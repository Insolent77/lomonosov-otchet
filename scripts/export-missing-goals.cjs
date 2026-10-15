'use strict';
const { Client } = require('pg');

async function main() {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD_MISSING');
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false,
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
    application_name: 'lomonosov_missing_goals'
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='60000ms'");
    const r = await client.query(`
      SELECT DISTINCT l.group_id, s.student_goal
      FROM public.group_lesson_students gls
      JOIN public.group_lesson l ON l.id = gls.lesson_id
      JOIN public.student_student s ON s.id = gls.student_id
      WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
        AND l.group_id IN (866,867,868)
      ORDER BY l.group_id
    `);
    await client.query('ROLLBACK');
    for (const row of r.rows) {
      const payload = Buffer.from(String(row.student_goal ?? ''), 'utf8').toString('base64');
      console.log('MISSING_GOAL|' + row.group_id + '|' + payload);
    }
  } finally {
    await client.end().catch(()=>{});
  }
}
main().catch(e=>{console.error('MISSING_GOALS_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
