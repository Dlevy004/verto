import { QdrantClient } from '@qdrant/js-client-rest';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import {
  decisionKey,
  fillDecisionCache,
  getDecision,
  invalidateDecision,
  readGeneration,
  toCachedDecision,
} from '../engine/decision-cache';
import { loadLatestDecision, saveDecision } from '../engine/decision-store';
import { ENGINE_CONFIG } from '../engine/engine.config';
import { triageRequest } from '../engine/triage';
import { createNeo4j } from './neo4j-runner';


async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });
  const redis = new Redis(process.env.REDIS_URL!);
  const neo = createNeo4j();
  let requestId: string | null = null;
  const demoDecisionIds: string[] = [];

  try {
    const first = await pool.query<{ id: string; seq: number; title: string }>(
      `SELECT cr.id, cr.seq, cr.title
         FROM change_request cr JOIN project p ON p.id = cr.project_id
        WHERE p.is_demo AND p.name ILIKE '%Acme%'
        ORDER BY cr.seq LIMIT 1`,
    );
    const request = first.rows[0];
    if (!request) throw new Error('No demo request found. Run `pnpm seed` first.');
    requestId = request.id;
    console.log(`Request #${request.seq}: ${request.title}`);

    const deps = {
      pool,
      mongo: mongo.db('verto'),
      qdrant,
      redis,
      read: neo.read,
      config: ENGINE_CONFIG,
    };

    // 1) the triage lock
    console.log('\n1) Two triage runs for the same request at the same time:');
    const runs = await Promise.all([
      triageRequest(deps, request.id),
      triageRequest(deps, request.id),
    ]);
    for (const run of runs) {
      if (run.status === 'decided') demoDecisionIds.push(run.decisionId);
    }
    console.table(
      runs.map((r, i) => ({
        run: i + 1,
        outcome: r.status,
        verdict: r.status === 'decided' ? r.evaluation.result.verdict : '-',
      })),
    );

    // 2) cache-aside
    console.log('2) Cache-aside read:');
    await invalidateDecision(redis, request.id);
    const miss = await getDecision(redis, pool, request.id);
    const hit = await getDecision(redis, pool, request.id);
    console.table([
      { read: 1, source: miss.source, verdict: miss.decision?.verdict },
      { read: 2, source: hit.source, verdict: hit.decision?.verdict },
    ]);
    console.log(
      `   key: ${decisionKey(request.id)}\n` +
        `   TTL left: ${await redis.ttl(decisionKey(request.id))} s, ` +
        `source_id: ${hit.decision?.source_id}, refreshed_at: ${hit.decision?.refreshed_at}`,
    );

    // 3) a stale cache entry
    console.log('\n3) A stale cache entry:');
    const before = hit.decision;
    if (!before) throw new Error('Expected a cached decision');
    const changedVerdict = before.verdict === 'SCOPE_CREEP' ? 'IN_SCOPE' : 'SCOPE_CREEP';

    // simulates an update path that writes a new decision but forgets to invalidate the cache
    const demoSave = await saveDecision(pool, {
      requestId: request.id,
      verdict: changedVerdict,
      reasonCodes: ['DEMO_CHANGE'],
      signals: { demo: true },
      decidedBy: 'DEMO',
    });
    demoDecisionIds.push(demoSave.id);
    const stale = await getDecision(redis, pool, request.id);

    // the fix: delete the key in the same update path (after the commit)
    await invalidateDecision(redis, request.id);
    const fresh = await getDecision(redis, pool, request.id);

    console.table([
      { step: 'PostgreSQL now holds', source: 'postgres', verdict: changedVerdict },
      { step: 'read without invalidation', source: stale.source, verdict: stale.decision?.verdict },
      { step: 'read after DEL', source: fresh.source, verdict: fresh.decision?.verdict },
    ]);

    // 4) the fenced fill
    console.log('\n4) A cache fill from a read that started before an invalidation:');
    await invalidateDecision(redis, request.id);
    const generation = await readGeneration(redis, request.id); // the reader notes the generation...
    const oldRow = await loadLatestDecision(pool, request.id); // ...then reads PostgreSQL
    await invalidateDecision(redis, request.id); // a writer commits and invalidates in between
    const published = oldRow
      ? await fillDecisionCache(redis, request.id, generation, toCachedDecision(oldRow))
      : false;
    console.table([
      { check: 'late fill was published', result: published },
      { check: 'cache key exists afterwards', result: (await redis.exists(decisionKey(request.id))) === 1 },
    ]);
  } finally {
    if (requestId) {
      await pool.query('DELETE FROM decision WHERE id = ANY($1)', [demoDecisionIds]);
      await invalidateDecision(redis, requestId);
      console.log('\nDemo data restored.');
    }
    await pool.end();
    await mongo.close();
    redis.disconnect();
    await neo.driver.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});