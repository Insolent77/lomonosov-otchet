
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;
for(const file of [path.join(root,'.env'),path.join(root,'..','.env')]) {
 if(!fs.existsSync(file))continue;
 for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
  const m=line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=(.*)$/);
  if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');
 }
}
const {Pool}=require('pg'),{loadReport}=require('./report.cjs');
const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),
 database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,
 ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false,max:2,
 connectionTimeoutMillis:8000,query_timeout:30000,application_name:'student_register'});
const PORT=Number(process.env.STUDENT_REGISTER_PORT||8788);
const publicDir=path.join(root,'public'),demo=JSON.parse(fs.readFileSync(path.join(root,'reference.json'),'utf8'));
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
let cache=null,inflight=null;
const server=http.createServer(async(req,res)=>{
 try {
  if(req.method!=='GET')return reply(res,405,{error:'Разрешено только чтение'});
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/reference')return reply(res,200,demo);
  if(url.pathname==='/api/students') {
   const key=url.searchParams.get('start')+'|'+url.searchParams.get('end');
   if(cache&&cache.key===key&&Date.now()-cache.at<60000&&url.searchParams.get('refresh')!=='1')return reply(res,200,cache.data);
   if(inflight&&inflight.key!==key)return reply(res,429,{error:'Дождитесь завершения текущего обновления'});
   if(!inflight){const promise=loadReport(pool,url.searchParams);inflight={key,promise};promise.finally(()=>{inflight=null;}).catch(()=>{});}
   const data=await inflight.promise;cache={key,at:Date.now(),data};return reply(res,200,data);
  }
  const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file=path.resolve(publicDir,relative);
  if(!file.startsWith(publicDir+path.sep))return reply(res,403,{error:'Доступ запрещён'});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return reply(res,404,{error:'Страница не найдена'});
  const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
 }catch(error){const invalid=/дата|Период/.test(error.message);reply(res,invalid?400:503,{error:invalid?error.message:'Не удалось получить актуальные данные из PostgreSQL. Проверьте доступность базы.',source:'unavailable'});}
});
server.listen(PORT,'127.0.0.1',()=>console.log('Ученики и срез: http://localhost:'+PORT));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>pool.end().then(()=>process.exit())));
