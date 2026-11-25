const S=require('../webapp/same-spec.js');const fs=require('fs');
const drugs=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../webapp/assets/egyptian-drugs.json'),'utf8'));
const built=S.buildIndex(drugs);
let ok=0,reasons={};drugs.forEach(d=>{const s=built.specs.get(d);if(s.ok)ok++;else reasons[s.reason]=(reasons[s.reason]||0)+1});
console.log('parsed ok',ok,'of',drugs.length,reasons);
let withAlt=0;for(const d of drugs){if(built.specs.get(d).ok){const c=S.compare(d,built);if(c.rows.length)withAlt++}}
console.log('with alternatives',withAlt);
const mk=(n,sci,route,price)=>({commercial_name_en:n,scientific_name:sci,route,price_egp:price});
function T(name,fn){try{fn();console.log('PASS',name)}catch(e){console.log('FAIL',name,e.message);process.exitCode=1}}
const assert=require('assert');
const mini=[
 mk('DICLO 50 MG 20 TABS.','DICLOFENAC SODIUM','ORAL.SOLID',20),
 mk('DICLO RETARD 100 MG 20 TABS.','DICLOFENAC SODIUM','ORAL.SOLID',30),
 mk('DICLO IR 50 MG 20 TABS.','DICLOFENAC SODIUM','ORAL.SOLID',15),
 mk('DICLO 50 MG 20 AMP.','DICLOFENAC SODIUM','INJECTION',9),
 mk('DICLO 50 MG 10 TABS.','DICLOFENAC SODIUM','ORAL.SOLID',9),
 mk('DICLO 50 MG 30 TABS.','DICLOFENAC SODIUM','ORAL.SOLID',27),
 mk('COMBO 500/50 MG 20 TABS.','A+B','ORAL.SOLID',10),
 mk('COMBO2 500 MG 20 TABS.','A+B','ORAL.SOLID',8),
 mk('COMBO3 500+50 MG 20 TABS.','A+B','ORAL.SOLID',11),
 mk('NOROUTE 50 MG 20 TABS.','DICLOFENAC SODIUM','UNKNOWN',5),
 mk('XR 50 MG 20 TABS.','DICLOFENAC SODIUM','ORAL.SOLID',5),
];
const b=S.buildIndex(mini);
T('IR50 tab != ER100 tab',()=>{const c=S.compare(mini[0],b);assert(!c.rows.some(r=>r.drug===mini[1]))});
T('ER 50 != IR 50',()=>{const c=S.compare(mini[0],b);assert(!c.rows.some(r=>r.drug===mini[10]))});
T('oral tablet != ampoule',()=>{const c=S.compare(mini[0],b);assert(!c.rows.some(r=>r.drug===mini[3]))});
T('same pack direct',()=>{const c=S.compare(mini[0],b);const r=c.rows.find(r=>r.drug===mini[2]);assert(r&&r.basis==='pack'&&r.saving===5)});
T('diff pack per unit',()=>{const c=S.compare(mini[0],b);const r=c.rows.find(r=>r.drug===mini[4]);assert(r&&r.basis==='unit'&&Math.abs(r.comparable-0.9)<1e-9)});
T('route unknown excluded',()=>{assert(!b.specs.get(mini[9]).ok)});
T('combo needs same strengths',()=>{const c=S.compare(mini[6],b);assert(!c.rows.some(r=>r.drug===mini[7]))});
