import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { clearDemoExternal, clearDemoPostgres } from './clear-demo';
import { createNeo4j } from './neo4j-runner';
import { QdrantClient } from '@qdrant/js-client-rest';

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const neo = createNeo4j();
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pg = await clearDemoPostgres(client);
    await client.query('COMMIT');

    const ext = await clearDemoExternal(mongo.db('verto'), neo.run, qdrant);
    console.log(
      `Törölve: ${pg.projects} demó projekt, ${pg.users} demó felhasználó, ${ext.payloads} Mongo-payload, a demó Neo4j-csúcsok (és minden hozzájuk tartozó Postgres-adat).`,
    );
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
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