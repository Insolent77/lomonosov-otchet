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
    application_name: 'lomonosov_goal_shape_check'
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='60000ms'");

    const coverage = await client.query(`
      WITH pairs AS (
        SELECT DISTINCT gls.student_id, l.group_id
        FROM public.group_lesson_students gls
        JOIN public.group_lesson l ON l.id=gls.lesson_id
        JOIN public.student_student s ON s.id=gls.student_id
        WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
          AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
      )
      SELECT
        COUNT(*)::int AS pair_count,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(gl.learning_goal,'')), '') IS NOT NULL)::int AS group_learning_goal_filled,
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
        )::int AS dream_schools_filled
      FROM pairs p
      JOIN public.student_student s ON s.id=p.student_id
      LEFT JOIN public.student_studentgrouplearninggoal gl
        ON gl.student_id=p.student_id AND gl.group_id=p.group_id
    `);

    const goalValues = await client.query(`
      WITH students AS (
        SELECT DISTINCT gls.student_id
        FROM public.group_lesson_students gls
        JOIN public.group_lesson l ON l.id=gls.lesson_id
        JOIN public.student_student s ON s.id=gls.student_id
        WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
          AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
      ),
      elems AS (
        SELECT jsonb_array_elements(s.lesson_goals) elem
        FROM students x
        JOIN public.student_student s ON s.id=x.student_id
        WHERE jsonb_typeof(s.lesson_goals)='array'
      )
      SELECT
        jsonb_typeof(elem) AS elem_type,
        CASE WHEN jsonb_typeof(elem)='string' THEN elem #>> '{}' ELSE NULL END AS string_value,
        COUNT(*)::int AS uses
      FROM elems
      GROUP BY 1,2
      ORDER BY uses DESC, string_value
    `);

    const dreamShape = await client.query(`
      WITH students AS (
        SELECT DISTINCT gls.student_id
        FROM public.group_lesson_students gls
        JOIN public.group_lesson l ON l.id=gls.lesson_id
        JOIN public.student_student s ON s.id=gls.student_id
        WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
          AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
      ),
      elems AS (
        SELECT jsonb_array_elements(s.dream_schools) elem
        FROM students x
        JOIN public.student_student s ON s.id=x.student_id
        WHERE jsonb_typeof(s.dream_schools)='array'
      )
      SELECT jsonb_typeof(elem) AS elem_type, COUNT(*)::int AS uses
      FROM elems
      GROUP BY 1
      ORDER BY uses DESC
    `);

    const dreamKeys = await client.query(`
      WITH students AS (
        SELECT DISTINCT gls.student_id
        FROM public.group_lesson_students gls
        JOIN public.group_lesson l ON l.id=gls.lesson_id
        JOIN public.student_student s ON s.id=gls.student_id
        WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
          AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
          AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
      ),
      elems AS (
        SELECT jsonb_array_elements(s.dream_schools) elem
        FROM students x
        JOIN public.student_student s ON s.id=x.student_id
        WHERE jsonb_typeof(s.dream_schools)='array'
      )
      SELECT k.key, COUNT(*)::int AS uses
      FROM elems
      CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(elem)='object' THEN elem ELSE '{}'::jsonb END) k(key)
      GROUP BY k.key
      ORDER BY uses DESC, k.key
    `);

    await client.query('ROLLBACK');

    console.log('GOAL_COVERAGE=' + JSON.stringify(coverage.rows[0]));
    console.log('LESSON_GOAL_VALUES=' + JSON.stringify(goalValues.rows));
    console.log('DREAM_ELEM_TYPES=' + JSON.stringify(dreamShape.rows));
    console.log('DREAM_OBJECT_KEYS=' + JSON.stringify(dreamKeys.rows));
  } finally {
    await client.end().catch(()=>{});
  }
}
main().catch(e=>{console.error('GOAL_CHECK_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
