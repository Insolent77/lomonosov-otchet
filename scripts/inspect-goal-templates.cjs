'use strict';
const { Client } = require('pg');

async function main() {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD_MISSING');
  const c=new Client({
    host:process.env.DB_HOST,
    port:Number(process.env.DB_PORT),
    database:process.env.DB_NAME,
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
    ssl:false,
    connectionTimeoutMillis:15000,
    query_timeout:30000,
    application_name:'goal_template_lookup'
  });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout='30000ms'");
    const a=await c.query(`
      SELECT id,name,category,body
      FROM public.notifications_messagetemplate
      WHERE body ILIKE '%Каждый урок делает тебя сильнее%'
         OR body ILIKE '%Работай сейчас%'
         OR body ILIKE '%сильный математический класс%'
         OR body ILIKE '%top_school%'
         OR body ILIKE '%math_school_program_catch_up%'
      ORDER BY id
    `);
    const b=await c.query(`
      SELECT id,key,value
      FROM public.notifications_customvariable
      WHERE value ILIKE '%Каждый урок делает тебя сильнее%'
         OR value ILIKE '%Работай сейчас%'
         OR value ILIKE '%сильный математический класс%'
         OR value ILIKE '%top_school%'
         OR value ILIKE '%math_school_program_catch_up%'
         OR key ILIKE '%goal%'
      ORDER BY id
    `);
    const d=await c.query(`
      SELECT id,name,text
      FROM public.info_message
      WHERE text ILIKE '%Каждый урок делает тебя сильнее%'
         OR text ILIKE '%Работай сейчас%'
         OR text ILIKE '%сильный математический класс%'
         OR text ILIKE '%top_school%'
         OR text ILIKE '%math_school_program_catch_up%'
      ORDER BY id
    `);
    await c.query('ROLLBACK');
    console.log('TEMPLATE_HITS='+JSON.stringify(a.rows));
    console.log('VARIABLE_HITS='+JSON.stringify(b.rows));
    console.log('INFO_HITS='+JSON.stringify(d.rows));
  } finally { await c.end().catch(()=>{}); }
}
main().catch(e=>{console.error('LOOKUP_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
