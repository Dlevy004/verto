import { Global, Module } from '@nestjs/common';
import { PostgresService } from './postgres.service';

/**
 * Global PostgreSQL database module.
 *
 * Registers `PostgresService` as a singleton in the NestJS DI container and
 * exposes it application-wide via `@Global()`. Imported once in `AppModule`,
 * allowing any controller or service (such as `HealthController` or domain
 * services) to inject `PostgresService` without re-importing this module.
 *
 * @see PostgresService for connection pooling (`pg.Pool`) and transaction helpers.
 * @see AppModule where this module and global `ConfigModule` (`.env`) are mounted.
 */
@Global()
@Module({
  providers: [PostgresService],
  exports: [PostgresService],
})
export class PostgresModule {}