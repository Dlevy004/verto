import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const VOLUMES = {
  postgres: 'pgdata',
  mongo: 'mongodata',
  neo4j: 'neo4jdata',
  qdrant: 'qdrantdata',
  redis: null,
};

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const requested = args.filter((a) => !a.startsWith('--'));
const services = requested.length ? requested : Object.keys(VOLUMES);

const unknown = services.filter((s) => !(s in VOLUMES));
if (unknown.length) {
  console.error(
    `Ismeretlen szolgáltatás: ${unknown.join(', ')}. Lehetséges: ${Object.keys(VOLUMES).join(', ')}`,
  );
  process.exit(1);
}

const run = (...a) => execFileSync('docker', a, { stdio: 'inherit' });
const out = (...a) => execFileSync('docker', a, { encoding: 'utf8' });

const project = JSON.parse(out('compose', 'config', '--format', 'json')).name;

console.log(`Projekt: ${project}`);
console.log(`Törlöm az adatot és újraindítom: ${services.join(', ')}`);

if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Biztosan? Az érintett adatbázisok MINDEN adata elvész. (y/N) ');
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Megszakítva, semmi nem változott.');
    process.exit(0);
  }
}

run('compose', 'rm', '-s', '-f', ...services);

const removed = [];
try {
  for (const service of services) {
    const volume = VOLUMES[service];
    if (volume) {
      run('volume', 'rm', '-f', `${project}_${volume}`);
      removed.push(`${project}_${volume}`);
    }
  }
} catch (e) {
  console.error(`\nHiba a volume törlésénél. Már törölt volume-ok: ${removed.join(', ') || 'nincs'}`);
  console.error('Megpróbálom újraindítani a szolgáltatásokat...');
  try {
    run('compose', 'up', '-d', ...services);
  } catch {
    console.error('Az újraindítás sem sikerült, futtasd kézzel: docker compose up -d');
  }
  process.exit(1);
}

run('compose', 'up', '-d', '--wait', ...services);

console.log('\nKész. A kiválasztott szolgáltatások újraindultak.');
if (services.includes('neo4j')) {
  console.log('A Neo4j megszorításait a backend indulásakor hozza létre, ezért indítsd újra a backendet.');
}