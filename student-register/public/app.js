
const $=id=>document.getElementById(id);
let report=null,shown=[],sort={key:'name',direction:1},busy=false;
const fields=[['name','ФИ'],['class_no','Класс'],['group','Номер уч группы'],['format','Формат'],['teacher','Преподаватель'],['subject','Предмет'],['goal','Цель'],['course','Курс'],['course_url','Ссылка на курс'],['level','Описание ол/угл/шк'],['editor','Кто редактирует'],['score_label','Срез за сентябрь'],['comment','Комментарий'],['status','Статус']];
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value==null?'':String(value);if(cls)el.className=cls;return el;};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('end').value=today;$('end').max=today;$('start').max=today;
$('filters').addEventListener('submit',e=>e.preventDefault());
function notice(value,type=''){ $('notice').textContent=value;$('notice').className='notice '+type; }
function options() {
 for(const [id,key] of [['class','class_no'],['subject','subject'],['format','format'],['teacher','teacher'],['status','status']]){
  const select=$(id),previous=select.value,label=select.options[0].textContent;
  select.replaceChildren(new Option(label,''));
  const values=[...new Set(report.rows.map(r=>r[key]).filter(x=>x!==''&&x!=null))].sort((a,b)=>String(a).localeCompare(String(b),'ru',{numeric:true}));
  for(const value of values)select.add(new Option(value,value));
  if(values.some(v=>String(v)===previous))select.value=previous;
 }
}
function render() {
 if(!report)return;
 const query=$('search').value.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
 shown=report.rows.filter(r=>[['class','class_no'],['subject','subject'],['format','format'],['teacher','teacher'],['status','status']].every(([id,key])=>!$(id).value||String(r[key])===$(id).value)&&query.every(q=>[r.name,r.group,r.course,r.teacher,r.subject].join(' ').toLocaleLowerCase('ru').includes(q)));
 shown.sort((a,b)=>{
  let comparison=sort.key==='score'?(a.score??-1)-(b.score??-1):String(a[sort.key]??'').localeCompare(String(b[sort.key]??''),'ru',{numeric:true});
  return comparison*sort.direction||a.name.localeCompare(b.name,'ru')||String(a.student_id).localeCompare(String(b.student_id),'ru',{numeric:true})||a.group.localeCompare(b.group,'ru',{numeric:true});
 });
 const body=document.createDocumentFragment();
 shown.forEach((row,index)=>{
  const tr=document.createElement('tr');
  tr.append(text('td',index+1,'rownum'),text('td',row.name,'student'),text('td',row.class_no,'class'),text('td',row.group,'group'));
  for(const key of ['format','teacher','subject','goal','course','level','editor','score_label','comment','status']){
   const td=document.createElement('td');if(key==='goal'||key==='comment')td.className=key;
   if(key==='course'&&row.course_url){
    const url=new URL(row.course_url);if(['http:','https:'].includes(url.protocol)){const a=text('a',row.course||'Открыть курс');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';td.append(a);}else td.textContent=row.course||'—';
   }else if(key==='status'&&row.status)td.append(text('span',row.status,'pill'+(row.status==='Архивный'?' archive':'')));
   else {td.textContent=row[key]||'—';if(!row[key])td.classList.add('missing');}
   if(key==='level'&&row.tags?.length)td.title='Исходные теги: '+row.tags.join(', ');
   if(key==='score_label'&&row.score===0)td.classList.add('zero');
   if(key==='goal'&&!row.goal)td.title='Исходная цель отсутствует или ещё не подключена';
   tr.append(td);
  }
  body.append(tr);
 });
 $('rows').replaceChildren(body);
 $('empty').hidden=shown.length>0;
 $('empty').textContent=report.rows.length?'Нет строк по выбранным фильтрам.':'В выбранном периоде строки не найдены.';
 const count=new Set(shown.map(r=>String(r.student_id))).size;
 $('count').textContent=count+' учеников · '+shown.length+' строк по группам';
 $('export').disabled=shown.length===0;
 $('checks').replaceChildren();
 for(const note of report.notes||[])$('checks').append(text('p',note));
 const problems=report.rows.filter(r=>r.issues?.length);
 if(problems.length)$('checks').append(text('p','Строк с непроверенными или отсутствующими полями: '+problems.length+' из '+report.rows.length+'. Это не подтверждённая полная выгрузка.'));
}
async function load(reference=false) {
 if(busy)return;busy=true;
 $('refresh').disabled=true;$('example').disabled=true;$('export').disabled=true;
 report=null;shown=[];$('rows').replaceChildren();$('empty').hidden=false;
 $('empty').textContent='Загрузка…';$('count').textContent='Получаем данные…';
 $('source').textContent=reference?'Пример оформления':'Подключение к PostgreSQL';$('source').className='source';
 notice(reference?'Загружаем пример оформления…':'Получаем актуальные данные из базы…');
 try {
  const qs=new URLSearchParams({start:$('start').value,end:$('end').value,refresh:'1'});
  const response=await fetch(reference?'/api/reference':'/api/students?'+qs,{signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка загрузки');
  report=data;options();render();
  $('source').textContent=reference?'Пример · не данные базы':'PostgreSQL · актуальный запрос';
  $('source').className='source'+(reference?'':' live');
  $('updated').textContent=reference?'Данные из визуального референса':'Обновлено: '+new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'}).format(new Date(data.updated_at))+' МСК';
  notice(reference?'ПРИМЕР ОФОРМЛЕНИЯ. Эти строки иллюстрируют присланную таблицу и не являются актуальными данными PostgreSQL.':data.complete?'Данные получены и проверены.':'Данные получены из базы. Полнота выборки и некоторые поля ещё требуют проверки; подробности под таблицей.',reference?'demo':'');
 }catch(error) {
  notice(error.message==='The operation was aborted due to timeout'?'Истекло время ожидания ответа. Проверьте подключение к базе.':error.message,'error');
  $('source').textContent='База недоступна';$('updated').textContent='Актуальное обновление не выполнено';
  $('count').textContent='Нет загруженных данных';$('empty').textContent='Для просмотра внешнего вида нажмите «Пример оформления».';
  $('checks').replaceChildren(text('p','Актуальные данные не получены. Локальные слепки автоматически не используются.'));
 }finally {busy=false;$('refresh').disabled=false;$('example').disabled=false;}
}
for(const id of ['search','class','subject','format','teacher','status'])$(id).addEventListener('input',render);
$('reset').addEventListener('click',()=>{for(const id of ['search','class','subject','format','teacher','status'])$(id).value='';sort={key:'name',direction:1};render();});
$('refresh').addEventListener('click',()=>load(false));$('example').addEventListener('click',()=>load(true));
document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{
 const key=button.dataset.sort;sort={key,direction:sort.key===key?-sort.direction:1};
 document.querySelectorAll('[data-sort]').forEach(other=>other.closest('th').removeAttribute('aria-sort'));
 button.closest('th').setAttribute('aria-sort',sort.direction===1?'ascending':'descending');render();
}));
function csvCell(value){let v=String(value??'');if(/^[\s]*[=+@-]/.test(v)||/^[\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
$('export').addEventListener('click',()=>{
 if(!report||!shown.length)return;
 const content=[fields.map(([,label])=>csvCell(label)).join(';'),...shown.map(r=>fields.map(([key])=>csvCell(r[key])).join(';'))].join('\r\n');
 const blob=new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=(report.source==='reference'?'example-':'')+'students-'+$('end').value+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
load();
