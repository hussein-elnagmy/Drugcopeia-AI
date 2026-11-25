#!/usr/bin/env python3
"""One-shot source patch: wires assets/monographs.json into the drug modal."""
from pathlib import Path

p = Path("webapp/app.js")
s = p.read_text("utf-8")

def sub(old: str, new: str, count: int = 1):
    global s
    assert s.count(old) >= 1, f"anchor missing: {old[:80]}"
    s = s.replace(old, new, count)

# 1) i18n strings (en dict ends line 78, ar dict line 79)
EN_KEYS = ("monoMechanism:'MECHANISM OF ACTION',monoIndications:'INDICATIONS & USAGE',"
"monoDosage:'DOSAGE & ADMINISTRATION',monoInteractions:'DRUG INTERACTIONS',"
"monoBoxed:'BOXED WARNING',monoWarnings:'WARNINGS & PRECAUTIONS',"
"monoContra:'CONTRAINDICATIONS',monoAdverse:'ADVERSE REACTIONS',"
"monoPregnancy:'PREGNANCY & LACTATION',monoUsLabel:'U.S. label',"
"monoNote:'From the official U.S. FDA label for this ingredient, trimmed for length; the full label is on DailyMed. Not clinically reviewed. Egyptian products can differ, so follow the local leaflet and ask a doctor or pharmacist.',"
"monoFullLabel:'Full label on DailyMed',monoUpdated:'label updated',")
AR_KEYS = ("monoMechanism:'آلية العمل (من النشرة)',monoIndications:'دواعي الاستعمال',"
"monoDosage:'الجرعة وطريقة الاستعمال',monoInteractions:'التداخلات الدوائية',"
"monoBoxed:'تحذير مهم',monoWarnings:'التحذيرات والاحتياطات',"
"monoContra:'موانع الاستعمال',monoAdverse:'الأعراض الجانبية',"
"monoPregnancy:'الحمل والرضاعة',monoUsLabel:'نشرة أمريكية',"
"monoNote:'من نشرة FDA الأمريكية الرسمية لهذه المادة، مختصرة للعرض والنص الكامل على DailyMed. لم تُراجَع إكلينيكيًا وقد تختلف المنتجات المصرية؛ اتبع النشرة المحلية واسأل الطبيب أو الصيدلي.',"
"monoFullLabel:'النشرة كاملة على DailyMed',monoUpdated:'تحديث النشرة',")
sub("railDisclaimer:'Educational information only. It does not replace diagnosis, professional advice, or a prescription.'},",
    EN_KEYS + "railDisclaimer:'Educational information only. It does not replace diagnosis, professional advice, or a prescription.'},")
sub("railDisclaimer:'معلومات تعليمية فقط. لا تغني عن التشخيص أو المشورة المتخصصة أو الوصفة الطبية.'}",
    AR_KEYS + "railDisclaimer:'معلومات تعليمية فقط. لا تغني عن التشخيص أو المشورة المتخصصة أو الوصفة الطبية.'}")

