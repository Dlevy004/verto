import { Pool } from 'pg';
import { clearDemoData } from './clear-demo';

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await clearDemoData(client);
    await client.query('COMMIT');
    console.log(`Törölve: ${result.projects} demó projekt, ${result.users} demó felhasználó (és minden hozzájuk tartozó adat).`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});