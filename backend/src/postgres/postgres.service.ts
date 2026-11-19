import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Core PostgreSQL database access service.
 *
 * Acts as the single gateway for all relational queries and ACID transactions
 * against the primary PostgreSQL + `pgvector` datastore defined in
 * `db/postgres/init.sql`. Registered globally via `PostgresModule`.
 *
 * @see PostgresModule for global singleton registration.
 * @see HealthController for startup/runtime connectivity checks (`GET /health/postgres`).
 */
@Injectable()
export class PostgresService implements OnModuleDestroy {
  private readonly pool: Pool;
  // the '.name' retrieves the class name for logging context, e.g. "PostgresService"
  // this is useful because if the class is renamed, the logger context will automatically update without needing to change the string manually
  private readonly logger = new Logger(PostgresService.name);

  /**
   * Initializes the PostgreSQL connection pool using `POSTGRES_URL` from `.env`
   * (provided by `ConfigModule` in `AppModule`) and attaches a listener for
   * unexpected errors on idle pool clients.
   */
  constructor(config: ConfigService) {
    this.pool = new Pool({
      // app.module.ts -> ConfigModule.forRoot({ envFilePath: ['../.env'] }) -> .env -> 'POSTGRES_URL' key's value
      connectionString: config.getOrThrow<string>('POSTGRES_URL'),
    });
    this.pool.on('error', (e) =>
      this.logger.error(`Idle Postgres client error: ${e.message}`),
    );
  }

  /**
   * Executes a single parameterized SQL query against the connection pool.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /**
   * Runs a callback inside an explicit ACID transaction (`BEGIN` / `COMMIT`).
   * Automatically rolls back on error and always releases the dedicated `PoolClient`
   * back to the pool in `finally`.
   */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * NestJS shutdown lifecycle hook: gracefully closes all pooled connections.
   */
  async onModuleDestroy() {
    await this.pool.end();
  }
}