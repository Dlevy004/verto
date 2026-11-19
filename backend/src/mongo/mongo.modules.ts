import { Global, Module } from '@nestjs/common';
import { MongoService } from './mongo.service';

/**
 * Global MongoDB database module.
 *
 * Registers `MongoService` as a singleton in the NestJS DI container and exposes
 * it application-wide via `@Global()`. Mounted once in `AppModule`, allowing any
 * controller or service to inject `MongoService` without re-importing this module.
 *
 * @see MongoService for the `MongoClient` wrapper and `'verto'` database accessor.
 * @see AppModule where this module and global `ConfigModule` (`.env`) are mounted.
 */
@Global()
@Module({
  providers: [MongoService],
  exports: [MongoService],
})
export class MongoModule {}