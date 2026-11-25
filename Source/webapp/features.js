/* Drugcopeia clinician features: same-spec price comparison, active-ingredient
 * card, clinical calculators and study mode. Loaded after app.js and uses only
 * the public window.DawayaApp surface plus the #featSlot hook it injects into
 * the medicine detail dialog.
 *
 * Rules kept here on purpose:
 *  - Drug facts come only from the bundled dataset (assets/egyptian-drugs.json).
 *  - Clinical text appears only where a named source sits next to it.
 *  - Anything without a source says "no data". Nothing is generated.
 */
(function () {
  'use strict';
  var App = function () { return window.DawayaApp || {}; };
  var SS = window.DawayaSameSpec, MAP = window.DawayaAltMap;
  function isAr() { return (App().language || document.documentElement.lang) === 'ar'; }
  function L(en, ar) { return isAr() ? ar : en; }
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nf(v, d) { var x = Number(v); if (!isFinite(x)) return ''; return x.toLocaleString(isAr() ? 'ar-EG' : 'en-US', { maximumFractionDigits: d == null ? 2 : d, minimumFractionDigits: 0 }); }
  function egp(v) { return nf(v, 2) + ' ' + L('EGP', 'ج.م'); }
  function drugs() { var d = App().drugs; return Array.isArray(d) ? d : []; }
  function brand(d) { return d.commercial_name_en || d.commercial_name_ar || ''; }
  function store(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { } }
  function link(href, label) { return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>'; }
  var NAV_TEXT = {
    navCalculators: ['Clinical calculators', 'حاسبات طبية'],
    navStudy: ['Study mode', 'وضع المذاكرة']
  };

  /* ---------- index (built once per dataset) ---------- */
  var built = null, builtLen = -1;
  function index() {
    var d = drugs();
    if (!built || builtLen !== d.length) { built = SS.buildIndex(d); builtLen = d.length; }
    return built;
  }
  document.addEventListener('dawaya:dataset-updated', function () { built = null; });

  /* ---------- pregnancy dataset (read-only lookup for the ingredient card) ---------- */
  var preg = null, pregPromise = null, pregMap = null;
  function loadPreg() {
    if (pregPromise) return pregPromise;
    pregPromise = DawayaNet.request('assets/data/pregnancy-safety.json').then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (j) { preg = j && j.entries ? j : null; }).catch(function () { preg = null; });
    return pregPromise;
  }
  var SALT = ['HYDROCHLORIDE', 'HCL', 'SODIUM', 'POTASSIUM', 'CALCIUM', 'MAGNESIUM', 'SULFATE', 'SULPHATE', 'PHOSPHATE', 'MALEATE', 'FUMARATE', 'TARTRATE', 'MESYLATE', 'BESYLATE', 'ACETATE', 'SUCCINATE', 'NITRATE', 'DIHYDRATE', 'MONOHYDRATE', 'TRIHYDRATE', 'HYDRATE', 'BASE', 'SALT'];
  function pnorm(s) { return String(s || '').toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9+\s.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function pregFind(name) {
    if (!preg) return null;
    if (!pregMap) {
      pregMap = new Map();
      Object.keys(preg.entries).forEach(function (k) {
        var e = preg.entries[k]; pregMap.set(pnorm(k), e);
        (e.aliases || []).forEach(function (a) { if (!pregMap.has(pnorm(a))) pregMap.set(pnorm(a), e); });
      });
    }
    var n = pnorm(name); if (!n) return null;
    if (pregMap.has(n)) return pregMap.get(n);
    var w = n.split(' ');
    while (w.length > 1 && SALT.indexOf(w[w.length - 1]) >= 0) { w.pop(); if (pregMap.has(w.join(' '))) return pregMap.get(w.join(' ')); }
    return null;
  }

  /* ================= detail dialog slot ================= */
  var currentDrug = null;
  function ensureSlot() {
    var slot = $('#featSlot');
    if (slot) return slot;
    var sources = $('#modalSources');
    if (!sources) return null;
    slot = document.createElement('div'); slot.id = 'featSlot'; slot.className = 'feat-slot';
    sources.parentNode.insertBefore(slot, sources);
    return slot;
  }
  function ingredientsOf(d) {
    return String(d.scientific_name || '').split('+').map(function (p) { return p.replace(/\(.*?\)/g, '').trim(); }).filter(Boolean);
  }
  function renderSlot(drug) {
    var slot = ensureSlot(); if (!slot) return;
    currentDrug = drug;
    if (!drug || drug._custom) { slot.innerHTML = ''; return; }
    var ings = ingredientsOf(drug);
    var html = '';
    if (ings.length) {
      html += '<div class="feat-card-buttons">' + ings.slice(0, 4).map(function (ing, i) {
        return '<button type="button" class="feat-card-btn" data-ing="' + esc(ing) + '"><span class="feat-card-btn-label">' + esc(L('Active ingredient card', 'بطاقة المادة الفعالة')) + '</span><span class="feat-card-btn-name">' + esc(ing) + '</span></button>';
      }).join('') + '</div>';
    }
    html += comparisonHtml(drug);
    slot.innerHTML = html;
  }
  function comparisonHtml(drug) {
    var c = SS.compare(drug, index());
    var h = '<section class="detail-block feat-compare" id="featCompare"><h3>' + esc(L('Price comparison of same-spec products', 'مقارنة أسعار المستحضرات المطابقة')) + '</h3>';
    var note = L('Same ingredient, strength and form. Price comparison only. Ask a pharmacist or doctor before any change.',
      'نفس المادة والتركيز والشكل الدوائي. مقارنة أسعار فقط. استشر الصيدلي أو الطبيب قبل أي تغيير.');
    if (c.status === 'unparsed') {
      var why = {
        strength: L('the strength is not stated in the product name', 'التركيز غير مذكور في اسم المنتج'),
        form: L('the dosage form is not clear from the product name', 'الشكل الدوائي غير واضح من اسم المنتج'),
        pack: L('the pack size is not clear from the product name', 'حجم العبوة غير واضح من اسم المنتج'),
        route: L('the route is not listed', 'طريقة الاستعمال غير مدرجة'),
        ingredient: L('the active ingredient is not listed', 'المادة الفعالة غير مدرجة'),
        cancelled: L('this product is marked cancelled', 'هذا المنتج مسجل كمُلغى'),
        custom: ''
      }[c.reason] || '';
      h += '<p class="feat-muted">' + esc(L('No comparison for this product: ', 'لا توجد مقارنة لهذا المنتج: ') + why + '.') + '</p>';
    } else if (c.status === 'none') {
      h += '<p class="feat-muted">' + esc(L('No matching products in the database.', 'لا توجد مستحضرات مطابقة في قاعدة البيانات.')) + '</p>';
    } else {
      var spec = c.spec;
      h += '<p class="feat-spec">' + esc([spec.ingredientKey.replace(/\+/g, ' + '), spec.strengths.join(' · '), formName(spec.form), relName(spec.release)].join(' | ')) + '</p>';
      if (c.self.value !== null) h += '<p class="feat-self">' + esc(L('This product: ', 'هذا المنتج: ') + egp(c.self.value)) + '</p>';
      var rows = c.rows, limit = 12, cheapestMarked = false;
      h += '<ul class="feat-rows">' + rows.map(function (r, i) {
        var d = r.drug, badge = '', saving = '', price = r.spec.price;
        var cheaper = r.basis === 'pack' ? (r.saving > 0) : (r.basis === 'unit' ? (r.savingPerUnit > 0) : false);
        if (!cheapestMarked && cheaper && !r.spec.notMarketed) { badge = '<span class="feat-badge">' + esc(L('Cheapest', 'الأرخص')) + '</span>'; cheapestMarked = true; }
        if (r.basis === 'pack' && r.saving > 0.004) saving = '<span class="feat-save">' + esc(L('Save ', 'وفّر ') + egp(r.saving)) + '</span>';
        else if (r.basis === 'pack') saving = '<span class="feat-unit">' + esc(L('Same pack. Price difference ', 'نفس العبوة. فرق السعر ') + (r.saving < -0.004 ? '+' + nf(-r.saving, 2) : '0') + ' ' + L('EGP', 'ج.م')) + '</span>';
        else if (r.basis === 'unit') saving = '<span class="feat-unit">' + esc(L('Unit price ', 'سعر الوحدة ') + egp(r.comparable) + (r.savingPerUnit > 0.004 ? L(' (saves ', ' (يوفر ') + egp(r.savingPerUnit) + ')' : '')) + '</span>';
        else saving = '<span class="feat-unit">' + esc(L('Different pack, no saving figure', 'عبوة مختلفة، لا يوجد رقم توفير')) + '</span>';
        return '<li class="feat-row' + (i >= limit ? ' feat-more' : '') + '"' + (i >= limit ? ' hidden' : '') + '><button type="button" class="feat-row-btn" data-idx="' + i + '">' +
          '<span class="feat-row-name">' + esc(brand(d)) + badge + (r.spec.notMarketed ? '<em class="feat-na">' + esc(L('listed not available', 'مدرج غير متاح')) + '</em>' : '') + '</span>' +
          '<span class="feat-row-meta">' + esc([d.manufacturer, packLabel(r.spec)].filter(Boolean).join(' · ')) + '</span>' +
          '<span class="feat-row-price">' + (price !== null ? esc(egp(price)) : esc(L('No price', 'لا يوجد سعر'))) + '</span>' + saving + '</button></li>';
      }).join('') + '</ul>';
      if (rows.length > limit) h += '<button type="button" class="feat-showall" data-showall>' + esc(L('Show all ', 'عرض الكل ') + rows.length) + '</button>';
      h += '<p class="feat-note">' + esc(note) + '</p>';
    }
    if (c.status !== 'ok') h += '<p class="feat-note">' + esc(note) + '</p>';
    return h + '</section>';
  }
  function formName(f) {
    var m = { TABLET: ['tablet', 'قرص'], CAPSULE: ['capsule', 'كبسولة'], AMPOULE: ['ampoule', 'أمبول'], VIAL: ['vial', 'فيال'], SYRUP: ['syrup', 'شراب'], SUSPENSION: ['suspension', 'معلق'], CREAM: ['cream', 'كريم'], OINTMENT: ['ointment', 'مرهم'], GEL: ['gel', 'جل'], SUPPOSITORY: ['suppository', 'لبوس'], SACHET: ['sachet', 'كيس'], DROPS: ['drops', 'قطرة'], 'EYE DROPS': ['eye drops', 'قطرة عين'], 'EAR DROPS': ['ear drops', 'قطرة أذن'], SOLUTION: ['solution', 'محلول'], SPRAY: ['spray', 'بخاخ'], EFFERVESCENT: ['effervescent', 'فوار'], 'CHEWABLE TABLET': ['chewable tablet', 'قرص للمضغ'], 'ORODISPERSIBLE TABLET': ['orodispersible tablet', 'قرص يذوب في الفم'], 'PREFILLED SYRINGE': ['prefilled syringe', 'حقنة معبأة'], PEN: ['pen', 'قلم'], INHALER: ['inhaler', 'جهاز استنشاق'], LOTION: ['lotion', 'لوشن'], EMULSION: ['emulsion', 'مستحلب'], POWDER: ['powder', 'بودرة'], PATCH: ['patch', 'لصقة'] }[f];
    return m ? L(m[0], m[1]) : f.toLowerCase();
  }
  function relName(r) { return r === 'MODIFIED' ? L('extended/modified release', 'ممتد المفعول') : (r === 'DELAYED' ? L('delayed release', 'متأخر الإطلاق') : L('immediate release', 'فوري الإطلاق')); }
  function packLabel(s) {
    if (s.packKey.indexOf('RAW:') === 0) return s.packKey.slice(4);
    var p = []; if (s.count) p.push(s.count + ' ×'); if (s.volumeKey) p.push(s.volumeKey);
    return p.join(' ');
  }
  document.addEventListener('dawaya:drug-opened', function (e) { renderSlot(e.detail); });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.feat-card-btn');
    if (b) { openIngredientCard(b.getAttribute('data-ing')); return; }
    var row = e.target.closest && e.target.closest('.feat-row-btn');
    if (row && currentDrug) {
      var c = SS.compare(currentDrug, index()); var r = c.rows[Number(row.getAttribute('data-idx'))];
      if (r && App().openDrug) App().openDrug(r.drug);
      return;
    }
    if (e.target.closest && e.target.closest('[data-showall]')) {
      document.querySelectorAll('#featCompare .feat-more').forEach(function (li) { li.hidden = false; });
      e.target.closest('[data-showall]').remove();
    }
  });

  /* ================= active-ingredient card ================= */
  function openIngredientCard(ing) {
    var overlay = $('#featOverlay');
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'featOverlay'; overlay.className = 'feat-overlay'; overlay.hidden = true;
      overlay.innerHTML = '<article class="feat-dialog" role="dialog" aria-modal="true" aria-labelledby="featDlgTitle"><button type="button" class="feat-close" aria-label="Close">×</button><div id="featDlgBody"></div></article>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay || ev.target.closest('.feat-close')) closeIngredientCard(); });
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !overlay.hidden) closeIngredientCard(); });
    }
    loadPreg().then(function () {
      $('#featDlgBody').innerHTML = ingredientCardHtml(ing);
      overlay.hidden = false; overlay.dataset.ing = ing;
      var close = $('.feat-close', overlay); if (close) close.focus();
    });
  }
  function closeIngredientCard() { var o = $('#featOverlay'); if (o) o.hidden = true; }

  function ingredientCardHtml(ing) {
    var key = MAP.normalizeIngredient(ing);
    var d = drugs().filter(function (x) { return !x._custom && ingredientsOf(x).some(function (i) { return MAP.normalizeIngredient(i) === key; }); });
    var classes = {}, routes = {}, forms = {};
    d.forEach(function (x) { if (x.drug_class) classes[x.drug_class] = (classes[x.drug_class] || 0) + 1; if (x.route) routes[x.route] = 1; });
    var classList = Object.keys(classes).sort(function (a, b) { return classes[b] - classes[a]; }).slice(0, 4);
    var pe = pregFind(ing);
    var h = '<span class="section-kicker">' + esc(L('ACTIVE INGREDIENT', 'المادة الفعالة')) + '</span><h2 id="featDlgTitle">' + esc(ing) + '</h2>';
    h += '<div class="feat-chips">' + classList.map(function (c) { return '<span class="feat-chip">' + esc(c) + '</span>'; }).join('') +
      (pe && pe.cat ? '<span class="feat-chip feat-chip-cat">' + esc(L('Old FDA category ', 'تصنيف FDA القديم ') + pe.cat) + '</span>' : '') + '</div>';
    h += '<p class="feat-muted">' + esc(L('Class labels come from the bundled Egyptian drug dataset.', 'تصنيفات الدواء من قاعدة بيانات الأدوية المصرية المضمنة.')) + '</p>';
    h += '<h3>' + esc(L('Indications and usual adult dose', 'دواعي الاستعمال وجرعة البالغين المعتادة')) + '</h3>';
    h += '<p class="feat-nodata">' + esc(L('No sourced text for this ingredient yet. The card never shows unsourced dosing. Read the current label:', 'لا يوجد نص موثق لهذه المادة بعد. البطاقة لا تعرض جرعات بدون مصدر. اقرأ النشرة الحالية:')) + '</p>';
    h += '<p class="feat-links">' + link('https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=' + encodeURIComponent(ing), 'DailyMed') + ' ' + link('https://medlineplus.gov/search/?query=' + encodeURIComponent(ing), 'MedlinePlus') + '</p>';
    h += '<h3>' + esc(L('Interactions', 'التفاعلات')) + '</h3><button type="button" class="feat-link-btn" data-go="interactions">' + esc(L('Open the interaction checker', 'افتح فاحص التفاعلات')) + '</button>';
    if (pe) {
      h += '<h3>' + esc(L('Pregnancy and breastfeeding', 'الحمل والرضاعة')) + '</h3>' +
        '<p>' + esc(isAr() ? (pe.preg_ar || '') : (pe.preg_en || '')) + '</p>' +
        '<p class="feat-muted">' + esc(L('Educational summary, not verified against the current label. Source list: DailyMed, LactMed, FDA PLLR, WHO.', 'ملخص تعليمي غير متحقق منه مقابل النشرة الحالية. المصادر: DailyMed وLactMed وFDA PLLR وWHO.')) + '</p>' +
        '<button type="button" class="feat-link-btn" data-go="pregnancy" data-q="' + esc(ing) + '">' + esc(L('Open the full pregnancy and breastfeeding page', 'افتح صفحة الحمل والرضاعة كاملة')) + '</button>';
    }
    h += '<h3>' + esc(L('Brands in Egypt', 'الماركات المتاحة في مصر')) + ' (' + d.length + ')</h3>';
    var sorted = d.slice().sort(function (a, b) { return (Number(a.price_egp) || 1e12) - (Number(b.price_egp) || 1e12); });
    h += '<ul class="feat-rows feat-brand-list">' + sorted.slice(0, 40).map(function (x, i) {
      return '<li class="feat-row"><button type="button" class="feat-brand-btn" data-bi="' + i + '"><span class="feat-row-name">' + esc(brand(x)) + '</span><span class="feat-row-meta">' + esc([x.manufacturer, x.route].filter(Boolean).join(' · ')) + '</span><span class="feat-row-price">' + (x.price_egp ? esc(egp(x.price_egp)) : '') + '</span></button></li>';
    }).join('') + '</ul>';
    if (sorted.length > 40) h += '<p class="feat-muted">' + esc(L('Showing the 40 lowest prices of ', 'يعرض أقل 40 سعرًا من ') + sorted.length) + '</p>';
    ingCardList = sorted.slice(0, 40);
    return h;
  }
  var ingCardList = [];
  document.addEventListener('click', function (e) {
    var go = e.target.closest && e.target.closest('#featOverlay [data-go]');
    if (go) {
      var page = go.getAttribute('data-go'), q = go.getAttribute('data-q');
      closeIngredientCard(); if (App().closeModal) App().closeModal();
      if (App().switchPage) App().switchPage(page, page);
      if (page === 'pregnancy' && q) setTimeout(function () { var i = $('#pregSearch'); if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 60);
      return;
    }
    var b = e.target.closest && e.target.closest('.feat-brand-btn');
    if (b) { var x = ingCardList[Number(b.getAttribute('data-bi'))]; if (x && App().openDrug) { closeIngredientCard(); App().openDrug(x); } }
  });

  /* ================= shared page scaffolding ================= */
  function pageShell(id, page, inner) {
    var s = document.createElement('section');
    s.className = 'clinical-page feat-page'; s.id = id; s.setAttribute('data-main-page', page); s.hidden = true;
    s.innerHTML = inner;
    var anchor = $('#pregnancyPage') || $('#aboutPage') || $('#mainContent').lastElementChild;
    var host = $('#mainContent');
    host.insertBefore(s, anchor && anchor.parentNode === host ? anchor : null);
    return s;
  }
  function setBackLabels() { document.querySelectorAll('.feat-back-label').forEach(function (n) { n.textContent = L('Back to search', 'العودة للبحث'); }); }

  /* ================= calculators ================= */
  var CALCS = [
    { id: 'egfr', icon: 'icon-dose', t: ['eGFR (CKD-EPI 2021)', 'معدل الترشيح الكبيبي eGFR (CKD-EPI 2021)'],
      formula: 'eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^−1.200 × 0.9938^age × 1.012 [female]; κ = 0.7 (F) / 0.9 (M); α = −0.241 (F) / −0.302 (M)',
      source: ['Inker LA et al. N Engl J Med 2021;385:1737-1749 (CKD-EPI 2021 creatinine equation).', 'https://doi.org/10.1056/NEJMoa2102953'],
      fields: [{ k: 'age', l: ['Age (years, adults)', 'العمر (سنة، بالغين)'], min: 18, max: 120 }, { k: 'sex', l: ['Sex', 'الجنس'], opts: [['M', 'Male', 'ذكر'], ['F', 'Female', 'أنثى']] }, { k: 'scr', l: ['Serum creatinine', 'الكرياتينين في الدم'], min: 0.1, max: 20, unit: 'mg/dL' }, { k: 'scrUnit', l: ['Creatinine unit', 'وحدة الكرياتينين'], opts: [['mgdl', 'mg/dL', 'mg/dL'], ['umol', 'µmol/L', 'µmol/L']] }],
      run: function (v) {
        var scr = v.scrUnit === 'umol' ? v.scr / 88.4 : v.scr; if (v.scrUnit === 'umol' && (scr < 0.1 || scr > 20)) return { err: L('Creatinine out of range.', 'قيمة الكرياتينين خارج المدى.') };
        var f = v.sex === 'F', k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
        var e = 142 * Math.pow(Math.min(scr / k, 1), a) * Math.pow(Math.max(scr / k, 1), -1.2) * Math.pow(0.9938, v.age) * (f ? 1.012 : 1);
        var st = e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5';
        return { value: nf(e, 0) + ' mL/min/1.73 m²', extra: L('KDIGO GFR category by value: ', 'تصنيف KDIGO حسب القيمة: ') + st };
      },
      note: ['Adult equation. Not for children. Not validated for acute kidney injury or unstable creatinine.', 'معادلة للبالغين. ليست للأطفال. غير مثبتة في الفشل الكلوي الحاد أو الكرياتينين غير المستقر.'] },
    { id: 'map', icon: 'icon-dose', t: ['Mean arterial pressure (MAP)', 'متوسط الضغط الشرياني (MAP)'],
      formula: 'MAP = DBP + (SBP − DBP) / 3',
      source: ['Standard hemodynamic definition (one third pulse pressure above diastolic). Reference text: DeMers D, Wachs D. Physiology, Mean Arterial Pressure. StatPearls.', 'https://www.ncbi.nlm.nih.gov/books/NBK538226/'],
      fields: [{ k: 'sbp', l: ['Systolic (mmHg)', 'الانقباضي (mmHg)'], min: 40, max: 300 }, { k: 'dbp', l: ['Diastolic (mmHg)', 'الانبساطي (mmHg)'], min: 20, max: 200 }],
      run: function (v) { if (v.sbp <= v.dbp) return { err: L('Systolic must be higher than diastolic.', 'يجب أن يكون الانقباضي أعلى من الانبساطي.') }; return { value: nf(v.dbp + (v.sbp - v.dbp) / 3, 0) + ' mmHg' }; },
      note: ['Estimate from a cuff reading, not a measured intra-arterial value.', 'تقدير من قياس بالجهاز وليس قياسًا مباشرًا من الشريان.'] },
    { id: 'bmi', icon: 'icon-dose', t: ['BMI (WHO categories)', 'مؤشر كتلة الجسم BMI (تصنيف WHO)'],
      formula: 'BMI = weight (kg) / height (m)²',
      source: ['WHO adult BMI categories: under 18.5, 18.5 to 24.9, 25.0 to 29.9, 30.0 and above.', 'https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight'],
      fields: [{ k: 'kg', l: ['Weight (kg)', 'الوزن (كجم)'], min: 2, max: 400 }, { k: 'cm', l: ['Height (cm)', 'الطول (سم)'], min: 50, max: 250 }],
      run: function (v) {
        var b = v.kg / Math.pow(v.cm / 100, 2);
        var c = b < 18.5 ? L('Underweight', 'نحافة') : b < 25 ? L('Normal range', 'وزن طبيعي') : b < 30 ? L('Overweight', 'زيادة وزن') : b < 35 ? L('Obesity class I', 'سمنة درجة 1') : b < 40 ? L('Obesity class II', 'سمنة درجة 2') : L('Obesity class III', 'سمنة درجة 3');
        return { value: nf(b, 1) + ' kg/m²', extra: c };
      },
      note: ['Adult categories only. Not for children, who use age and sex percentiles.', 'تصنيفات للبالغين فقط. الأطفال يستخدمون المئينيات حسب العمر والجنس.'] },
    { id: 'ag', icon: 'icon-dose', t: ['Anion gap', 'الفجوة الأيونية Anion gap'],
      formula: 'AG = Na − (Cl + HCO3)   or   AG = (Na + K) − (Cl + HCO3)',
      source: ['Kraut JA, Madias NE. Serum anion gap: its uses and limitations in clinical medicine. Clin J Am Soc Nephrol 2007;2:162-174.', 'https://doi.org/10.2215/CJN.03020906'],
      fields: [{ k: 'na', l: ['Na (mmol/L)', 'الصوديوم Na (mmol/L)'], min: 100, max: 180 }, { k: 'cl', l: ['Cl (mmol/L)', 'الكلوريد Cl (mmol/L)'], min: 60, max: 140 }, { k: 'hco3', l: ['HCO3 (mmol/L)', 'البيكربونات HCO3 (mmol/L)'], min: 2, max: 60 }, { k: 'k', l: ['K (mmol/L, optional)', 'البوتاسيوم K (اختياري)'], min: 1, max: 10, optional: true }],
      run: function (v) { var ag = v.na - (v.cl + v.hco3) + (v.k ? v.k : 0); return { value: nf(ag, 1) + ' mmol/L', extra: v.k ? L('Calculated with potassium.', 'محسوبة مع البوتاسيوم.') : L('Calculated without potassium.', 'محسوبة بدون البوتاسيوم.') }; },
      note: ['The reference interval depends on the laboratory method. Compare with your lab range. Hypoalbuminemia lowers the gap.', 'المدى المرجعي يعتمد على طريقة المعمل. قارن بمدى معملك. نقص الألبومين يخفض الفجوة.'] },
    { id: 'cca', icon: 'icon-dose', t: ['Corrected calcium', 'الكالسيوم المصحح'],
      formula: 'Corrected Ca (mg/dL) = measured Ca + 0.8 × (4.0 − albumin g/dL)',
      source: ['Payne RB et al. Interpretation of serum calcium in patients with abnormal serum proteins. BMJ 1973;4:643-646.', 'https://doi.org/10.1136/bmj.4.5893.643'],
      fields: [{ k: 'ca', l: ['Total calcium (mg/dL)', 'الكالسيوم الكلي (mg/dL)'], min: 4, max: 20 }, { k: 'alb', l: ['Albumin (g/dL)', 'الألبومين (g/dL)'], min: 0.5, max: 6.5 }],
      run: function (v) { return { value: nf(v.ca + 0.8 * (4 - v.alb), 1) + ' mg/dL' }; },
      note: ['An estimate with known limits in critical illness. Ionized calcium is the direct measure.', 'تقدير له حدود معروفة في الحالات الحرجة. الكالسيوم المتأين هو القياس المباشر.'] },
    { id: 'fluids', icon: 'icon-dose', t: ['Pediatric maintenance fluids', 'سوائل الصيانة للأطفال'],
      formula: '100 mL/kg/day for the first 10 kg + 50 mL/kg/day for the next 10 kg + 20 mL/kg/day for each kg above 20 kg',
      source: ['Holliday MA, Segar WE. The maintenance need for water in parenteral fluid therapy. Pediatrics 1957;19:823-832.', 'https://doi.org/10.1542/peds.19.5.823'],
      fields: [{ k: 'kg', l: ['Weight (kg)', 'الوزن (كجم)'], min: 1, max: 100 }],
      run: function (v) { var w = v.kg, d = w <= 10 ? w * 100 : w <= 20 ? 1000 + (w - 10) * 50 : 1500 + (w - 20) * 20; return { value: nf(d, 0) + ' mL/day', extra: nf(d / 24, 1) + ' mL/h' }; },
      note: ['Maintenance only. It does not cover deficit or ongoing losses. Not for neonates in the first days of life.', 'صيانة فقط. لا تغطي العجز أو الفقد المستمر. ليست لحديثي الولادة في الأيام الأولى.'] }
  ];
  var CALC_META = {
    egfr: ['eGFR', 'Kidney function from creatinine', 'وظائف الكلى من الكرياتينين'],
    map: ['MAP', 'Average pressure driving blood flow', 'متوسط الضغط المغذي للأعضاء'],
    bmi: ['BMI', 'Weight against height', 'الوزن بالنسبة للطول'],
    ag: ['AG', 'Helps explain metabolic acidosis', 'يساعد في تفسير الحماض الأيضي'],
    cca: ['Ca', 'Calcium adjusted for albumin', 'الكالسيوم مصححًا بالألبومين'],
    fluids: ['IV', 'Daily fluid need for a child', 'احتياج الطفل اليومي من السوائل']
  };
  var calcOpen = '';
  function buildCalcPage() {
    pageShell('calcPage', 'calculators',
      '<span class="section-kicker feat-k"></span><h1 class="feat-title"></h1><p class="clinical-intro feat-intro"></p><div id="calcGrid" class="feat-tiles"></div><div id="calcPanel" class="feat-panel" hidden></div>' +
      '<aside class="clinical-disclaimer"><p class="feat-disc"></p></aside>');
  }
  var DISCLAIMER = ['A support tool for clinicians, not a substitute for clinical judgment.', 'أداة مساعدة للطاقم الطبي، وليست بديلًا عن الحكم الإكلينيكي.'];
  function renderCalcPage() {
    var p = $('#calcPage'); if (!p) return;
    $('.feat-k', p).textContent = L('CLINICAL CALCULATORS', 'حاسبات طبية');
    $('.feat-title', p).textContent = L('Quick clinical calculators', 'حاسبات طبية سريعة');
    $('.feat-intro', p).textContent = L('Six published formulas. Each shows its formula and source. Nothing you enter leaves the device.', 'ست معادلات منشورة. كل حاسبة تعرض المعادلة ومصدرها. لا شيء مما تدخله يغادر الجهاز.');
    $('.feat-disc', p).textContent = L(DISCLAIMER[0], DISCLAIMER[1]);
    $('#calcGrid', p).innerHTML = CALCS.map(function (c) { return '<button type="button" class="feat-tile' + (c.id === calcOpen ? ' active' : '') + '" data-calc="' + c.id + '"><span class="calc-ic" aria-hidden="true">' + (CALC_META[c.id]||['🧮'])[0] + '</span><span class="calc-t">' + esc(L(c.t[0], c.t[1])) + '</span><span class="calc-d">' + esc(L((CALC_META[c.id]||['','',''])[1], (CALC_META[c.id]||['','',''])[2])) + '</span></button>'; }).join('');
    if (calcOpen) renderCalc(calcOpen);
    setBackLabels();
  }
  function renderCalc(id) {
    var c = CALCS.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    calcOpen = id;
    var hist = store('dawaya-calc-history', {})[id] || [];
    var panel = $('#calcPanel'); panel.hidden = false;
    panel.innerHTML = '<h2>' + esc(L(c.t[0], c.t[1])) + '</h2>' +
      '<form class="feat-form" novalidate data-form="' + id + '">' + c.fields.map(function (f) {
        var lab = '<label for="cf-' + f.k + '">' + esc(L(f.l[0], f.l[1])) + (f.optional ? '' : '') + '</label>';
        if (f.opts) return '<div class="feat-field">' + lab + '<select id="cf-' + f.k + '" name="' + f.k + '">' + f.opts.map(function (o) { return '<option value="' + o[0] + '">' + esc(L(o[1], o[2])) + '</option>'; }).join('') + '</select></div>';
        return '<div class="feat-field">' + lab + '<input id="cf-' + f.k + '" name="' + f.k + '" type="text" inputmode="decimal" autocomplete="off" dir="ltr"' + (f.unit ? ' placeholder="' + esc(f.unit) + '"' : '') + '><small class="feat-err" id="ce-' + f.k + '" role="alert"></small></div>';
      }).join('') + '<div class="feat-actions"><button type="submit" class="feat-primary">' + esc(L('Calculate', 'احسب')) + '</button><button type="reset" class="feat-secondary">' + esc(L('Clear', 'مسح')) + '</button></div></form>' +
      '<div class="feat-result" id="calcResult" aria-live="polite"></div>' +
      '<div class="feat-ref"><p><b>' + esc(L('Formula', 'المعادلة')) + ':</b> <code dir="ltr">' + esc(c.formula) + '</code></p><p><b>' + esc(L('Source', 'المصدر')) + ':</b> ' + esc(c.source[0]) + ' ' + link(c.source[1], L('Open', 'فتح')) + '</p><p class="feat-muted">' + esc(L(c.note[0], c.note[1])) + '</p><p class="feat-muted">' + esc(L(DISCLAIMER[0], DISCLAIMER[1])) + '</p></div>' +
      (hist.length ? '<div class="feat-hist"><h3>' + esc(L('Last calculations on this device', 'آخر الحسابات على هذا الجهاز')) + '</h3><ul>' + hist.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul><button type="button" class="feat-secondary" data-clear-hist="' + id + '">' + esc(L('Clear history', 'مسح السجل')) + '</button></div>' : '');
    document.querySelectorAll('.feat-tile').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-calc') === id); });
    var form = $('form[data-form]', panel);
    form.addEventListener('submit', function (ev) { ev.preventDefault(); submitCalc(c, form); });
    form.addEventListener('reset', function () { setTimeout(function () { $('#calcResult').innerHTML = ''; form.querySelectorAll('.feat-err').forEach(function (n) { n.textContent = ''; }); }, 0); });
  }
  function toNum(s) { s = String(s || '').replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); }).replace('٫', '.').replace(',', '.').trim(); if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return NaN; return parseFloat(s); }
  function submitCalc(c, form) {
    var vals = {}, bad = false;
    c.fields.forEach(function (f) {
      var el = form.elements[f.k], err = $('#ce-' + f.k); if (err) err.textContent = '';
      if (f.opts) { vals[f.k] = el.value; return; }
      var raw = el.value.trim();
      if (raw === '' && f.optional) { vals[f.k] = 0; return; }
      var n = toNum(raw), min = f.min, max = f.max;
      if (c.id === 'egfr' && f.k === 'scr' && form.elements.scrUnit.value === 'umol') { min = f.min * 88.4; max = f.max * 88.4; }
      if (!isFinite(n)) { bad = true; err.textContent = L('Enter a number.', 'أدخل رقمًا.'); }
      else if (n < min || n > max) { bad = true; err.textContent = L('Allowed range: ', 'المدى المسموح: ') + nf(min, 1) + ' – ' + nf(max, 1); }
      vals[f.k] = n;
    });
    var out = $('#calcResult');
    if (bad) { out.innerHTML = ''; return; }
    var r = c.run(vals);
    if (r.err) { out.innerHTML = '<p class="feat-err">' + esc(r.err) + '</p>'; return; }
    var inputs = c.fields.map(function (f) { var v = form.elements[f.k].value; if (f.opts) { var o = f.opts.filter(function (x) { return x[0] === v; })[0]; v = L(o[1], o[2]); } return L(f.l[0], f.l[1]) + ': ' + (v === '' ? '-' : v); });
    out.innerHTML = '<div class="feat-inputs">' + inputs.map(function (i) { return '<span>' + esc(i) + '</span>'; }).join('') + '</div><div class="feat-value">' + esc(r.value) + '</div>' + (r.extra ? '<p>' + esc(r.extra) + '</p>' : '');
    var all = store('dawaya-calc-history', {}); var arr = all[c.id] || [];
    arr.unshift(inputs.join(' | ') + ' → ' + r.value); all[c.id] = arr.slice(0, 10); save('dawaya-calc-history', all);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.feat-tile');
    if (t) { renderCalc(t.getAttribute('data-calc')); var p = $('#calcPanel'); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    var h = e.target.closest && e.target.closest('[data-clear-hist]');
    if (h) { var all = store('dawaya-calc-history', {}); delete all[h.getAttribute('data-clear-hist')]; save('dawaya-calc-history', all); renderCalc(h.getAttribute('data-clear-hist')); }
  });

  /* ================= study mode ================= */
  var NON_DRUG = /CARE|COSMET|SHAMP|SOAP|HAIR|SKIN|SERUM|FACE|MAKE|DENTAL|OIL|SUPPLEMENT|MILK|NUTRIT|DIET|FOOD|SUN|PERFUME|DEODOR|BABY|VITAMIN|MULTIVIT|HERBAL|STERILE|DIALYS|MOISTUR|LOTION|WIPE|TOOTH/i;
  var pool = null, poolLen = -1;
  function brandBase(name) {
    var m = String(name || '').toUpperCase().replace(/\(.*?\)/g, ' ').match(/^[A-Z][A-Z\-' ]*?(?=\s\d|\s*$|\s(?:TABS?|CAPS?|AMP|VIAL|SYRUP|SUSP|CREAM|GEL|DROPS|SPRAY|OINT|SUPP|SACHET)\b|\s[A-Z]*\.)/);
    var b = m ? m[0].trim() : ''; return b.length >= 4 && b.length <= 22 ? b : '';
  }
  function buildPool() {
    var d = drugs(); if (pool && poolLen === d.length) return pool; poolLen = d.length;
    var byIng = new Map(), ingClasses = new Map(), classIngs = new Map();
    d.forEach(function (x) {
      if (x._custom || !x.scientific_name || x.scientific_name.indexOf('+') >= 0 || x.scientific_name.length > 40) return;
      if (!x.drug_class || NON_DRUG.test(x.drug_class) || !/^(ORAL\.SOLID|ORAL\.LIQUID|INJECTION)$/.test(x.route || '')) return;
      if (/\((CANCELLED)\)/i.test(x.commercial_name_en || '')) return;
      var ing = MAP.normalizeIngredient(x.scientific_name); if (!ing) return;
      var base = brandBase(x.commercial_name_en); if (!base) return;
      if (base.replace(/[^A-Z]/g, '').indexOf(ing.replace(/[^A-Z]/g, '').slice(0, 5)) >= 0) return;
      if (!byIng.has(ing)) byIng.set(ing, []);
      byIng.get(ing).push({ base: base, ing: ing, cls: x.drug_class, route: x.route });
      if (!ingClasses.has(ing)) ingClasses.set(ing, new Set()); ingClasses.get(ing).add(x.drug_class);
      if (!classIngs.has(x.drug_class)) classIngs.set(x.drug_class, new Set()); classIngs.get(x.drug_class).add(ing);
    });
    pool = { byIng: byIng, ingClasses: ingClasses, classIngs: classIngs, ings: Array.from(byIng.keys()), classes: Array.from(classIngs.keys()).filter(function (c) { return classIngs.get(c).size >= 4 && c.length < 70; }) };
    return pool;
  }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function sameClassIngs(p, ing, k) {
    var out = [], classes = Array.from(p.ingClasses.get(ing) || []);
    shuffle(classes).forEach(function (c) { shuffle(Array.from(p.classIngs.get(c) || [])).forEach(function (i) { if (i !== ing && out.indexOf(i) < 0) out.push(i); }); });
    var rest = shuffle(p.ings); for (var i = 0; out.length < k + 4 && i < rest.length; i++) if (rest[i] !== ing && out.indexOf(rest[i]) < 0) out.push(rest[i]);
    return out.slice(0, k);
  }
  function makeQuestion(p) {
    var type = Math.random();
    if (type < 0.4) { /* brand -> ingredient */
      var ing = pick(p.ings), rec = pick(p.byIng.get(ing));
      var opts = shuffle([ing].concat(sameClassIngs(p, ing, 3)));
      return { q: L('What is the active ingredient in ', 'ما المادة الفعالة في ') + rec.base + '?', opts: opts, ans: ing, kind: 'b2i' };
    }
    if (type < 0.8) { /* ingredient -> brand */
      var ing2 = pick(p.ings), rec2 = pick(p.byIng.get(ing2));
      var others = sameClassIngs(p, ing2, 3).map(function (i) { return pick(p.byIng.get(i)).base; });
      var opts2 = shuffle([rec2.base].concat(others).filter(function (v, i, a) { return a.indexOf(v) === i; }));
      if (opts2.length < 4) return makeQuestion(p);
      return { q: L('Which brand contains ', 'أي اسم تجاري يحتوي على ') + ing2 + '?', opts: opts2, ans: rec2.base, kind: 'i2b' };
    }
    if (!p.classes.length) return makeQuestion(p);
    var cls = pick(p.classes), cIngs = Array.from(p.classIngs.get(cls)), correct = pick(cIngs);
    var wrong = shuffle(p.ings.filter(function (i) { return !p.ingClasses.get(i).has(cls); })).slice(0, 3);
    return { q: L('Which ingredient is listed under the class "', 'أي مادة فعالة مدرجة تحت التصنيف "') + cls + L('" in the dataset?', '" في قاعدة البيانات؟'), opts: shuffle([correct].concat(wrong)), ans: correct, kind: 'cls' };
  }
  var round = null, topic = '';
  var GOAL = 20;
  function topicPool(p) {
    if (!topic || !p.classIngs.get(topic)) return p;
    var set = p.classIngs.get(topic), ings = p.ings.filter(function (i) { return set.has(i); });
    if (ings.length < 4) return p;
    return { ings: ings, byIng: p.byIng, ingClasses: p.ingClasses, classIngs: p.classIngs, classes: [topic] };
  }
  function topTopics(p) {
    return p.classes.filter(function (c) { return /[A-Za-z]{4,}/.test(c); }).map(function (c) { return [c, p.classIngs.get(c).size]; }).filter(function (x) { return x[1] >= 6; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10).map(function (x) { return x[0]; });
  }
  function weekBars(s) {
    var out = '', d = new Date(), max = Math.max(GOAL, 1);
    for (var i = 6; i >= 0; i--) { var dt = new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10), n = (s.hist && s.hist[dt]) || 0; out += '<i title="' + dt + ': ' + n + '" style="height:' + Math.max(4, Math.min(100, Math.round(100 * n / max))) + '%"></i>'; }
    return '<span class="study-week" aria-hidden="true">' + out + '</span>';
  }
  function buildStudyPage() {
    pageShell('studyPage', 'study', '<span class="section-kicker feat-k"></span><h1 class="feat-title"></h1><p class="clinical-intro feat-intro"></p><div id="studyStats" class="feat-stats"></div><div id="studyBody" class="feat-panel"></div>');
  }
  function stats() { var s = store('dawaya-study-stats', null) || {}; var today = new Date().toISOString().slice(0, 10); s.total = s.total || 0; s.correct = s.correct || 0; s.streak = s.streak || 0; s.last = s.last || ''; s.todayDate = s.todayDate || ''; s.today = s.todayDate === today ? (s.today || 0) : 0; s.todayDate = today; s.hist = s.hist || {}; s.hist[today] = s.today; return s; }
  function renderStudy() {
    var p = $('#studyPage'); if (!p) return;
    $('.feat-k', p).textContent = L('STUDY MODE', 'وضع المذاكرة');
    $('.feat-title', p).textContent = L('Study mode', 'وضع المذاكرة');
    $('.feat-intro', p).textContent = L('Quizzes built only from the bundled drug dataset: brand and ingredient pairs, and the class label each record carries. No outside medical content.', 'اختبارات مبنية فقط من قاعدة بيانات الأدوية المضمنة: أزواج الاسم التجاري والمادة الفعالة، والتصنيف المدرج في كل سجل. لا يوجد محتوى طبي من خارجها.');
    var s = stats(), acc = s.total ? Math.round(100 * s.correct / s.total) : 0;
    var pct = Math.min(100, Math.round(100 * s.today / GOAL));
    $('#studyStats', p).innerHTML = '<div class="study-goal"><div class="study-goal-row"><b>' + esc(L('Daily goal', 'الهدف اليومي')) + '</b><span>' + s.today + ' / ' + GOAL + '</span></div><div class="study-goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + GOAL + '" aria-valuenow="' + Math.min(s.today, GOAL) + '"><i style="width:' + pct + '%"></i></div></div><span>' + esc(L('Accuracy ', 'الدقة ') + acc + '%') + '</span><span>' + esc(L('Streak ', 'التتابع ') + s.streak) + '</span><span>' + esc(L('Total ', 'الإجمالي ') + s.total) + '</span>' + weekBars(s);
    var body = $('#studyBody', p);
    if (!drugs().length) { body.innerHTML = '<p class="feat-muted">' + esc(L('The medicine directory is still loading.', 'دليل الأدوية ما زال يُحمّل.')) + '</p>'; setTimeout(function () { if (!$('#studyPage').hidden) renderStudy(); }, 900); return; }
    if (!round) { var tps = topTopics(buildPool()); body.innerHTML = '<h2 class="study-topics-title">' + esc(L('Topic', 'الموضوع')) + '</h2><div class="study-topics" role="group">' + ['' ].concat(tps).map(function (c) { return '<button type="button" class="study-topic' + (c === topic ? ' is-on' : '') + '" data-study-topic="' + esc(c) + '" aria-pressed="' + (c === topic) + '">' + esc(c || L('All topics', 'كل المواضيع')) + '</button>'; }).join('') + '</div><button type="button" class="feat-primary" data-study-start>' + esc(L('Start a round (20 questions)', 'ابدأ جولة (20 سؤالًا)')) + '</button>'; }
    else if (round.i >= round.n) { body.innerHTML = '<h2>' + esc(L('Round finished', 'انتهت الجولة')) + '</h2><p class="feat-value">' + round.score + ' / ' + round.n + '</p><button type="button" class="feat-primary" data-study-start>' + esc(L('New round', 'جولة جديدة')) + '</button>'; }
    else showQuestion(body);
    setBackLabels();
  }
  function showQuestion(body) {
    var q = round.cur; var answered = round.picked !== null;
    body.innerHTML = '<p class="feat-prog">' + esc((round.i + 1) + ' / ' + round.n) + '</p><h2 class="feat-q" dir="auto">' + esc(q.q) + '</h2><div class="feat-opts">' + q.opts.map(function (o, i) {
      var cls = 'feat-opt'; if (answered) { if (o === q.ans) cls += ' correct'; else if (i === round.picked) cls += ' wrong'; }
      return '<button type="button" class="' + cls + '" data-opt="' + i + '"' + (answered ? ' disabled' : '') + ' dir="auto">' + esc(o) + '</button>';
    }).join('') + '</div>' + (answered ? '<p class="feat-fb">' + esc(q.opts[round.picked] === q.ans ? L('Correct.', 'إجابة صحيحة.') : L('Not correct. The answer is ', 'غير صحيحة. الإجابة هي ') + q.ans) + '</p><button type="button" class="feat-primary" data-study-next>' + esc(L('Next', 'التالي')) + '</button>' : '');
  }
  document.addEventListener('click', function (e) {
    var tb = e.target.closest && e.target.closest('[data-study-topic]');
    if (tb) { topic = tb.getAttribute('data-study-topic') || ''; renderStudy(); return; }
    if (e.target.closest && e.target.closest('[data-study-start]')) {
      var p = buildPool(); if (!p.ings.length) return;
      var tp = topicPool(p); round = { i: 0, n: 20, score: 0, picked: null, topic: topic, cur: makeQuestion(tp) }; renderStudy(); return;
    }
    var o = e.target.closest && e.target.closest('[data-opt]');
    if (o && round && round.picked === null) {
      round.picked = Number(o.getAttribute('data-opt'));
      var ok = round.cur.opts[round.picked] === round.cur.ans; if (ok) round.score++;
      var s = stats(); var today = s.todayDate; s.total++; s.today++; if (ok) { s.correct++; s.streak++; } else s.streak = 0; s.last = today; s.hist = s.hist || {}; s.hist[today] = s.today; save('dawaya-study-stats', s);
      renderStudy(); return;
    }
    if (e.target.closest && e.target.closest('[data-study-next]') && round) { round.i++; round.picked = null; if (round.i < round.n) round.cur = makeQuestion(topicPool(buildPool())); renderStudy(); }
  });

  /* ================= wiring ================= */
  function applyNavText() {
    Object.keys(NAV_TEXT).forEach(function (k) { document.querySelectorAll('[data-i18n="' + k + '"]').forEach(function (n) { n.textContent = L(NAV_TEXT[k][0], NAV_TEXT[k][1]); }); });
  }
  function refreshAll() {
    applyNavText();
    var c = $('#calcPage'); if (c && !c.hidden) renderCalcPage();
    var s = $('#studyPage'); if (s && !s.hidden) renderStudy();
    var m = $('#modalBackdrop'); if (m && !m.hidden && currentDrug) renderSlot(currentDrug);
    var ov = $('#featOverlay'); if (ov && !ov.hidden && ov.dataset.ing) $('#featDlgBody').innerHTML = ingredientCardHtml(ov.dataset.ing);
    setBackLabels();
  }
  function init() {
    buildCalcPage(); buildStudyPage(); renderCalcPage(); applyNavText(); setBackLabels();
    new MutationObserver(function (m) { for (var i = 0; i < m.length; i++) if (m[i].attributeName === 'lang') { refreshAll(); break; } }).observe(document.documentElement, { attributes: true });
  }
  window.DawayaFeatures = {
    pages: { calculators: function () { renderCalcPage(); }, study: function () { renderStudy(); } },
    compare: function (drug) { return SS.compare(drug, index()); },
    openIngredientCard: openIngredientCard
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* Browse sections as buttons: each "Browse ... by" heading becomes a tappable
 * button that shows or hides its list (letters, groups, body systems, types,
 * test purposes, sample types). Only classes are toggled, so the lists keep
 * rendering exactly as before. */
(function () {
  'use strict';
  var FOLDS = [
    ['[data-i18n="browseByLetter"]', ['#medicineAlphabet']],
    ['#drugGroupHeading', ['#drugGroups']],
    ['#conditionSystemsHeading', ['#conditionGroups']],
    ['#conditionTypesHeading', ['#conditionTypes']],
    ['#conditionLetterLabel', ['#conditionAlphabet']],
    ['[data-i18n="labBrowseLetter"]', ['#labAlphabet']],
    ['[data-i18n="labPurposeHeading"]', ['#labPurposes']],
    ['[data-i18n="labSampleHeading"]', ['#labSamples']]
  ];
  function setOpen(btn, targets, open) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('is-open', open);
    targets.forEach(function (el) { el.classList.toggle('fold-collapsed', !open); });
  }
  function init() {
    FOLDS.forEach(function (f) {
      var btn = document.querySelector(f[0]);
      var targets = f[1].map(function (s) { return document.querySelector(s); }).filter(Boolean);
      if (!btn || !targets.length) return;
      btn.classList.add('browse-toggle');
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      setOpen(btn, targets, false);
      var flip = function () { setOpen(btn, targets, btn.getAttribute('aria-expanded') !== 'true'); };
      btn.addEventListener('click', flip);
      btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
