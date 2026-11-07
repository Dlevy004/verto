import { QdrantClient } from '@qdrant/js-client-rest';
import { Pool } from 'pg';
import { embed } from '../embeddings/embedder';
import { QDRANT_COLLECTION } from '../vectors/vector-sync';

async function main() {
  const query = process.argv[2] ?? 'Customers want to pay with Apple Pay at checkout';
  const projectName = process.argv[3] ?? 'Acme';

  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });
  try {
    const project = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM project WHERE name ILIKE $1 ORDER BY name LIMIT 1`,
      [`%${projectName}%`],
    );
    if (!project.rows[0]) throw new Error(`Nincs ilyen projekt: ${projectName}`);
    const { id: projectId, name } = project.rows[0];
    console.log(`Lekérdezés: "${query}"\nProjekt: ${name}\n`);

    const [vec] = await embed([query]);
    const vecText = `[${vec.join(',')}]`;

    const pg = await pool.query(
      `SELECT id, doc_type, round((1 - (embedding <=> $1::vector))::numeric, 4) AS cos_sim
       FROM doc_embedding
       WHERE project_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      [vecText, projectId],
    );
    console.log('pgvector:');
    console.table(pg.rows);

    const q = await qdrant.query(QDRANT_COLLECTION, {
      query: vec,
      limit: 5,
      with_payload: true,
      filter: { must: [{ key: 'project_id', match: { value: projectId } }] },
    });
    console.log('Qdrant:');
    console.table(
      q.points.map((p) => ({
        id: (p.payload as { text_id: string }).text_id,
        doc_type: (p.payload as { doc_type: string }).doc_type,
        cos_sim: Number(p.score.toFixed(4)),
      })),
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});