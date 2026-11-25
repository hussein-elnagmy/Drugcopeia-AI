/* Drugcopeia AI extras: tool cards inside the chat, clickable drug cards, saved chats
   grouped and searchable, patient/doctor modes, export and share.
   Presentation and navigation only. Answers, sources and the doctor note still come
   from the same pipeline and safety rules; nothing here writes medical text. */
(function(){
  'use strict';
  var doc=document,root=doc.documentElement;
  var lang=function(){return root.lang==='en'?'en':'ar'};
  var MODE_KEY='drugcopeia-ai-mode';
  var T={
    ar:{
      alt:'البدائل',inter:'التفاعلات',dose:'الجرعة',preg:'الحمل والرضاعة',calcDose:'حاسبة الجرعة',pair:'تفاعل مع دواء آخر',
      q:{
        alt:function(n){return 'ما هي بدائل '+n+' المتاحة وأسعارها؟'},
        inter:function(n){return 'ما أهم التفاعلات الدوائية لـ '+n+'؟'},
        dose:function(n){return 'ما الجرعة المعتادة لـ '+n+' وما الحد الأقصى؟'},
        preg:function(n){return 'هل '+n+' آمن أثناء الحمل والرضاعة؟'}
      },
      toolTitle:{inter:'فحص التفاعل بين دواءين',peds:'حاسبة جرعة الأطفال',calc:'الحاسبات الطبية'},
      toolHint:'الأداة داخل المحادثة. النتيجة مرجعية وتحتاج مراجعة الطبيب أو الصيدلي.',
      mode:'وضع الاستخدام',patient:'مريض',doctor:'طبيب',
      modeNote:{patient:'شرح مبسط بكلمات سهلة.',doctor:'لغة طبية ومعلومات أدق.'},
      saved:'محادثاتي المحفوظة',savedSearch:'ابحث في المحادثات',savedEmpty:'لا توجد محادثات محفوظة بعد.',savedNone:'لا نتائج.',
      grp:{drug:'الأدوية',cond:'الحالات المرضية',test:'التحاليل',preg:'الحمل والرضاعة',other:'أخرى'},
      msgs:'رسالة',del:'حذف',close:'إغلاق',
      exp:'تصدير ومشاركة المحادثة',expTitle:'تصدير المحادثة',share:'مشاركة',copy:'نسخ',copied:'تم النسخ',txt:'تنزيل ملف نصي',print:'طباعة / حفظ PDF',
      emptyChat:'لا توجد محادثة لتصديرها بعد.',you:'أنت',bot:'Drugcopeia',shareAns:'مشاركة',head:'محادثة Drugcopeia AI',
      foot:'للتثقيف فقط ولا تغني عن الطبيب أو الصيدلي.'
    },
    en:{
      alt:'Alternatives',inter:'Interactions',dose:'Dose',preg:'Pregnancy',calcDose:'Dose calculator',pair:'Check with another drug',
      q:{
        alt:function(n){return 'What are the available alternatives to '+n+' and their prices?'},
        inter:function(n){return 'What are the main drug interactions of '+n+'?'},
        dose:function(n){return 'What is the usual dose of '+n+' and its maximum?'},
        preg:function(n){return 'Is '+n+' safe in pregnancy and breastfeeding?'}
      },
      toolTitle:{inter:'Two-drug interaction check',peds:'Pediatric dose calculator',calc:'Clinical calculators'},
      toolHint:'This tool runs inside the chat. Results are a reference; confirm with a doctor or pharmacist.',
      mode:'Mode',patient:'Patient',doctor:'Doctor',
      modeNote:{patient:'Simple explanations in plain words.',doctor:'Clinical wording and more detail.'},
      saved:'Saved chats',savedSearch:'Search chats',savedEmpty:'No saved chats yet.',savedNone:'No results.',
      grp:{drug:'Drugs',cond:'Conditions',test:'Tests',preg:'Pregnancy',other:'Other'},
      msgs:'messages',del:'Delete',close:'Close',
      exp:'Export / share chat',expTitle:'Export chat',share:'Share',copy:'Copy',copied:'Copied',txt:'Download text file',print:'Print / save as PDF',
      emptyChat:'There is no conversation to export yet.',you:'You',bot:'Drugcopeia',shareAns:'Share',head:'Drugcopeia AI conversation',
      foot:'For education only. It does not replace your doctor or pharmacist.'
    }
  };
  var tx=function(){return T[lang()]};
  function el(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  function log(){return doc.getElementById('aiLog')}
  function closeMenu(){var b=doc.getElementById('aiMenuClose');var bd=doc.getElementById('aiMenuBackdrop');if(bd&&!bd.hidden&&b)b.click()}
  function fill(text,send){
    var i=doc.getElementById('aiInput'),f=doc.getElementById('aiComposer');if(!i)return;
    i.value=text;i.dispatchEvent(new Event('input',{bubbles:true}));
    if(send&&f){if(f.requestSubmit)f.requestSubmit();else f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))}
    else i.focus();
  }

  /* ---------------- mode: patient / doctor ---------------- */
  function mode(){try{return localStorage.getItem(MODE_KEY)==='doctor'?'doctor':'patient'}catch(_){return 'patient'}}
  function setMode(m){
    try{localStorage.setItem(MODE_KEY,m)}catch(_){}
    root.dataset.aiMode=m;
    doc.dispatchEvent(new CustomEvent('drugcopeia-mode',{detail:m}));
  }
  root.dataset.aiMode=mode();
  /* Read by the prompt builder. A hint about wording only: the safety rules never change. */
  window.DrugcopeiaAudience=function(l){
    if(mode()==='doctor')return l==='en'
      ?'Audience: a clinician. Use precise clinical terms and give mechanism, interactions and monitoring when the context has them. Same rules as always: only facts from the context.'
      :'الجمهور: طبيب أو صيدلي. استخدم مصطلحات طبية دقيقة واذكر الآلية والتفاعلات والمتابعة إذا كانت موجودة في السياق. نفس القواعد: معلومات السياق فقط.';
    return l==='en'
      ?'Audience: a patient with no medical training. Use short sentences and plain words and explain any medical term. Same rules as always: only facts from the context.'
      :'الجمهور: مريض بلا خلفية طبية. استخدم جملاً قصيرة وكلمات بسيطة واشرح أي مصطلح طبي. نفس القواعد: معلومات السياق فقط.';
  };

  /* ---------------- tool cards inside the chat ---------------- */
  var TOOLS={inter:{page:'interactions',sel:'#interactionsPage'},peds:{page:'dose-calculator',sel:'#dosePage'},calc:{page:'calculators',sel:'#calcPage'}};
  var held={};
  function avatar(){
    var src=doc.querySelector('.ai-msg-bot .ai-avatar');
    if(src)return src.cloneNode(true);
    var a=el('span','ai-avatar','D');a.setAttribute('aria-hidden','true');return a;
  }
  function botShell(){
    var art=el('article','ai-msg ai-msg-bot ai-tool-msg');art.dataset.role='assistant';
    var bubble=el('div','ai-bubble');art.append(avatar(),bubble);
    return {art:art,bubble:bubble};
  }
  function openTool(key){
    var t=TOOLS[key],app=window.DawayaApp,lg=log();
    if(!t||!app||!lg)return;
    closeMenu();
    var sec=held[key]||doc.querySelector(t.sel);
    if(!sec)return;
    if(sec.dataset.mainPage){ /* first use: let the app initialise the page, then take it into the chat */
      try{app.switchPage(t.page)}catch(_){}
      sec.dataset.aiPage=sec.dataset.mainPage;sec.removeAttribute('data-main-page');
    }
    held[key]=sec;
    sec.hidden=false;sec.classList.add('ai-embedded-tool');
    var prev=sec.closest('.ai-tool-msg');if(prev)prev.remove();
    var shell=botShell();
    var h=el('strong','ai-tool-title',tx().toolTitle[key]);
    shell.bubble.append(h,sec,el('p','ai-inline-note',tx().toolHint));
    lg.append(shell.art);
    try{app.switchPage('assistant')}catch(_){}
    setTimeout(function(){shell.art.scrollIntoView({block:'start',behavior:'smooth'})},60);
  }

  /* ---------------- clickable cards: actions under each drug ---------------- */
  function decorateCards(){
    var lg=log();if(!lg)return;
    lg.querySelectorAll('.ai-card-med').forEach(function(card){
      if(card.querySelector('.ai-card-actions'))return;
      var nameEl=card.querySelector('.ai-card-name');var name=nameEl?nameEl.textContent.trim():'';
      if(!name)return;
      var t=tx(),row=el('div','ai-card-actions');
      ['alt','inter','dose','preg'].forEach(function(k){
        var b=el('button','ai-chip ai-chip-small',t[k]);b.type='button';
        b.addEventListener('click',function(){fill(t.q[k](name),true)});row.append(b);
      });
      var c1=el('button','ai-chip ai-chip-small ai-chip-tool',t.calcDose);c1.type='button';c1.addEventListener('click',function(){openTool('peds')});
      var c2=el('button','ai-chip ai-chip-small ai-chip-tool',t.pair);c2.type='button';c2.addEventListener('click',function(){openTool('inter')});
      row.append(c1,c2);
      card.append(row);
    });
    lg.querySelectorAll('.ai-msg-actions').forEach(function(row){
      if(row.querySelector('.ai-share-one'))return;
      var b=el('button','ai-link-button ai-share-one',tx().shareAns);b.type='button';
      b.addEventListener('click',function(){
        var msg=row.closest('.ai-msg');
        shareText(messageText(msg),b);
      });
      row.append(b);
    });
  }

  /* ---------------- export / share ---------------- */
  function messageText(msg){
    if(!msg)return '';
    var t=tx(),who=msg.classList.contains('ai-msg-user')?t.you:t.bot,parts=[];
    var main=msg.querySelectorAll('.ai-text'),body='';
    if(main.length)main.forEach(function(n){body+=(body?'\n':'')+n.textContent.trim()});
    else{var b=msg.querySelector('.ai-bubble');body=b?b.textContent.trim():''}
    if(!body)return '';
    parts.push(who+': '+body);
    msg.querySelectorAll('.ai-card-med').forEach(function(c){
      var n=c.querySelector('.ai-card-name');
      var facts=[].map.call(c.querySelectorAll('.ai-card-facts dd, .ai-card-note, .ai-card-interaction'),function(x){return '  - '+x.textContent.trim()});
      if(n)parts.push('['+n.textContent.trim()+']\n'+facts.join('\n'));
    });
    var srcs=[].map.call(msg.querySelectorAll('.ai-sources a, .ai-links a'),function(a){return '  - '+a.textContent.trim()+(a.href?' '+a.href:'')});
    if(srcs.length)parts.push(srcs.join('\n'));
    return parts.join('\n');
  }
  function conversationText(){
    var lg=log();if(!lg)return '';
    var t=tx(),out=[t.head,new Date().toLocaleString(lang()==='ar'?'ar-EG':'en-GB'),''];
    var any=false;
    lg.querySelectorAll('.ai-msg').forEach(function(m){if(m.classList.contains('ai-tool-msg'))return;var s=messageText(m);if(s){any=true;out.push(s,'')}});
    if(!any)return '';
    out.push(t.foot);
    return out.join('\n');
  }
  function copyText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(text).then(function(){return true},function(){return false});
    try{var ta=el('textarea');ta.value=text;doc.body.appendChild(ta);ta.select();var ok=doc.execCommand('copy');ta.remove();return Promise.resolve(ok)}catch(_){return Promise.resolve(false)}
  }
  function shareText(text,btn){
    if(!text)return;
    var label=btn&&btn.textContent;
    if(navigator.share){navigator.share({title:'Drugcopeia AI',text:text}).catch(function(){})}
    else copyText(text).then(function(ok){if(btn&&ok){btn.textContent=tx().copied;setTimeout(function(){btn.textContent=label},1500)}});
  }
  function download(text){
    try{
      var blob=new Blob([text],{type:'text/plain;charset=utf-8'});
      var a=el('a');a.href=URL.createObjectURL(blob);a.download='drugcopeia-ai-chat.txt';doc.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
    }catch(_){copyText(text)}
  }
  var overlay=null;
  function closeOverlay(){if(overlay){overlay.remove();overlay=null}}
  function openOverlay(title){
    closeOverlay();
    overlay=el('div','ai-overlay');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    var box=el('div','ai-overlay-box');
    var head=el('div','ai-overlay-head');head.append(el('strong','',title));
    var x=el('button','ai-overlay-x','\u00d7');x.type='button';x.setAttribute('aria-label',tx().close);x.addEventListener('click',closeOverlay);head.append(x);
    box.append(head);overlay.append(box);
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeOverlay()});
    doc.body.appendChild(overlay);
    return box;
  }
  function openExport(){
    closeMenu();
    var t=tx(),text=conversationText(),box=openOverlay(t.expTitle);
    if(!text){box.append(el('p','ai-overlay-note',t.emptyChat));return}
    var pre=el('pre','ai-export-preview',text);box.append(pre);
    var row=el('div','ai-overlay-row');
    var mk=function(label,fn){var b=el('button','ai-chip',label);b.type='button';b.addEventListener('click',function(){fn(b,label)});row.append(b);return b};
    if(navigator.share)mk(t.share,function(b){shareText(text,b)});
    mk(t.copy,function(b,l){copyText(text).then(function(ok){if(ok){b.textContent=t.copied;setTimeout(function(){b.textContent=l},1500)}})});
    mk(t.txt,function(){download(text)});
    mk(t.print,function(){
      var pr=el('div','');pr.id='ai-print-root';pr.dir='auto';pr.textContent=text;doc.body.appendChild(pr);root.classList.add('ai-printing');
      setTimeout(function(){window.print();setTimeout(function(){root.classList.remove('ai-printing');pr.remove()},600)},50);
    });
    box.append(row);
  }

  /* ---------------- saved chats: grouped and searchable ---------------- */
  var RE={
    preg:/حمل|حامل|رضاع|رضيع|ارضاع|إرضاع|pregnan|lactat|breastfe|nursing|trimester|فئة\s*[abcdx]\b/i,
    test:/تحليل|تحاليل|فحص|نسبة|hba1c|cbc|crp|esr|creatinine|كرياتينين|test\b|lab\b|level|blood count|thyroid|tsh|inr|ferritin/i,
    cond:/أعراض|مرض|ضغط|سكر|سكري|التهاب|حساسية|ربو|صداع|انفلونزا|نزلة|عدوى|علاج\s+(ال|ل)|symptom|disease|condition|diabetes|hypertension|infection|asthma|allerg|pain|fever|cough|migraine/i
  };
  function category(s){
    var u=(s.user||s.title||'');
    if(RE.preg.test(u))return 'preg';
    if(RE.test.test(u))return 'test';
    if(RE.cond.test(u))return 'cond';
    return 'drug';
  }
  function fold(s){return String(s||'').toLowerCase().replace(/[\u064b-\u065f\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')}
  function openSaved(){
    closeMenu();
    var t=tx(),h=window.DawayaPrivacy,box=openOverlay(t.saved);
    var q=el('input','ai-overlay-search');q.type='search';q.placeholder=t.savedSearch;q.setAttribute('aria-label',t.savedSearch);
    var list=el('div','ai-saved-list');box.append(q,list);
    var all=[];
    function paint(){
      list.textContent='';
      var needle=fold(q.value.trim()),shown=all.filter(function(s){return !needle||fold(s.text).indexOf(needle)>=0||fold(s.title).indexOf(needle)>=0});
      if(!all.length){list.append(el('p','ai-overlay-note',t.savedEmpty));return}
      if(!shown.length){list.append(el('p','ai-overlay-note',t.savedNone));return}
      ['drug','cond','test','preg','other'].forEach(function(g){
        var items=shown.filter(function(s){return s.cat===g});if(!items.length)return;
        list.append(el('p','ai-saved-group',t.grp[g]+' ('+items.length+')'));
        items.forEach(function(s){
          var row=el('div','ai-saved-row');
          var open=el('button','ai-saved-open');open.type='button';
          open.append(el('span','ai-saved-title',s.title||'...'),el('span','ai-saved-meta',new Date(s.updatedAt).toLocaleDateString(lang()==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short'})+' \u00b7 '+s.messages+' '+t.msgs));
          open.addEventListener('click',function(){
            if(window.DawayaAIChat&&window.DawayaAIChat.openSession)window.DawayaAIChat.openSession(s.id).then(function(ok){if(ok)closeOverlay()});
          });
          var del=el('button','ai-saved-del','\u00d7');del.type='button';del.setAttribute('aria-label',t.del);del.title=t.del;
          del.addEventListener('click',function(){
            h.deleteSession(s.id).then(function(r){if(r&&r.wasCurrent){var lg=log();if(lg)lg.textContent=''}all=all.filter(function(x){return x.id!==s.id});paint()});
          });
          row.append(open,del);list.append(row);
        });
      });
    }
    q.addEventListener('input',paint);
    if(h&&h.sessionIndex)h.sessionIndex().then(function(rows){
      all=(rows||[]).map(function(s){s.cat=category(s);return s});paint();
    }).catch(paint);else paint();
  }

  /* ---------------- menu entries (called by ai-shell) ---------------- */
  function modeControl(){
    var t=tx(),box=el('div','ai-mode');
    box.append(el('p','ai-nav-group',t.mode));
    var seg=el('div','ai-seg');seg.setAttribute('role','group');
    var note=el('p','ai-mode-note','');
    function paint(){
      var m=mode();
      [].forEach.call(seg.children,function(b){b.setAttribute('aria-pressed',b.dataset.m===m?'true':'false');b.classList.toggle('on',b.dataset.m===m)});
      note.textContent=t.modeNote[m];
    }
    ['patient','doctor'].forEach(function(m){
      var b=el('button','ai-seg-btn',t[m]);b.type='button';b.dataset.m=m;
      b.addEventListener('click',function(){setMode(m);paint()});seg.append(b);
    });
    box.append(seg,note);paint();return box;
  }
  window.DrugcopeiaExtras={
    openTool:openTool,openSaved:openSaved,openExport:openExport,modeControl:modeControl,mode:mode,
    labels:function(){return {saved:tx().saved,exp:tx().exp,mode:tx().mode}}
  };

  function boot(){
    var lg=log();if(!lg)return;
    new MutationObserver(decorateCards).observe(lg,{childList:true,subtree:true});
    decorateCards();
    doc.addEventListener('keydown',function(e){if(e.key==='Escape')closeOverlay()});
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot);else boot();
})();
