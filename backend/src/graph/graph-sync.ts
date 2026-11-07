import neo4j from 'neo4j-driver';
import { Pool } from 'pg';

export type CypherRunner = (
  cypher: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

export interface GraphSyncResult {
  modules: number;
  requests: number;
  dependsOn: number;
  touches: number;
}

/**
 * A Neo4j gráf újraépítése a Postgresből.
 * Ha projectIds meg van adva, csak azokat a projekteket építi újra, különben az egészet.
 */
export async function syncGraph(
  pool: Pool,
  run: CypherRunner,
  projectIds?: string[],
): Promise<GraphSyncResult> {
  const scoped = projectIds !== undefined;
  const ids = projectIds ?? [];
  const params = scoped ? [ids] : [];

  const modules = await pool.query(
    `SELECT m.id, m.project_id, m.name, m.kind, m.frozen, p.is_demo
     FROM module m JOIN project p ON p.id = m.project_id
     ${scoped ? 'WHERE m.project_id = ANY($1::uuid[])' : ''}`,
    params,
  );
  const deps = await pool.query(
    `SELECT d.from_module AS from_id, d.to_module AS to_id
     FROM module_dependency d JOIN module m ON m.id = d.from_module
     ${scoped ? 'WHERE m.project_id = ANY($1::uuid[])' : ''}`,
    params,
  );
  const requests = await pool.query<{
    id: string; seq: number; project_id: string; status: string; is_demo: boolean;
  }>(
    `SELECT cr.id, cr.seq, cr.project_id, cr.status::text AS status, p.is_demo
     FROM change_request cr JOIN project p ON p.id = cr.project_id
     ${scoped ? 'WHERE cr.project_id = ANY($1::uuid[])' : ''}`,
    params,
  );
  const touches = await pool.query(
    `SELECT rm.request_id, rm.module_id
     FROM request_module rm JOIN change_request cr ON cr.id = rm.request_id
     ${scoped ? 'WHERE cr.project_id = ANY($1::uuid[])' : ''}`,
    params,
  );

  // 1) a régi másolat törlése
  if (scoped) {
    await run('MATCH (n) WHERE n.project_id IN $ids DETACH DELETE n', { ids });
  } else {
    await run('MATCH (n) WHERE n:Module OR n:Request DETACH DELETE n');
  }

  // 2) csúcsok
  await run(
    `UNWIND $rows AS row
     MERGE (m:Module {id: row.id})
     SET m.project_id = row.project_id, m.name = row.name, m.kind = row.kind,
         m.frozen = row.frozen, m.is_demo = row.is_demo, m.refreshed_at = datetime()`,
    { rows: modules.rows },
  );
  await run(
    `UNWIND $rows AS row
     MERGE (r:Request {id: row.id})
     SET r.seq = row.seq, r.project_id = row.project_id, r.status = row.status,
         r.is_demo = row.is_demo, r.refreshed_at = datetime()`,
    {
      rows: requests.rows.map((r) => ({ ...r, seq: neo4j.int(r.seq) })),
    },
  );

  // 3) élek
  await run(
    `UNWIND $rows AS row
     MATCH (a:Module {id: row.from_id})
     MATCH (b:Module {id: row.to_id})
     MERGE (a)-[:DEPENDS_ON]->(b)`,
    { rows: deps.rows },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (r:Request {id: row.request_id})
     MATCH (m:Module {id: row.module_id})
     MERGE (r)-[:TOUCHES]->(m)`,
    { rows: touches.rows },
  );

  return {
    modules: modules.rowCount ?? 0,
    requests: requests.rowCount ?? 0,
    dependsOn: deps.rowCount ?? 0,
    touches: touches.rowCount ?? 0,
  };
}