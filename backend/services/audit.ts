import type pg from 'pg';
export async function audit(
  c: pg.PoolClient,
  actor: string | null,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
) {
  await c.query(
    'INSERT INTO audit_log(actor_id,action,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5)',
    [actor, action, id, JSON.stringify(before), JSON.stringify(after)],
  );
}
