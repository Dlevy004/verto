import { resolve } from 'node:path';

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;

function getExtractor(): Promise<Extractor> {
  extractorPromise ??= (async () => {
    // a csomag ESM, ezért dinamikus importtal töltjük be
    const mod = await import('@huggingface/transformers');
    // a modell a repo gyökerében lévő .cache mappába töltődik, nem a node_modules-ba
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

/** Szövegek beágyazása: mean pooling, L2-normalizálva, 384 dimenziós vektorok. */
export async function embed(texts: string[], batchSize = 32): Promise<number[][]> {
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    out.push(...tensor.tolist());
  }
  return out;
}