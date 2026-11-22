import { QdrantClient } from '@qdrant/js-client-rest';
import { Pool } from 'pg';
import { QDRANT_COLLECTION } from './vector-sync';

export type ContractKind = 'INCLUDED' | 'EXCLUDED';

export interface PassageHit {
  id: string;
  sim: number;
  kind: ContractKind;
  category: string;
  text: string;
}

export interface DuplicateHit {
  requestId: string;
  textId: string;
  sim: number;
}

const toVector = (v: number[]) => `[${v.join(',')}]`;

/** pgvector: a legközelebbi szerződés-passzusok egyetlen SQL-ben, joinolva a passzus-táblával. */
export async function searchPassagesPg(
  pool: Pool,
  vec: number[],
  projectId: string,
  k: number,
): Promise<PassageHit[]> {
  const r = await pool.query<PassageHit>(
    `SELECT cp.id, 1 - (e.embedding <=> $1::vector) AS sim, cp.kind, cp.category, cp.text
     FROM doc_embedding e
     JOIN contract_passage cp ON cp.id = e.id
     WHERE e.doc_type = 'contract_passage' AND e.project_id = $2
     ORDER BY e.embedding <=> $1::vector
     LIMIT $3`,
    [toVector(vec), projectId, k],
  );
  return r.rows;
}

/** Qdrant: a szűrt keresés után egy második Postgres-lekérdezés hozza a passzusok adatait. */
export async function searchPassagesQdrant(
  pool: Pool,
  qdrant: QdrantClient,
  vec: number[],
  projectId: string,
  k: number,
): Promise<PassageHit[]> {
  const res = await qdrant.query(QDRANT_COLLECTION, {
    query: vec,
    limit: k,
    with_payload: true,
    filter: {
      must: [
        { key: 'project_id', match: { value: projectId } },
        { key: 'doc_type', match: { value: 'contract_passage' } },
      ],
    },
  });
  const scored = res.points.map((p) => ({
    id: (p.payload as { text_id: string }).text_id,
    sim: p.score,
  }));
  if (scored.length === 0) return [];

  const rows = await pool.query<{ id: string; kind: ContractKind; category: string; text: string }>(
    'SELECT id, kind, category, text FROM contract_passage WHERE id = ANY($1::text[])',
    [scored.map((s) => s.id)],
  );
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  return scored.flatMap((s) => {
    const row = byId.get(s.id);
    return row ? [{ ...row, sim: s.sim }] : [];
  });
}

/**
 * pgvector: a legközelebbi korábbi kérés ugyanabban a projektben.
 * Kizárjuk a kérést magát, a később keletkezetteket és az elutasított/visszavont kéréseket.
 */
export async function searchDuplicatePg(
  pool: Pool,
  vec: number[],
  projectId: string,
  excludeRequestId: string | null,
  before: Date,
): Promise<DuplicateHit | null> {
  const r = await pool.query<{ text_id: string; request_id: string; sim: number }>(
    `SELECT e.id AS text_id, e.source_id AS request_id, 1 - (e.embedding <=> $1::vector) AS sim
     FROM doc_embedding e
     JOIN change_request cr ON cr.id::text = e.source_id
     WHERE e.doc_type = 'past_request'
       AND e.project_id = $2
       AND ($3::uuid IS NULL OR cr.id <> $3::uuid)
       AND cr.created_at < $4
       AND cr.status NOT IN ('REJECTED', 'CANCELLED')
     ORDER BY e.embedding <=> $1::vector
     LIMIT 1`,
    [toVector(vec), projectId, excludeRequestId, before],
  );
  const row = r.rows[0];
  return row ? { requestId: row.request_id, textId: row.text_id, sim: row.sim } : null;
}

/**
 * Qdrant: ranked candidates are fetched page by page and checked against PostgreSQL
 * (creation time, status) until an eligible request is found or the search is exhausted.
 */
export async function searchDuplicateQdrant(
  pool: Pool,
  qdrant: QdrantClient,
  vec: number[],
  projectId: string,
  excludeRequestId: string | null,
  before: Date,
): Promise<DuplicateHit | null> {
  const PAGE_SIZE = 10;
  const MAX_SCANNED = 1000; // safety cap for very large corpora
  const filter = {
    must: [
      { key: 'project_id', match: { value: projectId } },
      { key: 'doc_type', match: { value: 'past_request' } },
    ],
    ...(excludeRequestId
      ? { must_not: [{ key: 'source_id', match: { value: excludeRequestId } }] }
      : {}),
  };

  for (let offset = 0; offset < MAX_SCANNED; offset += PAGE_SIZE) {
    const res = await qdrant.query(QDRANT_COLLECTION, {
      query: vec,
      limit: PAGE_SIZE,
      offset,
      with_payload: true,
      filter,
    });
    const candidates = res.points.map((p) => {
      const payload = p.payload as { text_id: string; source_id: string };
      return { textId: payload.text_id, requestId: payload.source_id, sim: p.score };
    });
    if (candidates.length === 0) return null;

    const ok = await pool.query<{ id: string }>(
      `SELECT id::text AS id FROM change_request
        WHERE id = ANY($1::uuid[]) AND created_at < $2 AND status NOT IN ('REJECTED', 'CANCELLED')`,
      [candidates.map((c) => c.requestId), before],
    );
    const allowed = new Set(ok.rows.map((r) => r.id));
    const hit = candidates.find((c) => allowed.has(c.requestId));
    if (hit) return hit; // the first eligible candidate in rank order wins

    if (candidates.length < PAGE_SIZE) return null; // the search is exhausted
  }
  return null;
}