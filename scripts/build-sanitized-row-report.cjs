'use strict';
const { Client } = require('pg');

function clean(v) {
  return String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function percent(correct, total) {
  if (!total) return null;
  return Math.round((correct * 10000) / total) / 100;
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
    application_name: 'lomonosov_sanitized_row_report'
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='60000ms'");

    const pairsQ = await client.query(`
      SELECT DISTINCT
        s.id student_id,
        s.name student_name,
        s.surname student_surname,
        s.student_status,
        g.id group_id,
        g.name group_name,
        g.course_id
      FROM public.group_lesson_students gls
      JOIN public.group_lesson l ON l.id=gls.lesson_id
      JOIN public.student_student s ON s.id=gls.student_id
      JOIN public.group_group g ON g.id=l.group_id
      WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
        AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
        AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
        AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
    `);

    const diagnosticsQ = await client.query(`
      SELECT
        ah.course_id,
        t.id topic_id,
        COUNT(task.id)::int task_count
      FROM public.course_assignedhomework ah
      JOIN public.course_topicinhomework tih ON tih.homework_id=ah.homework_id
      JOIN public.course_topic t ON t.id=tih.topic_id
      LEFT JOIN public.course_task task ON task.topic_id=t.id
      WHERE LOWER(t.name) LIKE '%срез знаний сентябрь%'
      GROUP BY ah.course_id,t.id
      ORDER BY ah.course_id,t.id
    `);

    const answersQ = await client.query(`
      WITH diagnostic_topics AS (
        SELECT id topic_id
        FROM public.course_topic
        WHERE LOWER(name) LIKE '%срез знаний сентябрь%'
      ),
      latest AS (
        SELECT DISTINCT ON (a.student_id,a.task_id)
          a.student_id,a.task_id,a.is_right,a.date
        FROM public.student_studentanswer a
        JOIN public.course_task task ON task.id=a.task_id
        JOIN diagnostic_topics d ON d.topic_id=task.topic_id
        ORDER BY a.student_id,a.task_id,a.date DESC,a.id DESC
      )
      SELECT
        l.student_id,
        task.topic_id,
        COUNT(*)::int answered,
        COUNT(*) FILTER (WHERE l.is_right IS TRUE)::int correct
      FROM latest l
      JOIN public.course_task task ON task.id=l.task_id
      GROUP BY l.student_id,task.topic_id
    `);

    await client.query('ROLLBACK');

    const byCourse = new Map();
    for (const d of diagnosticsQ.rows) {
      const key=String(d.course_id);
      if (!byCourse.has(key)) byCourse.set(key,[]);
      byCourse.get(key).push({topic_id:String(d.topic_id),task_count:Number(d.task_count||0)});
    }
    const ans = new Map();
    for (const a of answersQ.rows) {
      ans.set(String(a.student_id)+'|'+String(a.topic_id), {
        answered:Number(a.answered||0),
        correct:Number(a.correct||0)
      });
    }

    const pairs=pairsQ.rows.map(r=>({
      student_id:String(r.student_id),
      display_name:clean(r.student_surname+' '+r.student_name),
      student_status:Number(r.student_status),
      group_id:String(r.group_id),
      group_name:clean(r.group_name),
      course_id:r.course_id==null?null:String(r.course_id)
    })).sort((a,b)=>a.display_name.localeCompare(b.display_name,'ru')||a.group_name.localeCompare(b.group_name,'ru'));

    const checksum=fnv1a(pairs.map(p=>p.display_name+'|'+p.group_id).join('\n'));
    console.log('PAIR_COUNT='+pairs.length);
    console.log('PAIR_CHECKSUM='+checksum);

    let hasDiag=0, answeredCount=0, noDiag=0, multi=0;
    pairs.forEach((p,index)=>{
      const candidates=p.course_id?(byCourse.get(p.course_id)||[]):[];
      if(candidates.length) hasDiag++; else noDiag++;
      if(candidates.length>1) multi++;

      const scored=candidates.map(d=>{
        const a=ans.get(p.student_id+'|'+d.topic_id)||{answered:0,correct:0};
        return {...d,...a};
      }).sort((a,b)=>b.answered-a.answered||b.correct-a.correct||a.topic_id.localeCompare(b.topic_id));

      const chosen=scored[0]||null;
      if(chosen&&chosen.answered>0) answeredCount++;

      const row=index+2;
      const pct=chosen&&chosen.answered>0?percent(chosen.correct,chosen.task_count):'';
      const correct=chosen?chosen.correct:0;
      const total=chosen?chosen.task_count:0;
      const answered=chosen?chosen.answered:0;
      const has=candidates.length?1:0;
      const status=p.student_status===1?'A':(p.student_status===0?'R':'U');

      // Sanitized output only: target row + diagnostic metrics + status.
      console.log(['ROW',row,has,answered,correct,total,pct,status].join('|'));
    });
    console.log('STATS|'+[hasDiag,answeredCount,noDiag,multi].join('|'));
  } finally {
    await client.end().catch(()=>{});
  }
}
main().catch(e=>{console.error('REPORT_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
