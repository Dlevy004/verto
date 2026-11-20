import neo4j, { Driver } from 'neo4j-driver';
import { CypherRunner, CypherTransaction } from '../graph/graph-sync';
import { CypherRead } from '../engine/signals';

export function createNeo4j(): {
  driver: Driver;
  run: CypherRunner;
  runTx: CypherTransaction;
  read: CypherRead;
} {
  const driver = neo4j.driver(
    process.env.NEO4J_URL!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
  );

  const run: CypherRunner = async (cypher, params = {}) => {
    const session = driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  };

  const runTx: CypherTransaction = async (work) => {
    const session = driver.session();
    try {
      return await session.executeWrite((tx) =>
        work(async (cypher, params = {}) => tx.run(cypher, params)),
      );
    } finally {
      await session.close();
    }
  };

  const read: CypherRead = async (cypher, params = {}) => {
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(cypher, params);
      return result.records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  };

  return { driver, run, runTx, read };
}