import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { PostgresModule } from './postgres/postgres.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env'] }),
    PostgresModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}