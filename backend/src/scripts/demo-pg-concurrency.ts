import { Pool } from 'pg';
import { VersionConflictError, approveRequest } from '../engine/approval';

interface RequestRow {
  id: string;
  seq: number;
  status: string;
  estimated_hours: number | null;
  updated_at: Date;
}

interface BudgetRow {
  id: string;
  total_hours: number;
  remaining_hours: number;
  version: number;
}

const SEEN_VERSION = 7;

async function main() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  let restore: (() => Promise<void>) | null = null;

  try {
    const projectRes = await pool.query<{ id: string; name: string; owner_id: string }>(
      `SELECT id, name, owner_id FROM project
        WHERE is_demo AND name ILIKE '%Acme%' ORDER BY name LIMIT 1`,
    );
    const project = projectRes.rows[0];
    if (!project) throw new Error('No demo project found. Run `pnpm seed` first.');

    const requests = (
      await pool.query<RequestRow>(
        `SELECT id, seq, status::text AS status, estimated_hours::float8 AS estimated_hours, updated_at
            FROM change_request WHERE project_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM hours_reservation hr WHERE hr.request_id = change_request.id
            )
          ORDER BY seq LIMIT 2`,
        [project.id],
      )
    ).rows;
    const budget = (
      await pool.query<BudgetRow>(
        `SELECT id, total_hours::float8 AS total_hours,
                remaining_hours::float8 AS remaining_hours, version
           FROM retainer_budget
          WHERE project_id = $1 AND period = date_trunc('month', now())::date`,
        [project.id],
      )
    ).rows[0];
    if (requests.length < 2 || !budget) throw new Error('Not enough demo data. Run `pnpm seed`.');

    const ids = requests.map((r) => r.id);
    const startedAt = (await pool.query<{ t: Date }>('SELECT clock_timestamp() AS t')).rows[0].t;

    // Everything below changes demo data; `restore` puts it back in the finally block.
    restore = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM hours_reservation WHERE request_id = ANY($1::uuid[])', [ids]);
        await client.query(
          'DELETE FROM audit_log WHERE request_id = ANY($1::uuid[]) AND created_at >= $2',
          [ids, startedAt],
        );
        await client.query(
          'DELETE FROM decision WHERE request_id = ANY($1::uuid[]) AND created_at >= $2',
          [ids, startedAt],
        );
        for (const r of requests) {
          await client.query(
            `UPDATE change_request
                SET status = $2::request_status, estimated_hours = $3, updated_at = $4
              WHERE id = $1`,
            [r.id, r.status, r.estimated_hours, r.updated_at],
          );
        }
        await client.query(
          'UPDATE retainer_budget SET remaining_hours = $2, version = $3 WHERE id = $1',
          [budget.id, budget.remaining_hours, budget.version],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };

    // Setup: both requests waiting for approval, a full budget at version 7.
    await pool.query(
      `UPDATE change_request SET status = 'NEEDS_TRIAGE' WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await pool.query(
      'UPDATE retainer_budget SET remaining_hours = total_hours, version = $2 WHERE id = $1',
      [budget.id, SEEN_VERSION],
    );

    console.log(`Project: ${project.name}`);
    console.log(
      `Both approvers loaded the budget: ${budget.total_hours} h remaining, version ${SEEN_VERSION}\n`,
    );

    const attempts = [
      { id: requests[0].id, seq: requests[0].seq, hours: 2 },
      { id: requests[1].id, seq: requests[1].seq, hours: 3 },
    ];
    const inputFor = (a: (typeof attempts)[number], expectedVersion: number) => ({
      requestId: a.id,
      budgetId: budget.id,
      expectedVersion,
      hours: a.hours,
      userId: project.owner_id,
    });

    console.log('1) Two approvals at the same time, both based on version 7:');
    const results = await Promise.allSettled(
      attempts.map((a) => approveRequest(pool, inputFor(a, SEEN_VERSION))),
    );
    console.table(
      results.map((res, i) =>
        res.status === 'fulfilled'
          ? {
              request: `#${attempts[i].seq}`,
              hours: attempts[i].hours,
              outcome: 'committed',
              budget: `${res.value.remainingHours} h left (v${res.value.version})`,
            }
          : {
              request: `#${attempts[i].seq}`,
              hours: attempts[i].hours,
              outcome: res.reason instanceof Error ? `${res.reason.name}` : String(res.reason),
              budget: res.reason instanceof Error ? res.reason.message : '-',
            },
      ),
    );

    console.log('2) The loser reloads the budget and retries:');
    for (const [i, res] of results.entries()) {
      if (res.status === 'rejected' && res.reason instanceof VersionConflictError) {
        const retry = await approveRequest(
          pool,
          inputFor(attempts[i], res.reason.currentVersion),
        );
        console.log(
          `   #${attempts[i].seq}: retried on v${res.reason.currentVersion} -> committed, ` +
            `${retry.remainingHours} h left (v${retry.version})`,
        );
      }
    }

    const final = (
      await pool.query<BudgetRow>(
        `SELECT id, total_hours::float8 AS total_hours,
                remaining_hours::float8 AS remaining_hours, version
           FROM retainer_budget WHERE id = $1`,
        [budget.id],
      )
    ).rows[0];
    console.log(
      `\nFinal budget: ${final.remaining_hours} h left (v${final.version}), ` +
        `expected ${final.total_hours - 5} h after approving 2 h + 3 h`,
    );

    console.log('\n3) Approving an already approved request again:');
    await approveRequest(pool, inputFor(attempts[0], SEEN_VERSION)).then(
      () => console.log('   unexpected: the second approval succeeded'),
      (e: Error) => console.log(`   ${e.name}: ${e.message}`),
    );
  } finally {
    if (restore) {
      await restore();
      console.log('\nDemo data restored.');
    }
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});