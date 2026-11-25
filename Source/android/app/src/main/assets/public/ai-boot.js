/* Drugcopeia AI: runs first. Chat-only mode and Arabic as the first language. */
(function(){
  var h=document.documentElement;
  h.classList.add('ai-only');
  try{
    if(!localStorage.getItem('dawaya-language'))localStorage.setItem('dawaya-language','ar');
    var l=localStorage.getItem('dawaya-language');
    h.lang=l==='en'?'en':'ar';h.dir=l==='en'?'ltr':'rtl';
  }catch(_){h.lang='ar';h.dir='rtl'}
})();
