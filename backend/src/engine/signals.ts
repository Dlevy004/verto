import { QdrantClient } from '@qdrant/js-client-rest';
import { Db } from 'mongodb';
import { Pool } from 'pg';
import { embed } from '../embeddings/embedder';
import {
  searchDuplicatePg,
  searchDuplicateQdrant,
  searchPassagesPg,
  searchPassagesQdrant,
} from '../vectors/vector-search';
import {
  DecisionConfig,
  DecisionResult,
  DecisionSignals,
  RequestType,
  decide,
  estimateHours,
} from './decide';

/** Olvasó Cypher-hívás: a sorokat sima objektumként adja vissza. */
export type CypherRead = (
  cypher: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>[]>;

export interface RequestInput {
  requestId?: string; // meglévő kérésnél: a saját vektorát kizárjuk a duplikátum-keresésből
  projectId: string;
  type: RequestType;
  title: string;
  body: string;
  moduleIds: string[];
  createdAt: Date;
  regressionOfDelivered: boolean; // a Mongo-payloadból
}

export interface EngineDeps {
  pool: Pool;
  qdrant: QdrantClient;
  read: CypherRead;
  config: DecisionConfig;
  primaryVector?: 'pgvector' | 'qdrant';
}

export interface Evaluation {
  result: DecisionResult;
  signals: DecisionSignals;
  detail: Record<string, unknown>; // az Inspector mátrixához és a decision.signals JSONB-hez
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Egy meglévő kérés bemenete a Postgresből és a Mongóból. */
export async function loadRequestInput(
  pool: Pool,
  mongo: Db,
  requestId: string,
): Promise<RequestInput> {
  const r = await pool.query<{
    id: string; project_id: string; type: RequestType; title: string; created_at: Date;
  }>(
    `SELECT id, project_id, type::text AS type, title, created_at
     FROM change_request WHERE id = $1`,
    [requestId],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`Nincs ilyen kérés: ${requestId}`);

  const mods = await pool.query<{ module_id: string }>(
    'SELECT module_id FROM request_module WHERE request_id = $1',
    [requestId],
  );
  const payload = await mongo.collection('request_payloads').findOne({ request_id: requestId });
  if (!payload) throw new Error(`Hiányzó Mongo-payload a kéréshez: ${requestId}`);
  const fields = payload.fields as { regression_of_delivered?: boolean } | undefined;

  return {
    requestId,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    body: payload.markdown_raw as string,
    moduleIds: mods.rows.map((m) => m.module_id),
    createdAt: row.created_at,
    regressionOfDelivered: fields?.regression_of_delivered === true,
  };
}

/** A jelzések összegyűjtése az öt tárból (Redis nélkül), majd a döntés. */
export async function evaluateRequest(deps: EngineDeps, input: RequestInput): Promise<Evaluation> {
  const { pool, qdrant, read, config } = deps;
  const primary = deps.primaryVector ?? 'pgvector';
  const excludeId = input.requestId ?? null;

  // ugyanaz a szövegformátum, mint a vektorok építésekor (vector-sync.ts)
  const [vec] = await embed([`${input.title}\n${input.body}`]);

  const [passagesPg, passagesQd, dupPg, dupQd, graphRows, budgetRows] = await Promise.all([
    searchPassagesPg(pool, vec, input.projectId, config.topK),
    searchPassagesQdrant(pool, qdrant, vec, input.projectId, config.topK),
    searchDuplicatePg(pool, vec, input.projectId, excludeId, input.createdAt),
    searchDuplicateQdrant(pool, qdrant, vec, input.projectId, excludeId, input.createdAt),
    // Neo4j: az érintett modulok és minden függőjük (max. 4 lépés), frozen jelzéssel
    read(
      `UNWIND $ids AS mid
       MATCH (m:Module {id: mid})
       MATCH (dep:Module)-[:DEPENDS_ON*0..4]->(m)
       RETURN DISTINCT dep.id AS id, dep.name AS name, dep.frozen AS frozen`,
      { ids: input.moduleIds },
    ),
    // Postgres: az aktuális havi óra-keret és a verziója
    pool.query<{ id: string; remaining_hours: number; version: number }>(
      `SELECT id, remaining_hours::float8 AS remaining_hours, version
       FROM retainer_budget
       WHERE project_id = $1 AND period = date_trunc('month', now())::date`,
      [input.projectId],
    ),
  ]);

  const passages = primary === 'pgvector' ? passagesPg : passagesQd;
  const dup = primary === 'pgvector' ? dupPg : dupQd;
  const shadowPassages = primary === 'pgvector' ? passagesQd : passagesPg;
  const shadowDup = primary === 'pgvector' ? dupQd : dupPg;
  const top = passages[0] ?? null;

  const modules = graphRows as { id: string; name: string; frozen: boolean }[];
  const frozen = modules.filter((m) => m.frozen === true);
  const budget = budgetRows.rows[0] ?? null;
  const remainingHours = budget?.remaining_hours ?? 0;

  const signals: DecisionSignals = {
    type: input.type,
    scopeSim: top?.sim ?? null,
    scopePassageId: top?.id ?? null,
    scopeKind: top?.kind ?? null,
    dupSim: dup?.sim ?? null,
    dupRequestId: dup?.requestId ?? null,
    affectedModules: modules.length,
    blockers: frozen.length,
    estHours: estimateHours(input.type, modules.length, config),
    remainingHours,
    regressionOfDelivered: input.regressionOfDelivered,
  };
  const result = decide(signals, config);

  const detail = {
    vector: {
      primary,
      passages: passages.map((p) => ({ id: p.id, sim: r4(p.sim), kind: p.kind })),
      duplicate: dup ? { requestId: dup.requestId, textId: dup.textId, sim: r4(dup.sim) } : null,
      shadow: {
        passageTop1: shadowPassages[0]
          ? { id: shadowPassages[0].id, sim: r4(shadowPassages[0].sim) }
          : null,
        sameTop1: passagesPg[0]?.id === passagesQd[0]?.id,
        duplicate: shadowDup ? { textId: shadowDup.textId, sim: r4(shadowDup.sim) } : null,
      },
    },
    graph: { affected: modules.map((m) => m.name), frozen: frozen.map((m) => m.name) },
    budget: budget ? { id: budget.id, version: budget.version, remainingHours } : null,
    mongo: { regressionOfDelivered: input.regressionOfDelivered },
  };

  return { result, signals, detail };
}