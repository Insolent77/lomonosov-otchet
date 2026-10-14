
const fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8'));
const SQL=`
WITH participants AS (
 SELECT l.group_id,ls.student_id,l.id lesson_id,l.teacher_id,l.start_dt
 FROM public.group_lesson l JOIN public.group_lesson_students ls ON ls.lesson_id=l.id
 LEFT JOIN public.group_lessonattending a ON a.lesson_id=l.id AND a.student_id=ls.student_id
 WHERE l.start_dt >= ($1::date::timestamp AT TIME ZONE 'Europe/Moscow')
 AND l.start_dt < (($2::date+1)::timestamp AT TIME ZONE 'Europe/Moscow')
 AND l.start_dt <= now() AND l.status IN (1,3)
 AND (a.id IS NULL OR (a.canceled_at IS NULL AND a.is_attended IS DISTINCT FROM false))
 UNION
 SELECT l.group_id,a.student_id,l.id,l.teacher_id,l.start_dt
 FROM public.group_lessonattending a JOIN public.group_lesson l ON l.id=a.lesson_id
 WHERE a.is_attended=true AND a.canceled_at IS NULL
 AND l.start_dt >= ($1::date::timestamp AT TIME ZONE 'Europe/Moscow')
 AND l.start_dt < (($2::date+1)::timestamp AT TIME ZONE 'Europe/Moscow')
 AND l.start_dt <= now() AND l.status IN (1,3)
), pairs AS (
 SELECT group_id,student_id,COUNT(DISTINCT lesson_id) lesson_count,
 (array_agg(teacher_id ORDER BY start_dt DESC,lesson_id DESC) FILTER (WHERE teacher_id IS NOT NULL))[1] teacher_id,
 COUNT(DISTINCT teacher_id) teacher_count FROM participants GROUP BY group_id,student_id
), topics AS (
 SELECT DISTINCT cah.course_id,t.id,t.name
 FROM public.course_assignedhomework cah
 JOIN public.course_topicinhomework tih ON tih.homework_id=cah.homework_id
 JOIN public.course_topic t ON t.id=tih.topic_id
 WHERE t.name ILIKE '%срез знаний сентябрь%'
), latest AS (
 SELECT DISTINCT ON (a.student_id,a.task_id) a.student_id,a.task_id,a.is_right
 FROM public.student_studentanswer a JOIN public.course_task task ON task.id=a.task_id
 WHERE task.topic_id IN (SELECT id FROM topics)
 AND a.student_id IN (SELECT student_id FROM pairs)
 AND a.date >= ($3::date::timestamp AT TIME ZONE 'Europe/Moscow')
 AND a.date < ($4::date::timestamp AT TIME ZONE 'Europe/Moscow')
 ORDER BY a.student_id,a.task_id,a.date DESC,a.id DESC
), scores AS (
 SELECT a.student_id,task.topic_id,COUNT(*) attempted,
 COUNT(*) FILTER (WHERE a.is_right=true) correct
 FROM latest a JOIN public.course_task task ON task.id=a.task_id
 GROUP BY a.student_id,task.topic_id
), tags AS (
 SELECT tic.course_id,array_agg(DISTINCT tag.name ORDER BY tag.name) names
 FROM public.course_tagincourse tic JOIN public.course_topictag tag ON tag.id=tic.tag_id
 GROUP BY tic.course_id
), goals AS (
 SELECT student_id,group_id,array_agg(DISTINCT learning_goal) FILTER
 (WHERE learning_goal IS NOT NULL AND btrim(learning_goal)<>'') texts
 FROM public.student_studentgrouplearninggoal GROUP BY student_id,group_id
)
SELECT p.student_id::text,p.group_id::text,s.name,s.surname,s.num_class,s.student_status,
g.name group_name,g.type group_type,g.course_id::text,c.name course_name,ln.name subject,
concat_ws(' ',teacher.surname,teacher.name) teacher,p.teacher_count,p.lesson_count,
goals.texts goals,COALESCE(tags.names,ARRAY[]::varchar[]) tags,
COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id::text,'name',t.name,
'attempted',COALESCE(sc.attempted,0),'correct',COALESCE(sc.correct,0)) ORDER BY t.id)
FROM topics t LEFT JOIN scores sc ON sc.topic_id=t.id AND sc.student_id=p.student_id
WHERE t.course_id=g.course_id),'[]'::jsonb) assessments
FROM pairs p JOIN public.student_student s ON s.id=p.student_id
JOIN public.group_group g ON g.id=p.group_id
LEFT JOIN public.course_course c ON c.id=g.course_id
LEFT JOIN public.group_lessonname ln ON ln.id=g.lesson_name_id
LEFT JOIN public.teacher_teacher teacher ON teacher.id=p.teacher_id
LEFT JOIN goals ON goals.student_id=p.student_id AND goals.group_id=p.group_id
LEFT JOIN tags ON tags.course_id=g.course_id
ORDER BY s.surname,s.name,s.id,g.name,g.id`;
function dates(params) {
 const start=params.get('start')||'2026-09-01';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const end=params.get('end')||today;
 for(const value of [start,end]) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw new Error('Некорректная дата');
 }
 if(start>end||end>today)throw new Error('Период должен завершаться не позднее сегодняшнего дня');
 const year=start.slice(0,4);return [start,end,year+'-09-01',year+'-10-01'];
}
function normalize(raw,cfg=config) {
 const issues=[],comments=[];
 const format=cfg.groupFormats[String(raw.group_type)]||'';
 if(!format)issues.push('Не подтверждён формат группы: '+raw.group_type);
 const goals=raw.goals||[],goal=goals.length===1?goals[0]:'';
 if(!goal)issues.push(goals.length>1?'Несколько исходных целей':'Нет дословной цели группы');
 const tags=raw.tags||[],levels=[...new Set(tags.map(t=>cfg.courseLevelsByTag[t]).filter(Boolean))];
 const assessmentIds=cfg.assessmentTopicIdsByCourse[String(raw.course_id)];
 const all=raw.assessments||[];
 const relevant=assessmentIds?all.filter(x=>assessmentIds.map(String).includes(String(x.id))):all;
 let score=null,scoreLabel='',assessmentState='unknown';
 if(relevant.length===1) {
  const a=relevant[0];assessmentState=a.attempted?'completed':'not_taken';
  if(a.attempted) {score=100*a.correct/a.attempted;scoreLabel=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(score)+'%';}
  else scoreLabel='Не решал';
  comments.push(a.name+' — правильных ответов: '+a.correct+' из '+a.attempted+'. Выполнено заданий: '+a.attempted);
 } else {
  issues.push(relevant.length?'Несколько сентябрьских срезов: требуется выбор':'Сентябрьский срез не сопоставлен с курсом');
  for(const a of relevant)comments.push(a.name+': '+(a.attempted?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(100*a.correct/a.attempted)+'% ('+a.correct+' из '+a.attempted+')':'Не решал'));
 }
 if(Number(raw.teacher_count)>1)comments.push('Преподаватель последнего занятия; за период преподавателей: '+raw.teacher_count);
 const status=cfg.studentStatuses[String(raw.student_status)]||'';
 if(!status)issues.push('Не подтверждён статус ученика');
 const editor=cfg.courseEditors[String(raw.course_id)]||'';
 if(!editor)issues.push('Не подтверждён редактор курса');
 if(!levels.length)issues.push('Уровень курса не сопоставлен с тегами');
 const url=raw.course_id?new URL('/admin/course/course/'+encodeURIComponent(raw.course_id)+'/change/',cfg.djangoBaseUrl).href:'';
 return {student_id:String(raw.student_id),group_id:String(raw.group_id),name:[raw.surname,raw.name].filter(Boolean).join(' '),class_no:raw.num_class??'',group:raw.group_name||'',format,teacher:raw.teacher||'',subject:raw.subject||'',goal,course:raw.course_name||'',course_url:url,level:levels.join(', '),tags,editor,score,score_label:scoreLabel,assessment_state:assessmentState,comment:comments.join('\n'),status,issues};
}
async function loadReport(pool,params) {
 const period=dates(params),client=await pool.connect();
 try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '25s'");
  await client.query("SET LOCAL lock_timeout = '3s'");
  const result=await client.query(SQL,period);
  await client.query('COMMIT');
  const rows=result.rows.map(r=>normalize(r));
  return {source:'live',updated_at:new Date().toISOString(),period:period.slice(0,2),rows,
   complete:config.reviewed && rows.every(r=>r.issues.length===0),
   notes:['Выборка по проведённым/оплаченным занятиям; участие без таких занятий требует отдельной проверки.',
    'Срез: ответы за сентябрь выбранного года, последняя попытка каждого задания; правило требует проверки по Django.',
    'Цели берутся только из готового learning_goal. Сгенерированные Django цели пока не подключены.',
    'Подтверждение полноты и соответствий Django ещё не выполнено.']};
 } catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
module.exports={SQL,dates,normalize,loadReport};
