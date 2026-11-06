import { PoolClient } from 'pg';

export async function clearDemoData(client: PoolClient) {
  // TODO (a további tárak seedelésekor): itt gyűjtjük ki a demó projekt-id-kat,
  // és törlünk velük a Mongóból, a Neo4j-ból, a Qdrantból és a Redisből.
  const projects = await client.query('DELETE FROM project WHERE is_demo');
  const users = await client.query('DELETE FROM app_user WHERE is_demo');
  return { projects: projects.rowCount ?? 0, users: users.rowCount ?? 0 };
}