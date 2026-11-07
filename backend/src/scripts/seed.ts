import { createHash } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { Document, MongoClient, ObjectId } from 'mongodb';
import { Pool } from 'pg';
import { clearDemoExternal, clearDemoPostgres } from './clear-demo';
import { uuidv5 } from '../common/ids';
import { PASSAGES } from './data/passages';
import { REQUESTS, RequestIdea } from './data/requests';
import { COMPANIES, DEVELOPERS, ModuleKind, TEMPLATES } from './data/templates';
import { syncGraph } from '../graph/graph-sync';
import { createNeo4j } from './neo4j-runner';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QDRANT_COLLECTION, syncVectors } from '../vectors/vector-sync';

faker.seed(42);

const DAY = 24 * 60 * 60 * 1000;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const now = new Date();
const monthStart = (offset: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

// a cég nevét minden szövegbe beleírjuk (ha nincs benne), hogy a projektek szövegei ne legyenek azonosak
const withClient = (text: string, short: string) => {
  const t = text.replaceAll('{client}', short);
  return t.includes(short) ? t : `${short}: ${t}`;
};

const BROWSERS = ['Chrome 130', 'Safari 17', 'Firefox 132', 'Edge 130'];
const SYSTEMS = ['Windows 11', 'macOS Sonoma', 'Ubuntu 24.04', 'iOS 18', 'Android 15'];
const VIEWPORTS = ['1440x900', '1920x1080', '390x844', '768x1024'];
const CRITERIA_POOL = [
  'Works on desktop and mobile browsers',
  'Existing functionality keeps working',
  'Covered by automated tests',
  'Documented for the team',
];

function priorityFor(idea: RequestIdea): string {
  if (idea.severity === 'CRITICAL') return 'CRITICAL';
  if (idea.severity === 'MAJOR') return 'HIGH';
  if (idea.severity === 'MINOR') return faker.helpers.arrayElement(['LOW', 'MEDIUM']);
  return faker.helpers.weightedArrayElement([
    { weight: 20, value: 'LOW' },
    { weight: 45, value: 'MEDIUM' },
    { weight: 25, value: 'HIGH' },
    { weight: 10, value: 'CRITICAL' },
  ]);
}

function pickStatus(verdict: string, pending: boolean): string {
  if (pending) return 'NEEDS_TRIAGE';
  switch (verdict) {
    case 'REJECTED':
      return 'REJECTED';
    case 'SCOPE_CREEP':
      return faker.helpers.weightedArrayElement([
        { weight: 70, value: 'SCOPE_CREEP' },
        { weight: 30, value: 'NEEDS_ACTION' },
      ]);
    case 'REQUIRES_ALIGNMENT':
      return 'NEEDS_ACTION';
    default:
      return faker.helpers.weightedArrayElement([
        { weight: 55, value: 'COMPLETED' },
        { weight: 25, value: 'IN_SPRINT' },
        { weight: 20, value: 'APPROVED' },
      ]);
  }
}

// a típus-specifikus mezők, a Mongo $jsonSchema szerkezetét követve
function buildFields(idea: RequestIdea, slug: string): Document {
  switch (idea.type) {
    case 'FEATURE':
      return {
        acceptance_criteria: [
          `${idea.title} works as described in the request`,
          ...faker.helpers.arrayElements(CRITERIA_POOL, faker.number.int({ min: 1, max: 3 })),
        ],
        affected_areas: idea.modules,
      };
    case 'BUG':
      return {
        steps_to_reproduce: idea.steps!,
        severity: idea.severity!,
        regression_of_delivered: idea.regression!,
        environment: {
          browser: faker.helpers.arrayElement(BROWSERS),
          os: faker.helpers.arrayElement(SYSTEMS),
          viewport: faker.helpers.arrayElement(VIEWPORTS),
        },
      };
    case 'UI_UX':
      return {
        screens: idea.screens!,
        ...(faker.datatype.boolean()
          ? { design_link: `https://design.example/${slug}/${slugify(idea.title)}` }
          : {}),
      };
    case 'CONTENT':
      return { pages: idea.pages!, word_count: faker.number.int({ min: 80, max: 1200 }) };
    case 'TECHNICAL':
      return { component: idea.component!, change_kind: idea.changeKind! };
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const mongo = new MongoClient(process.env.MONGO_URL!);
  await mongo.connect();
  const neo = createNeo4j();
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });
  const client = await pool.connect();
  const payloads: Document[] = [];

  try {
    await client.query('BEGIN');

    const cleared = await clearDemoPostgres(client);
    console.log(
      `Előző demó törölve (Postgres): ${cleared.projects} projekt, ${cleared.users} felhasználó`,
    );

    // fejlesztők
    const devIds: string[] = [];
    for (const d of DEVELOPERS) {
      const id = uuidv5(`user:${d.email}`);
      devIds.push(id);
      await client.query(
        `INSERT INTO app_user (id, email, full_name, global_role, is_demo)
         VALUES ($1, $2, $3, 'DEVELOPER', true)`,
        [id, d.email, d.name],
      );
    }
    if (devIds.length < 4) {
      throw new Error('A DEVELOPERS listában legalább 4 fejlesztő kell (templates.ts)');
    }

    const usedEmails = new Set<string>();
    let passageSeq = 0;

    for (let i = 0; i < COMPANIES.length; i++) {
      const [company, short] = COMPANIES[i];
      const tpl = TEMPLATES[i % TEMPLATES.length];
      const slug = `${slugify(short)}-${tpl.key}`;
      const projectId = uuidv5(`project:${slug}`);
      const domain = `${slugify(short)}.example`;
      const inviteCode = `VT-${faker.string.numeric(3)}-${faker.string.alphanumeric({ length: 3, casing: 'upper' })}`;

      await client.query(
        `INSERT INTO project (id, name, description, invite_code, owner_id, is_demo)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [projectId, `${short} ${tpl.title}`, tpl.description, inviteCode, devIds[0]],
      );

      // tagok: Levy a tulajdonos, két másik fejlesztő, két ügyfél
      const addMember = (userId: string, role: string, displayName: string | null) =>
        client.query(
          `INSERT INTO project_member (project_id, user_id, role, display_name)
           VALUES ($1, $2, $3, $4)`,
          [projectId, userId, role, displayName],
        );
      const projectDevIds = [devIds[0], devIds[1 + (i % 3)], devIds[1 + ((i + 1) % 3)]];
      await addMember(projectDevIds[0], 'OWNER', null);
      await addMember(projectDevIds[1], 'DEVELOPER', null);
      await addMember(projectDevIds[2], 'DEVELOPER', null);

      const clientIds: string[] = [];
      for (let c = 0; c < 2; c++) {
        const first = faker.person.firstName();
        const last = faker.person.lastName();
        let email = `${first}.${last}@${domain}`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
        if (usedEmails.has(email)) email = email.replace('@', `${c + 1}@`);
        usedEmails.add(email);
        const userId = uuidv5(`user:${email}`);
        clientIds.push(userId);
        await client.query(
          `INSERT INTO app_user (id, email, full_name, global_role, is_demo)
           VALUES ($1, $2, $3, 'CLIENT', true)`,
          [userId, email, `${first} ${last}`],
        );
        await addMember(userId, 'CLIENT', company); // ez adja a "Client: xy" badge-et
      }

      // óra-keret: az aktuális és az előző két hónap
      const total = faker.helpers.arrayElement([20, 30, 40]);
      for (let m = 0; m < 3; m++) {
        const used = faker.number.int({ min: 0, max: Math.floor(total * 0.85 * 2) }) / 2;
        const period = monthStart(m);
        await client.query(
          `INSERT INTO retainer_budget (id, project_id, period, total_hours, remaining_hours)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv5(`budget:${slug}:${period}`), projectId, period, total, total - used],
        );
      }

      // modulok és függőségek a sablonból
      const moduleIds = new Map<string, string>();
      const frozenByName = new Map<string, boolean>();
      for (const [kind, names] of Object.entries(tpl.modules) as [ModuleKind, string[]][]) {
        for (const name of names) {
          const id = uuidv5(`module:${slug}:${name}`);
          const frozen = faker.datatype.boolean({ probability: 0.1 });
          moduleIds.set(name, id);
          frozenByName.set(name, frozen);
          await client.query(
            `INSERT INTO module (id, project_id, name, kind, frozen)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, projectId, name, kind, frozen],
          );
        }
      }
      for (const dep of tpl.dependencies) {
        const [from, to] = dep.split('>');
        await client.query(
          `INSERT INTO module_dependency (from_module, to_module) VALUES ($1, $2)`,
          [moduleIds.get(from), moduleIds.get(to)],
        );
      }

      // szerződés és passzusai
      const contractId = uuidv5(`contract:${slug}`);
      const signedAt = faker.date
        .between({ from: '2025-06-01', to: '2026-06-30' })
        .toISOString()
        .slice(0, 10);
      await client.query(
        `INSERT INTO contract (id, project_id, title, signed_at) VALUES ($1, $2, $3, $4)`,
        [contractId, projectId, `${company} – Development Services Agreement`, signedAt],
      );
      for (const p of PASSAGES[tpl.key]) {
        passageSeq++;
        const text = withClient(
          p.text.replace(/\{(\d+)-(\d+)\}/g, (_, a: string, b: string) =>
            String(faker.number.int({ min: Number(a), max: Number(b) })),
          ),
          short,
        );
        await client.query(
          `INSERT INTO contract_passage (id, contract_id, category, kind, text)
           VALUES ($1, $2, $3, $4, $5)`,
           [`dcp-${String(passageSeq).padStart(4, '0')}`, contractId, p.category, p.kind, text],
        );
      }

      // kérések, döntések, Mongo-payloadok
      const ideas = REQUESTS[tpl.key];
      const createdAgo: number[] = [];

      for (let r = 0; r < ideas.length; r++) {
        const idea = ideas[r];
        const requestId = uuidv5(`request:${slug}:${r}`);
        const payloadHex = createHash('sha1').update(`payload:${slug}:${r}`).digest('hex').slice(0, 24);

        // ha egy érintett modul befagyasztott, a sima "rendben" döntésből egyeztetés lesz
        let verdict: string = idea.verdict;
        let reason = idea.reason;
        if (reason === 'IN_SCOPE_OK' && idea.modules.some((m) => frozenByName.get(m))) {
          verdict = 'REQUIRES_ALIGNMENT';
          reason = 'FROZEN_MODULES';
        }

        const pending = verdict !== 'REJECTED' && faker.datatype.boolean({ probability: 0.12 });
        const status = pickStatus(verdict, pending);

        let ago = faker.number.int({ min: 3, max: 45 });
        if (status === 'COMPLETED') ago = faker.number.int({ min: 60, max: 170 });
        if (pending) ago = faker.number.int({ min: 0, max: 6 });
        if (idea.duplicateOf !== undefined) {
          ago = Math.max(1, createdAgo[idea.duplicateOf] - faker.number.int({ min: 2, max: 10 }));
        }
        createdAgo.push(ago);
        const createdAt = daysAgo(ago);

        const deadline = new Date(createdAt.getTime() + faker.number.int({ min: 14, max: 60 }) * DAY)
          .toISOString()
          .slice(0, 10);
        const assigneeId = pending ? null : faker.helpers.arrayElement(projectDevIds);
        const submitterId = faker.helpers.arrayElement(clientIds);

        await client.query(
          `INSERT INTO change_request
             (id, project_id, submitter_id, assignee_id, title, type, priority, deadline,
              status, estimated_hours, payload_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [
            requestId, projectId, submitterId, assigneeId, idea.title, idea.type,
            priorityFor(idea), deadline, status, pending ? null : idea.hours, payloadHex, createdAt,
          ],
        );

        for (const moduleName of idea.modules) {
          const moduleId = moduleIds.get(moduleName);
          if (!moduleId) throw new Error(`Ismeretlen modul a(z) ${tpl.key} sablonban: ${moduleName}`);
          await client.query(
            `INSERT INTO request_module (request_id, module_id) VALUES ($1, $2)`,
            [requestId, moduleId],
          );
        }

        if (!pending) {
          await client.query(
            `INSERT INTO decision (request_id, verdict, reason_codes, signals, decided_by, created_at)
             VALUES ($1, $2, $3, $4, 'DEMO_SEED', $5)`,
            [
              requestId, verdict, [reason], JSON.stringify({ source: 'seed' }),
              new Date(createdAt.getTime() + 5 * 60 * 1000),
            ],
          );
        }

        const body = withClient(idea.body, short);
        payloads.push({
          _id: new ObjectId(payloadHex),
          request_id: requestId,
          project_id: projectId,
          type: idea.type,
          markdown_raw: body,
          rich_text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] },
          fields: buildFields(idea, slug),
          created_at: createdAt,
          is_demo: true,
        });
      }
    }

    await client.query('COMMIT');

    // A Postgres a forrás: a másolatok (Mongo, Neo4j) csak a commit után változnak.
    // Ha innen bármi hibázik, a `pnpm seed` újrafuttatása helyreállítja őket.
    const external = await clearDemoExternal(mongo.db('verto'), neo.run, qdrant);
    console.log(`Előző demó törölve (másolatok): ${external.payloads} Mongo-payload`);
    await mongo.db('verto').collection('request_payloads').insertMany(payloads);

    // a Neo4j másolat felépítése a Postgres-adatból
    const demoProjects = await pool.query<{ id: string }>('SELECT id FROM project WHERE is_demo');
    const graph = await syncGraph(pool, neo.runTx, demoProjects.rows.map((r) => r.id));

    // vektorok: ugyanazokkal a beágyazásokkal a pgvectorba és a Qdrantba
    await syncVectors(pool, mongo.db('verto'), qdrant, demoProjects.rows.map((r) => r.id));

    const counts: Record<string, number> = {};
    for (const t of [
      'app_user', 'project', 'project_member', 'retainer_budget', 'module', 'module_dependency',
      'contract', 'contract_passage', 'change_request', 'request_module', 'decision',
    ]) {
      const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
      counts[t] = r.rows[0].n;
    }
    counts['mongo: request_payloads'] = await mongo
      .db('verto')
      .collection('request_payloads')
      .countDocuments();
    counts['neo4j: nodes'] = graph.modules + graph.requests;
    counts['neo4j: relationships'] = graph.dependsOn + graph.touches;

    counts['pgvector: doc_embedding'] = (
      await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM doc_embedding')
    ).rows[0].n;
    counts['qdrant: points'] = (await qdrant.count(QDRANT_COLLECTION, { exact: true })).count;

    console.table(counts);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
    await mongo.close();
    await neo.driver.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});