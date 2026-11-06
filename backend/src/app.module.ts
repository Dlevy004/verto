import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { PostgresModule } from './postgres/postgres.module';
import { MongoModule } from './mongo/mongo.modules';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env'] }),
    PostgresModule,
    MongoModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}