import { QdrantClient } from '@qdrant/js-client-rest';
import { Db } from 'mongodb';
import { Pool } from 'pg';
import { uuidv5 } from '../common/ids';
import { EMBEDDING_DIM, embed } from '../embeddings/embedder';

export const QDRANT_COLLECTION = 'doc_embedding';
// ugyanezek a paraméterek a pgvector indexben (db/postgres/init.sql)
export const HNSW = { m: 16, ef_construction: 64 } as const;

interface VectorDoc {
  id: string; // text id: dcp-0001 | drq-0001
  docType: 'contract_passage' | 'past_request';
  projectId: string;
  category: string;
  sourceId: string;
  isDemo: boolean;
  text: string;
}

interface PassageRow {
  id: string; category: string; text: string; project_id: string; is_demo: boolean;
}
interface RequestRow {
  id: string; seq: number; category: string; title: string; project_id: string; is_demo: boolean;
}

const toVector = (v: number[]) => `[${v.join(',')}]`;

export async function ensureQdrantCollection(qdrant: QdrantClient) {
  const { collections } = await qdrant.getCollections();
  if (!collections.some((c) => c.name === QDRANT_COLLECTION)) {
    await qdrant.createCollection(QDRANT_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
      hnsw_config: { m: HNSW.m, ef_construct: HNSW.ef_construction },
    });
  }
  const info = await qdrant.getCollection(QDRANT_COLLECTION);
  const existing = new Set(Object.keys(info.payload_schema ?? {}));
  const indexes = [
    ['project_id', 'keyword'],
    ['doc_type', 'keyword'],
    ['category', 'keyword'],
    ['is_demo', 'bool'],
  ] as const;
  for (const [field, schema] of indexes) {
    if (!existing.has(field)) {
      await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
        field_name: field,
        field_schema: schema,
        wait: true,
      });
    }
  }
}

async function loadDocs(pool: Pool, mongo: Db, projectIds: string[]): Promise<VectorDoc[]> {
  const passages = await pool.query<PassageRow>(
    `SELECT cp.id, cp.category, cp.text, c.project_id, p.is_demo
     FROM contract_passage cp
     JOIN contract c ON c.id = cp.contract_id
     JOIN project p ON p.id = c.project_id
     WHERE c.project_id = ANY($1::uuid[])
     ORDER BY cp.id`,
    [projectIds],
  );
  const requests = await pool.query<RequestRow>(
    `SELECT cr.id, cr.seq, cr.type::text AS category, cr.title, cr.project_id, p.is_demo
     FROM change_request cr
     JOIN project p ON p.id = cr.project_id
     WHERE cr.project_id = ANY($1::uuid[])
     ORDER BY cr.seq`,
    [projectIds],
  );

  // a kérések leírása az eredeti Mongo-dokumentumból jön
  const payloads = await mongo
    .collection('request_payloads')
    .find(
      { request_id: { $in: requests.rows.map((r) => r.id) } },
      { projection: { request_id: 1, markdown_raw: 1 } },
    )
    .toArray();
  const bodyByRequest = new Map<string, string>(
    payloads.map((p) => [p.request_id as string, p.markdown_raw as string]),
  );

  const docs: VectorDoc[] = passages.rows.map((p) => ({
    id: p.id,
    docType: 'contract_passage',
    projectId: p.project_id,
    category: p.category,
    sourceId: p.id,
    isDemo: p.is_demo,
    text: p.text,
  }));

  for (const r of requests.rows) {
    const body = bodyByRequest.get(r.id);
    if (!body) throw new Error(`Hiányzó Mongo-payload a kéréshez: ${r.id}`);
    docs.push({
      id: `${r.is_demo ? 'drq' : 'rq'}-${String(r.seq).padStart(4, '0')}`,
      docType: 'past_request',
      projectId: r.project_id,
      category: r.category,
      sourceId: r.id,
      isDemo: r.is_demo,
      text: `${r.title}\n${body}`,
    });
  }
  return docs;
}

export interface VectorSyncResult {
  passages: number;
  requests: number;
}

/**
 * A megadott projektek vektorainak újraépítése a Postgres és a Mongo adataiból,
 * ugyanazokkal a vektorokkal a pgvectorban és a Qdrantban.
 */
export async function syncVectors(
  pool: Pool,
  mongo: Db,
  qdrant: QdrantClient,
  projectIds: string[],
): Promise<VectorSyncResult> {
  await ensureQdrantCollection(qdrant);
  if (projectIds.length === 0) return { passages: 0, requests: 0 };

  const docs = await loadDocs(pool, mongo, projectIds);
  const vectors = await embed(docs.map((d) => d.text));
  const refreshedAt = new Date();

  // pgvector: egy tranzakcióban
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM doc_embedding WHERE project_id = ANY($1::uuid[])', [projectIds]);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      await client.query(
        `INSERT INTO doc_embedding
           (id, doc_type, project_id, category, source_id, refreshed_at, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [d.id, d.docType, d.projectId, d.category, d.sourceId, refreshedAt, toVector(vectors[i])],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Qdrant: a pont-id a text id-ből képzett UUID, a text id a payloadban marad
  await qdrant.delete(QDRANT_COLLECTION, {
    wait: true,
    filter: { must: [{ key: 'project_id', match: { any: projectIds } }] },
  });
  const BATCH = 100;
  for (let i = 0; i < docs.length; i += BATCH) {
    const points = docs.slice(i, i + BATCH).map((d, j) => ({
      id: uuidv5(`vector:${d.id}`),
      vector: vectors[i + j],
      payload: {
        text_id: d.id,
        doc_type: d.docType,
        project_id: d.projectId,
        category: d.category,
        source_id: d.sourceId,
        refreshed_at: refreshedAt.toISOString(),
        is_demo: d.isDemo,
      },
    }));
    await qdrant.upsert(QDRANT_COLLECTION, { wait: true, points });
  }

  return {
    passages: docs.filter((d) => d.docType === 'contract_passage').length,
    requests: docs.filter((d) => d.docType === 'past_request').length,
  };
}