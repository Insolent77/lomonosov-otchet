'use strict';
const fs = require('node:fs');
const { Client } = require('pg');

function clean(v) {
  return String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD_MISSING');
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false,
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
    application_name: 'lomonosov_goal_rows_export'
  });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout='60000ms'");
    const r = await c.query(`
      SELECT DISTINCT
        s.name AS student_name,
        s.surname AS student_surname,
        s.student_goal,
        l.group_id,
        g.name AS group_name
      FROM public.group_lesson_students gls
      JOIN public.group_lesson l ON l.id = gls.lesson_id
      JOIN public.student_student s ON s.id = gls.student_id
      JOIN public.group_group g ON g.id = l.group_id
      WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
        AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
        AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
        AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
    `);
    await c.query('ROLLBACK');

    const pairs = r.rows.map(x => ({
      display_name: clean(x.student_surname + ' ' + x.student_name),
      group_name: clean(x.group_name),
      goal: clean(x.student_goal)
    })).sort((a,b) =>
      a.display_name.localeCompare(b.display_name,'ru') ||
      a.group_name.localeCompare(b.group_name,'ru')
    );

    const out = pairs.map((p,i)=>({row:i+2,goal:p.goal || null}));
    fs.mkdirSync('goal-row-result',{recursive:true});
    fs.writeFileSync('goal-row-result/goals.json',JSON.stringify(out,null,2),'utf8');
    for (const x of out) { if (x.goal) console.log('GOAL|' + x.row + '|' + Buffer.from(x.goal,'utf8').toString('base64')); }
    console.log('Goal row export completed. rows=' + out.length + ', filled=' + out.filter(x=>x.goal).length);
  } finally {
    await c.end().catch(()=>{});
  }
}
main().catch(e=>{console.error('GOAL_ROW_EXPORT_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
