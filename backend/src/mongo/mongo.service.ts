import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Db, MongoClient } from 'mongodb';

/**
 * Singleton wrapper around the official Node.js `MongoClient`.
 *
 * Manages the MongoDB connection pool for the `'verto'` database and ensures
 * sockets are cleanly closed when the NestJS application shuts down.
 *
 * @see MongoModule where this service is registered and exported globally.
 * @see db/mongo/init.js for collection schemas (`request_payloads`) and indexes.
 */
@Injectable()
export class MongoService implements OnModuleDestroy {
  private readonly client: MongoClient;

  constructor(config: ConfigService) {
    // Fail fast on startup if MONGO_URL is not defined in .env
    this.client = new MongoClient(config.getOrThrow<string>('MONGO_URL'));
  }

  /**
   * Returns the MongoDB `Db` handle scoped to the `'verto'` database.
   * The underlying `MongoClient` connects lazily and pools connections automatically.
   */
  get db(): Db {
    return this.client.db('verto');
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}