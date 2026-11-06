import { Controller, Get } from '@nestjs/common';
import { MongoService } from './mongo/mongo.service';
import { PostgresService } from './postgres/postgres.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly pg: PostgresService,
    private readonly mongo: MongoService,
  ) {}

  @Get('postgres')
  async postgres() {
    const r = await this.pg.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    return { ok: true, pgvector: r.rows[0]?.extversion ?? null };
  }

  @Get('mongo')
  async mongoHealth() {
    await this.mongo.db.command({ ping: 1 });
    const collections = await this.mongo.db.listCollections().toArray();
    return { ok: true, collections: collections.map((c) => c.name) };
  }
}