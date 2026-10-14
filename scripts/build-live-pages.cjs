'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg'),{loadReport}=require('../student-register/report.cjs');
async function main(){
 if(!process.env.DB_PASSWORD)throw new Error('DB_PASSWORD secret is missing');
 const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,
 password:process.env.DB_PASSWORD,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false,max:1,connectionTimeoutMillis:15000,query_timeout:30000});
 let report;
 try{report=await loadReport(pool,new URLSearchParams({start:'2026-09-01'}));}finally{await pool.end();}
 if(report.source!=='live'||!Array.isArray(report.rows))throw new Error('Invalid database report');
 const pairs=new Set(report.rows.map(row=>row.student_id+':'+row.group_id));
 if(pairs.size!==report.rows.length)throw new Error('Duplicate student/group pairs');
 const output=path.resolve('_site/student-register');fs.mkdirSync(output,{recursive:true});
 for(const file of ['index.html','app.js'])fs.copyFileSync(path.join(__dirname,'../student-register/pages',file),path.join(output,file));
 fs.copyFileSync(path.join(__dirname,'../student-register/public/style.css'),path.join(output,'style.css'));
 // Only normalized report columns are published. No connection settings, raw tables or schema.
 fs.writeFileSync(path.join(output,'data.json'),JSON.stringify(report));
 fs.writeFileSync('_site/.nojekyll','');
 fs.writeFileSync('_site/index.html','<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./student-register/"><a href="./student-register/">Открыть отчёт</a>');
 console.log(JSON.stringify({rows:report.rows.length,students:new Set(report.rows.map(r=>r.student_id)).size,complete:report.complete,updated_at:report.updated_at}));
}
main().catch(error=>{const password=process.env.DB_PASSWORD;let message=error.message||'Unknown error';if(password)message=message.replaceAll(password,'[redacted]');console.error('Report build failed: '+(error.code||'')+' '+message);process.exitCode=1;});
