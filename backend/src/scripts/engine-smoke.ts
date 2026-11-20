import { QdrantClient } from '@qdrant/js-client-rest';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { ENGINE_CONFIG } from '../engine/engine.config';
import { evaluateRequest, loadRequestInput } from '../engine/signals';
import { createNeo4j } from './neo4j-runner';

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function main() {
  const limit = Number(process.argv[2] ?? 12);
  const projectName = process.argv[3] ?? 'Acme';

  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });
  const neo = createNeo4j();

  try {
    const rows = await pool.query<{
      id: string; seq: number; title: string; verdict: string | null; reason: string | null;
    }>(
      `SELECT cr.id, cr.seq, cr.title, d.verdict::text AS verdict, d.reason_codes[1] AS reason
       FROM change_request cr
       JOIN project p ON p.id = cr.project_id
       LEFT JOIN LATERAL (
         SELECT verdict, reason_codes FROM decision
         WHERE request_id = cr.id ORDER BY created_at DESC LIMIT 1
       ) d ON true
       WHERE p.name ILIKE $1
       ORDER BY cr.seq
       LIMIT $2`,
      [`%${projectName}%`, limit],
    );

    console.time('motor');
    const out = [];
    let same = 0;
    for (const row of rows.rows) {
      const input = await loadRequestInput(pool, mongo.db('verto'), row.id);
      const ev = await evaluateRequest(
        { pool, qdrant, read: neo.read, config: ENGINE_CONFIG },
        input,
      );
      if (ev.result.verdict === row.verdict) same++;
      out.push({
        seq: row.seq,
        title: cut(row.title, 30),
        seed: `${row.verdict ?? '-'} ${row.reason ?? ''}`.trim(),
        engine: `${ev.result.verdict} ${ev.result.reasonCodes[0]}`,
        scope: ev.signals.scopeSim?.toFixed(2) ?? '-',
        dup: ev.signals.dupSim?.toFixed(2) ?? '-',
        modules: ev.signals.affectedModules,
        blockers: ev.signals.blockers,
        est: ev.signals.estHours,
        left: ev.signals.remainingHours,
      });
    }
    console.timeEnd('motor');
    console.table(out);
    console.log(
      `Egyezés a seed címkéivel: ${same}/${rows.rows.length} (csak tájékoztató, NEM mérés)`,
    );
  } finally {
    await pool.end();
    await mongo.close();
    await neo.driver.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});