import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { PostgresModule } from './postgres/postgres.module';
import { MongoModule } from './mongo/mongo.modules';
import { RedisModule } from './redis/redis.module';
import { GraphModule } from './graph/graph.modul';
import { QdrantModule } from './qdrant/qdrant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env'] }),
    PostgresModule,
    MongoModule,
    RedisModule,
    GraphModule,
    QdrantModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}