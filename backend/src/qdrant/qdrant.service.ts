import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';

@Injectable()
export class QdrantService {
  readonly client: QdrantClient;
  readonly url: string;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('QDRANT_URL');
    this.client = new QdrantClient({ url: this.url });
  }
}