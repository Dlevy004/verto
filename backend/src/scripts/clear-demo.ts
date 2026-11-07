import { Db } from 'mongodb';
import { PoolClient } from 'pg';
import { CypherRunner } from '../graph/graph-sync';

export async function clearDemoData(client: PoolClient, mongo: Db, run: CypherRunner) {
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

  // A többi tár a Postgres után jön: ha a fenti hibázik, azok érintetlenek maradnak.
  // A dokumentumokat és csúcsokat a saját jelölőjük alapján töröljük.
  const payloads = await mongo.collection('request_payloads').deleteMany({ is_demo: true });
  await run('MATCH (n) WHERE n.is_demo = true DETACH DELETE n');
  // TODO (a további tárak seedelésekor): Qdrant, Redis, ugyanígy jelölő alapján

  return {
    projects: projects.rowCount ?? 0,
    users: users.rowCount ?? 0,
    payloads: payloads.deletedCount,
  };
}