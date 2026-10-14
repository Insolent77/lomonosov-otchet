'use strict';
const fs = require('node:fs');
const { Client } = require('pg');

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

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
    application_name: 'lomonosov_goal_export'
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='60000ms'");
    const r = await client.query(`
      SELECT DISTINCT
        gls.student_id,
        l.group_id,
        s.student_goal,
        s.lesson_goals,
        s.dream_schools
      FROM public.group_lesson_students gls
      JOIN public.group_lesson l ON l.id = gls.lesson_id
      JOIN public.student_student s ON s.id = gls.student_id
      WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
      ORDER BY gls.student_id, l.group_id
    `);
    await client.query('ROLLBACK');

    fs.mkdirSync('goal-result', {recursive:true});
    fs.writeFileSync('goal-result/goals.json', JSON.stringify(r.rows), 'utf8');

    for (const row of r.rows) {
      const key = fnv1a(String(row.student_id) + '|' + String(row.group_id));
      const payload = Buffer.from(JSON.stringify({
        student_goal: row.student_goal,
        lesson_goals: row.lesson_goals,
        dream_schools: row.dream_schools
      }), 'utf8').toString('base64');
      console.log('GOAL|' + key + '|' + payload);
    }
    console.log('Goal source export completed. rows=' + r.rowCount);
  } finally {
    await client.end().catch(()=>{});
  }
}

main().catch(e=>{console.error('GOAL_EXPORT_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
