import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, QueryResult } from 'neo4j-driver';

/**
 * Idempotent Cypher DDL statements applied on backend startup (`OnModuleInit`).
 * Ensures unique node identities (`:Module`, `:Request`) and project-scoped lookup speed.
 */
const SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT module_id IF NOT EXISTS FOR (m:Module) REQUIRE m.id IS UNIQUE',
  'CREATE CONSTRAINT request_id IF NOT EXISTS FOR (r:Request) REQUIRE r.id IS UNIQUE',
  'CREATE INDEX module_project IF NOT EXISTS FOR (m:Module) ON (m.project_id)',
];

/**
 * Singleton wrapper around the official `neo4j-driver` over the Bolt protocol.
 *
 * Manages the Neo4j connection pool, applies idempotent uniqueness constraints and
 * indexes on startup, provides a session-safe `run()` helper for Cypher queries,
 * and closes the driver cleanly on application shutdown.
 *
 * @see GraphModule (`backend/src/graph/graph.modul.ts`) where this service is registered globally.
 * @see syncGraph (`backend/src/scripts/sync-graph.ts`) which projects PostgreSQL modules and requests into this graph.
 */
@Injectable()
export class GraphService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphService.name);
  private readonly driver: Driver;

  constructor(config: ConfigService) {
    this.driver = neo4j.driver(
      config.getOrThrow<string>('NEO4J_URL'),
      neo4j.auth.basic(
        config.getOrThrow<string>('NEO4J_USER'),
        config.getOrThrow<string>('NEO4J_PASSWORD'),
      ),
    );
  }

  /**
   * Ensures required Neo4j uniqueness constraints and indexes exist on startup.
   * Safe to run on every boot because all statements use `IF NOT EXISTS`.
   */
  async onModuleInit() {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.run(statement);
    }
    this.logger.log('Neo4j constraints and indexes are in place');
  }

  /**
   * Executes a parameterized Cypher query inside a short-lived session and
   * guarantees session cleanup in `finally`.
   *
   * @param cypher - Cypher query string (use `$param` placeholders instead of string interpolation).
   * @param params - Key-value parameter map bound to the Cypher query.
   */
  async run(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<QueryResult> {
    const session = this.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy() {
    await this.driver.close();
  }
}