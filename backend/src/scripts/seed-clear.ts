import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { clearDemoData } from './clear-demo';
import { createNeo4j } from './neo4j-runner';

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const neo = createNeo4j();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await clearDemoData(client, mongo.db('verto'), neo.run);
    await client.query('COMMIT');
    console.log(
      `Törölve: ${r.projects} demó projekt, ${r.users} demó felhasználó, ${r.payloads} Mongo-payload, a demó Neo4j-csúcsok (és minden hozzájuk tartozó Postgres-adat).`,
    );
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
    await mongo.close();
    await neo.driver.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});