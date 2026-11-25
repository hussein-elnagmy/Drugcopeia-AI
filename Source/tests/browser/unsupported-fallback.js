const puppeteer=require('puppeteer-core');const fs=require('fs');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cases={'A-low-memory-natural':()=>{}, 'B-no-opfs':()=>{Object.defineProperty(StorageManager.prototype,'getDirectory',{value:undefined})}, 'C-no-webassembly':()=>{delete window.WebAssembly}};
(async()=>{for(const [name,fn] of Object.entries(cases)){
 const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',userDataDir:'/tmp/pu-'+name,args:['--no-sandbox'],defaultViewport:{width:430,height:900}});
 const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
 await p.evaluateOnNewDocument(`(${fn.toString()})();try{localStorage.setItem('dawaya-language','en')}catch(_){}`);
 await p.goto('http://127.0.0.1:8181/',{waitUntil:'load'});await sleep(3000);
 await p.evaluate(()=>document.querySelector('[data-app-nav="assistant"]').click());await sleep(4000);
 const st=await p.evaluate(()=>({s:document.getElementById('aiStatus').dataset.state,t:document.getElementById('aiStatusText').innerText,why:document.getElementById('aiSmartWhy')?.innerText,banner:!document.getElementById('aiSmartBanner').hidden,startVisible:!!document.getElementById('aiStart').offsetParent}));
 await p.screenshot({path:`/tmp/shots/U-${name}-1.png`});
 let ans='';
 try{await p.click('#aiInput');await p.type('#aiInput','What are the side effects of Concor?');await p.click('#aiSend');const t0=Date.now();await sleep(3000);while(Date.now()-t0<60000&&await p.evaluate(()=>!document.getElementById('aiStop').hidden))await sleep(1000);ans=await p.evaluate(()=>document.getElementById('aiLog').innerText.slice(0,260));
 await p.screenshot({path:`/tmp/shots/U-${name}-2.png`});}catch(e){ans='ERR '+e.message}
 console.log(name,JSON.stringify({st,errs,answered:ans.replace(/\n/g,' | ')}));await b.close();}})()