# 2) monograph loader + render helpers, before openDrug
HELPERS = """  /* Sourced monographs: per-ingredient sections from official U.S. FDA labels
     (openFDA / DailyMed), bundled offline in assets/monographs.json. Each block
     carries the DailyMed link to the full label and a not-reviewed note. */
  const MONOGRAPHS_URL='assets/monographs.json';
  let monographsData=null,monographsRequest=null;
  function loadMonographs(){
    if(monographsData)return Promise.resolve(monographsData);
    if(!monographsRequest){
      monographsRequest=fetchWithTimeout(withRev(MONOGRAPHS_URL),{cache:'force-cache'},20000)
        .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
        .then(data=>{monographsData=data&&data.items?data:null;return monographsData})
        .catch(error=>{monographsRequest=null;console.warn('Monographs unavailable:',error);return null});
    }
    return monographsRequest;
  }
  function findMonographs(drug){
    if(!monographsData)return [];
    const raw=val(drug,'scientific_name');
    if(!raw)return [];
    const found=[],seen=new Set();
    String(raw).split(/[+,;/]/).forEach(part=>{
      [part,part.replace(/\\([^)]*\\)/g,' ')].forEach(variant=>{
        const hit=monographsData.index[clean(variant)];
        if(hit!==undefined&&!seen.has(hit)){seen.add(hit);found.push(monographsData.items[hit])}
      });
    });
    return found.slice(0,3);
  }
  const MONO_PANELS={overview:['mechanism'],use:['indications','dosage','interactions'],caution:['boxed_warning','warnings','contraindications','adverse_reactions','pregnancy']};
  const MONO_LABELS={mechanism:'monoMechanism',indications:'monoIndications',dosage:'monoDosage',interactions:'monoInteractions',boxed_warning:'monoBoxed',warnings:'monoWarnings',contraindications:'monoContra',adverse_reactions:'monoAdverse',pregnancy:'monoPregnancy'};
  function monographName(item){return (item.names&&item.names[0])||''}
  function monographSourceHtml(items){
    const links=items.map(item=>{
      const src=item.source||{};
      if(!src.dailymed)return '';
      const date=src.label_date?` <span class="monograph-date">${esc(t('monoUpdated'))} ${esc(src.label_date)}</span>`:'';
      return `<a href="${esc(src.dailymed)}" target="_blank" rel="noopener noreferrer">${esc(t('monoFullLabel'))}: ${esc(monographName(item))} ↗</a>${date}`;
    }).filter(Boolean).join(' · ');
    return `<p class="monograph-note">${esc(t('monoNote'))}</p><p class="monograph-source">${links}</p>`;
  }
  function monographSectionsHtml(drug,panel){
    const items=findMonographs(drug);
    if(!items.length)return '';
    let html='';
    items.forEach(item=>{
      (MONO_PANELS[panel]||[]).forEach(key=>{
        const text=item.sections&&item.sections[key];
        if(!text)return;
        const boxed=key==='boxed_warning'?' monograph-boxed':'';
        html+=`<section class="detail-block monograph-block${boxed}"><h3>${esc(t(MONO_LABELS[key]))} <span class="monograph-tag">${esc(monographName(item))} · ${esc(t('monoUsLabel'))}</span></h3><p>${esc(text)}</p></section>`;
      });
    });
    if(html&&panel==='caution')html+=monographSourceHtml(items);
    return html;
  }
  function appendMonographSections(drug){
    if(!monographsData){loadMonographs().then(loaded=>{if(loaded&&activeDrug===drug&&!modal.hidden){appendMonographSections(drug);['overview','use','caution'].forEach(name=>enableReadMore($('#'+name+'Panel')))}});return}
    const token=clean(val(drug,'scientific_name')||val(drug,'commercial_name_en'));
    ['overview','use','caution'].forEach(panel=>{
      const node=$('#'+panel+'Panel');
      if(!node||node.dataset.monoFor===token)return;
      const html=monographSectionsHtml(drug,panel);
      node.dataset.monoFor=token;
      if(html)node.insertAdjacentHTML('beforeend',html);
    });
  }
  function openDrug(drug){"""
sub("  function openDrug(drug){", HELPERS)

# 3) call it inside openDrug before read-more wiring
sub("    const detailPanels=['overview','use','caution'].map(name=>$('#'+name+'Panel'));",
    "    appendMonographSections(drug);\n    const detailPanels=['overview','use','caution'].map(name=>$('#'+name+'Panel'));")

# 4) raise the condition detail text cap (full MedlinePlus text now bundled)
sub("function conditionWikiSectionHtml(title,text){const content=String(text||'').trim();if(!content)return '';return `<section><h4>${esc(title)}</h4>${wikiParagraphHtml(content,3400)}</section>`}",
    "function conditionWikiSectionHtml(title,text){const content=String(text||'').trim();if(!content)return '';return `<section><h4>${esc(title)}</h4>${wikiParagraphHtml(content,24000)}</section>`}")

p.write_text(s, "utf-8")
print("app.js patched")
