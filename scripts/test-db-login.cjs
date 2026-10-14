'use strict';
const {Client}=require('pg');
async function main(){
 if(!process.env.DB_PASSWORD)throw Object.assign(new Error('Missing repository secret'),{code:'DB_PASSWORD_MISSING'});
 const client=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,
 user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false,
 connectionTimeoutMillis:15000,query_timeout:15000,application_name:'student_register_connection_test'});
 try{
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const result=await client.query('SELECT 1 AS connected');
  await client.query('ROLLBACK');
  if(result.rows[0]?.connected!==1)throw new Error('Unexpected response');
  console.log('Authenticated read-only SELECT 1 succeeded. No student data queried or exported.');
 }finally{await client.end().catch(()=>{});}
}
main().catch(error=>{
 console.error('Database connection test failed: '+(error.code||'CONNECTION_OR_QUERY_FAILED'));
 if(error.code==='DB_PASSWORD_MISSING')console.error('Add DB_PASSWORD in repository Settings > Secrets and variables > Actions, then rerun this job.');
 process.exitCode=1;
});
