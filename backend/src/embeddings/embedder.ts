import { resolve } from 'node:path';

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

/**
 * A function that extracts embeddings from a list of strings.
 *
 * @param texts - The list of strings to extract embeddings from (e.g. the passages from the contract)
 * @param options - Options for the embedding extraction, including pooling and normalization
 * @returns A promise that resolves to a 2D array of embeddings, where each row corresponds to the embedding of a string in the input list
 *
 * The function uses a dynamically loaded model from the Hugging Face Transformers library to extract embeddings.
 * It processes the input texts in batches to optimize performance and memory usage.
 */
type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;


/**
 * Lazily initializes and caches the @huggingface/transformers model for embedding extraction.
 * Caching the `Promise` itself prevents duplicate model loads under concurrent calls,
 * avoiding race conditions and unnecessary resource usage.
 */
function getExtractor(): Promise<Extractor> {
  extractorPromise ??= (async () => {
    // load the model dinamically, so that the backend can start even if the model is not yet downloaded
    // this is an ESM-only module, so we need to use dynamic import and not require(),
    // because the backend is compiled to CommonJS and
    // the await import is working both module system
    const mod = await import('@huggingface/transformers');
    // the model will be loaded in the .cache dir, not in the node_modules
    // if we delete the node_modules, the model will be lost.
    // if we delete the .cache dir too, the model will be lost, but the at next embed call, it will be downloaded again.
    mod.env.cacheDir = resolve(__dirname, '../../../.cache/models');

    const pipeline = mod.pipeline as unknown as (
      task: string,
      model: string,
      options: object,
    ) => Promise<Extractor>;
    return pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' });
  })();
  return extractorPromise;
}

/**
 * Generates 384-dimensional, L2-normalized sentence embeddings for an array of texts.
 *
 * @param texts - Input strings to embed.
 * @param batchSize - Number of texts processed per forward pass (defaults to `32`).
 * @returns A 2D array of shape `[texts.length][384]` where each vector has unit L2 norm (`1.0`).
 *
 * The 32 batch size is necessary to avoid out-of-memory errors and CPU overloads.
 * The "pooling: mean" option averages the word/passage/sentence embeddings to produce
 * a single vector per input text with meaningful semantic representation.
 */
export async function embed(
  texts: string[],
  batchSize = 32,
): Promise<number[][]> {
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    out.push(...tensor.tolist());
  }
  return out;
}