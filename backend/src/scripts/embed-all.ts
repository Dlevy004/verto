import { QdrantClient } from '@qdrant/js-client-rest';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { syncVectors } from '../vectors/vector-sync';

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });

  const totals = { projects: 0, passages: 0, requests: 0 };
  const failures: { project: string; error: string }[] = [];

  try {
    const projects = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM project ORDER BY name',
    );
    console.time('embed');
    for (const p of projects.rows) {
      try {
        const r = await syncVectors(pool, mongo.db('verto'), qdrant, [p.id]);
        totals.projects++;
        totals.passages += r.passages;
        totals.requests += r.requests;
      } catch (e) {
        failures.push({ project: p.name, error: (e as Error).message });
      }
    }
    console.timeEnd('embed');
    console.table(totals);

    if (failures.length > 0) {
      console.error(`${failures.length} projekt feldolgozása hibázott (a többi rendben lefutott):`);
      console.table(failures);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
    await mongo.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});