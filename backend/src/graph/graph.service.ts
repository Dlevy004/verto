import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, QueryResult } from 'neo4j-driver';

const SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT module_id IF NOT EXISTS FOR (m:Module) REQUIRE m.id IS UNIQUE',
  'CREATE CONSTRAINT request_id IF NOT EXISTS FOR (r:Request) REQUIRE r.id IS UNIQUE',
  'CREATE INDEX module_project IF NOT EXISTS FOR (m:Module) ON (m.project_id)',
];

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

  async onModuleInit() {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.run(statement);
    }
    this.logger.log('Neo4j constraints and indexes are in place');
  }

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