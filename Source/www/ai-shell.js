/* Drugcopeia AI shell: welcome screen, suggestions, side menu entries and the
   "back to chat" control. Presentation only: every answer still goes through
   DawayaAIChat and the safety pipeline. */
(function(){
  'use strict';
  var doc=document,root=doc.documentElement;
  var lang=function(){return root.lang==='en'?'en':'ar'};
  var T={
    ar:{
      hello:'أنا دوكوبيديا',
      sub:'مساعد معلومات الأدوية. اسألني عن دواء أو حالة أو تحليل أو الحمل. المعلومات للتثقيف فقط ولا تغني عن الطبيب أو الصيدلي.',
      chips:['ما استخدامات بانادول وما الحد الأقصى اليومي؟','هل يمكن الجمع بين الإيبوبروفين والأسبرين؟','ما أعراض ارتفاع ضغط الدم؟','ما معنى تحليل HbA1c؟','ما الأدوية المناسبة للحمل في الشهور الأولى؟','كيف أحسب جرعة الأطفال حسب الوزن؟'],
      nav:{chats:'محادثات',drug:'محادثة عن دواء',cond:'محادثة عن حالة مرضية',test:'محادثة عن تحليل',preg:'محادثة عن الحمل',tools:'أدوات',inter:'التفاعلات الدوائية',peds:'جرعات الأطفال',calc:'الحاسبات',more:'المزيد',fb:'ملاحظات',about:'عن دوكوبيديا',priv:'الخصوصية',lang:'English'},
      starters:{drug:'أريد أن أسأل عن دواء: ',cond:'أريد أن أعرف عن حالة: ',test:'أريد أن أفهم تحليل: ',preg:'سؤال عن دواء أثناء الحمل: ',inter:'هل يوجد تفاعل بين ',peds:'جرعة الأطفال لدواء ',calc:'احسب لي جرعة '},
      back:'رجوع للمحادثة',
      feedback:'للملاحظات والاقتراحات: افتح صفحة المشروع على GitHub وأضف Issue.'
    },
    en:{
      hello:"I'm Drugcopeia",
      sub:'A medicine information assistant. Ask about a drug, a condition, a lab test or pregnancy. For education only; it does not replace your doctor or pharmacist.',
      chips:['What is Panadol used for and what is the daily maximum?','Can I take ibuprofen and aspirin together?','What are the symptoms of high blood pressure?','What does an HbA1c test mean?','Which medicines are considered in early pregnancy?','How do I calculate a child dose by weight?'],
      nav:{chats:'Chats',drug:'Drug chat',cond:'Condition chat',test:'Test chat',preg:'Pregnancy chat',tools:'Tools',inter:'Interactions',peds:'Pediatric doses',calc:'Calculators',more:'More',fb:'Feedback',about:'About Drugcopeia',priv:'Privacy',lang:'العربية'},
      starters:{drug:'I want to ask about a drug: ',cond:'I want to learn about a condition: ',test:'Help me understand this test: ',preg:'A question about a medicine in pregnancy: ',inter:'Is there an interaction between ',peds:'Pediatric dose of ',calc:'Calculate a dose of '},
      back:'Back to chat',
      feedback:'For feedback or suggestions, open the project page on GitHub and add an Issue.'
    }
  };
  var tx=function(){return T[lang()]};
  function el(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}

  function input(){return doc.getElementById('aiInput')}
  function form(){return doc.getElementById('aiComposer')}
  function fill(text,send){
    var i=input();if(!i)return;
    i.value=text;i.dispatchEvent(new Event('input',{bubbles:true}));
    if(send&&form()){if(form().requestSubmit)form().requestSubmit();else form().dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))}
    else{i.focus();try{i.setSelectionRange(text.length,text.length)}catch(_){}}
  }
  function closeMenu(){var b=doc.getElementById('aiMenuClose');var bd=doc.getElementById('aiMenuBackdrop');if(bd&&!bd.hidden&&b)b.click()}

  /* ---- welcome ---- */
  var welcome=null;
  function buildWelcome(){
    var t=tx();
    var w=el('section','ai-welcome');
    w.appendChild(el('div','ai-welcome-mark','D'));
    var h=el('h1','',t.hello);w.appendChild(h);
    w.appendChild(el('p','',t.sub));
    var c=el('div','ai-chips');
    t.chips.forEach(function(q){var b=el('button','ai-chip',q);b.type='button';b.addEventListener('click',function(){fill(q,true)});c.appendChild(b)});
    w.appendChild(c);
    return w;
  }
  function syncWelcome(){
    var log=doc.getElementById('aiLog');if(!log)return;
    var has=!!log.querySelector('.ai-msg');
    if(has){if(welcome&&welcome.parentNode)welcome.remove();return}
    if(!welcome||welcome.dataset.lang!==lang()){if(welcome&&welcome.parentNode)welcome.remove();welcome=buildWelcome();welcome.dataset.lang=lang()}
    if(!welcome.parentNode)log.insertBefore(welcome,log.firstChild);
  }

  /* ---- side menu ---- */
  function openOther(page){
    closeMenu();
    var app=window.DawayaApp;
    root.dataset.aiPage='other';
    var sec=doc.querySelector('[data-main-page="'+page+'"]');
    if(sec)sec.classList.add('ai-only-page');
    if(app&&app.switchPage)app.switchPage(page);
  }
  function backToChat(){
    doc.querySelectorAll('.ai-only-page').forEach(function(s){s.classList.remove('ai-only-page')});
    delete root.dataset.aiPage;
    if(window.DawayaApp&&window.DawayaApp.switchPage)window.DawayaApp.switchPage('assistant');
  }
  function navItem(label,fn){var b=el('button','ai-nav-item',label);b.type='button';b.addEventListener('click',fn);return b}
  function buildNav(){
    var body=doc.querySelector('#aiAssistantMenu .ai-menu-body');if(!body)return;
    var old=doc.getElementById('aiNavExtra');if(old)old.remove();
    var t=tx(),n=t.nav,s=t.starters;
    var box=el('div','');box.id='aiNavExtra';
    var starter=function(key){return function(){closeMenu();fill(s[key],false)}};
    box.appendChild(el('p','ai-nav-group',n.chats));
    box.appendChild(navItem(n.drug,starter('drug')));
    box.appendChild(navItem(n.cond,starter('cond')));
    box.appendChild(navItem(n.test,starter('test')));
    box.appendChild(navItem(n.preg,starter('preg')));
    box.appendChild(el('p','ai-nav-group',n.tools));
    box.appendChild(navItem(n.inter,starter('inter')));
    box.appendChild(navItem(n.peds,starter('peds')));
    box.appendChild(navItem(n.calc,starter('calc')));
    box.appendChild(el('p','ai-nav-group',n.more));
    box.appendChild(navItem(n.fb,function(){closeMenu();window.alert(tx().feedback)}));
    box.appendChild(navItem(n.about,function(){openOther('about')}));
    box.appendChild(navItem(n.priv,function(){openOther('privacy')}));
    box.appendChild(navItem(n.lang,function(){try{localStorage.setItem('dawaya-language',lang()==='ar'?'en':'ar')}catch(_){}location.reload()}));
    body.insertBefore(box,body.firstChild);
  }

  function boot(){
    if(!doc.getElementById('aiBackChat')){
      var b=el('button','ai-back-chat','');b.id='aiBackChat';b.type='button';
      b.addEventListener('click',backToChat);doc.body.appendChild(b);
    }
    doc.getElementById('aiBackChat').textContent='\u2190 '+tx().back;
    doc.title='Drugcopeia AI';
    buildNav();
    var log=doc.getElementById('aiLog');
    if(log){new MutationObserver(syncWelcome).observe(log,{childList:true});syncWelcome()}
    var menu=doc.getElementById('aiAssistantMenu');
    if(menu)new MutationObserver(function(){if(!doc.getElementById('aiNavExtra'))buildNav()}).observe(menu,{childList:true,subtree:true});
    var tries=0;(function go(){
      if(window.DawayaApp&&window.DawayaApp.switchPage){window.DawayaApp.switchPage('assistant');return}
      if(++tries<80)setTimeout(go,150);
    })();
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot);else boot();
  window.addEventListener('load',function(){setTimeout(syncWelcome,400)});
})();
