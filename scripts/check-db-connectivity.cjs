'use strict';
// Probe only the authorized PostgreSQL endpoint; no passwords or student records.
const net = require('node:net');
const fs = require('node:fs');
const host = process.env.DB_HOST || '37.140.199.107';
const port = Number(process.env.DB_PORT || 16623);
function probe(kind) {
  return new Promise(resolve => {
    const result = {kind, tcp_connected:false, postgres_response:false};
    const socket = net.createConnection({host, port});
    let finished=false;
    const timer=setTimeout(()=>finish('timeout'),10000);
    function finish(status) {
      if(finished)return; finished=true;clearTimeout(timer);socket.destroy();
      resolve({...result,status});
    }
    socket.on('connect',()=>{
      result.tcp_connected=true;
      if(kind==='ssl') {
        const bytes=Buffer.alloc(8);bytes.writeInt32BE(8);bytes.writeInt32BE(80877103,4);socket.write(bytes);
      } else {
        const payload=Buffer.from('user\0readonly_user\0database\0mylomonosov\0application_name\0report-connectivity-check\0\0');
        const bytes=Buffer.alloc(8+payload.length);bytes.writeInt32BE(bytes.length);bytes.writeInt32BE(196608,4);payload.copy(bytes,8);socket.write(bytes);
      }
    });
    socket.once('data',data=>{
      result.response_type=String.fromCharCode(data[0]);
      result.postgres_response=kind==='ssl'?['S','N'].includes(result.response_type):['R','E'].includes(result.response_type);
      finish(result.postgres_response?'postgres_replied':'unexpected_protocol');
    });
    socket.on('error',error=>finish(error.code||'connection_error'));
    socket.on('end',()=>finish('closed'));
  });
}
(async()=>{
 const checks=await Promise.all([probe('ssl'),probe('startup')]);
 const report={checked_at:new Date().toISOString(),host,port,checks};
 fs.mkdirSync('connectivity-result',{recursive:true});
 fs.writeFileSync('connectivity-result/result.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## PostgreSQL connectivity\n\n'+checks.map(c=>'- '+c.kind+': TCP '+c.tcp_connected+', PostgreSQL '+c.postgres_response+', '+c.status).join('\n')+'\n');
 if(!checks.some(c=>c.postgres_response))process.exitCode=1;
})();
