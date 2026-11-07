import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Db, MongoClient } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleDestroy {
  private readonly client: MongoClient;

  constructor(config: ConfigService) {
    this.client = new MongoClient(config.getOrThrow<string>('MONGO_URL'));
  }

  get db(): Db {
    return this.client.db('verto');
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}