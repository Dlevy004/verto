import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Singleton wrapper around the official Qdrant REST client (`QdrantClient`).
 *
 * Uses stateless HTTP requests (no persistent TCP socket pool to close on shutdown)
 * and exposes both the typed `client` and the base `url` for root metadata checks.
 *
 * @see QdrantModule (`backend/src/qdrant/qdrant.module.ts`) where this service is registered globally.
 */
@Injectable()
export class QdrantService {
  readonly client: QdrantClient;
  readonly url: string;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('QDRANT_URL');
    this.client = new QdrantClient({ url: this.url });
  }
}