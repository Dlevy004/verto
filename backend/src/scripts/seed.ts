import { faker } from '@faker-js/faker';
import { Pool } from 'pg';
import { clearDemoData } from './clear-demo';
import { uuidv5 } from './data/ids';
import { COMPANIES, DEVELOPERS, TEMPLATES, ModuleKind } from './data/templates';

faker.seed(42);

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const now = new Date();
const monthStart = (offset: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    .toISOString()
    .slice(0, 10);

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cleared = await clearDemoData(client);
    console.log(`Előző demó törölve: ${cleared.projects} projekt, ${cleared.users} felhasználó`);

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

    const usedEmails = new Set<string>();

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

      const addMember = (userId: string, role: string, displayName: string | null) =>
        client.query(
          `INSERT INTO project_member (project_id, user_id, role, display_name)
           VALUES ($1, $2, $3, $4)`,
          [projectId, userId, role, displayName],
        );
      await addMember(devIds[0], 'OWNER', null);
      await addMember(devIds[1 + (i % 3)], 'DEVELOPER', null);
      await addMember(devIds[1 + ((i + 1) % 3)], 'DEVELOPER', null);

      for (let c = 0; c < 2; c++) {
        const first = faker.person.firstName();
        const last = faker.person.lastName();
        let email = `${first}.${last}@${domain}`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
        if (usedEmails.has(email)) email = email.replace('@', `${c + 1}@`);
        usedEmails.add(email);
        const userId = uuidv5(`user:${email}`);
        await client.query(
          `INSERT INTO app_user (id, email, full_name, global_role, is_demo)
           VALUES ($1, $2, $3, 'CLIENT', true)`,
          [userId, email, `${first} ${last}`],
        );
        await addMember(userId, 'CLIENT', company);
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

      const moduleIds = new Map<string, string>();
      for (const [kind, names] of Object.entries(tpl.modules) as [ModuleKind, string[]][]) {
        for (const name of names) {
          const id = uuidv5(`module:${slug}:${name}`);
          moduleIds.set(name, id);
          await client.query(
            `INSERT INTO module (id, project_id, name, kind, frozen)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, projectId, name, kind, faker.datatype.boolean({ probability: 0.1 })],
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
    }

    await client.query('COMMIT');

    const counts: Record<string, number> = {};
    for (const t of [
      'app_user', 'project', 'project_member', 'retainer_budget', 'module', 'module_dependency',
    ]) {
      const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
      counts[t] = r.rows[0].n;
    }
    console.table(counts);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});