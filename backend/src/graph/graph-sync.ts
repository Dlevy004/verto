import neo4j from 'neo4j-driver';
import { Pool } from 'pg';

export type CypherRunner = (
  cypher: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Atomic Neo4j transaction wrapper: if any statement inside `work` throws,
 * all changes roll back and the previous graph state remains untouched.
 */
export type CypherTransaction = <T>(
  work: (run: CypherRunner) => Promise<T>,
) => Promise<T>;

export interface GraphSyncResult {
  modules: number;
  requests: number;
  dependsOn: number;
  touches: number;
}

/**
 * Only reads modules, dependencies, requests, and request-module links from PostgreSQL
 * inside a single `REPEATABLE READ READ ONLY` transaction to guarantee a consistent
 * point-in-time snapshot across all four queries.
 */
async function readSnapshot(pool: Pool, projectIds?: string[]) {
  const scoped = projectIds !== undefined;
  const params = scoped ? [projectIds] : [];
  const client = await pool.connect();
  try {
    // freezes the current state of the DB, when the transaction started
    // BEGIN: open an isolated "workspace" / transaction
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
      id: string;
      seq: number;
      project_id: string;
      status: string;
      is_demo: boolean;
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
    // If everything has proceeded correctly, it finalizes the transaction.
    // Since this is a read-only transaction, the COMMIT does not finalize any writes here;
    // instead, it simply closes the frozen read state.
    await client.query('COMMIT');
    return {
      modules: modules.rows,
      deps: deps.rows,
      requests: requests.rows,
      touches: touches.rows,
    };
  } catch (e) {
    // If any error occurs within the `try` block, the rollback reverts everything,
    // so the database remains in its previous valid state.
    await client.query('ROLLBACK');
    throw e;
  } finally {
    // `client.release()` does not close the TCP connection to PostgreSQL; instead,
    // it returns it to the pool so that the next request can use it.
    client.release();
  }
}

/**
 * Rebuilds the derived Neo4j dependency graph from PostgreSQL.
 *
 * - When `projectIds` is provided, only those projects' subgraphs are replaced;
 *   otherwise all `:Module` and `:Request` nodes are rebuilt globally.
 * - Executes all Neo4j writes inside a single `CypherTransaction` using batched `UNWIND`.
 */
export async function syncGraph(
  pool: Pool,
  runTx: CypherTransaction,
  projectIds?: string[],
): Promise<GraphSyncResult> {
  const snap = await readSnapshot(pool, projectIds);

  await runTx(async (run) => {
    // 1) delete existing nodes - and their edges - for the given projects (or all nodes if no projectIds)
    if (projectIds !== undefined) {
      await run('MATCH (n) WHERE n.project_id IN $ids DETACH DELETE n', {
        ids: projectIds,
      });
    } else {
      await run('MATCH (n) WHERE n:Module OR n:Request DETACH DELETE n');
    }

    // 2a) create module nodes
    await run(
      `UNWIND $rows AS row
       MERGE (m:Module {id: row.id})
       SET m.project_id = row.project_id, m.name = row.name, m.kind = row.kind,
           m.frozen = row.frozen, m.is_demo = row.is_demo, m.refreshed_at = datetime()`,
      { rows: snap.modules },
    );
    // 2b) create request nodes
    await run(
      `UNWIND $rows AS row
       MERGE (r:Request {id: row.id})
       SET r.seq = row.seq, r.project_id = row.project_id, r.status = row.status,
           r.is_demo = row.is_demo, r.refreshed_at = datetime()`,
      { rows: snap.requests.map((r) => ({ ...r, seq: neo4j.int(r.seq) })) },
    );

    // 3a) create module edges
    await run(
      `UNWIND $rows AS row
       MATCH (a:Module {id: row.from_id})
       MATCH (b:Module {id: row.to_id})
       MERGE (a)-[:DEPENDS_ON]->(b)`,
      { rows: snap.deps },
    );
    // 3b) create request edges
    await run(
      `UNWIND $rows AS row
       MATCH (r:Request {id: row.request_id})
       MATCH (m:Module {id: row.module_id})
       MERGE (r)-[:TOUCHES]->(m)`,
      { rows: snap.touches },
    );
  });
  // the module is a unit of the software product
  // the request is the change request from clients

  return {
    modules: snap.modules.length,
    requests: snap.requests.length,
    dependsOn: snap.deps.length,
    touches: snap.touches.length,
  };
}