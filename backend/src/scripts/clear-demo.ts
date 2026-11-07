import { Db } from 'mongodb';
import { PoolClient } from 'pg';
import { CypherRunner } from '../graph/graph-sync';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QDRANT_COLLECTION } from '../vectors/vector-sync';

/** A Postgres-rész (a forrás). Tranzakción belül hívandó. */
export async function clearDemoPostgres(client: PoolClient) {
  // A kéréseket előre töröljük: a request_module.module_id és az hours_reservation.budget_id
  // külső kulcsai NO ACTION típusúak, ezért a projekt-kaszkád módosítás nélkül ütközne.
  await client.query(
    `DELETE FROM change_request WHERE project_id IN (SELECT id FROM project WHERE is_demo)`,
  );
  const projects = await client.query('DELETE FROM project WHERE is_demo');
  const users = await client.query('DELETE FROM app_user WHERE is_demo');

  // ha nem maradt valódi kérés, a #VR sorszámok újra 1-ről indulnak
  const left = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM change_request');
  if (left.rows[0].n === 0) {
    await client.query('ALTER TABLE change_request ALTER COLUMN seq RESTART WITH 1');
  }

  return { projects: projects.rowCount ?? 0, users: users.rowCount ?? 0 };
}

/** A másolatok (Mongo, Neo4j, Qdrant). Csak a Postgres commit UTÁN hívandó. */
export async function clearDemoExternal(mongo: Db, run: CypherRunner, qdrant: QdrantClient) {
  const payloads = await mongo.collection('request_payloads').deleteMany({ is_demo: true });
  await run('MATCH (n) WHERE n.is_demo = true DETACH DELETE n');

  // a pgvector-sorok a projekt törlésekor kaszkáddal törlődtek, a Qdrantban jelölő alapján törlünk
  const { collections } = await qdrant.getCollections();
  if (collections.some((c) => c.name === QDRANT_COLLECTION)) {
    await qdrant.delete(QDRANT_COLLECTION, {
      wait: true,
      filter: { must: [{ key: 'is_demo', match: { value: true } }] },
    });
  }
  // TODO (később): Redis, ugyanígy jelölő alapján

  return { payloads: payloads.deletedCount };
}