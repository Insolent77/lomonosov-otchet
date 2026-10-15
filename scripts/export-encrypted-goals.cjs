'use strict';
const { Client } = require('pg');
const crypto = require('node:crypto');

const RSA_N = BigInt('0x' + 'b7bb40c7a40468ec79b04c1f7020a71fe11aace9b204fd8a38db3d9656400b4d86e431ea84568415362ace31fb00d75e39318150f322192f00c652db189db4e82a5aa6971b0e0b6d07161a895ce2ea1e9147d1bdab81041365676388936c2795db90565439b7c1d65c7d171c6c6444d9cca8fd454cfd572f20183d0be1e689cd');
const RSA_E = 65537n;
const MASK64 = (1n << 64n) - 1n;

function clean(v) {
  return String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function modPow(b,e,m) {
  let r=1n; b%=m;
  while(e>0n){ if(e&1n) r=(r*b)%m; b=(b*b)%m; e>>=1n; }
  return r;
}
function bufferToBigInt(buf) {
  return BigInt('0x' + buf.toString('hex'));
}
function encryptStream(input,key) {
  let s0=key.readBigUInt64BE(0);
  let s1=key.readBigUInt64BE(8);
  if(s0===0n && s1===0n) s1=1n;
  const out=Buffer.alloc(input.length);
  let pos=0;
  while(pos<input.length){
    let x=s0, y=s1;
    s0=y;
    x ^= (x << 23n) & MASK64;
    x ^= x >> 17n;
    x ^= y;
    x ^= y >> 26n;
    s1=x & MASK64;
    const z=(s1 + y) & MASK64;
    const block=Buffer.alloc(8);
    block.writeBigUInt64BE(z);
    for(let j=0;j<8 && pos<input.length;j++,pos++) out[pos]=input[pos]^block[j];
  }
  return out;
}

async function main(){
  if(!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD_MISSING');
  const c=new Client({
    host:process.env.DB_HOST,
    port:Number(process.env.DB_PORT),
    database:process.env.DB_NAME,
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
    ssl:false,
    connectionTimeoutMillis:15000,
    query_timeout:60000,
    application_name:'lomonosov_encrypted_goal_export'
  });
  await c.connect();
  try{
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout='60000ms'");
    const r=await c.query(`
      SELECT DISTINCT
        s.id AS student_id,
        s.name AS student_name,
        s.surname AS student_surname,
        s.student_goal,
        l.group_id,
        g.name AS group_name
      FROM public.group_lesson_students gls
      JOIN public.group_lesson l ON l.id=gls.lesson_id
      JOIN public.student_student s ON s.id=gls.student_id
      JOIN public.group_group g ON g.id=l.group_id
      WHERE l.start_dt >= TIMESTAMPTZ '2026-09-01 00:00:00+03'
        AND LOWER(TRIM(COALESCE(s.name,''))) <> 'ученик'
        AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'test%'
        AND LOWER(TRIM(COALESCE(s.name,''))) NOT LIKE 'тест%'
    `);
    await c.query('ROLLBACK');

    const pairs=r.rows.map(x=>({
      display_name:clean(x.student_surname+' '+x.student_name),
      group_id:String(x.group_id),
      group_name:clean(x.group_name),
      goal:clean(x.student_goal)
    })).sort((a,b)=>a.display_name.localeCompare(b.display_name,'ru')||a.group_name.localeCompare(b.group_name,'ru'));

    const checksum=fnv1a(pairs.map(p=>p.display_name+'|'+p.group_id).join('\n'));
    const payload={
      pair_count:pairs.length,
      checksum_fnv1a:checksum,
      filled:pairs.filter(p=>p.goal).length,
      rows:pairs.map((p,i)=>({row:i+2,goal:p.goal||null}))
    };

    const plain=Buffer.from(JSON.stringify(payload),'utf8');
    const sessionKey=crypto.randomBytes(16);
    const keyInt=bufferToBigInt(sessionKey);
    const encryptedKey=modPow(keyInt,RSA_E,RSA_N);
    const cipher=encryptStream(plain,sessionKey);

    console.log('GOALS_PAIR_COUNT='+payload.pair_count);
    console.log('GOALS_PAIR_CHECKSUM='+payload.checksum_fnv1a);
    console.log('GOALS_FILLED='+payload.filled);
    console.log('GOALS_KEY_RSA='+encryptedKey.toString(16));
    console.log('GOALS_CIPHERTEXT_B64='+cipher.toString('base64'));
  } finally {
    await c.end().catch(()=>{});
  }
}
main().catch(e=>{console.error('GOAL_EXPORT_FAILED:'+(e.code||e.message||'ERROR'));process.exitCode=1;});
