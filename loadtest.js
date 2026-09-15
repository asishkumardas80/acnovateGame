// DevRush Arena load test — simulates N concurrent players against a server.
// Usage:  node loadtest.js [players] [host] [port]
//   node loadtest.js            -> 60 players vs localhost:3000
//   node loadtest.js 150        -> 150 players vs localhost:3000
//   node loadtest.js 100 my-app.onrender.com 443   -> vs a deployed server
const https = require('https'), http = require('http');
const N    = parseInt(process.argv[2]) || 60;
const HOST = process.argv[3] || 'localhost';
const PORT = parseInt(process.argv[4]) || 3000;
const TLS  = PORT === 443;
const lib  = TLS ? https : http;

function req(method, path, body) {
  return new Promise((resolve) => {
    const t = Date.now();
    const data = body ? JSON.stringify(body) : null;
    const opts = { host: HOST, port: PORT, path, method,
      headers: Object.assign({ 'Accept-Encoding': 'gzip' },
        data ? { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) };
    const r = lib.request(opts, (resp) => {
      let n = 0; resp.on('data', c => n += c.length);
      resp.on('end', () => resolve({ status: resp.statusCode, ms: Date.now()-t, bytes: n,
        ver: resp.headers['x-store-version'], enc: resp.headers['content-encoding']||'' }));
    });
    r.on('error', e => resolve({ status: 0, ms: Date.now()-t, err: e.code }));
    if (data) r.write(data); r.end();
  });
}
const stat = (arr) => { if(!arr.length) return {n:0,p50:0,p95:0,max:0,avg:0}; const s=[...arr].sort((a,b)=>a-b);
  const q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
  return { n:s.length, min:s[0], p50:q(.5), p95:q(.95), max:s[s.length-1], avg:Math.round(s.reduce((a,b)=>a+b,0)/s.length) }; };
const line = (label,st,extra='') => console.log(`  ${label.padEnd(26)} n=${st.n}  p50=${st.p50}ms  p95=${st.p95}ms  max=${st.max}ms  avg=${st.avg}ms ${extra}`);

(async () => {
  console.log(`\n=== DevRush Arena load test: ${N} players vs ${HOST}:${PORT} ===\n`);
  const pids = Array.from({length:N}, (_,i)=>'load_'+i);
  let errors = 0, slow = 0; const bump=(r)=>{ if(r.status===0||r.status>=500) errors++; if(r.ms>1000) slow++; return r; };

  await req('POST','/api/reset');
  await req('POST','/api/storage/game',{value:{stage:'game',roundIndex:3,phase:'playing',tStart:Date.now(),duration:120}});

  let t=Date.now();
  let res = await Promise.all(pids.map(p=>req('POST','/api/storage/player:'+p,{value:{pid:p,name:'P'+p,emoji:'X',color:'#5b8cff',ts:1}}).then(bump)));
  console.log(`1) JOIN burst (${N} concurrent writes)   in ${Date.now()-t}ms`);
  line('   write latency', stat(res.map(r=>r.ms)));

  const teams=[]; for(let i=0;i<Math.ceil(N/6);i++) teams.push({id:'t'+i,name:'Team'+i,color:'#2fd4c9',pids:pids.slice(i*6,i*6+6)});
  await req('POST','/api/storage/teams',{value:teams});

  let cur = (await req('GET','/api/all')).ver;
  t=Date.now();
  res = await Promise.all(pids.map(()=>req('GET','/api/all?v='+cur).then(bump)));
  console.log(`\n2) STEADY poll (${N} concurrent, version match)  in ${Date.now()-t}ms`);
  line('   poll latency', stat(res.map(r=>r.ms)), `| 304s=${res.filter(r=>r.status===304).length}/${N}`);

  t=Date.now();
  res = await Promise.all(pids.map(p=>req('POST','/api/storage/pscore:3:'+p,{value:80}).then(bump)));
  console.log(`\n3) SUBMIT burst (${N} concurrent writes)  in ${Date.now()-t}ms`);
  line('   write latency', stat(res.map(r=>r.ms)));

  t=Date.now();
  res = await Promise.all(pids.map(()=>req('GET','/api/all?v='+cur).then(bump)));
  console.log(`\n4) FULL fetch after change (${N} concurrent, 200)  in ${Date.now()-t}ms`);
  line('   fetch latency', stat(res.map(r=>r.ms)),
       `| payload~${Math.round((res[0].bytes||0)/1024*10)/10}KB gzip=${res[0].enc||'none'}`);

  console.log(`\n5) SUSTAINED 10s (${N} players polling ~every 2s + writes)`);
  const polls=[], writes=[]; let stop=false;
  const clients = pids.map((p,i)=> (async()=>{
    while(!stop){ const r=await req('GET','/api/all?v='+cur); if(r.ver) cur=r.ver; polls.push(r.ms); bump(r);
      if(i%15===0){ const w=await req('POST','/api/storage/panswer:3:'+p,{value:{display:'x',name:p,ts:Date.now()}}); writes.push(w.ms); bump(w); }
      await new Promise(z=>setTimeout(z, 1800+Math.random()*400)); }
  })());
  await new Promise(z=>setTimeout(z,10000)); stop=true; await Promise.all(clients);
  line('   sustained poll latency', stat(polls));
  if(writes.length) line('   sustained write latency', stat(writes));
  console.log('   throughput: '+polls.length+' polls in 10s  (~'+Math.round(polls.length/10)+'/sec)');

  console.log('\n=== RESULT ===');
  console.log('  server errors (5xx / conn fail): '+errors);
  console.log('  requests over 1s (laggy):        '+slow);
  console.log('  '+(errors===0 && slow===0 ? 'PASS - comfortably handles '+N+' players' :
                    errors===0 ? 'OK - no errors but '+slow+' slow requests (approaching limits)' :
                    'FAIL - '+errors+' errors'));

  await req('POST','/api/reset');
  await req('POST','/api/storage/game',{value:{stage:'lobby',roundIndex:0,phase:'lobby',tStart:0,duration:0}});
  console.log('  (store reset to clean lobby)\n');
})();
