const puppeteer=require('puppeteer-core');const fs=require('fs');
const BASE='http://drug.test:8181/';const S='/tmp/shots/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=fs.createWriteStream('/tmp/receipt.log',{flags:'a'});
const HOOKDEF=1;const log=(...a)=>{const l=new Date().toISOString()+' '+a.join(' ');console.log(l);out.write(l+'\n')};
const HOOK=()=>{if(window.__hooked)return;window.__hooked=true;window.__drafts=[];const R=window.DawayaAIRuntime;const g=R.generate.bind(R);R.generate=async(req)=>{const out=await g(req);window.__drafts.push({prompt:String(req.prompt||'').slice(-700),text:out&&out.text,err:out&&out.error});return out}};
const reqs=[];
function watch(page,tag){page.on('request',r=>{reqs.push({tag,t:Date.now(),m:r.method(),u:r.url(),b:r.postData()||''})});
 page.on('console',m=>{const t=m.text();if(/error|fail|block/i.test(t))log('console['+tag+']',t.slice(0,300))});
 page.on('pageerror',e=>log('pageerror['+tag+']',String(e).slice(0,300)))}
async function state(p){return p.evaluate(()=>({s:document.getElementById('aiStatus')?.dataset.state,t:document.getElementById('aiStatusText')?.textContent,prog:document.getElementById('aiProgressText')?.textContent}))}
async function openAssistant(p){await p.evaluate(()=>document.querySelector('.bottom-nav-ai, [data-app-nav="assistant"]').click());await sleep(1500)}
async function ask(p,q,tag,maxMs=600000){
 const before=await p.evaluate(()=>document.getElementById('aiLog').innerText.length);
 await p.click('#aiInput');await p.type('#aiInput',q);
 const n0=reqs.length;
 await p.click('#aiSend');log('asked',tag,q);
 const t0=Date.now();let last='',same=0;
 while(Date.now()-t0<maxMs){await sleep(5000);
  const r=await p.evaluate(()=>({txt:document.getElementById('aiLog').innerText,stop:!document.getElementById('aiStop').hidden}));
  if(!r.stop&&r.txt.length>before+20){break}}
 await sleep(1500);
 const txt=await p.evaluate(()=>document.getElementById('aiLog').innerText);
 log('answer',tag,'secs',((Date.now()-t0)/1000).toFixed(0));fs.writeFileSync(S+tag+'.txt',txt.slice(txt.lastIndexOf(q)));
 await p.screenshot({path:S+tag+'.png',fullPage:false});return {txt,n0}}
(async()=>{
 const ud='/tmp/prof-'+Date.now();
 const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',userDataDir:ud,args:['--no-sandbox','--disable-dev-shm-usage','--host-resolver-rules=MAP drug.test 127.0.0.1','--unsafely-treat-insecure-origin-as-secure=http://drug.test:8181'],defaultViewport:{width:430,height:900}});
 const p=await b.newPage();watch(p,'main');
 await p.evaluateOnNewDocument(()=>{Object.defineProperty(Navigator.prototype,'deviceMemory',{get:()=>8});try{localStorage.getItem('dawaya-language')||localStorage.setItem('dawaya-language','en')}catch(_){}});
 await p.goto(BASE,{waitUntil:'load'});await sleep(4000);
 log('loaded; SW controller',await p.evaluate(()=>!!navigator.serviceWorker.controller),'crossOriginIsolated',await p.evaluate(()=>crossOriginIsolated));
 await openAssistant(p);await p.screenshot({path:S+'01-assistant-fresh.png'});log('state',JSON.stringify(await state(p)));
 // download
 const dl0=reqs.length;
 await p.click('#aiStart');log('clicked download');
 const t0=Date.now();let lastp='';
 while(Date.now()-t0<1500000){await sleep(10000);const s=await state(p);if(s.prog!==lastp){lastp=s.prog;log('dl',JSON.stringify(s))}
  if(Date.now()-t0>20000&&!(await p.evaluate(()=>document.getElementById('aiStart').offsetParent))&&(s.s==='ready'||/ready/i.test(s.t||''))){break}
  if(['error','failed'].includes(s.s))break}
 log('post-download state',JSON.stringify(await state(p)),'secs',((Date.now()-t0)/1000).toFixed(0));
 await p.screenshot({path:S+'02-model-ready.png'});
 const dlHosts=[...new Set(reqs.slice(dl0).map(r=>new URL(r.u).host))];log('hosts during/after download',dlHosts.join(','));

 await p.evaluate(HOOK);
 const q1=await ask(p,'What are the side effects of Panadol 500 mg tablets?','10-ask-en-panadol');
 const q2=await ask(p,'What is the best pasta recipe for dinner?','11-offtopic-pasta');
 const q3=await ask(p,'Who won the football World Cup in 2018?','12-offtopic-worldcup');
 fs.writeFileSync(S+'drafts-en.json',JSON.stringify(await p.evaluate(()=>window.__drafts),null,1));
 // Arabic UI
 await p.evaluate(()=>{localStorage.setItem('dawaya-language','ar')});await p.reload({waitUntil:'load'});await sleep(4000);
 await openAssistant(p);await sleep(6000);log('ar state',JSON.stringify(await state(p)));await p.evaluate(HOOK);
 await p.screenshot({path:S+'13-ar-ui-assistant.png'});
 const q4=await ask(p,'ما هي الآثار الجانبية لدواء كونكور؟','14-ask-ar-ui-concor');
 const q5=await ask(p,'مين كسب كاس العالم؟','15-ar-offtopic-worldcup');
 const q6=await ask(p,'إزاي أعمل مكرونة بالبشاميل؟','16-ar-offtopic-pasta');
 fs.writeFileSync(S+'drafts-ar.json',JSON.stringify(await p.evaluate(()=>window.__drafts),null,1));
 const tail=await p.evaluate(()=>[...document.querySelectorAll('.ai-disclaimer')].map(e=>e.textContent));log('AR disclaimer elements',JSON.stringify(tail));
 // question privacy
 const bad=reqs.filter(r=>/panadol|football|pasta|concor|كونكور/i.test(decodeURIComponent(r.u)+r.b));
 log('requests total',reqs.length,'containing question text',bad.length,JSON.stringify(bad.map(r=>r.u)));
 log('non-local requests after download:',JSON.stringify(reqs.slice(dl0).filter(r=>!r.u.startsWith(BASE)&&!/huggingface|\.hf\.co/.test(r.u)).map(r=>r.u)));
 const tAsk=r1.n0;log('non-local requests since first ask:',JSON.stringify(reqs.slice(tAsk).filter(r=>!r.u.startsWith(BASE)).map(r=>r.u)));
 await b.close();log('DONE main');
})().catch(e=>{log('FATAL',e.stack);process.exit(1)});
