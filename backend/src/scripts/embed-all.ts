import { QdrantClient } from '@qdrant/js-client-rest';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { syncVectors } from '../vectors/vector-sync';

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });
  try {
    const projects = await pool.query<{ id: string }>('SELECT id FROM project');
    console.time('embed');
    const result = await syncVectors(pool, mongo.db('verto'), qdrant, projects.rows.map((r) => r.id));
    console.timeEnd('embed');
    console.table(result);
  } finally {
    await pool.end();
    await mongo.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});