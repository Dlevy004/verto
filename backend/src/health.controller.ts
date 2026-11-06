import { Controller, Get } from '@nestjs/common';
import { PostgresService } from './postgres/postgres.service';

@Controller('health')
export class HealthController {
  constructor(private readonly pg: PostgresService) {}

  @Get('postgres')
  async postgres() {
    const r = await this.pg.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    return { ok: true, pgvector: r.rows[0]?.extversion ?? null };
  }
}