import neo4j, { Driver } from 'neo4j-driver';
import { CypherRunner } from '../graph/graph-sync';

export function createNeo4j(): { driver: Driver; run: CypherRunner } {
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
  return { driver, run };
}