'use strict';

const fs = require('node:fs');
const { Client } = require('pg');

const OUT_DIR = 'report-result';
const OUT_FILE = OUT_DIR + '/diagnostics.json';

async function main() {
  if (!process.env.DB_PASSWORD) {
    throw Object.assign(new Error('Missing repository secret'), { code: 'DB_PASSWORD_MISSING' });
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
    application_name: 'lomonosov_report_diagnostics'
  });

  await client.connect();

  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '60000ms'");
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '90000ms'");

    const groups = await client.query(`
      SELECT
        g.id AS group_id,
        g.name AS group_name,
        g.type AS group_type,
        g.course_id,
        g.status AS group_status,
        g.is_archived AS group_is_archived
      FROM public.group_group g
      ORDER BY g.id
    `);

    const students = await client.query(`
      SELECT
        s.id AS student_id,
        s.name AS student_name,
        s.surname AS student_surname,
        s.num_class,
        s.student_status
      FROM public.student_student s
      ORDER BY s.id
    `);

    const topics = await client.query(`
      SELECT
        t.id AS topic_id,
        t.name AS topic_name,
        ah.id AS assignedhomework_id,
        ah.course_id,
        ah.homework_id,
        ah.hw_number,
        tih.topic_number,
        COUNT(task.id)::int AS task_count
      FROM public.course_topic t
      JOIN public.course_topicinhomework tih
        ON tih.topic_id = t.id
      JOIN public.course_assignedhomework ah
        ON ah.homework_id = tih.homework_id
      LEFT JOIN public.course_task task
        ON task.topic_id = t.id
      WHERE LOWER(t.name) LIKE '%срез знаний сентябрь%'
      GROUP BY
        t.id, t.name,
        ah.id, ah.course_id, ah.homework_id, ah.hw_number,
        tih.topic_number
      ORDER BY ah.course_id, ah.hw_number, tih.topic_number, t.id
    `);

    const preparation = await client.query(`
      WITH diagnostic_assigned AS (
        SELECT DISTINCT ah.id
        FROM public.course_topic t
        JOIN public.course_topicinhomework tih
          ON tih.topic_id = t.id
        JOIN public.course_assignedhomework ah
          ON ah.homework_id = tih.homework_id
        WHERE LOWER(t.name) LIKE '%срез знаний сентябрь%'
      )
      SELECT
        p.student_id,
        p.assignedhomework_id,
        p.result,
        p.total_answers,
        p.correct_answers,
        p.created_date
      FROM public.student_newstudentpreparation p
      JOIN diagnostic_assigned d
        ON d.id = p.assignedhomework_id
      ORDER BY p.student_id, p.assignedhomework_id, p.created_date
    `);

    const answers = await client.query(`
      WITH diagnostic_topics AS (
        SELECT t.id
        FROM public.course_topic t
        WHERE LOWER(t.name) LIKE '%срез знаний сентябрь%'
      ),
      latest_answer AS (
        SELECT DISTINCT ON (a.student_id, a.task_id)
          a.student_id,
          a.task_id,
          a.is_right,
          a.date
        FROM public.student_studentanswer a
        JOIN public.course_task task
          ON task.id = a.task_id
        JOIN diagnostic_topics dt
          ON dt.id = task.topic_id
        ORDER BY a.student_id, a.task_id, a.date DESC, a.id DESC
      )
      SELECT
        la.student_id,
        task.topic_id,
        COUNT(*)::int AS answered_tasks,
        COUNT(*) FILTER (WHERE la.is_right IS TRUE)::int AS correct_tasks,
        MIN(la.date) AS first_answer_at,
        MAX(la.date) AS last_answer_at
      FROM latest_answer la
      JOIN public.course_task task
        ON task.id = la.task_id
      GROUP BY la.student_id, task.topic_id
      ORDER BY la.student_id, task.topic_id
    `);

    await client.query('ROLLBACK');

    const payload = {
      generated_at: new Date().toISOString(),
      groups: groups.rows,
      students: students.rows,
      diagnostic_topics: topics.rows,
      preparation: preparation.rows,
      answers: answers.rows
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');

    console.log('Diagnostic report export completed.');
    console.log('Groups: ' + groups.rowCount);
    console.log('Students: ' + students.rowCount);
    console.log('Diagnostic topic-course links: ' + topics.rowCount);
    console.log('Preparation rows: ' + preparation.rowCount);
    console.log('Aggregated answer rows: ' + answers.rowCount);
    for (const x of topics.rows) {
      console.log('TOPICMAP|' + x.course_id + '|' + x.topic_id + '|' + Buffer.from(String(x.topic_name),'utf8').toString('base64'));
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        '## Lomonosov diagnostic export\n\n' +
        '- Groups: ' + groups.rowCount + '\n' +
        '- Students: ' + students.rowCount + '\n' +
        '- Diagnostic topic-course links: ' + topics.rowCount + '\n' +
        '- Preparation rows: ' + preparation.rowCount + '\n' +
        '- Aggregated answer rows: ' + answers.rowCount + '\n'
      );
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(error => {
  console.error('Report export failed: ' + (error.code || 'QUERY_FAILED'));
  process.exitCode = 1;
});
