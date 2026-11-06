import { Controller, Get } from '@nestjs/common';
import { GraphService } from './graph/graph.service';
import { MongoService } from './mongo/mongo.service';
import { PostgresService } from './postgres/postgres.service';
import { QdrantService } from './qdrant/qdrant.service';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly pg: PostgresService,
    private readonly mongo: MongoService,
    private readonly redis: RedisService,
    private readonly graph: GraphService,
    private readonly qdrant: QdrantService,
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

  @Get('redis')
  async redisHealth() {
    const pong = await this.redis.client.ping();
    await this.redis.client.set('health:test', 'ok', 'EX', 10);
    const value = await this.redis.client.get('health:test');
    const ttl = await this.redis.client.ttl('health:test');
    return { ok: true, ping: pong, roundtrip: value, ttl };
  }

  @Get('neo4j')
  async neo4jHealth() {
    const r = await this.graph.run(
      'CALL dbms.components() YIELD name, versions RETURN name, versions[0] AS version',
    );
    const row = r.records[0];
    const c = await this.graph.run('SHOW CONSTRAINTS YIELD name RETURN name ORDER BY name');
    return {
      ok: true,
      name: row.get('name'),
      version: row.get('version'),
      constraints: c.records.map((rec) => rec.get('name')),
    };
  }

  @Get('qdrant')
  async qdrantHealth() {
    const info = (await (await fetch(`${this.qdrant.url}/`)).json()) as {
      version: string;
    };
    const collections = await this.qdrant.client.getCollections();
    return {
      ok: true,
      version: info.version,
      collections: collections.collections.map((c) => c.name),
    };
  }
}