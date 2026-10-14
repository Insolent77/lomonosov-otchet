
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalize,dates}=require('../report.cjs');
const cfg={djangoBaseUrl:'https://example.com',groupFormats:{1:'инд'},studentStatuses:{1:'Активный',0:'Архивный'},courseLevelsByTag:{'Олимпиадный':'ол'},courseEditors:{},assessmentTopicIdsByCourse:{}};
const base={student_id:'1',group_id:'2',surname:'Ученик',name:'Один',group_type:1,student_status:0,course_id:'3',tags:['Олимпиадный'],goals:['Цель!\nБез изменений.'],assessments:[{id:'4',name:'Срез знаний сентябрь',attempted:0,correct:0}]};
test('No submissions are distinct from an all-wrong completed assessment',()=>{
 const absent=normalize(base,cfg);assert.equal(absent.score,null);assert.equal(absent.score_label,'Не решал');
 const zero=normalize({...base,assessments:[{...base.assessments[0],attempted:5}]},cfg);
 assert.equal(zero.score,0);assert.equal(zero.score_label,'0%');assert.equal(zero.assessment_state,'completed');
});
test('Exact goal and archived status are preserved',()=>{const r=normalize(base,cfg);assert.equal(r.goal,base.goals[0]);assert.equal(r.status,'Архивный');});
test('Ambiguous assessments and conflicting goals cannot produce an invented aggregate',()=>{
 const r=normalize({...base,goals:['Первый текст','Второй текст'],assessments:[...base.assessments,{id:'5',attempted:10,correct:10}]},cfg);
 assert.equal(r.score,null);assert.equal(r.goal,'');assert.ok(r.issues.length>0);
});
test('Separate groups retain separate identity and course links',()=>{
 const a=normalize(base,cfg),b=normalize({...base,group_id:'7',course_id:'8'},cfg);
 assert.equal(a.student_id,b.student_id);assert.notEqual(a.group_id,b.group_id);assert.notEqual(a.course_url,b.course_url);
});
test('Invalid calendar dates and reversed periods are rejected',()=>{
 assert.throws(()=>dates(new URLSearchParams('start=2026-02-30&end=2026-03-01')));
 assert.throws(()=>dates(new URLSearchParams('start=2026-09-30&end=2026-09-01')));
 assert.deepEqual(dates(new URLSearchParams('start=2026-09-01&end=2026-09-30')),['2026-09-01','2026-09-30','2026-09-01','2026-10-01']);
});
