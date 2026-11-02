'use strict';

const fs = require('node:fs');
const { Client } = require('pg');

const MONTHS_RU = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь'
];

function clean(v) {
  return String(v ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a(text) {
  let h = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return h.toString(16).padStart(8, '0');
}

function getReportPeriod(targetMonth) {
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new Error('TARGET_MONTH must be YYYY-MM');
  }

  const [year, month] = targetMonth.split('-').map(Number);

  if (month < 1 || month > 12) {
    throw new Error('INVALID_TARGET_MONTH');
  }

  const academicYear =
    month >= 9
      ? year
      : year - 1;

  const academicYearStart =
    `${academicYear}-09-01`;

  let nextYear = year;
  let nextMonth = month + 1;

  if (nextMonth === 13) {
    nextMonth = 1;
    nextYear += 1;
  }

  const endDate =
    `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return {
    targetMonth,
    monthNameRu: MONTHS_RU[month - 1],
    academicYearStart,
    endDate
  };
}

async function main() {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD_MISSING');
  }

  if (!process.env.TARGET_MONTH) {
    throw new Error('TARGET_MONTH_MISSING');
  }

  const period = getReportPeriod(
    process.env.TARGET_MONTH.trim()
  );

  console.log('TARGET_MONTH=' + period.targetMonth);
  console.log('PAIR_START=' + period.academicYearStart);
  console.log('PAIR_END=' + period.endDate);

  const client = new Client({
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

  await client.connect();

  try {
    await client.query('BEGIN READ ONLY');

    await client.query(
      "SET LOCAL statement_timeout='60000ms'"
    );

    const result = await client.query(`
      SELECT DISTINCT
        s.id AS student_id,
        s.name AS student_name,
        s.surname AS student_surname,
        s.student_goal,
        g.id AS group_id,
        g.name AS group_name
      FROM public.group_lesson_students gls
      JOIN public.group_lesson l
        ON l.id = gls.lesson_id
      JOIN public.student_student s
        ON s.id = gls.student_id
      JOIN public.group_group g
        ON g.id = l.group_id
      WHERE
        l.start_dt >= (
          $1::date::timestamp
          AT TIME ZONE 'Europe/Moscow'
        )
        AND l.start_dt < (
          $2::date::timestamp
          AT TIME ZONE 'Europe/Moscow'
        )
        AND LOWER(
          TRIM(COALESCE(s.name,''))
        ) <> 'ученик'
        AND LOWER(
          TRIM(COALESCE(s.name,''))
        ) NOT LIKE 'test%'
        AND LOWER(
          TRIM(COALESCE(s.name,''))
        ) NOT LIKE 'тест%'
    `, [
      period.academicYearStart,
      period.endDate
    ]);

    await client.query('ROLLBACK');

    const pairs = result.rows
      .map(r => ({
        student_id:
          String(r.student_id),

        display_name:
          clean(
            r.student_surname +
            ' ' +
            r.student_name
          ),

        group_id:
          String(r.group_id),

        group_name:
          clean(r.group_name),

        goal:
          clean(r.student_goal)
      }))
      .sort((a, b) =>
        a.display_name.localeCompare(
          b.display_name,
          'ru'
        ) ||
        a.group_name.localeCompare(
          b.group_name,
          'ru'
        )
      );

    const checksum = fnv1a(
      pairs
        .map(
          p =>
            p.display_name +
            '|' +
            p.group_id
        )
        .join('\n')
    );

    const output = pairs.map(
      (p, index) => ({
        row: index + 2,

        student_id:
          p.student_id,

        display_name:
          p.display_name,

        group_id:
          p.group_id,

        group_name:
          p.group_name,

        goal:
          p.goal || null
      })
    );

    fs.mkdirSync(
      'goal-row-result',
      { recursive: true }
    );

    fs.writeFileSync(
      'goal-row-result/goals.json',
      JSON.stringify(
        {
          target_month:
            period.targetMonth,

          pair_count:
            pairs.length,

          pair_checksum:
            checksum,

          rows:
            output
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(
      'PAIR_COUNT=' + pairs.length
    );

    console.log(
      'PAIR_CHECKSUM=' + checksum
    );

    console.log(
      'GOAL_COUNT=' +
      output.filter(x => x.goal).length
    );

    console.log(
      'Goal row export completed'
    );

  } finally {
    await client
      .end()
      .catch(() => {});
  }
}

main().catch(e => {
  console.error(
    'GOAL_ROW_EXPORT_FAILED:' +
    (
      e.code ||
      e.message ||
      'ERROR'
    )
  );

  process.exitCode = 1;
});
