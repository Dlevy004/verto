import neo4j from 'neo4j-driver';
import { Pool } from 'pg';

export type CypherRunner = (
  cypher: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Egyetlen Neo4j-tranzakció: ha bármi hibázik, a korábbi gráf érintetlen marad. */
export type CypherTransaction = <T>(work: (run: CypherRunner) => Promise<T>) => Promise<T>;

export interface GraphSyncResult {
  modules: number;
  requests: number;
  dependsOn: number;
  touches: number;
}

/** A forrásadat egyetlen konzisztens pillanatképből (repeatable read). */
async function readSnapshot(pool: Pool, projectIds?: string[]) {
  const scoped = projectIds !== undefined;
  const params = scoped ? [projectIds] : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const modules = await client.query(
      `SELECT m.id, m.project_id, m.name, m.kind, m.frozen, p.is_demo
       FROM module m JOIN project p ON p.id = m.project_id
       ${scoped ? 'WHERE m.project_id = ANY($1::uuid[])' : ''}`,
      params,
    );
    const deps = await client.query(
      `SELECT d.from_module AS from_id, d.to_module AS to_id
       FROM module_dependency d JOIN module m ON m.id = d.from_module
       ${scoped ? 'WHERE m.project_id = ANY($1::uuid[])' : ''}`,
      params,
    );
    const requests = await client.query<{
      id: string; seq: number; project_id: string; status: string; is_demo: boolean;
    }>(
      `SELECT cr.id, cr.seq, cr.project_id, cr.status::text AS status, p.is_demo
       FROM change_request cr JOIN project p ON p.id = cr.project_id
       ${scoped ? 'WHERE cr.project_id = ANY($1::uuid[])' : ''}`,
      params,
    );
    const touches = await client.query(
      `SELECT rm.request_id, rm.module_id
       FROM request_module rm JOIN change_request cr ON cr.id = rm.request_id
       ${scoped ? 'WHERE cr.project_id = ANY($1::uuid[])' : ''}`,
      params,
    );
    await client.query('COMMIT');
    return {
      modules: modules.rows,
      deps: deps.rows,
      requests: requests.rows,
      touches: touches.rows,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A Neo4j gráf újraépítése a Postgresből.
 * Ha projectIds meg van adva, csak azokat a projekteket építi újra, különben az egészet.
 */
export async function syncGraph(
  pool: Pool,
  runTx: CypherTransaction,
  projectIds?: string[],
): Promise<GraphSyncResult> {
  const snap = await readSnapshot(pool, projectIds);

  await runTx(async (run) => {
    // 1) a régi másolat törlése
    if (projectIds !== undefined) {
      await run('MATCH (n) WHERE n.project_id IN $ids DETACH DELETE n', { ids: projectIds });
    } else {
      await run('MATCH (n) WHERE n:Module OR n:Request DETACH DELETE n');
    }

    // 2) csúcsok
    await run(
      `UNWIND $rows AS row
       MERGE (m:Module {id: row.id})
       SET m.project_id = row.project_id, m.name = row.name, m.kind = row.kind,
           m.frozen = row.frozen, m.is_demo = row.is_demo, m.refreshed_at = datetime()`,
      { rows: snap.modules },
    );
    await run(
      `UNWIND $rows AS row
       MERGE (r:Request {id: row.id})
       SET r.seq = row.seq, r.project_id = row.project_id, r.status = row.status,
           r.is_demo = row.is_demo, r.refreshed_at = datetime()`,
      { rows: snap.requests.map((r) => ({ ...r, seq: neo4j.int(r.seq) })) },
    );

    // 3) élek
    await run(
      `UNWIND $rows AS row
       MATCH (a:Module {id: row.from_id})
       MATCH (b:Module {id: row.to_id})
       MERGE (a)-[:DEPENDS_ON]->(b)`,
      { rows: snap.deps },
    );
    await run(
      `UNWIND $rows AS row
       MATCH (r:Request {id: row.request_id})
       MATCH (m:Module {id: row.module_id})
       MERGE (r)-[:TOUCHES]->(m)`,
      { rows: snap.touches },
    );
  });

  return {
    modules: snap.modules.length,
    requests: snap.requests.length,
    dependsOn: snap.deps.length,
    touches: snap.touches.length,
  };
}