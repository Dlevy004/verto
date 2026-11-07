import { EMBEDDING_DIM, EMBEDDING_MODEL, embed } from '../embeddings/embedder';

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a));

async function main() {
  const texts = [
    'Add Apple Pay and Google Pay at checkout',
    'Support Apple Pay in the checkout flow',
    'Native iOS app for the shop',
  ];

  console.time('első beágyazás (a modell betöltésével)');
  const v = await embed(texts);
  console.timeEnd('első beágyazás (a modell betöltésével)');

  console.log({ model: EMBEDDING_MODEL, dim: v[0].length, expectedDim: EMBEDDING_DIM });
  console.log('vektor-normák:', v.map((x) => norm(x).toFixed(4)));
  console.log('koszinusz (majdnem-duplikátum pár):', dot(v[0], v[1]).toFixed(3));
  console.log('koszinusz (nem összefüggő):', dot(v[0], v[2]).toFixed(3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});