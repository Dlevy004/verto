import { Pool } from 'pg';
import { syncGraph } from '../graph/graph-sync';
import { createNeo4j } from './neo4j-runner';

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const neo = createNeo4j();
  try {
        const result = await syncGraph(pool, neo.runTx);
    console.table(result);
  } finally {
    await pool.end();
    await neo.driver.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});