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
    application_name: 'lomonosov_goal_coverage_check'
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='60000ms'");

    const r = await client.query(`
      WITH pairs AS (
        SELECT DISTINCT
          gls.student_id,
          l.group_id
        FROM public.group_lesson_students gls
        JOIN public.group_lesson l ON l.id = gls.lesson_id
        JOIN public.student_student s ON s.id = gls.student_id
        WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
          AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
      )
      SELECT
        COUNT(*)::int AS pair_count,
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(COALESCE(gl.learning_goal,'')), '') IS NOT NULL
        )::int AS group_learning_goal_filled,
        COUNT(*) FILTER (
          WHERE s.lesson_goals IS NOT NULL
            AND s.lesson_goals <> 'null'::jsonb
            AND s.lesson_goals <> '{}'::jsonb
            AND s.lesson_goals <> '[]'::jsonb
        )::int AS lesson_goals_filled,
        COUNT(*) FILTER (
          WHERE s.dream_schools IS NOT NULL
            AND s.dream_schools <> 'null'::jsonb
            AND s.dream_schools <> '{}'::jsonb
            AND s.dream_schools <> '[]'::jsonb
        )::int AS dream_schools_filled,
        COUNT(*) FILTER (
          WHERE s.lesson_goals IS NOT NULL
        )::int AS lesson_goals_nonnull,
        COUNT(*) FILTER (
          WHERE s.dream_schools IS NOT NULL
        )::int AS dream_schools_nonnull
      FROM pairs p
      JOIN public.student_student s ON s.id=p.student_id
      LEFT JOIN public.student_studentgrouplearninggoal gl
        ON gl.student_id=p.student_id
       AND gl.group_id=p.group_id
    `);

    const types = await client.query(`
      WITH students AS (
        SELECT DISTINCT gls.student_id
        FROM public.group_lesson_students gls
        JOIN public.group_lesson l ON l.id=gls.lesson_id
        JOIN public.student_student s ON s.id=gls.student_id
        WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
          AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
      )
      SELECT
        COALESCE(jsonb_typeof(s.lesson_goals),'null') AS lesson_goals_type,
        COALESCE(jsonb_typeof(s.dream_schools),'null') AS dream_schools_type,
        COUNT(*)::int AS students
      FROM students x
      JOIN public.student_student s ON s.id=x.student_id
      GROUP BY 1,2
      ORDER BY 1,2
    `);

    await client.query('ROLLBACK');

    console.log('GOAL_COVERAGE=' + JSON.stringify(r.rows[0]));
    console.log('GOAL_JSON_TYPES=' + JSON.stringify(types.rows));
  } finally {
    await client.end().catch(()=>{});
  }
}
main().catch(e=>{console.error('GOAL_CHECK_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
