(() => {
  'use strict';
  const BUNDLED_DATA_URL = 'assets/egyptian-drugs.json';
  const CONDITION_DATA_URL = 'assets/conditions.json';
  const LAB_CONTENT_URL = 'assets/lab-tests-content.json';
  /* The bundled datasets are served with force-cache, so their URL must change when the app
     ships new data; otherwise an upgrade keeps reading the previous release from the WebView
     cache. The revision is the ?v= the build stamps on this script tag. */
  const ASSET_REV = (() => {
    try {
      const src = document.currentScript && document.currentScript.src;
      return (src && new URL(src).searchParams.get('v')) || '';
    } catch (_) {
      return '';
    }
  })();
  const withRev = (url) => (ASSET_REV ? `${url}${url.includes('?') ? '&' : '?'}v=${ASSET_REV}` : url);
  const SUGGESTION_EMAIL = 'hussein.sayed994@gmail.com';
  const CUSTOM_DRUGS_KEY = 'dawaya-custom-drugs-v1';
  const NEW_MEDICINE_SUBJECT = 'إضافة دواء جديد';
  const $ = (selector) => document.querySelector(selector);
  const core = window.DawayaCore || null;
  const ID_FIELD_SELECTOR = 'input[type="text"],input:not([type]),input[type="search"],textarea';
  function sanitizeUserText(value){
    let text = String(value == null ? '' : value), removed = false;
    const email = /[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
    const nationalId = /(^|[^\d])\d{14}(?!\d)/g;
    const phone = /(^|[^\d])((?:\+|00)?\d[\d\s().-]{5,}\d)(?!\d)/g;
    const withoutEmail = text.replace(email, '');
    if (withoutEmail !== text) { text = withoutEmail; removed = true; }
    const withoutId = text.replace(nationalId, '$1');
    if (withoutId !== text) { text = withoutId; removed = true; }
    text = text.replace(phone, (match, prefix, run) => {
      const digits = run.replace(/\D/g, '');
      const international = /^(\+|00)/.test(run);
      if (digits.length >= 10 || (international && digits.length >= 8)) { removed = true; return prefix; }
      return match;
    });
    if (removed) text = text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^\s+|\s+$/g, '');
    return { text, removed };
  }
  const input = $('#searchInput'), results = $('#results'), modal = $('#modalBackdrop'), suggestions = $('#suggestions');
  const conditionInput=$('#conditionSearch'), conditionResults=$('#conditionResults'), conditionStatus=$('#conditionStatus'), conditionSuggestions=$('#conditionSuggestions');
  const conditionDetailBackdrop=$('#conditionDetailBackdrop');
  const relatedBackdrop=$('#relatedBackdrop');
  const conditionSummaryObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){conditionSummaryObserver.unobserve(entry.target);loadConditionCardSummary(entry.target)}}),{rootMargin:'240px'}):null;

  let drugs = [], baseDrugs = [], matching = [], mode = 'brand', shown = 20, loadFailed = false, debounce, activeSuggestion = -1, language = 'en', activeDrug = null, activeConditionTopic = null, customDrugs = [], usingBundledData = false;
  let themePreference=core?.theme?.preference||'system';if(!core){try{themePreference=localStorage.getItem('dawaya-theme')||'system'}catch(_){}}
  let reminderSpeakingId='',reminderScheduleSignature='',reminderTimer=0;
  // Drop the obsolete per-tab dataset cache, which can exceed the sessionStorage quota.
  try{sessionStorage.removeItem('dawaya-drugs-v2')}catch(_){}
  let selectedMedicineLetter=null,activeDrugGroup='',activeDrugPath=[],selectedConditionLetter=null,activeConditionGroup='',activeConditionType='',conditionRequest=0,conditionTopicList=[],conditionVisible=6,conditionSuggestionRequest=0,conditionSuggestionTimer=0,conditionSuggestionActive=-1,conditionSuggestionItems=[];
  let modalReturnFocus=null,conditionReturnFocus=null;
  let unifiedConditionItems=[],unifiedConditionRequest=0,unifiedConditionTimer=0,unifiedConditionLoading=false,unifiedLabItems=[],mainSuggestionItems=[];const wikiCache=new Map(),labWikiCache=new Map();
  let relatedDrug=null,relatedKind='',relatedScope='',relatedRoot='',relatedItems=[],relatedShown=20,relatedPriceSort='default',groupWikiToken=0;
  const ingredientSignatureCache=new WeakMap(),fieldTextCache=new WeakMap(),brandTextCache=new WeakMap();const groupCountCache=new Map();let similarIndex=new Map(),classIndex=new Map(),rootClassIndex=new Map(),lastSearchQuery='',lastSearchMode='',lastSearchMatches=null;
  try { language=localStorage.getItem('dawaya-language')||'en'; } catch (_) { language='en'; }
  if(!['en','ar'].includes(language))language='en';

  // Educational summaries for common ingredients. These are not prescribing instructions.
  const clinicalNotes = [
    { keys:['PARACETAMOL','ACETAMINOPHEN'], mechanism:'Paracetamol relieves pain and reduces fever. Its exact mechanism is not fully established. It appears to reduce prostaglandin-related pain and temperature signaling mainly within the central nervous system, with much less anti-inflammatory activity in peripheral tissues than NSAIDs.', pharmacology:'After absorption, it is processed mainly by the liver. Most is converted to inactive metabolites and cleared in urine. A small fraction forms a reactive metabolite that is normally neutralized by glutathione; overdose can overwhelm this protection and injure the liver.', uses:'Commonly used for mild to moderate pain and fever. Check combination cold and pain products so the same ingredient is not taken more than once.', effects:'Usually well tolerated when used as directed. Nausea or rash can occur. Excess exposure can cause severe liver injury, sometimes before symptoms appear.', safety:'People with liver disease, heavy alcohol use, malnutrition, or repeated use of combination products should seek professional advice. Suspected overdose needs urgent medical attention even if the person feels well.' },
    { keys:['IBUPROFEN'], mechanism:'Ibuprofen reversibly blocks cyclo-oxygenase enzymes COX-1 and COX-2. These enzymes help produce prostaglandins, which contribute to pain, fever, inflammation, and protection of the stomach lining and kidney blood flow. Lower prostaglandin production explains both the intended effects and several important risks.', pharmacology:'It is a non-steroidal anti-inflammatory drug (NSAID). Its pain-relieving, fever-reducing, and anti-inflammatory effects are linked to reduced prostaglandin synthesis. It is processed by the liver and cleared mainly by the kidneys.', uses:'Used for pain, inflammation, and fever when appropriate for the individual. Follow the product leaflet; taking it with food may reduce stomach upset but does not remove ulcer or bleeding risk.', effects:'Indigestion, nausea, or stomach discomfort can occur. More serious risks include stomach or intestinal ulcer/bleeding, kidney injury, fluid retention, increased blood pressure, and cardiovascular events; risks vary with dose, duration, and health history.', safety:'Ask a clinician before use with a history of ulcers, kidney or heart disease, high blood pressure, asthma triggered by NSAIDs, blood thinners, or pregnancy. Avoid combining with another NSAID unless advised.' },
    { keys:['AMOXICILLIN+CLAVULANIC ACID','AMOXICILLIN CLAVULANIC ACID'], mechanism:'Amoxicillin is a beta-lactam antibiotic. It binds bacterial penicillin-binding proteins and interferes with cross-linking of peptidoglycan, weakening the bacterial cell wall. Clavulanic acid blocks some beta-lactamase enzymes that would otherwise break down amoxicillin, extending activity against susceptible organisms.', pharmacology:'The combination only works against susceptible bacteria. The clavulanate component does not make it effective for every resistant organism, and neither component treats viral infections. Both ingredients are substantially cleared through the kidneys; amoxicillin exposure may rise when kidney function is reduced.', uses:'Prescribed for selected bacterial infections after clinical assessment. The correct product, schedule, and duration depend on the infection and patient. Complete the prescribed course unless the prescriber changes it.', effects:'Diarrhea, nausea, vomiting, and rash are common. Serious but less common problems include immediate allergy, severe skin reactions, antibiotic-associated colitis, and liver injury.', safety:'Do not use without medical advice if there has been a serious penicillin or cephalosporin allergy. Tell the prescriber about kidney or liver problems, previous antibiotic-associated jaundice, and other medicines. Seek urgent care for breathing difficulty, facial swelling, or severe persistent diarrhea.' },
    { keys:['AMOXICILLIN'], mechanism:'Amoxicillin is a penicillin-family beta-lactam antibiotic. It binds penicillin-binding proteins and inhibits the final cross-linking steps used to build the bacterial cell wall. Susceptible bacteria become unable to maintain that wall and may die as they grow.', pharmacology:'Its activity depends on the bacteria being susceptible and on maintaining adequate exposure during treatment. It is cleared mainly by the kidneys. Beta-lactamase-producing bacteria can inactivate it, so it is not appropriate for every infection.', uses:'Used for certain bacterial infections when prescribed. It does not treat colds, flu, or other viral infections.', effects:'Diarrhea, nausea, and rash may occur. Serious allergy can cause hives, swelling, wheezing, or collapse. Severe or persistent diarrhea needs medical assessment.', safety:'Tell the prescriber about any past penicillin or cephalosporin reaction and kidney disease. Use only for the infection and schedule prescribed; do not share or save leftover antibiotics.' },
    { keys:['AZITHROMYCIN'], mechanism:'Azithromycin is a macrolide antibiotic. It binds the 50S subunit of the bacterial ribosome and interferes with protein synthesis, which can stop susceptible bacteria from growing. The effect depends on the organism and its resistance pattern.', pharmacology:'It distributes widely into tissues and remains in the body longer than many antibiotics. This does not mean it is suitable for self-treatment: resistance, the infection site, and patient factors determine whether it is appropriate.', uses:'Prescribed for selected bacterial infections. It does not treat viral colds or flu, and it should be used only for the diagnosis and schedule chosen by a clinician.', effects:'Diarrhea, nausea, abdominal pain, and vomiting are among reported effects. Less common but serious risks include abnormal heart rhythm (QT prolongation), liver injury, severe allergy, and hearing changes.', safety:'Tell the prescriber about heart rhythm problems, fainting, liver disease, low potassium or magnesium, and medicines that affect heart rhythm. Seek urgent care for fainting, severe palpitations, breathing difficulty, or jaundice.' },
    { keys:['OMEPRAZOLE'], mechanism:'Omeprazole is a proton-pump inhibitor. It is activated in the acidic secretory canaliculi of stomach parietal cells, then binds to and suppresses the H+/K+-ATPase proton pump. This reduces the final step of gastric acid secretion.', pharmacology:'Acid suppression can continue after the medicine has left the bloodstream because pump activity returns as new pumps are made. The drug is metabolized mainly by liver enzymes, and its effect can alter absorption of medicines that need stomach acid.', uses:'Used for selected acid-related conditions such as reflux and ulcers. Product instructions differ; use the formulation as directed and do not assume that persistent symptoms should be self-treated indefinitely.', effects:'Headache, abdominal pain, nausea, diarrhea, constipation, or gas can occur. Long-term or high-dose use has additional risks that should be reviewed with a clinician.', safety:'Seek medical assessment for trouble swallowing, vomiting blood, black stools, persistent vomiting, or unexplained weight loss. Ask about interactions, especially with medicines whose absorption or metabolism may be affected.' },
    { keys:['CETIRIZINE'], mechanism:'Cetirizine is a selective peripheral histamine H1 receptor inverse agonist. By reducing histamine signaling, it can lessen itching, sneezing, runny nose, and hives. It generally enters the brain less readily than older antihistamines, but drowsiness can still occur.', pharmacology:'It is the active metabolite of hydroxyzine and is eliminated largely unchanged in urine. Reduced kidney function can increase exposure, so the product label or clinician may recommend a different regimen.', uses:'Used to relieve symptoms of allergic rhinitis and urticaria. It treats symptoms, not the underlying allergy trigger.', effects:'Sleepiness, fatigue, dry mouth, and headache can occur. Some people remain drowsy even when the medicine is described as less sedating.', safety:'Avoid alcohol and be cautious with driving until you know how it affects you. Ask a pharmacist or clinician before use in kidney disease or with sedatives and other medicines that cause drowsiness.' },
    { keys:['LORATADINE'], mechanism:'Loratadine is a long-acting, peripherally selective histamine H1 receptor inverse agonist. It reduces histamine-mediated allergic symptoms while usually causing less central nervous system sedation than older antihistamines.', pharmacology:'It is absorbed by mouth and converted in the liver to an active metabolite, desloratadine. Liver impairment and interacting medicines can change exposure.', uses:'Used for symptoms of allergic rhinitis and hives. It does not prevent a severe allergic reaction or replace emergency treatment.', effects:'Headache, sleepiness, fatigue, or dry mouth may occur, though many people experience none.', safety:'Ask a clinician or pharmacist about use with liver disease or interacting medicines. Seek emergency help for throat swelling, breathing difficulty, or signs of anaphylaxis.' },
    { keys:['DICLOFENAC'], mechanism:'Diclofenac is an NSAID that inhibits COX-1 and COX-2 enzymes, reducing the production of prostaglandins involved in pain and inflammation. The amount reaching the bloodstream differs substantially between tablets, injections, suppositories, and topical products.', pharmacology:'Systemic diclofenac can affect the stomach lining, kidney blood flow, blood pressure, and cardiovascular risk. A topical product may lower but does not eliminate systemic exposure. Formulations are not interchangeable by dose.', uses:'Used for selected painful or inflammatory conditions. Follow the instructions for the exact formulation; do not apply a topical product to broken skin unless its leaflet says otherwise.', effects:'Stomach discomfort, nausea, or dizziness may occur. Serious risks include gastrointestinal bleeding, kidney or liver problems, fluid retention, and cardiovascular events.', safety:'Ask a clinician before use with ulcers, heart or kidney disease, high blood pressure, blood thinners, or pregnancy. Do not combine with another NSAID unless specifically advised.' },
    { keys:['METFORMIN'], mechanism:'Metformin lowers glucose mainly by reducing hepatic glucose production and improving insulin sensitivity in muscle and other tissues. It does not normally stimulate pancreatic insulin release, so by itself it has a low risk of causing hypoglycemia.', pharmacology:'It is not significantly metabolized and is eliminated unchanged by the kidneys. Reduced kidney function or severe illness with low oxygen, dehydration, or poor circulation can allow accumulation and increase the rare risk of lactic acidosis.', uses:'Used in type 2 diabetes as part of a wider care plan. Formulations may be immediate- or extended-release and are not always taken the same way; follow the exact product instructions.', effects:'Diarrhea, nausea, abdominal discomfort, and a metallic taste are common, especially when starting. Long-term use can lower vitamin B12. Lactic acidosis is rare but serious.', safety:'Kidney function should be assessed. Tell healthcare professionals about severe dehydration, serious infection, surgery, or planned imaging with iodinated contrast. Do not change diabetes treatment without clinical advice.' },
    { keys:['ATORVASTATIN'], mechanism:'Atorvastatin competitively inhibits HMG-CoA reductase, a rate-limiting enzyme in cholesterol synthesis in the liver. The liver responds by increasing LDL receptors, which removes more LDL cholesterol from the blood.', pharmacology:'It lowers LDL cholesterol and triglycerides and can modestly raise HDL. It is metabolized by CYP3A4, so some medicines and grapefruit products can increase exposure and muscle toxicity risk.', uses:'Used to lower cholesterol and reduce cardiovascular risk when a clinician determines that treatment is appropriate. It complements, rather than replaces, diet and other risk-reduction measures.', effects:'Muscle aches, joint symptoms, digestive upset, or changes in liver tests can occur. Severe muscle injury and clinically significant liver injury are uncommon but important.', safety:'Tell the prescriber about muscle pain or weakness, liver disease, pregnancy, and all medicines or supplements. Urgent assessment is appropriate for severe muscle symptoms with dark urine or marked weakness.' },
    { keys:['SALBUTAMOL','ALBUTEROL'], mechanism:'Salbutamol is a selective beta-2 adrenergic receptor agonist. Activation of beta-2 receptors increases intracellular cyclic AMP in airway smooth muscle, helping relax the muscle and widen the airways.', pharmacology:'Inhaled forms deliver medicine to the lungs; technique and device matter. The effect is generally rapid and short acting. Frequent need for a reliever can signal worsening asthma and is not a reason to increase treatment indefinitely without review.', uses:'Used for rapid relief of bronchospasm and in some plans before exercise. It does not treat the underlying airway inflammation; follow the asthma action plan and device instructions.', effects:'Tremor, nervousness, headache, and a fast heartbeat can occur. High exposure can lower blood potassium or cause rhythm problems.', safety:'Seek urgent help if breathing is worsening or the inhaler is not relieving symptoms as expected. Ask a clinician if reliever use is increasing, and do not stop controller treatment without advice.' }
  ];
  const routeNames = { 'ORAL.SOLID':'Oral · tablet/capsule', 'ORAL.LIQUID':'Oral · liquid', 'ORAL':'Oral', 'INJECTION':'Injection', 'TOPICAL':'Topical', 'OPHTHALMIC':'Ophthalmic', 'NASAL':'Nasal', 'INHALATION':'Inhalation', 'OTIC':'Otic', 'VAGINAL':'Vaginal', 'RECTAL':'Rectal' };
  const translations = {
    en:{brandAria:'Drugcopeia home',closeAria:'Close',appBackAria:'Back to the previous page',searchPlaceholder:'Search medicines and health conditions',searchAria:'Search medicines and health conditions',conditionMatchesHeading:'Matching health conditions',conditionsListTitle:'Health conditions',medicineMatches:'Medicine matches',imageSearchAria:'Open this medicine\u2019s product photographs in the browser view',viewInBrowser:'View in browser',readingEyebrow:'NEWS AND ARTICLES',commonsTitle:'Photos',commonsShow:'Show photos',commonsHide:'Hide photos',commonsLoading:'Loading photographs…',commonsEmpty:'No photograph came back from Wikimedia Commons for this medicine.',commonsNoTerm:'This medicine has no name to search for.',commonsShownNote:'From Wikimedia Commons. Tap a photo to open it full size.',commonsPreviewOnly:'The full-size file did not open. This is the preview.',commonsGridAria:'Photographs from Wikimedia Commons',photoViewerAria:'Full-size photograph',photoZoomHint:'Pinch to zoom',readingTitle:'Drug news and scientific articles',readingIntro:'Daily drug news from the Egyptian Drug Authority, the Ministry of Health, WHO, FDA and PubMed. Tap a headline to open the full article.',readingFiltersAria:'Filter news and articles',readingTabAll:'All',readingTabNews:'Drug news',readingTabArticles:'Articles',readingDisclaimer:'Educational information only. It does not replace the product leaflet or advice from a doctor or pharmacist.',readingSectionHint:'Tap a heading to read its details.',photosFailed:'Could not load the photographs. Check your connection.',noPackPhoto:'The offline database holds no photograph of this pack. The buttons below look it up on the open web.',offlineBrowserBlocked:'Offline mode is on. Every link opens on the open web, so they stay closed until you turn offline mode off.',medicinesTab:'Medicines',conditionsTab:'Conditions',browseByLetter:'Browse medicines by first letter',browseDrugGroups:'Browse medicine groups',browseBodySystems:'Browse by body system',browseConditionTypes:'Browse by condition type',browseConditionLetter:'Browse conditions by first letter',browseAll:'All',allBodySystems:'All body systems',conditionSubgroups:'Subgroups',back:'Back',appearanceTitle:'Appearance',themeLight:'Light mode',themeDark:'Dark mode',themeSystem:'Follow system',startsWith:'Starting with',groupAntibiotics:'Antibiotics',groupAntivirals:'Antivirals',groupAntifungals:'Antifungals',groupPain:'Pain & inflammation',groupAllergy:'Allergy',groupCardio:'Heart & blood pressure',groupDiabetes:'Diabetes',groupDigestive:'Digestive health',groupRespiratory:'Respiratory',groupHairCare:'Hair care',groupSkinCare:'Skin care',groupPsychiatry:'Mental health & neurology',groupHormones:'Hormones & endocrine',groupUrology:'Urology & men\u2019s health',groupEyeCare:'Eye care',groupEntCare:'Ear, nose & throat',groupOncology:'Cancer medicines',groupImmunology:'Immunology & biologics',groupVaccines:'Vaccines',groupHematology:'Blood & clotting',groupGynecology:'Women\u2019s health',groupSmokingCessation:'Smoking cessation',groupWeightManagement:'Weight management',groupDental:'Dental & oral care',groupSupplements:'Nutritional supplements',bodyBlood:'Blood, Heart and Circulation',bodyBones:'Bones, Joints and Muscles',bodyBrain:'Brain and Nerves',bodyDigestive:'Digestive System',bodyEnt:'Ear, Nose and Throat',bodyEndocrine:'Endocrine System',bodyEyes:'Eyes and Vision',bodyImmune:'Immune System',bodyKidney:'Kidneys and Urinary System',bodyLungs:'Lungs and Breathing',bodyMouth:'Mouth and Teeth',bodySkin:'Skin, Hair and Nails',bodyFemale:'Female Reproductive System',bodyMale:'Male Reproductive System',conditionAlphabetNote:'Condition names are mainly in English in this terminology database.',conditionsEyebrow:'HEALTH CONDITIONS',conditionsTitle:'Understand a condition.',conditionsDescription:'Search the condition index by name or body system, then follow the source links.',conditionSearchPlaceholder:'Search a condition, e.g. asthma',conditionSearchButton:'Search',conditionPopular:'Popular topics',quickDiabetes:'Diabetes',quickAsthma:'Asthma',quickBloodPressure:'High blood pressure',quickMigraine:'Migraine',conditionSearchHint:'Choose a popular topic or search by name.',conditionLoading:'Loading the bundled condition index…',conditionError:'Could not load condition topics from the bundled data. Reload the app and try again.',conditionNoResults:'No matching health topics found. Try another term.',conditionSummary:'Overview',conditionCare:'Care and treatment information',conditionSource:'ClinicalTables source',readMedlinePlus:'Search MedlinePlus for details',searchDrugsCom:'Search Drugs.com',searchMedscape:'Search Medscape',conditionsAttribution:'Source: MedlinePlus, National Library of Medicine. Condition index from NLM ClinicalTables, built into the app.',conditionDisclaimerTitle:'For education only',conditionDisclaimer:'Treatment depends on the diagnosis and the person. This page does not diagnose or prescribe.',brandSubtitle:'EGYPT MEDICINE GUIDE',developerCredit:'Developed by Dr. Hussein Elnagmy',developerTitle:'Clinical Pharmacist',versionLabel:'App version',eyebrow:'YOUR MEDICINE, MADE CLEAR',heroTitle1:'Find a medicine.',heroTitle2:'Understand it better.',heroDescription:'Search medicines available in Egypt by brand name, active ingredient, drug group, company, or price.',heroMeta:'Ingredients, pharmacology and details',directory:'MEDICINE DIRECTORY',searchQuestion:'What are you looking for?',searchPlaceholder:'Search medicines and health conditions',searchAria:'Search medicines and health conditions',clearAria:'Clear search',searchButton:'Search',searchBy:'Search by',searchDrugBy:'Search drug by',searchFieldAria:'Choose search field',brandName:'Brand name',genericName:'Generic name / ingredient',drugGroupSearch:'Drug class / group',manufacturer:'Manufacturer',price:'Price (EGP)',suggestionsAria:'Medicine suggestions',searchHint:'Try a brand, ingredient, drug group, manufacturer, or price',wildcardHint:'Use * or a space for letters you cannot remember',searchHintLang:'Search in English or Arabic',showMore:'Show more',readMore:'Read more',readLess:'Read less',noResults:'No medicines found',noResultsHint:'Try another spelling, search field, or ingredient.',welcome:'Search to explore medicines in Egypt',popularSearchesLabel:'Popular searches',disclaimerTitle:'For information, not treatment',disclaimerText:'Never start, stop, or change a medicine without advice from a qualified healthcare professional.',readSafety:'Read safety note',aboutEyebrow:'ABOUT DRUGCOPEIA',aboutTitle1:'A local guide',aboutTitle2:'to clearer answers.',aboutText1:'All medicines found in Egypt in one searchable directory: names, ingredients, companies, routes and prices.',aboutText2:'Data is built into the app and updates only with a new version. Always follow the product leaflet.',sourceLink:'View medicine data source',safetyTitle:'Important safety information',safetyText:'Educational only. No diagnosis or personal treatment. Read the leaflet and ask a doctor or pharmacist.',footerText:'Built for learning, not diagnosis or treatment.',footerSource:'Medicine listings: CC0 · GitHub source',tabOverview:'Overview',tabUse:'Use & side effects',tabSafety:'Safety',modalDisclaimer:'Educational information only. Always check the product leaflet and consult a healthcare professional.',activeIngredient:'ACTIVE INGREDIENT',route:'ROUTE',listedPrice:'LISTED PRICE',notListed:'Not listed',notAvailable:'Not available',medicine:'Medicine',classificationMissing:'Classification not listed',howWorks:'HOW IT WORKS',pharmacology:'PHARMACOLOGY',commonUse:'COMMON USE',sideEffects:'POSSIBLE SIDE EFFECTS',howGiven:'HOW IT IS GIVEN',leafletAdvice:'For product-specific information, check the approved leaflet and ask a pharmacist.',searchOfficialLabels:'Search official US product labels',missingMonograph:'This database record does not include a verified pharmacology monograph.',noVerifiedMechanism:'A drug-specific mechanism of action has not been verified for this entry, so no clinical explanation is generated.',routeOnly:'The source database lists the route as',noInstructions:'No verified instructions are available for this product. Check the leaflet and ask a pharmacist.',safeUse:'Check the leaflet for this exact brand and ask a professional about allergies, interactions and pregnancy.',suggestions:'Suggestions',popularMedicines:'Popular medicines',popularConditions:'Common conditions',popularLabTests:'Common tests',matches:'Matches for',brandMatches:'brand names',genericMatches:'active ingredients',classMatches:'drug group',manufacturerMatches:'manufacturers',priceMatches:'prices',match:'match',matchDual:'matches',matchesPlural:'matches',connectionRequired:'Connection required',updatedDataset:'Updated dataset · Egypt',builtInDataset:'Built-in database · Egypt',builtInLoading:'Loading the built-in medicine database…',indexed:'medicines indexed',databaseUnavailable:'Database unavailable',connectDatabase:'Loading the built-in medicine database',databaseError:'Could not load the medicine database',databaseErrorHint:'Reload the app and try again.',databaseRetry:'Try again',sourceClassificationLead:'The database classifies this medicine as',classLimits:'The class alone cannot confirm the action, uses, side effects or warnings for this product.',ingredientNotAvailable:'The active ingredient is not listed in the source database.',noVerifiedMonograph:'A drug-specific mechanism of action has not been verified for this entry.',officialProductAdvice:'For product-specific information, check the approved leaflet and ask a pharmacist.',routeInstruction:'This describes the route or dosage form only, not a dose or schedule. Follow the product leaflet and prescription.',dosesNotIndividualized:'This guide does not provide individualized dosing.',databaseRouteProduct:'The database lists this product as',popularLabel:'Popular searches',browseMedicinePrompt:'Choose a medicine group or a letter to begin.',browseMedicineHint:'Groups open subgroups and then medicines; letters show matching brand names.',navPrivacy:'Privacy',navAssistant:'AI',privacyEyebrow:'PRIVACY',privacyTitle:'Your data stays on this device',privacyLede:'No account, no analytics, no ads. Nothing you search or save leaves your device.',privacyCollectTitle:'What we collect',privacyCollectValue:'Nothing.',privacyCollect1:'No names, phone numbers, national IDs, email addresses or patient details.',privacyCollect2:'No search history, reading history or reminder contents leave the app.',privacyCollect3:'No device ID, location or contacts. Camera and microphone open only when you tap their buttons.',privacyCollect4:'Everything is processed on this device. Voice search uses the system speech service, on-device where supported.',privacyCollect5:'Phone numbers, national IDs and emails you type are removed before use.',privacyDownloadsTitle:'What can be downloaded',privacyDownloadsText:'Medicine, condition and test data are built in. Only two things go online, and only when you tap: Update news, and Show photos (searched by the medicine\'s trade name). No identifiers or tracking.',privacyDownloadsNote:'Every other network request is blocked inside the app. Links open in a browser view only when you tap them.',privacyLinksNote:'Links open in a browser view over the page. The app reads nothing from it.',privacyLinksWhere:'On phones it uses your device\'s browser component. On computers it opens its own window and forgets it on close.',privacyFeedbackNote:'Feedback is prepared in the app and sent through your own email app only when you press Send.',privacyHostWho:'Headlines from the World Health Organization',privacyHostFda:'Drug recall reports from the U.S. FDA',privacyHostNlm:'Scientific abstracts from the U.S. National Library of Medicine',privacyHostCommons:'Photographs of the pack, asked for when you press Show photos on a medicine page. Sends that product name and nothing else.',privacyHostCommonsImage:'The small previews in that photo grid, fetched only with the search above.',privacyHostCommonsFull:'The full-size file that opens when you tap one of those previews.',privacyPermissionsTitle:'Permissions and why',privacyPermNotify:'Notifications: to show the reminders you created, at the time you chose.',privacyPermCamera:'Camera: only to scan a box code or attach a photo to an assistant question. Pictures are read on the device and never stored or uploaded.',privacyPermMic:'Microphone: only while Voice search listens. Audio is not stored.',privacyPermAlarm:'Alarms and restart (Android): to keep your reminders exact and restore them after a restart.',privacyPermInternet:'Internet: only for news, photos and source links you open. The directory works fully offline.',privacyPermNone:'No location, contacts, phone state, files or advertising permissions are requested.',privacyLocalTitle:'Data on this device',privacyLocalText:'Reminders, added medicines and saved headlines stay in private app storage and are never uploaded.',privacyWipe:'Delete all local data',privacyWipeConfirm:'Tap again to confirm deletion',privacyWipeDone:'Local data deleted. The app is reloading.',privacyWipeFail:'Could not delete data. Please close the app and try again.',privacyGuardNotice:'Removed a phone number, national ID or email address. Drugcopeia never needs personal details.',privacyOfflineTitle:'Offline mode',privacyOfflineText:'Off by default. Turn on to block all network requests.',privacyOfflineOn:'Offline mode is on',privacyOfflineOff:'Offline mode is off',privacyHistoryTitle:'Saved conversations',privacyHistoryText:'Chats are saved encrypted on this device. Turn saving off to erase them.',privacyHistoryOn:'Saving conversations is on',privacyHistoryOff:'Saving conversations is off',privacyHistoryListTitle:'Previous conversations',privacyHistoryEmpty:'No saved conversations yet. Every new chat will appear here.',privacyHistoryUntitled:'Conversation',privacyHistoryMessages:'messages',privacyHistoryDelete:'Delete',privacyHistoryDeleteConfirm:'Confirm',privacyHistoryDeleted:'Conversation deleted.',privacyHistoryDeleteFail:'That conversation is no longer saved.',privacyHistoryClear:'Delete all conversations',privacyHistoryClearConfirm:'Confirm delete all',privacyHistoryCleared:'All conversations deleted.',privacyHistoryKept:'Saving is on: conversations are stored encrypted on this device.',privacyHistoryErased:'Saving is off and everything saved was erased.',privacyHistoryOpened:'Conversation opened.',privacyFoot:'Educational guide, not a medical record. Do not type patient details.',skipToContent:'Skip to main content',primaryNavAria:'Primary navigation',quickNavAria:'Quick navigation',workspaceLabel:'MEDICINE SAFETY WORKSPACE',navSupportLabel:'SUPPORT',navHome:'Home',navMedicines:'Medicines',navConditions:'Conditions',navTests:'Medical tests',navDoses:'Doses',navInteractions:'Interactions',navAbout:'About Drugcopeia',sidenavSafetyNote:'For information only. Ask a pharmacist or clinician.',safetyRailKicker:'SAFETY RAIL',safetyRailStatus:'Educational only',safetyRailTitle:'Safety alerts',railEmergencyTitle:'Not for emergencies',railEmergencyText:'For severe symptoms, call your local emergency number or go to the nearest emergency department.',railQuickTitle:'Quick checks',railInteractionsAction:'Check two medicines',railInteractionsHint:'Avoid, major, or moderate pairs',railDoseAction:'Pediatric dose reference',railDoseHint:'Weight-based ranges from 2 kg',railBeforeTitle:'Before you act',railBefore1:'Confirm the active ingredient and strength on the package.',railBefore2:'Ask about pregnancy, kidney or liver disease, and other medicines.',railBefore3:'Verify price and availability locally before relying on them.',monoMechanism:'MECHANISM OF ACTION',monoIndications:'INDICATIONS & USAGE',monoDosage:'DOSAGE & ADMINISTRATION',monoInteractions:'DRUG INTERACTIONS',monoBoxed:'BOXED WARNING',monoWarnings:'WARNINGS & PRECAUTIONS',monoContra:'CONTRAINDICATIONS',monoAdverse:'ADVERSE REACTIONS',monoPregnancy:'PREGNANCY & LACTATION',monoUsLabel:'U.S. label',monoRefTitle:'US reference (FDA label)',monoRefDiff:'This U.S. product may differ from the Egyptian one in route, release form (such as extended-release) or strength, so it is shown as a separate reference, not as this product\'s own label. Follow the local leaflet and ask a doctor or pharmacist.',monoRefCombo:'This U.S. label covers this ingredient alone; it does not cover the whole combination product. The Egyptian leaflet and a doctor or pharmacist are the reference for this product.',monoSrcLine:'U.S. FDA label · DailyMed',monoNote:'From the official U.S. FDA label for this ingredient, trimmed for length; the full label is on DailyMed. Not clinically reviewed. Egyptian products can differ, so follow the local leaflet and ask a doctor or pharmacist.',monoFullLabel:'Full label on DailyMed',monoUpdated:'label updated',railDisclaimer:'Educational information only. It does not replace diagnosis, professional advice, or a prescription.'},
    ar:{brandAria:'الصفحة الرئيسية لDrugcopeia',closeAria:'إغلاق',appBackAria:'الرجوع إلى الصفحة السابقة',searchPlaceholder:'ابحث عن دواء أو حالة مرضية',searchAria:'البحث عن الأدوية والحالات المرضية',conditionMatchesHeading:'الحالات المرضية المطابقة',conditionsListTitle:'الحالات المرضية',medicineMatches:'الأدوية المطابقة',imageSearchAria:'افتح صور عبوة هذا الدواء في نافذة المتصفح',viewInBrowser:'العرض في المتصفح',readingEyebrow:'الأخبار والمقالات',commonsTitle:'صور',commonsShow:'إظهار الصور',commonsHide:'إخفاء الصور',commonsLoading:'جارٍ تحميل الصور…',commonsEmpty:'لم تصل أي صورة من ويكيميديا كومونز لهذا الدواء.',commonsNoTerm:'لا يوجد اسم لهذا الدواء للبحث عنه.',commonsShownNote:'من ويكيميديا كومونز. اضغط على صورة لفتحها بالحجم الكامل.',commonsPreviewOnly:'لم يفتح الملف بالحجم الكامل. هذه المعاينة.',commonsGridAria:'صور من ويكيميديا كومونز',photoViewerAria:'صورة بالحجم الكامل',photoZoomHint:'قرّب بإصبعين للتكبير',readingTitle:'أخبار الأدوية والمقالات العلمية',readingIntro:'أخبار الأدوية اليومية من هيئة الدواء المصرية ووزارة الصحة وWHO وFDA وPubMed. اضغط على العنوان لفتح المقال كاملًا.',readingFiltersAria:'تصفية الأخبار والمقالات',readingTabAll:'الكل',readingTabNews:'أخبار الأدوية',readingTabArticles:'المقالات',readingRefresh:'تحديث الأخبار',readingDisclaimer:'معلومات تعليمية فقط. لا تغني عن نشرة الدواء ولا عن استشارة الطبيب أو الصيدلي.',readingSectionHint:'اضغط على عنوان لقراءة تفاصيله.',photosFailed:'تعذّر تحميل الصور. تحقق من اتصالك بالإنترنت.',noPackPhoto:'قاعدة البيانات المرفقة لا تحوي صورة لهذه العبوة. الأزرار بالأسفل تبحث عنها في الإنترنت.',offlineBrowserBlocked:'الوضع غير المتصل مفعّل. كل رابط يُفتح من الإنترنت، لذلك تظل الروابط مغلقة حتى تطفئ الوضع غير المتصل.',medicinesTab:'الأدوية',conditionsTab:'الحالات المرضية',browseByLetter:'تصفح الأدوية حسب الحرف الأول',browseDrugGroups:'تصفح مجموعات الأدوية',browseBodySystems:'تصفح حسب أجهزة الجسم',browseConditionTypes:'تصفح حسب نوع الحالة',browseConditionLetter:'تصفح الحالات حسب الحرف الأول',browseAll:'الكل',allBodySystems:'كل أجهزة الجسم',conditionSubgroups:'المجموعات الفرعية',back:'رجوع',appearanceTitle:'المظهر',themeLight:'الوضع الفاتح',themeDark:'الوضع الداكن',themeSystem:'حسب النظام',startsWith:'يبدأ بحرف',groupAntibiotics:'مضادات حيوية',groupAntivirals:'مضادات فيروسية',groupAntifungals:'مضادات فطريات',groupPain:'مسكنات ومضادات التهاب',groupAllergy:'أدوية الحساسية',groupCardio:'القلب وضغط الدم',groupDiabetes:'أدوية السكري',groupDigestive:'الجهاز الهضمي',groupRespiratory:'أدوية الجهاز التنفسي',groupHairCare:'العناية بالشعر',groupSkinCare:'العناية بالبشرة',groupPsychiatry:'الصحة النفسية والأعصاب',groupHormones:'الهرمونات والغدد الصماء',groupUrology:'المسالك والصحة الرجالية',groupEyeCare:'العناية بالعيون',groupEntCare:'الأنف والأذن والحنجرة',groupOncology:'أدوية الأورام',groupImmunology:'المناعة والأدوية البيولوجية',groupVaccines:'التطعيمات',groupHematology:'الدم والتجلط',groupGynecology:'صحة المرأة',groupSmokingCessation:'الإقلاع عن التدخين',groupWeightManagement:'إدارة الوزن',groupDental:'العناية بالفم والأسنان',groupSupplements:'المكملات الغذائية',bodyBlood:'الدم والقلب والدورة الدموية',bodyBones:'العظام والمفاصل والعضلات',bodyBrain:'الدماغ والأعصاب',bodyDigestive:'الجهاز الهضمي',bodyEnt:'الأذن والأنف والحنجرة',bodyEndocrine:'جهاز الغدد الصماء',bodyEyes:'العين والرؤية',bodyImmune:'الجهاز المناعي',bodyKidney:'الكلى والجهاز البولي',bodyLungs:'الرئتان والتنفس',bodyMouth:'الفم والأسنان',bodySkin:'الجلد والشعر والأظافر',bodyFemale:'الجهاز التناسلي الأنثوي',bodyMale:'الجهاز التناسلي الذكري',conditionAlphabetNote:'أسماء الحالات في قاعدة المصطلحات هذه باللغة الإنجليزية غالبًا.',conditionsEyebrow:'دليل الحالات الصحية',conditionsTitle:'تعرّف على الحالة الصحية',conditionsDescription:'ابحث في فهرس الحالات بالاسم أو حسب جهاز الجسم ثم افتح روابط المصادر.',conditionSearchPlaceholder:'ابحث عن حالة، مثل الربو',conditionSearchButton:'بحث',conditionPopular:'موضوعات شائعة',quickDiabetes:'السكري',quickAsthma:'الربو',quickBloodPressure:'ارتفاع ضغط الدم',quickMigraine:'الشقيقة',conditionSearchHint:'اختر موضوعًا شائعًا أو ابحث بالاسم.',conditionLoading:'جارٍ تحميل فهرس الأمراض المضمّن…',conditionError:'تعذر تحميل الموضوعات من البيانات المضمّنة. أعد تشغيل التطبيق وحاول مرة أخرى.',conditionNoResults:'لم نعثر على موضوع مطابق. جرّب كلمة أخرى.',conditionSummary:'نظرة عامة',conditionCare:'معلومات الرعاية والعلاج',conditionSource:'مصدر ClinicalTables',readMedlinePlus:'ابحث عن شرح في MedlinePlus',searchDrugsCom:'ابحث في Drugs.com',searchMedscape:'ابحث في Medscape',conditionsAttribution:'المصدر: MedlinePlus، المكتبة الوطنية الأمريكية للطب. فهرس الحالات من NLM ClinicalTables، مضمّن في التطبيق.',conditionDisclaimerTitle:'للتثقيف فقط',conditionDisclaimer:'العلاج يعتمد على التشخيص وحالة الشخص. لا تشخّص هذه الصفحة ولا تصف علاجًا.',brandSubtitle:'دليل الأدوية المصري',developerCredit:'تم التطوير بواسطة Dr. Hussein Elnagmy',developerTitle:'صيدلي إكلينيكي',versionLabel:'إصدار التطبيق',eyebrow:'معلومات دوائك بوضوح',heroTitle1:'اعثر على دوائك.',heroTitle2:'وافهمه بشكل أفضل.',heroDescription:'ابحث عن الأدوية المتاحة في مصر بالاسم التجاري أو المادة الفعالة أو الفئة الدوائية أو الشركة أو السعر.',heroMeta:'المادة الفعالة وآلية العمل والتفاصيل',directory:'دليل الأدوية',searchQuestion:'عمّ تبحث؟',searchPlaceholder:'ابحث عن دواء أو حالة مرضية',searchAria:'ابحث عن الأدوية والحالات المرضية',clearAria:'مسح البحث',searchButton:'ابحث',searchBy:'البحث حسب',searchDrugBy:'ابحث عن الدواء حسب',searchFieldAria:'اختر طريقة البحث',brandName:'الاسم التجاري',genericName:'الاسم العلمي / المادة الفعالة',drugGroupSearch:'الفئة / المجموعة الدوائية',manufacturer:'الشركة المنتجة',price:'السعر (جنيه)',suggestionsAria:'اقتراحات الأدوية',searchHint:'جرّب اسمًا تجاريًا أو مادة فعالة أو فئة دوائية أو شركة أو سعرًا',wildcardHint:'استخدم * أو مسافة بدلًا من الحروف التي لا تتذكرها',searchHintLang:'ابحث بالعربية أو الإنجليزية',showMore:'عرض المزيد',readMore:'اقرأ المزيد',readLess:'اقرأ أقل',noResults:'لم نعثر على أدوية',noResultsHint:'جرّب تهجئة أخرى أو اختر طريقة بحث مختلفة.',welcome:'ابحث لاستكشاف الأدوية في مصر',popularSearchesLabel:'الأكثر بحثاً',disclaimerTitle:'للمعرفة فقط، وليس للعلاج',disclaimerText:'لا تبدأ دواءً أو توقفه أو تغيّره دون استشارة مختص صحي مرخّص.',readSafety:'اقرأ تنبيه السلامة',aboutEyebrow:'عن Drugcopeia',aboutTitle1:'دليل محلي',aboutTitle2:'لمعلومة أوضح.',aboutText1:'كل الأدوية المتداولة في مصر في دليل واحد للبحث: الأسماء والمواد الفعالة والشركات وطرق الإعطاء والأسعار.',aboutText2:'البيانات مضمّنة في التطبيق وتتحدث بإصدار جديد فقط. اتبع دائمًا نشرة المنتج.',sourceLink:'عرض مصدر بيانات الأدوية',safetyTitle:'معلومات مهمة للسلامة',safetyText:'للتعليم فقط. لا تشخيص ولا علاج فردي. اقرأ النشرة واسأل طبيبًا أو صيدليًا.',footerText:'للمعرفة، وليس للتشخيص أو العلاج.',footerSource:'بيانات الأدوية: CC0 · مصدر GitHub',tabOverview:'نظرة عامة',tabUse:'الاستخدام والآثار الجانبية',tabSafety:'السلامة',modalDisclaimer:'معلومات تثقيفية فقط. راجع نشرة المنتج واستشر مختصًا صحيًا.',activeIngredient:'المادة الفعالة',route:'طريقة الإعطاء',listedPrice:'السعر المسجل',notListed:'غير مدرج',notAvailable:'غير متاح',medicine:'دواء',classificationMissing:'التصنيف غير مدرج',howWorks:'آلية العمل',pharmacology:'الحرائك والتأثير الدوائي',commonUse:'الاستخدام المعتاد',sideEffects:'آثار جانبية محتملة',howGiven:'طريقة الإعطاء',leafletAdvice:'للمعلومات الخاصة بالمنتج، راجع النشرة المعتمدة واستشر الصيدلي.',searchOfficialLabels:'ابحث في النشرات الدوائية الأمريكية',missingMonograph:'لا تتضمن قاعدة البيانات شرحًا دوائيًا موثقًا لهذا السجل.',noVerifiedMechanism:'لم يتم التحقق من آلية عمل خاصة بهذا الدواء، لذلك لا نعرض شرحًا سريريًا تخمينيًا.',routeOnly:'طريقة الإعطاء المسجلة في قاعدة البيانات هي',noInstructions:'لا توجد تعليمات موثقة لهذا المنتج. راجع النشرة واسأل صيدليًا.',safeUse:'راجع نشرة هذه العلامة بالذات واسأل مختصًا عن الحساسية والتداخلات والحمل.',suggestions:'اقتراحات',popularMedicines:'أدوية شائعة',popularConditions:'أشهر الأمراض',popularLabTests:'أشهر التحاليل',matches:'نتائج البحث عن',brandMatches:'اسم تجاري',genericMatches:'مادة فعالة',classMatches:'فئة دوائية',manufacturerMatches:'شركة',priceMatches:'سعر',match:'نتيجة',matchDual:'نتيجتان',matchesPlural:'نتائج',connectionRequired:'يلزم الاتصال بالإنترنت',updatedDataset:'قاعدة بيانات الأدوية المصرية',builtInDataset:'قاعدة بيانات مدمجة · مصر',builtInLoading:'جارٍ تحميل قاعدة الأدوية المدمجة…',indexed:'دواء في قاعدة البيانات',databaseUnavailable:'قاعدة البيانات غير متاحة',connectDatabase:'جارٍ تحميل قاعدة الأدوية المضمّنة',databaseError:'تعذر تحميل قاعدة بيانات الأدوية',databaseErrorHint:'أعد تشغيل التطبيق وحاول مرة أخرى.',databaseRetry:'إعادة المحاولة',sourceClassificationLead:'تصنف قاعدة البيانات هذا الدواء ضمن',classLimits:'لا يكفي التصنيف وحده لتأكيد آلية العمل أو الاستخدامات أو الآثار أو التحذيرات الخاصة بالمنتج.',ingredientNotAvailable:'المادة الفعالة غير مذكورة في قاعدة البيانات المصدر.',noVerifiedMonograph:'لم يتم التحقق من آلية عمل خاصة بهذا الدواء.',officialProductAdvice:'للمعلومات الخاصة بالمنتج، راجع النشرة المعتمدة واستشر الصيدلي.',routeInstruction:'هذه المعلومة تحدد طريقة الإعطاء أو الشكل الدوائي فقط، ولا تحدد جرعة أو مواعيد. اتبع النشرة والوصفة.',dosesNotIndividualized:'لا يحدد هذا الدليل جرعات فردية.',databaseRouteProduct:'يسجل المصدر هذا المنتج بالشكل التالي',popularLabel:'عمليات بحث شائعة',browseMedicinePrompt:'اختر مجموعة دوائية أو حرفًا للبدء.',browseMedicineHint:'تفتح المجموعات مجموعات فرعية ثم الأدوية، وتعرض الحروف الأسماء المطابقة.',navPrivacy:'الخصوصية',navAssistant:'AI',privacyEyebrow:'الخصوصية',privacyTitle:'بياناتك تبقى على هذا الجهاز',privacyLede:'بلا حساب ولا تحليلات ولا إعلانات. لا شيء مما تبحث عنه أو تحفظه يغادر جهازك.',privacyCollectTitle:'ما الذي نجمعه',privacyCollectValue:'لا شيء.',privacyCollect1:'لا أسماء ولا أرقام هواتف ولا أرقام قومية ولا بريد إلكتروني ولا بيانات مرضى.',privacyCollect2:'لا سجل بحث ولا سجل قراءة ولا محتوى تذكيرات يخرج من التطبيق.',privacyCollect3:'لا معرّف جهاز ولا موقع ولا جهات اتصال. الكاميرا والميكروفون يعملان عند الضغط على أزرارهما فقط.',privacyCollect4:'كل المعالجة على الجهاز. البحث الصوتي يستخدم خدمة الكلام في النظام، على الجهاز حيث يدعم ذلك.',privacyCollect5:'أرقام الهواتف والأرقام القومية والبريد الإلكتروني التي تكتبها تُزال قبل الاستخدام.',privacyDownloadsTitle:'ما الذي يمكن تنزيله',privacyDownloadsText:'بيانات الأدوية والحالات والتحاليل مضمّنة. شيئان فقط يتصلان بالإنترنت وعند الضغط عليهما: تحديث الأخبار وإظهار الصور (بحث بالاسم التجاري). بلا معرّفات أو تتبع.',privacyDownloadsNote:'كل طلب شبكي آخر محجوب داخل التطبيق. الروابط تُفتح في نافذة متصفح عند الضغط عليها فقط.',privacyLinksNote:'الروابط تُفتح في نافذة متصفح فوق الصفحة ولا يقرأ التطبيق منها شيئًا.',privacyLinksWhere:'على الهاتف يستخدم متصفح جهازك. على الحاسوب يفتح نافذته الخاصة وينساها عند إغلاقها.',privacyFeedbackNote:'الاقتراحات تُجهّز في التطبيق وتُرسل عبر تطبيق بريدك فقط عند الضغط على إرسال.',privacyHostWho:'عناوين من منظمة الصحة العالمية',privacyHostFda:'تقارير استدعاء أدوية من هيئة الغذاء والدواء الأمريكية',privacyHostNlm:'ملخصات علمية من المكتبة الوطنية الأمريكية للطب',privacyHostCommons:'صور العبوة، ويُستفسر عنها عند الضغط على «إظهار الصور» في صفحة الدواء. ترسل اسم المنتج فقط ولا شيء آخر.',privacyHostCommonsImage:'الصور المصغّرة التي تظهر في شبكة الصور، ولا تُجلب إلا بعد البحث أعلاه.',privacyHostCommonsFull:'الملف بالحجم الكامل الذي يفتح عند الضغط على إحدى تلك المعاينات.',privacyPermissionsTitle:'الأذونات وسببها',privacyPermNotify:'الإشعارات: لعرض التذكيرات التي أنشأتها في الوقت الذي اخترته.',privacyPermCamera:'الكاميرا: فقط لمسح كود العلبة أو إرفاق صورة بسؤال المساعد. الصور تُقرأ على الجهاز ولا تُحفظ ولا تُرفع.',privacyPermMic:'الميكروفون: فقط أثناء البحث الصوتي. الصوت لا يُحفظ.',privacyPermAlarm:'المنبهات وإعادة التشغيل (أندرويد): للحفاظ على دقة تذكيراتك واستعادتها بعد إعادة تشغيل الجهاز.',privacyPermInternet:'الإنترنت: فقط للأخبار والصور وروابط المصادر التي تفتحها. الدليل يعمل بالكامل بدونه.',privacyPermNone:'لا يُطلب أي إذن للموقع أو جهات الاتصال أو حالة الهاتف أو الملفات أو الإعلانات.',privacyLocalTitle:'البيانات على هذا الجهاز',privacyLocalText:'التذكيرات والأدوية المضافة والعناوين المحفوظة تبقى في تخزين التطبيق الخاص ولا تُرفع.',privacyWipe:'حذف كل البيانات المحلية',privacyWipeConfirm:'اضغط مرة أخرى لتأكيد الحذف',privacyWipeDone:'تم حذف البيانات المحلية. يجري إعادة تحميل التطبيق.',privacyWipeFail:'تعذّر حذف البيانات. أغلق التطبيق وحاول مرة أخرى.',privacyGuardNotice:'أُزيل رقم هاتف أو رقم قومي أو بريد إلكتروني. Drugcopeia لا يحتاج إلى بيانات شخصية.',privacyOfflineTitle:'وضع عدم الاتصال',privacyOfflineText:'متوقف افتراضيًا. فعّله لمنع كل طلبات الشبكة.',privacyOfflineOn:'وضع عدم الاتصال مفعّل',privacyOfflineOff:'وضع عدم الاتصال متوقف',privacyHistoryTitle:'المحادثات المحفوظة',privacyHistoryText:'المحادثات تُحفظ مشفّرة على الجهاز. أوقف الحفظ لمسحها.',privacyHistoryOn:'حفظ المحادثات مفعّل',privacyHistoryOff:'حفظ المحادثات مقفول',privacyHistoryListTitle:'المحادثات السابقة',privacyHistoryEmpty:'مفيش محادثات محفوظة لحد الآن. أي محادثة جديدة هتظهر هنا.',privacyHistoryUntitled:'محادثة',privacyHistoryMessages:'رسائل',privacyHistoryDelete:'حذف',privacyHistoryDeleteConfirm:'تأكيد',privacyHistoryDeleted:'اتمسحت المحادثة.',privacyHistoryDeleteFail:'المحادثة دي مش محفوظة خلاص.',privacyHistoryClear:'حذف كل المحادثات',privacyHistoryClearConfirm:'تأكيد حذف الكل',privacyHistoryCleared:'اتمسحت كل المحادثات.',privacyHistoryKept:'الحفظ مفعّل: المحادثات بتتخزن مشفّرة على الجهاز.',privacyHistoryErased:'الحفظ مقفول وكل المحفوظ اتمسح.',privacyHistoryOpened:'اتفتحت المحادثة.',privacyFoot:'دليل تعليمي وليس سجلًا طبيًا. لا تكتب بيانات مرضى.',skipToContent:'انتقل إلى المحتوى الرئيسي',primaryNavAria:'التنقل الرئيسي',quickNavAria:'تنقل سريع',workspaceLabel:'مساحة عمل سلامة الدواء',navSupportLabel:'الدعم',navHome:'الرئيسية',navMedicines:'الأدوية',navConditions:'الحالات',navTests:'التحاليل الطبية',navDoses:'الجرعات',navInteractions:'التداخلات',navAbout:'عن Drugcopeia',sidenavSafetyNote:'للعلم فقط. اسأل الصيدلي أو الطبيب.',safetyRailKicker:'مركز السلامة',safetyRailStatus:'تعليمي فقط',safetyRailTitle:'تنبيهات السلامة',railEmergencyTitle:'ليست للطوارئ',railEmergencyText:'في الأعراض الشديدة، اتصل برقم الطوارئ المحلي أو توجه إلى أقرب قسم طوارئ.',railQuickTitle:'فحوص سريعة',railInteractionsAction:'افحص دواءين',railInteractionsHint:'أزواج يجب تجنبها أو خطيرة أو متوسطة',railDoseAction:'مرجع جرعات الأطفال',railDoseHint:'نطاقات حسب الوزن من 2 كجم',railBeforeTitle:'قبل الاستخدام',railBefore1:'تحقق من المادة الفعالة والتركيز على العبوة.',railBefore2:'اسأل عن الحمل أو أمراض الكلى والكبد أو الأدوية الأخرى.',railBefore3:'تحقق من السعر والتوافر محليًا قبل الاعتماد عليهما.',monoMechanism:'آلية العمل (من النشرة)',monoIndications:'دواعي الاستعمال',monoDosage:'الجرعة وطريقة الاستعمال',monoInteractions:'التداخلات الدوائية',monoBoxed:'تحذير مهم',monoWarnings:'التحذيرات والاحتياطات',monoContra:'موانع الاستعمال',monoAdverse:'الأعراض الجانبية',monoPregnancy:'الحمل والرضاعة',monoUsLabel:'نشرة أمريكية',monoRefTitle:'مرجع أمريكي (نشرة FDA)',monoRefDiff:'قد يختلف هذا المنتج الأمريكي عن المستحضر المصري في طريقة الاستعمال أو الشكل الدوائي (مثل ممتد المفعول) أو التركيز، لذلك يُعرض كمرجع منفصل وليس كنشرة لهذا المنتج. اتبع النشرة المحلية واسأل الطبيب أو الصيدلي.',monoRefCombo:'هذه النشرة الأمريكية تخص هذا المكوّن وحده ولا تغطي المستحضر المركّب كاملًا. النشرة المصرية والطبيب أو الصيدلي هما المرجع لهذا المنتج.',monoSrcLine:'نشرة FDA الأمريكية · DailyMed',monoNote:'من نشرة FDA الأمريكية الرسمية لهذه المادة، مختصرة للعرض والنص الكامل على DailyMed. لم تُراجَع إكلينيكيًا وقد تختلف المنتجات المصرية؛ اتبع النشرة المحلية واسأل الطبيب أو الصيدلي.',monoFullLabel:'النشرة كاملة على DailyMed',monoUpdated:'تحديث النشرة',railDisclaimer:'معلومات تعليمية فقط. لا تغني عن التشخيص أو المشورة المتخصصة أو الوصفة الطبية.'}
  };

  const arabicClinical = [
    {keys:['PARACETAMOL','ACETAMINOPHEN'],mechanism:'يساعد الباراسيتامول على تخفيف الألم وخفض الحرارة، لكن آلية عمله الدقيقة ليست مفهومة بالكامل. ويُعتقد أنه يقلل إشارات الألم وتنظيم الحرارة المرتبطة بالبروستاغلاندينات، خاصة في الجهاز العصبي المركزي، مع تأثير مضاد للالتهاب أضعف من مضادات الالتهاب غير الستيرويدية.',pharmacology:'يُستقلب معظمه في الكبد إلى نواتج غير فعالة تُطرح في البول. ويتحول جزء صغير إلى ناتج تفاعلي يحيّده الجسم عادةً بالجلوتاثيون؛ أما الجرعة الزائدة فقد تتجاوز قدرة الحماية وتسبب أذى شديدًا للكبد.',uses:'يُستخدم غالبًا للألم الخفيف إلى المتوسط والحمّى. انتبه لوجوده في أدوية الزكام والمسكنات المركبة حتى لا تتكرر المادة الفعالة دون قصد.',effects:'عادةً ما يكون جيد التحمل عند اتباع تعليمات المنتج. قد يحدث غثيان أو طفح جلدي. ويمكن أن تسبب الجرعة الزائدة تلفًا خطيرًا بالكبد قبل ظهور الأعراض أحيانًا.',safety:'استشر مختصًا عند وجود مرض بالكبد أو سوء تغذية أو تناول الكحول بكثرة أو استخدام أدوية مركبة. الاشتباه بجرعة زائدة يستلزم مساعدة طبية عاجلة حتى إذا لم تظهر أعراض.'},
    {keys:['IBUPROFEN'],mechanism:'يثبط الإيبوبروفين إنزيمي الأكسدة الحلقية COX-1 وCOX-2 بشكل عكوس. وتُسهم هذه الإنزيمات في إنتاج البروستاغلاندينات المرتبطة بالألم والحمّى والالتهاب، كما تشارك في حماية بطانة المعدة وتدفق الدم إلى الكلى. يفسر خفض البروستاغلاندينات الفائدة العلاجية وبعض المخاطر أيضًا.',pharmacology:'هو مضاد التهاب غير ستيرويدي، وترتبط آثاره المسكنة والخافضة للحرارة والمضادة للالتهاب بتقليل تصنيع البروستاغلاندينات. يُستقلب في الكبد ويُطرح أساسًا عبر الكلى.',uses:'يُستخدم للألم والالتهاب والحمّى عند ملاءمته للحالة. اتبع نشرة المنتج؛ قد يقلل تناوله مع الطعام اضطراب المعدة، لكنه لا يزيل خطر القرحة أو النزف.',effects:'قد يسبب عسر هضم أو غثيانًا أو انزعاجًا بالمعدة. تشمل المخاطر الأشد قرحة أو نزفًا هضميًا وإصابة الكلى واحتباس السوائل وارتفاع ضغط الدم ومشكلات القلب والأوعية؛ ويتغير الخطر حسب الجرعة والمدة والحالة الصحية.',safety:'استشر مختصًا عند وجود قرحة سابقة أو مرض بالكلى أو القلب أو ارتفاع ضغط الدم أو ربو يتحفز بمضادات الالتهاب، أو عند تناول مميعات الدم أو الحمل. لا تجمعه مع مضاد التهاب آخر دون توجيه.'},
    {keys:['AMOXICILLIN+CLAVULANIC ACID','AMOXICILLIN CLAVULANIC ACID'],mechanism:'الأموكسيسيلين مضاد حيوي من عائلة البيتا-لاكتام؛ يرتبط ببروتينات ربط البنسلين ويعطل تشابك الببتيدوجليكان، فيضعف جدار الخلية البكتيرية. أما حمض كلافولانيك فيثبط بعض إنزيمات بيتا-لاكتاماز التي قد تكسر الأموكسيسيلين، فيحافظ على فعاليته ضد بعض البكتيريا الحساسة.',pharmacology:'يعمل المركب فقط ضد البكتيريا الحساسة له؛ ولا يجعل كلافولانات كل سلالة مقاومة قابلة للعلاج. لا يعالج أي من المكونين العدوى الفيروسية. يُطرح المكونان بدرجة كبيرة عبر الكلى وقد يرتفع تعرض الجسم للأموكسيسيلين عند ضعف وظائفها.',uses:'يصفه الطبيب لأنواع محددة من العدوى البكتيرية بعد التقييم. يعتمد المنتج والجدول والمدة على نوع العدوى والمريض. اتبع الوصفة كاملة ما لم يغيّرها الطبيب.',effects:'قد يحدث إسهال أو غثيان أو قيء أو طفح. وتشمل المشكلات الأقل شيوعًا الحساسية الفورية والتفاعلات الجلدية الشديدة والتهاب القولون المرتبط بالمضادات وإصابة الكبد.',safety:'لا تستخدمه دون استشارة إذا سبق حدوث حساسية شديدة للبنسلين أو السيفالوسبورين. أخبر الطبيب عن مشكلات الكلى أو الكبد أو اليرقان السابق بعد المضادات والأدوية الأخرى. اطلب رعاية عاجلة عند صعوبة التنفس أو تورم الوجه أو الإسهال الشديد المستمر.'},
    {keys:['AMOXICILLIN'],mechanism:'الأموكسيسيلين مضاد حيوي من عائلة البنسلين والبيتا-لاكتام. يرتبط ببروتينات ربط البنسلين ويثبط الخطوات النهائية لتشابك جدار الخلية البكتيرية. تفقد البكتيريا الحساسة القدرة على الحفاظ على جدارها أثناء النمو.',pharmacology:'تعتمد فعاليته على حساسية البكتيريا والتعرض المناسب أثناء العلاج. يُطرح أساسًا عبر الكلى. وقد تكسره إنزيمات بيتا-لاكتاماز لدى بعض البكتيريا؛ لذلك لا يصلح لكل أنواع العدوى.',uses:'يُستخدم لبعض أنواع العدوى البكتيرية بوصفة طبية، ولا يعالج البرد أو الإنفلونزا أو غيرهما من العدوى الفيروسية.',effects:'قد يسبب الإسهال أو الغثيان أو الطفح. قد تسبب الحساسية الشديدة شرىً أو تورمًا أو صفيرًا أو انهيارًا. يحتاج الإسهال الشديد أو المستمر إلى تقييم طبي.',safety:'أخبر الطبيب بأي تفاعل سابق مع البنسلين أو السيفالوسبورين وبوجود مرض كلوي. استخدمه فقط للعدوى والجدول الموصوفين، ولا تشارك المتبقي منه أو تحتفظ به لعلاج لاحق.'},
    {keys:['AZITHROMYCIN'],mechanism:'أزيثروميسين مضاد حيوي من الماكروليدات. يرتبط بالوحدة 50S من الريبوسوم البكتيري ويعطل تصنيع البروتين، ما يوقف نمو أنواع بكتيرية حساسة. وتتوقف الفعالية على نوع الجرثومة ومقاومتها.',pharmacology:'يتوزع بدرجة واسعة في الأنسجة ويبقى في الجسم مدة أطول من كثير من المضادات. لا يعني ذلك أنه مناسب للعلاج الذاتي؛ فالعدوى ومقاومة الجراثيم وحالة المريض عوامل تحدد ملاءمته.',uses:'يُوصف لبعض العدوى البكتيرية المحددة. لا يعالج نزلات البرد أو الإنفلونزا، ويجب استخدامه للتشخيص والجدول اللذين يحددهما الطبيب.',effects:'قد يحدث إسهال أو غثيان أو ألم بالبطن أو قيء. وتشمل المخاطر الأقل شيوعًا اضطراب نظم القلب وإصابة الكبد والحساسية الشديدة وتغيرات السمع.',safety:'أخبر الطبيب عن اضطراب النبض أو الإغماء أو مرض الكبد أو انخفاض البوتاسيوم أو المغنيسيوم والأدوية التي تؤثر في نظم القلب. اطلب رعاية عاجلة عند الإغماء أو الخفقان الشديد أو صعوبة التنفس أو اليرقان.'},
    {keys:['OMEPRAZOLE'],mechanism:'أوميبرازول مثبط لمضخة البروتون. ينشط داخل القنوات الإفرازية الحمضية لخلايا المعدة الجدارية، ثم يثبط مضخة البروتون H+/K+-ATPase، وهي الخطوة النهائية في إفراز الحمض.',pharmacology:'قد يستمر خفض الحمض بعد انخفاض الدواء في الدم لأن عودة نشاط المضخة تعتمد على تكوين مضخات جديدة. يُستقلب أساسًا بإنزيمات الكبد، وقد يؤثر في امتصاص أدوية تحتاج إلى حموضة المعدة.',uses:'يُستخدم لبعض الحالات المرتبطة بحمض المعدة مثل الارتجاع والقرحة. تختلف تعليمات المستحضرات؛ اتبع المنتج المحدد ولا تفترض أن استمرار الأعراض يُعالج ذاتيًا إلى أجل طويل.',effects:'قد يحدث صداع أو ألم بالبطن أو غثيان أو إسهال أو إمساك أو غازات. وقد يرتبط الاستخدام الطويل أو الجرعات العالية بمخاطر إضافية تستلزم مراجعة الطبيب.',safety:'اطلب تقييمًا عند صعوبة البلع أو قيء الدم أو البراز الأسود أو القيء المستمر أو نقص الوزن غير المفسر. راجع التداخلات، خصوصًا الأدوية التي قد يتأثر امتصاصها أو استقلابها.'},
    {keys:['CETIRIZINE'],mechanism:'سيتريزين مضاد انتقائي لمستقبلات الهيستامين H1 المحيطية من نوع الناهض العكسي. يقلل إشارات الهيستامين فيخفف الحكة والعطاس وسيلان الأنف والشرى. وصوله إلى الدماغ أقل عادةً من مضادات الحساسية الأقدم، لكن النعاس لا يزال ممكنًا.',pharmacology:'هو ناتج أيضي فعال للهيدروكسيزين، ويُطرح في البول دون تغيير بدرجة كبيرة. قد يؤدي ضعف وظائف الكلى إلى زيادة التعرض له، لذا تُتبع تعليمات المنتج أو توجيه المختص.',uses:'يُستخدم لتخفيف أعراض حساسية الأنف والشرى. يخفف الأعراض ولا يعالج سبب التحسس نفسه.',effects:'قد يسبب النعاس أو التعب أو جفاف الفم أو الصداع. وقد يشعر بعض الأشخاص بالنعاس رغم تصنيفه أقل تسببًا بالنعاس من أدوية أقدم.',safety:'تجنب الكحول والحذر عند القيادة إلى أن تعرف تأثيره عليك. استشر الصيدلي أو الطبيب قبل استعماله مع مرض الكلى أو المهدئات والأدوية التي تسبب النعاس.'},
    {keys:['LORATADINE'],mechanism:'لوراتادين مضاد طويل المفعول وانتقائي محيطي لمستقبلات الهيستامين H1 من نوع الناهض العكسي. يقلل الأعراض التحسسية المرتبطة بالهيستامين، وعادةً ما يسبب نعاسًا أقل من مضادات الحساسية الأقدم.',pharmacology:'يُمتص عن طريق الفم ويتحول في الكبد إلى ناتج فعال هو ديسلوراتادين. قد يغير مرض الكبد أو بعض التداخلات الدوائية مستوى التعرض له.',uses:'يُستخدم لأعراض حساسية الأنف والشرى. لا يمنع التفاعل التحسسي الشديد ولا يغني عن علاج الطوارئ.',effects:'قد يحدث صداع أو نعاس أو تعب أو جفاف بالفم، مع أن كثيرين لا يلاحظون آثارًا جانبية.',safety:'استشر الطبيب أو الصيدلي عند مرض الكبد أو تناول أدوية أخرى قد تتفاعل معه. تورم الحلق أو صعوبة التنفس أو علامات التأق تتطلب إسعافًا عاجلًا.'},
    {keys:['DICLOFENAC'],mechanism:'ديكلوفيناك مضاد التهاب غير ستيرويدي يثبط إنزيمي COX-1 وCOX-2، فيقلل إنتاج البروستاغلاندينات المشاركة في الألم والالتهاب. تختلف كمية الدواء التي تصل إلى الدم كثيرًا بين الأقراص والحقن والتحاميل والمستحضرات الموضعية.',pharmacology:'قد يؤثر ديكلوفيناك الجهازي في بطانة المعدة وتدفق الدم إلى الكلى وضغط الدم ومخاطر القلب والأوعية. وقد يقل التعرض الجهازي بالمستحضر الموضعي لكنه لا يختفي. الأشكال الدوائية لا تُستبدل جرعاتها ببعضها.',uses:'يُستخدم لحالات مختارة من الألم أو الالتهاب. اتبع تعليمات الشكل الدوائي نفسه، ولا تضع المستحضر الموضعي على جلد متضرر إلا إذا سمحت النشرة بذلك.',effects:'قد يحدث انزعاج بالمعدة أو غثيان أو دوار. وتشمل المخاطر الأشد النزف الهضمي ومشكلات الكلى أو الكبد واحتباس السوائل ومضاعفات القلب والأوعية.',safety:'استشر الطبيب عند وجود قرحة أو مرض بالقلب أو الكلى أو ارتفاع ضغط الدم أو استخدام مميعات الدم أو الحمل. لا تجمعه مع مضاد التهاب آخر إلا بتوجيه محدد.'},
    {keys:['METFORMIN'],mechanism:'يخفض ميتفورمين سكر الدم أساسًا عبر تقليل إنتاج الجلوكوز في الكبد وتحسين حساسية الأنسجة للإنسولين. ولا يحفز عادةً إفراز الإنسولين من البنكرياس، لذلك يكون خطر هبوط السكر منخفضًا عند استخدامه وحده.',pharmacology:'لا يُستقلب بدرجة تُذكر ويُطرح عن طريق الكلى دون تغيير. قد يؤدي ضعف الكلى أو المرض الشديد المصحوب بنقص الأكسجين أو الجفاف أو ضعف الدورة الدموية إلى تراكمه وزيادة خطر الحماض اللبني النادر.',uses:'يُستخدم للسكري من النوع الثاني ضمن خطة علاج أوسع. تختلف مستحضرات التحرر الفوري والممتد في طريقة الاستعمال؛ اتبع تعليمات العبوة المحددة.',effects:'الإسهال والغثيان وانزعاج البطن والطعم المعدني آثار شائعة خاصة عند بدء العلاج. وقد يقل فيتامين B12 مع الاستخدام الطويل. الحماض اللبني نادر لكنه خطير.',safety:'تحتاج وظائف الكلى إلى المتابعة. أخبر الطاقم الطبي بالجفاف الشديد أو العدوى الشديدة أو الجراحة أو التخطيط لتصوير بصبغة اليود. لا تغير علاج السكري دون استشارة.'},
    {keys:['ATORVASTATIN'],mechanism:'أتورفاستاتين مثبط تنافسي لإنزيم HMG-CoA reductase، وهو إنزيم محدد السرعة في تصنيع الكوليسترول بالكبد. يستجيب الكبد بزيادة مستقبلات LDL، ما يساعده على إزالة كمية أكبر من كوليسترول LDL من الدم.',pharmacology:'يخفض LDL والدهون الثلاثية وقد يرفع HDL بدرجة متواضعة. يستقلب بإنزيم CYP3A4؛ لذلك قد تزيد بعض الأدوية والجريب فروت من التعرض له ومخاطر العضلات.',uses:'يُستخدم لخفض الكوليسترول وتقليل خطر أمراض القلب والأوعية عندما يرى الطبيب الحاجة إليه. يكمل تغييرات نمط الحياة ولا يحل محلها.',effects:'قد يحدث ألم عضلي أو أعراض بالمفاصل أو اضطراب هضمي أو تغير في تحاليل الكبد. إصابة العضلات الشديدة أو الكبدية المهمة غير شائعة لكنها تستلزم الانتباه.',safety:'أخبر الطبيب عن ألم أو ضعف العضلات ومرض الكبد والحمل وجميع الأدوية والمكملات. يستلزم ألم العضلات الشديد مع بول داكن أو ضعف واضح تقييمًا عاجلًا.'},
    {keys:['SALBUTAMOL','ALBUTEROL'],mechanism:'سالبوتامول ناهض انتقائي لمستقبلات بيتا-2 الأدرينالية. يؤدي تنشيط هذه المستقبلات إلى زيادة AMP الحلقي داخل العضلات الملساء للشعب الهوائية، فيساعد على ارتخائها واتساع الممرات الهوائية.',pharmacology:'توصل المستحضرات المستنشقة الدواء إلى الرئتين؛ لذا تهم تقنية الاستنشاق ونوع الجهاز. يبدأ مفعوله عادةً سريعًا ويستمر مدة قصيرة. زيادة الحاجة إليه قد تدل على تدهور الربو وتحتاج مراجعة الخطة العلاجية.',uses:'يُستخدم لتخفيف التشنج القصبي سريعًا، وقد يُستخدم قبل التمرين ضمن بعض الخطط. لا يعالج التهاب الشعب الأساسي؛ اتبع خطة الربو وتعليمات جهاز الاستنشاق.',effects:'قد يسبب رعشة أو توترًا أو صداعًا أو تسارع ضربات القلب. وقد يؤدي التعرض العالي إلى انخفاض البوتاسيوم أو اضطراب النبض.',safety:'اطلب مساعدة عاجلة إذا ازداد ضيق التنفس أو لم يخف مع البخاخ كما هو متوقع. أخبر الطبيب بزيادة استخدام دواء الإنقاذ، ولا توقف علاج السيطرة دون استشارة.'}
  ];

  const clean = value => String(value ?? '').normalize('NFKC').replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[+/,;]+/g,' ').replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase();
  const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function buildWildcardQuery(query){
    const normalized=clean(query);if(!normalized)return null;
    const rawChunks=normalized.split(/[\s*]+/).filter(Boolean);if(!rawChunks.length)return null;
    const chunks=rawChunks.map(raw=>{
      const arabic=/[\u0600-\u06FF]/.test(raw),core=arabic&&raw.startsWith('ال')&&raw.length>3?raw.slice(2):raw;
      return {raw,core,source:arabic?`(?:ال)?${escapeRegex(core)}`:escapeRegex(raw)};
    });
    return {chunks,compact:chunks.map(chunk=>chunk.core).join(''),regex:new RegExp(chunks.map(chunk=>chunk.source).join('.*')),wildcard:/[*]/.test(String(query))||chunks.length>1};
  }
  function wildcardScore(parsed,hay){
    if(!parsed||!hay||!parsed.regex.test(hay))return -1;
    const compactHay=hay.replace(/\s+/g,''),first=parsed.chunks[0].core,index=hay.indexOf(first);let score=50;
    if(index===0)score+=24;else if(index>0)score+=/[\s.&+()\/,-]/.test(hay.charAt(index-1))?14:4;
    if(compactHay===parsed.compact)score+=100;else if(compactHay.startsWith(parsed.compact))score+=30;else if(compactHay.includes(parsed.compact))score+=12;
    score+=Math.max(0,18-Math.abs(compactHay.length-parsed.compact.length));
    return score;
  }
  function brandTexts(drug){
    let cached=brandTextCache.get(drug);if(cached)return cached;
    cached=[clean(val(drug,'commercial_name_en')),clean(val(drug,'commercial_name_ar'))];
    brandTextCache.set(drug,cached);return cached;
  }
  function drugFieldScore(drug,field,parsed){
    if(field==='brand'){const [en,ar]=brandTexts(drug);return Math.max(wildcardScore(parsed,en),wildcardScore(parsed,ar))}
    if(field==='class'){const strong=wildcardScore(parsed,classStrongText(drug));if(strong>=0)return strong+40;return wildcardScore(parsed,classSearchText(drug))}
    return wildcardScore(parsed,fieldText(drug,field));
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const val = (drug,...keys) => keys.map(k=>drug?.[k]).find(v=>v!==undefined&&v!==null&&String(v).trim()!=='') ?? '';
  const conditionUi={en:{conditionDetailLabel:'HEALTH CONDITION',conditionSuggestLoading:'Searching conditions…',conditionSuggestEmpty:'No matching conditions',conditionInfoLoading:'Loading health information…',conditionInfoUnavailable:'A detailed summary is not available for this topic right now. Use the official source link below.',conditionOverview:'Overview',conditionSymptoms:'Symptoms and signs',conditionDiagnosis:'Diagnosis and tests',conditionTreatment:'Treatment and care',conditionClinicalSummary:'MedlinePlus health topic summary',conditionMedlineSource:'Open MedlinePlus topic',conditionInlineSummary:'MedlinePlus summary',conditionSummaryLoading:'Loading summary…',conditionSummaryUnavailable:'No summary available for this condition.',conditionDetailDisclaimer:'This general information is educational. It cannot confirm a diagnosis or replace care from a qualified clinician.',conditionNoSummary:'MedlinePlus did not return a topic summary for this condition.',conditionSourceScope:'Summary from MedlinePlus. Open the source for full details.',wikiConditionTitle:'Condition overview',wikiConditionLoading:'Loading condition overview…',wikiConditionMissing:'No matching reference article was found for this condition.',wikiOverview:'Overview and background',wikiSymptoms:'Symptoms and signs',wikiDiagnosis:'Diagnosis',wikiTreatment:'Treatment and management',wikiCauses:'Causes and risk factors',wikiComplications:'Complications',wikiPrevention:'Prevention',wikiPrognosis:'Outlook and prognosis',wikiSectionMissing:'This section is not covered in the linked reference article.',wikiMedicalNote:'From a general encyclopedia. May be incomplete. Verify with a clinician.',conditionBrowseHint:'Choose a body system or a letter to browse conditions.',wikiRiskFactors:'Risk factors',wikiTypes:'Types and classification',conditionImagesTitle:'Illustrative images',conditionImagesLoading:'Loading illustrative images…',conditionImagesEmpty:'No illustrative images were found for this condition.',conditionImagesNote:'Illustrative images from open sources.',offlineConditionNote:'Summary from the built-in MedlinePlus database (English).'},ar:{conditionDetailLabel:'حالة صحية',conditionSuggestLoading:'جارٍ البحث عن الحالات…',conditionSuggestEmpty:'لا توجد حالات مطابقة',conditionInfoLoading:'جارٍ تحميل المعلومات الصحية…',conditionInfoUnavailable:'لا يتوفر شرح مفصل لهذه الحالة الآن. استخدم رابط المصدر الطبي الرسمي أدناه.',conditionOverview:'نظرة عامة',conditionSymptoms:'الأعراض والعلامات',conditionDiagnosis:'التشخيص والفحوصات',conditionTreatment:'العلاج والرعاية',conditionClinicalSummary:'ملخص الحالة من MedlinePlus',conditionMedlineSource:'فتح صفحة الحالة في MedlinePlus',conditionInlineSummary:'ملخص MedlinePlus',conditionSummaryLoading:'جارٍ تحميل الملخص…',conditionSummaryUnavailable:'لا يتوفر ملخص لهذه الحالة.',conditionDetailDisclaimer:'هذه المعلومات عامة وتثقيفية، ولا تؤكد التشخيص أو تحل محل رعاية مختص صحي مؤهل.',conditionNoSummary:'لم يُرجع MedlinePlus ملخصًا لهذه الحالة.',conditionSourceScope:'ملخص من MedlinePlus. افتح المصدر للتفاصيل الكاملة.',wikiConditionTitle:'ملخص الحالة',wikiConditionLoading:'جارٍ تحميل ملخص الحالة…',wikiConditionMissing:'لم يُعثر على مقالة مرجعية مطابقة لهذه الحالة.',wikiOverview:'نظرة عامة وخلفية',wikiSymptoms:'الأعراض والعلامات',wikiDiagnosis:'التشخيص',wikiTreatment:'العلاج والتدبير',wikiCauses:'الأسباب وعوامل الخطورة',wikiComplications:'المضاعفات',wikiPrevention:'الوقاية',wikiPrognosis:'المآل والتوقعات',wikiSectionMissing:'لا تتناول المقالة المرجعية المرتبطة هذا القسم.',wikiMedicalNote:'من موسوعة عامة وقد تكون ناقصة. تحقق مع مختص.',conditionBrowseHint:'اختر جهازًا من أجهزة الجسم أو حرفًا لعرض الحالات.',wikiRiskFactors:'عوامل الخطورة',wikiTypes:'الأنواع والتصنيف',conditionImagesTitle:'صور توضيحية',conditionImagesLoading:'جارٍ تحميل الصور التوضيحية…',conditionImagesEmpty:'لم نعثر على صور توضيحية لهذه الحالة.',conditionImagesNote:'صور توضيحية من مصادر مفتوحة.',offlineConditionNote:'ملخص من قاعدة MedlinePlus المدمجة (بالإنجليزية).'}};
  const drawerUi={en:{drawerNavAria:'All pages',drawerSafetyNote:'For information only. Ask a healthcare professional.',menuCloseAria:'Close menu',navAria:'Navigation',aboutDrawer:'About Drugcopeia',suggestionsMenu:'Feedback',suggestionsEyebrow:'APP FEEDBACK',suggestionsTitle:'Share feedback',suggestionsDescription:'Tell us what could make Drugcopeia more useful or report a problem.',suggestionRequired:'Add a subject and a message.',suggestionSubjectLabel:'Subject',suggestionMessageLabel:'Feedback',suggestionSubmit:'Send',suggestionEmailNote:'Your email app opens with the message ready. Press Send there to deliver it.',suggestionFallbackNote:'If your email app did not open, copy the message details below into it.',suggestionRecipientLabel:'Send to',suggestionCopy:'Copy message',suggestionCopied:'Message copied. Paste it into your email app.',suggestionCopyFailed:'Could not copy automatically. Select and copy the message above.',suggestionOpenGmail:'Open Gmail'},ar:{drawerNavAria:'كل الصفحات',drawerSafetyNote:'للتوعية فقط، واستشر مختصًا صحيًا.',menuCloseAria:'إغلاق القائمة',navAria:'التنقل',aboutDrawer:'عن Drugcopeia',suggestionsMenu:'المقترحات',suggestionsEyebrow:'مقترحات التطبيق',suggestionsTitle:'شاركنا اقتراحك',suggestionsDescription:'أخبرنا كيف يمكننا تحسين Drugcopeia.',suggestionRequired:'أضف موضوعًا ونصًا للاقتراح.',suggestionSubjectLabel:'عنوان الموضوع',suggestionMessageLabel:'محتوى الاقتراح',suggestionSubmit:'إرسال',suggestionEmailNote:'سيُفتح تطبيق البريد برسالة جاهزة. اضغط إرسال هناك لإيصالها.',suggestionFallbackNote:'إذا لم يفتح تطبيق البريد، انسخ تفاصيل الرسالة بالأسفل إليه.',suggestionRecipientLabel:'إرسال إلى',suggestionCopy:'نسخ الرسالة',suggestionCopied:'تم نسخ الرسالة. ألصقها في تطبيق البريد.',suggestionCopyFailed:'تعذر النسخ تلقائيًا. حدد الرسالة أعلاه وانسخها.',suggestionOpenGmail:'فتح Gmail'}};
  const labUi={en:{labMenu:'Medical tests',labTestsEyebrow:'LABORATORY TEST DIRECTORY',labTestsTitle:'Medical tests',labTestsIntro:'Browse tests by clinical specialty.',labSearchLabel:'Search tests',labSearchPlaceholder:'Search a test, e.g. CBC',labSearchClear:'Clear',labSpecialtyHeading:'Browse tests by clinical specialty',labGroupHeading:'Test groups',labTestHeading:'Tests in this group',labSearchHeading:'Matching tests',labTestCount:'tests',labPurposeHeading:'Browse by test purpose',labSampleHeading:'Browse by sample type',labWhatMeasures:'What it measures and what it is used for',labResults:'What results may mean',labMethod:'How it is performed',labPreparation:'Preparation and conditions',labSource:'Read the MedlinePlus guide',labDisclaimerTitle:'Educational information',labDisclaimer:'Results and reference ranges vary by laboratory and clinical context. This guide does not diagnose disease; follow the ordering clinician’s instructions, especially for preparation and medication changes.',labNoResults:'No matching tests found.'},ar:{labMenu:'التحاليل الطبية',labTestsEyebrow:'دليل التحاليل الطبية',labTestsTitle:'التحاليل الطبية',labTestsIntro:'تصفح التحاليل حسب التخصص.',labSearchLabel:'ابحث في التحاليل',labSearchPlaceholder:'ابحث عن تحليل، مثل CBC',labSearchClear:'مسح',labSpecialtyHeading:'تصفح التحاليل حسب التخصصات الإكلينيكية',labGroupHeading:'المجموعات الفرعية',labTestHeading:'تحاليل هذه المجموعة',labSearchHeading:'التحاليل المطابقة',labTestCount:'تحاليل',labPurposeHeading:'تصفح حسب الغرض من التحليل',labSampleHeading:'تصفح حسب نوع العينة',labWhatMeasures:'ما التحليل وما وظيفته؟',labResults:'ماذا قد تعني النتائج؟',labMethod:'كيف يُجرى؟',labPreparation:'شروط التحضير والإجراء',labSource:'اقرأ دليل MedlinePlus الطبي',labDisclaimerTitle:'معلومات تثقيفية',labDisclaimer:'تختلف النتائج والمجالات المرجعية بين المختبرات وبحسب الحالة. لا يشخّص هذا الدليل الأمراض؛ اتبع تعليمات الطبيب، خاصةً للتحضير وتغيير الأدوية.',labNoResults:'لم نعثر على تحاليل مطابقة.'}};
  Object.assign(labUi.en,{labReference:'Reference values (examples)',labCritical:'Critical / panic values',labValueDisclaimer:'Adult examples from published references; your laboratory’s interval and alert limits take priority.',labValueSource:'Value source',labGuideNote:'',labGuideCredit:'Source: MedlinePlus, National Library of Medicine. Full guide reproduced in English. Tap a heading to open its paragraph.',labWikiOverview:'Overview',labWikiPurpose:'Purpose and uses',labWikiProcedure:'Procedure',labWikiPreparation:'Preparation',labWikiResults:'Results and interpretation',labWikiRisks:'Risks and considerations',labWikiLimitations:'Limitations and accuracy',labBrowseLetter:'Browse tests by first letter',labLetterNote:'Letters follow the English test name.',labLetterHeading:'Tests starting with',labLetterEmpty:'No tests in this directory start with this letter.',labImagesTitle:'Illustrative images',labImagesLoading:'Loading illustrative images…',labImagesEmpty:'No illustrative images were found for this test.',labImagesNote:'Illustrative images from open sources.',sourceTestingCom:'Testing.com'});
  Object.assign(labUi.ar,{labReference:'القيم المرجعية (أمثلة)',labCritical:'القيم الحرجة / قيم التنبيه',labValueDisclaimer:'أمثلة للبالغين من مراجع منشورة؛ مجال مختبرك وحدود التنبيه لديه هي المعتمدة.',labValueSource:'مصدر القيم',labGuideNote:'الدليل الكامل من MedlinePlus بالإنجليزية. اضغط على أي عنوان لفتحه.',labGuideCredit:'المصدر: MedlinePlus، المكتبة الوطنية الأمريكية للطب. الدليل الكامل مُعاد إنتاجه بالإنجليزية. الأقسام تُفتح بالضغط على عنوانها.',labWikiOverview:'نظرة عامة',labWikiPurpose:'الغرض والاستخدامات',labWikiProcedure:'طريقة الإجراء',labWikiPreparation:'التحضير',labWikiResults:'النتائج والتفسير',labWikiRisks:'المخاطر والاعتبارات',labWikiLimitations:'القيود والدقة',labBrowseLetter:'تصفح التحاليل حسب الحرف الأول',labLetterNote:'تتبع الحروف الاسم الإنجليزي للتحليل.',labLetterHeading:'تحاليل تبدأ بحرف',labLetterEmpty:'لا توجد تحاليل في هذا الدليل تبدأ بهذا الحرف.',labImagesTitle:'صور توضيحية',labImagesLoading:'جارٍ تحميل الصور التوضيحية…',labImagesEmpty:'لم نعثر على صور توضيحية لهذا التحليل.',labImagesNote:'صور توضيحية من مصادر مفتوحة.',sourceTestingCom:'Testing.com'});
  const detailUi={en:{unifiedSearchPlaceholder:'Search medicines, conditions, tests',medicineSearchPlaceholder:'Search by brand, ingredient, drug group, or price',unifiedSearchAria:'Search medicines, health conditions and medical tests',medicineSearchAria:'Search medicines by brand, ingredient, drug group, manufacturer, or price',unifiedSearchHeading:'What are you looking for?',medicineSearchHeading:'Search medicines',unifiedKicker:'SEARCH DRUGCOPEIA',medicineKicker:'MEDICINE DIRECTORY',unifiedSearchHint:'Try a medicine, condition, test name, or abbreviation',medicineSearchHint:'Try a brand, ingredient, drug group, manufacturer, or price',unifiedScopeHint:'Medicines · Conditions · Medical tests',medicineScopeHint:'Search in English or Arabic',noUnifiedResults:'No matches found',noUnifiedResultsHint:'Try a medicine, condition, test name, or test abbreviation.',labMatchesHeading:'Matching medical tests',labSuggestionLabel:'Medical tests',labOpenTest:'Open test',labSpecialtyLabel:'Specialty',labGroupLabel:'Group',labWikiTitle:'Encyclopedia overview',labWikiLoading:'Loading encyclopedia information…',labWikiMissing:'No matching reference article was found for this test. Use the MedlinePlus guide for a detailed explanation.',labWikiNote:'From a general encyclopedia. May be incomplete. Ask your clinician to interpret results.',labOfficialSources:'Official and reference sources',labWikiSource:'Reference article',wikiDrugTitle:'Encyclopedia',wikiDrugOverview:'Overview',wikiDrugUseSection:'Uses and side effects',wikiDrugSafetySection:'Safety, interactions and warnings',wikiDrugLoading:'Loading encyclopedia sections…',wikiDrugMissing:'No matching reference article was found for this medicine.',wikiDrugNote:'From a general encyclopedia. May be incomplete. Verify with a clinician.',wikiDrugMechanism:'Mechanism and pharmacology',wikiDrugUses:'Medical uses',wikiDrugSideEffects:'Side effects',wikiDrugSafety:'Cautions and contraindications',wikiDrugInteractions:'Interactions',wikiDrugPharmacokinetics:'Pharmacokinetics',wikiDrugArticleNote:'From the linked reference article. Verify details with a clinician.',wikiDrugArticleLink:'Read the full reference article',officialSourcesTitle:'Official and trusted sources',sourceDailyMed:'DailyMed · official labels',sourceMedlineDrug:'MedlinePlus · medicine information',sourceEma:'EMA · European medicines',sourceEda:'EDA · Egyptian Drug Authority',sourceWho:'WHO',sourceCdc:'CDC',sourceNhs:'NHS',sourcesHeading:'Sources and further reading',homeMenu:'Home',homeMenuHint:'Search medicines, conditions and tests',relatedSimilarButton:'Similar',relatedSimilarHint:'Same active ingredient',relatedAlternativesButton:'Alternatives',relatedAlternativesHint:'Same class, different ingredient',relatedSimilarKicker:'SAME ACTIVE INGREDIENT',relatedAlternativesKicker:'SAME CLASS · DIFFERENT INGREDIENT',relatedAlternativesClassKicker:'SAME CLASS',relatedSimilarTitle:'Similar medicines',relatedAlternativesTitle:'Alternatives',relatedSimilarIntro:'Products in this database that list {ingredient} as their active ingredient.',relatedAlternativesIntro:'Other medicines in the same classification with a different active ingredient. Their uses, strengths, and risks may differ.',relatedAlternativesUnverifiedIntro:'Same classification. No active ingredient is listed, so differences cannot be verified.',relatedRootIntro:'No other medicine was listed in the exact same classification, so this shows the broader {group} group.',relatedComparedWith:'Compared with {name}',relatedSimilarNote:'Same ingredient may differ in strength or form. Ask a professional before switching.',relatedAlternativesNote:'Same class does not mean interchangeable. Ask a pharmacist before switching.',relatedRootNote:'This broader group includes different active ingredients and is not a substitute recommendation.',relatedFilterLabel:'Filter this list',relatedFilterPlaceholder:'Filter by name or ingredient',relatedPriceSortLabel:'Price',relatedPriceSortAria:'Order results by price',relatedPriceSortDefault:'Default order',relatedPriceSortHigh:'Highest price first',relatedPriceSortLow:'Lowest price first',relatedShowing:'Showing {shown} of {total}',relatedShowingFiltered:'Showing {shown} of {total} matching',relatedNoMatches:'No medicines match this filter.',relatedEmpty:'No related medicines are listed for this product.',relatedBackAria:'Back to medicine',relatedDisclaimer:'This comparison is drawn from the listed database fields. It is not a recommendation to switch, substitute, or combine medicines. Confirm the exact product and active ingredient with a pharmacist or prescriber.',relatedSimilarEmpty:'No other medicine with the same active ingredient is listed.',relatedAlternativesEmpty:'No other medicine in this class is listed.',wikiDrugDosage:'Dosage and administration',wikiDrugHistory:'History and development',groupHowItWorks:'How it works',groupEffect:'Pharmacological effect',groupWikiLoading:'Loading encyclopedia information about this group…',groupWikiTitle:'Encyclopedia',groupWikiMissing:'No matching reference article was found for this group. Use the trusted sources below.',groupSourcesTitle:'Trusted sources for this group',groupInfoNote:'This is a class-level overview; effects and risks vary by active ingredient and formulation. Check the product leaflet.'},
  ar:{unifiedSearchPlaceholder:'ابحث عن دواء أو مرض أو تحليل',medicineSearchPlaceholder:'ابحث بالاسم التجاري أو المادة أو الفئة الدوائية أو السعر',unifiedSearchAria:'البحث عن الأدوية والحالات المرضية والتحاليل الطبية',medicineSearchAria:'البحث عن الأدوية بالاسم أو المادة الفعالة أو الفئة الدوائية أو الشركة أو السعر',unifiedSearchHeading:'عمّ تبحث؟',medicineSearchHeading:'ابحث عن دواء',unifiedKicker:'ابحث في Drugcopeia',medicineKicker:'دليل الأدوية',unifiedSearchHint:'جرّب اسم دواء أو حالة مرضية أو تحليلًا أو اختصاره',medicineSearchHint:'جرّب اسمًا تجاريًا أو مادة فعالة أو فئة دوائية أو شركة أو سعرًا',unifiedScopeHint:'أدوية · حالات مرضية · تحاليل طبية',medicineScopeHint:'ابحث بالعربية أو الإنجليزية',noUnifiedResults:'لا توجد نتائج مطابقة',noUnifiedResultsHint:'جرّب اسم دواء أو حالة مرضية أو اسم تحليل أو اختصاره.',labMatchesHeading:'التحاليل الطبية المطابقة',labSuggestionLabel:'التحاليل الطبية',labOpenTest:'فتح التحليل',labSpecialtyLabel:'التخصص',labGroupLabel:'المجموعة',labWikiTitle:'نظرة موسوعية',labWikiLoading:'جارٍ تحميل معلومات الموسوعة…',labWikiMissing:'لم يُعثر على مقالة مرجعية مطابقة لهذا التحليل. راجع دليل MedlinePlus للحصول على شرح مفصل.',labWikiNote:'من موسوعة عامة وقد تكون ناقصة. اسأل طبيبك عن تفسير النتائج.',labOfficialSources:'المصادر الرسمية والمرجعية',labWikiSource:'مقالة مرجعية',wikiDrugTitle:'الموسوعة',wikiDrugOverview:'نظرة عامة',wikiDrugUseSection:'الاستخدامات والآثار الجانبية',wikiDrugSafetySection:'السلامة والتداخلات والتحذيرات',wikiDrugLoading:'جارٍ تحميل أقسام الموسوعة…',wikiDrugMissing:'لم يُعثر على مقالة مرجعية مطابقة لهذا الدواء.',wikiDrugNote:'من موسوعة عامة وقد تكون ناقصة. تحقق مع مختص.',wikiDrugMechanism:'آلية العمل والفارماكولوجيا',wikiDrugUses:'الاستخدامات الطبية',wikiDrugSideEffects:'الآثار الجانبية',wikiDrugSafety:'التحذيرات وموانع الاستخدام',wikiDrugInteractions:'التداخلات الدوائية',wikiDrugPharmacokinetics:'الحرائك الدوائية',wikiDrugArticleNote:'من المقالة المرجعية المرتبطة. تحقق منها مع مختص.',wikiDrugArticleLink:'اقرأ المقالة المرجعية كاملة',officialSourcesTitle:'مصادر رسمية وموثوقة',sourceDailyMed:'DailyMed · النشرات الرسمية',sourceMedlineDrug:'MedlinePlus · معلومات الأدوية',sourceEma:'EMA · الأدوية الأوروبية',sourceEda:'هيئة الدواء المصرية',sourceWho:'منظمة الصحة العالمية',sourceCdc:'CDC',sourceNhs:'NHS',sourcesHeading:'المصادر وقراءات إضافية',homeMenu:'الصفحة الرئيسية',homeMenuHint:'ابحث عن الأدوية والحالات والتحاليل',relatedSimilarButton:'المثايل',relatedSimilarHint:'نفس المادة الفعالة',relatedAlternativesButton:'البدائل',relatedAlternativesHint:'نفس التصنيف بمادة مختلفة',relatedSimilarKicker:'نفس المادة الفعالة',relatedAlternativesKicker:'نفس التصنيف · مادة فعالة مختلفة',relatedAlternativesClassKicker:'نفس التصنيف',relatedSimilarTitle:'الأدوية المثايلة',relatedAlternativesTitle:'البدائل',relatedSimilarIntro:'أدوية مسجلة في قاعدة البيانات وتحتوي على المادة الفعالة نفسها: {ingredient}.',relatedAlternativesIntro:'أدوية أخرى في التصنيف نفسه بمادة فعالة مختلفة. قد تختلف استخداماتها وتركيزاتها ومخاطرها.',relatedAlternativesUnverifiedIntro:'نفس التصنيف. لا توجد مادة فعالة مسجلة فلا يمكن التحقق من الفروق.',relatedRootIntro:'لم تُسجل بدائل أخرى في التصنيف الدقيق نفسه، لذلك تعرض القائمة المجموعة الأوسع: {group}.',relatedComparedWith:'مقارنة مع {name}',relatedSimilarNote:'نفس المادة قد تختلف في التركيز أو الشكل. اسأل مختصًا قبل التبديل.',relatedAlternativesNote:'نفس التصنيف لا يعني بديلًا متكافئًا. اسأل الصيدلي قبل التبديل.',relatedRootNote:'تظهر هذه المجموعة الأوسع لعدم توفر بدائل أقرب في البيانات. وهي تشمل مواد فعالة مختلفة وليست توصية بالاستبدال.',relatedFilterLabel:'تصفية القائمة',relatedFilterPlaceholder:'صفِّ بالاسم أو المادة الفعالة',relatedPriceSortLabel:'السعر',relatedPriceSortAria:'ترتيب النتائج حسب السعر',relatedPriceSortDefault:'الترتيب الافتراضي',relatedPriceSortHigh:'الأعلى سعرًا أولًا',relatedPriceSortLow:'الأرخص أولًا',relatedShowing:'عرض {shown} من {total}',relatedShowingFiltered:'عرض {shown} من {total} مطابق',relatedNoMatches:'لا توجد أدوية مطابقة لهذه التصفية.',relatedEmpty:'لا توجد أدوية مرتبطة مسجلة لهذا المنتج.',relatedBackAria:'العودة إلى الدواء',relatedDisclaimer:'هذه المقارنة مبنية على حقول قاعدة البيانات المسجلة، وليست توصية بالتبديل أو الاستبدال أو الجمع بين الأدوية. تحقق من المنتج والمادة الفعالة بدقة مع الصيدلي أو الطبيب.',relatedSimilarEmpty:'لا يوجد دواء آخر مسجل بالمادة الفعالة نفسها.',relatedAlternativesEmpty:'لا يوجد دواء آخر مسجل في هذا التصنيف.',wikiDrugDosage:'الجرعات وطريقة الإعطاء',wikiDrugHistory:'التاريخ والتطوير',groupHowItWorks:'آلية العمل',groupEffect:'التأثير الدوائي',groupWikiLoading:'جارٍ تحميل معلومات موسوعية عن هذه المجموعة…',groupWikiTitle:'الموسوعة',groupWikiMissing:'لم يُعثر على مقالة مرجعية مطابقة لهذه المجموعة. استخدم المصادر الموثوقة أدناه.',groupSourcesTitle:'مصادر موثوقة لهذه المجموعة',groupInfoNote:'هذا شرح عام للفئة؛ تختلف التأثيرات والمخاطر حسب المادة الفعالة والتركيبة. راجع نشرة المنتج.'}};
  const addMedicineUi={en:{addMedicineButton:'New medicine',addMedicineButtonAria:'Add a new medicine',addMedicineEyebrow:'CONTRIBUTE TO THE DIRECTORY',addMedicineTitle:'Add a new medicine',addMedicineIntro:'Add a missing medicine. It is saved on this device and prepared as an email to the suggestions address.',addMedicineNameLabel:'Full commercial name',addMedicineNamePlaceholder:'Example: Panadol Extra 24 F.C. Tablets',addMedicineIngredientLabel:'Active ingredient',addMedicineIngredientPlaceholder:'Example: Paracetamol + caffeine',addMedicineConcentrationLabel:'Concentration',addMedicineConcentrationPlaceholder:'Example: 500 mg + 65 mg',addMedicinePriceLabel:'Price (EGP)',addMedicinePricePlaceholder:'Example: 54',addMedicineUnitsLabel:'Package units',addMedicineUnitsPlaceholder:'Example: 2 strips (24 tablets)',addMedicineSubmit:'Send',addMedicineEmailNote:'Saved on this device now. Press Send in your email app to deliver it.',addMedicineFallbackNote:'If your email app did not open, copy the prepared message into it.',addMedicineStorageNote:'The entry is stored in this browser only. The prepared email lets the app owner review it for the shared directory.',addMedicineSafetyNote:'Not verified by the app. Confirm details with a pharmacist or the leaflet.',addMedicineSaved:'{name} was added to the medicine database on this device and can now be found in search.',addMedicineSaveFailed:'The medicine was added for this session only because it could not be saved on this device.',addMedicineEvicted:'The oldest locally added medicine was removed to make room for this one.',addMedicineLocalDb:'Local records',addMedicineRequired:'Fill in all fields with a valid price before submitting.',addMedicineTag:'Added by user',customMedicineNote:'Added by a user and not verified. Confirm details with a pharmacist or the leaflet.',addMedicineEmailIntro:'New medicine submission from Drugcopeia',addMedicineEmailName:'Full commercial name',addMedicineEmailIngredient:'Active ingredient',addMedicineEmailConcentration:'Concentration',addMedicineEmailPrice:'Price (EGP)',addMedicineEmailUnits:'Package units'},ar:{addMedicineButton:'دواء جديد',addMedicineButtonAria:'إضافة دواء جديد',addMedicineEyebrow:'شارك في إثراء الدليل',addMedicineTitle:'إضافة دواء جديد',addMedicineIntro:'أضف دواءً ناقصًا. يُحفظ على جهازك ويُجهّز كرسالة بريد لعنوان المقترحات.',addMedicineNameLabel:'الاسم التجاري الكامل',addMedicineNamePlaceholder:'مثال: بانادول إكسترا 24 قرصًا',addMedicineIngredientLabel:'المادة الفعالة',addMedicineIngredientPlaceholder:'مثال: باراسيتامول + كافيين',addMedicineConcentrationLabel:'التركيز',addMedicineConcentrationPlaceholder:'مثال: 500 مجم + 65 مجم',addMedicinePriceLabel:'السعر (ج.م)',addMedicinePricePlaceholder:'مثال: 54',addMedicineUnitsLabel:'الوحدات',addMedicineUnitsPlaceholder:'مثال: 2 شريط (24 قرصًا)',addMedicineSubmit:'إرسال',addMedicineEmailNote:'يُحفظ على جهازك الآن. اضغط إرسال في تطبيق البريد لإيصاله.',addMedicineFallbackNote:'إذا لم يفتح تطبيق البريد، انسخ الرسالة الجاهزة إليه.',addMedicineStorageNote:'يُحفظ السجل في هذا المتصفح فقط. الرسالة البريدية تتيح لمالك التطبيق مراجعته للدليل المشترك.',addMedicineSafetyNote:'غير مراجَع من التطبيق. تأكد من التفاصيل مع الصيدلي أو النشرة.',addMedicineSaved:'تمت إضافة {name} إلى قاعدة بيانات الأدوية على هذا الجهاز، ويمكن البحث عنه الآن.',addMedicineSaveFailed:'أُضيف الدواء لهذه الجلسة فقط لأن حفظه على الجهاز تعذر.',addMedicineEvicted:'حُذف أقدم دواء محلي لإفساح المجال لهذا الدواء.',addMedicineLocalDb:'سجلات محلية',addMedicineRequired:'اكمل كل الخانات بسعر صحيح قبل الإرسال.',addMedicineTag:'مضاف بواسطة المستخدم',customMedicineNote:'أضافه مستخدم وغير مراجَع. تأكد من التفاصيل مع الصيدلي أو النشرة.',addMedicineEmailIntro:'إضافة دواء جديد من Drugcopeia',addMedicineEmailName:'الاسم التجاري الكامل',addMedicineEmailIngredient:'المادة الفعالة',addMedicineEmailConcentration:'التركيز',addMedicineEmailPrice:'السعر (ج.م)',addMedicineEmailUnits:'الوحدات'}};
  Object.assign(translations.en,addMedicineUi.en);Object.assign(translations.ar,addMedicineUi.ar);
  const settingsUi={en:{navSettings:'Settings',settingsEyebrow:'PREFERENCES',settingsTitle:'Settings',settingsLede:'Appearance, text size, language and privacy. Every preference is stored on this device.',settingsDisplay:'Display',settingsAppearanceHint:'Light, dark, or the same look as your device.',themeLightShort:'Light',themeDarkShort:'Dark',themeSystemShort:'Automatic',settingsTextSizeHint:'Applies to every screen in the app.',settingsLanguage:'Language',settingsLanguageHint:'English or Arabic interface.',settingsPrivacyHeading:'Privacy and data',settingsPrivacyHint:'What is stored, and what is never collected.',settingsEraseTitle:'Delete local data',settingsEraseHint:'Removes reminders, added medicines, saved headlines and assistant history from this device.',settingsMore:'More',settingsAiHint:'Download and manage the on-device model.',settingsOpen:'Open',settingsFoot:'Preferences stay on this device and are never uploaded.'},ar:{navSettings:'الإعدادات',settingsEyebrow:'التفضيلات',settingsTitle:'الإعدادات',settingsLede:'المظهر وحجم النص واللغة والخصوصية. كل تفضيل محفوظ على هذا الجهاز.',settingsDisplay:'العرض',settingsAppearanceHint:'فاتح أو داكن أو نفس مظهر جهازك.',themeLightShort:'فاتح',themeDarkShort:'داكن',themeSystemShort:'تلقائي',settingsTextSizeHint:'يُطبَّق على كل شاشات التطبيق.',settingsLanguage:'اللغة',settingsLanguageHint:'واجهة إنجليزية أو عربية.',settingsPrivacyHeading:'الخصوصية والبيانات',settingsPrivacyHint:'ما يُحفظ، وما لا يُجمع أبدًا.',settingsEraseTitle:'حذف البيانات المحلية',settingsEraseHint:'يحذف التذكيرات والأدوية المضافة والعناوين المحفوظة وسجل المساعد من هذا الجهاز.',settingsMore:'المزيد',settingsAiHint:'نزّل النموذج الموجود على الجهاز وأدره.',settingsOpen:'فتح',settingsFoot:'تبقى التفضيلات على هذا الجهاز ولا تُرفع أبدًا.'}};
  Object.assign(translations.en,settingsUi.en);Object.assign(translations.ar,settingsUi.ar);
  const captureUi={en:{scanButtonAria:'Scan a barcode or QR code on the box',voiceButtonAria:'Search by voice',scanEyebrow:'CAMERA',scanTitle:'Scan a box code',scanClose:'Close',scanStarting:'Starting the camera…',scanHelp:'Hold the barcode or QR code inside the frame. Nothing is uploaded; the code is read on this device.',scanManualLabel:'Code printed on the box',scanManualPlaceholder:'Or type the code printed under the barcode',scanManualSubmit:'Look up',scanLooking:'Looking for a code…',scanPermissionDenied:'Camera access is off. Allow it in system settings, or type the code below.',scanCameraError:'The camera could not start. Type the code below instead.',scanUnavailable:'Scanning is not available on this device. Type the code instead.',scanFound:'Opened {name}.',scanFoundSearch:'Showing matches for {name}.',scanNoMatch:'No medicine in the bundled directory matches {code}. Try the brand name instead.',scanIndexMissing:'The box-code list did not load, so this code could not be checked. Try again, or search by brand name.',scanOpenedLink:'Opened the scanned link in your browser.',voiceListening:'Listening… say the medicine name.',voiceUnavailable:'Voice search is not available on this device.',voicePermissionDenied:'Microphone access is off. Allow it in system settings to search by voice.',voiceNoSpeech:'No speech was recognised. Try again.',voiceError:'Voice search could not start.',voiceStopped:'Voice search cancelled.'},ar:{scanButtonAria:'مسح الباركود أو رمز QR على العلبة',voiceButtonAria:'البحث بالصوت',scanEyebrow:'الكاميرا',scanTitle:'امسح كود العلبة',scanClose:'إغلاق',scanStarting:'جارٍ تشغيل الكاميرا…',scanHelp:'ضع الباركود أو رمز QR داخل الإطار. لا يُرفع أي شيء؛ يُقرأ الكود على هذا الجهاز.',scanManualLabel:'الكود المطبوع على العلبة',scanManualPlaceholder:'أو اكتب الكود المطبوع تحت الباركود',scanManualSubmit:'ابحث',scanLooking:'جارٍ البحث عن كود…',scanPermissionDenied:'الوصول إلى الكاميرا مغلق. اسمح به من إعدادات النظام، أو اكتب الكود أدناه.',scanCameraError:'تعذّر تشغيل الكاميرا. اكتب الكود أدناه.',scanUnavailable:'المسح غير متاح على هذا الجهاز. اكتب الكود بدلاً من ذلك.',scanFound:'تم فتح {name}.',scanFoundSearch:'عرض النتائج لـ {name}.',scanNoMatch:'لا يوجد دواء في القائمة يطابق {code}. جرّب اسم العلامة التجارية.',scanIndexMissing:'قائمة أكواد العبوات لم تُحمَّل، لذلك تعذّر التحقق من هذا الكود. حاول مجددًا أو ابحث بالاسم التجاري.',scanOpenedLink:'تم فتح الرابط الممسوح في المتصفح.',voiceListening:'يستمع… قل اسم الدواء.',voiceUnavailable:'البحث الصوتي غير متاح على هذا الجهاز.',voicePermissionDenied:'الوصول إلى الميكروفون مغلق. اسمح به من إعدادات النظام للبحث بالصوت.',voiceNoSpeech:'لم يُتعرَّف على كلام. حاول مرة أخرى.',voiceError:'تعذّر بدء البحث الصوتي.',voiceStopped:'أُلغي البحث الصوتي.'}};
  Object.assign(translations.en,captureUi.en);Object.assign(translations.ar,captureUi.ar);
  const clinicalUi={
    en:{
      
      doseMenu:'Dosage calculator',
      doseMenuHint:'Weight-based children’s doses',
      interactionsMenu:'Drug interactions',
      interactionsMenuHint:'Check two medicines',
      doseEyebrow:'PEDIATRIC DOSING REFERENCE',
      doseTitle:'Children’s dose calculator',
      doseIntro:'Enter the child\'s weight (2 to 50 kg) for an educational dose range with daily limits.',
      doseMedicineLabel:'Medicine',
      clinicalPickerPlaceholder:'Search a medicine or active ingredient',
      clinicalPickerToggleAria:'Show medicine list',
      clinicalPickerListAria:'Medicine options',
      clinicalPickerDoseGroup:'Dose references in this calculator',
      clinicalPickerGuideGroup:'Interaction guide ingredients (no pediatric dose data)',
      clinicalPickerDatabaseGroup:'Medicine database',
      clinicalPickerDoseHint:'Choose a dose reference, or type a medicine name to search the database.',
      clinicalPickerGuideHint:'Choose a guide ingredient, or type a medicine name to search the database.',
      clinicalPickerMoreResults:'Showing {shown} of {total} database matches. Keep typing to narrow the list.',
      clinicalPickerDbUnavailable:'The medicine database is unavailable right now. Guide ingredients remain available.',
      clinicalPickerTypeHint:'Type at least 2 letters to search the medicine database.',
      clinicalPickerTypeHintAll:'Type at least 2 letters to search all {count} medicines in the database.',
      clinicalPickerDbLoading:'The medicine database is still loading. Guide ingredients remain available.',
      clinicalPickerSearching:'Searching the medicine database…',
      clinicalPickerNoResults:'No medicine or guide ingredient matches this search.',
      clinicalPickerNoDbResults:'No medicine in the database matches this search. Guide ingredients are shown above.',
      clinicalPickerChooseOne:'Choose a medicine from the list.',
      clinicalPickerNoIngredient:'The database does not list an active ingredient for this product, so it cannot be matched safely.',
      clinicalPickerBadgeDose:'Dose reference',
      clinicalPickerBadgeNoDose:'No pediatric reference',
      clinicalPickerBadgeGuide:'Guide match',
      clinicalPickerBadgeNoGuide:'Not in guide',
      clinicalPickerBadgeCombo:'Combination',
      clinicalPickerBadgeNonOral:'Non-oral',
      clinicalPickerBadgeNonSystemic:'Topical / local',
      clinicalPickerBadgeAspirin:'Low-dose only',
      clinicalPickerBadgeAspirinDose:'Aspirin dose caution',
      clinicalPickerBadgeRouteUnknown:'Route unconfirmed',
      clinicalPickerBadgeNoIngredient:'No ingredient listed',
      clinicalPickerDoseSub:'Weight-based pediatric reference',
      doseWeightLabel:'Child’s weight (kg)',
      doseAgeLabel:'Age (optional)',
      doseAgeUnitLabel:'Age unit',
      doseYears:'Years',
      doseMonths:'Months',
      doseConcentrationLabel:'Liquid concentration (mg per 5 mL, optional)',
      doseConcentrationHint:'Copy the concentration from the bottle to get millilitres. Use the supplied syringe or cup.',
      doseCalculate:'Calculate reference dose',
      doseReset:'Clear',
      doseSourcesTitle:'Dose references',
      doseSourceNote:'Ranges summarised from FDA-approved labeling on DailyMed and WHO guidance.',
      
      doseDisclaimer:'Fever, dehydration, kidney or liver disease, allergy, pregnancy or other medicines need an individual assessment. Ask a clinician before changing a prescribed dose.',
      doseInvalidWeight:'Enter a weight between 2 and 50 kg.',
      doseInvalidAge:'Enter a valid age, or leave the age field empty.',
      doseInvalidAgeMax:'This calculator is for children under 18 years. Confirm the dose with a clinician.',
      doseInvalidConcentration:'Enter a concentration between 1 and 1000 mg per 5 mL, or leave it empty.',
      doseNoResult:'Choose a medicine and enter a weight to calculate a reference range.',
      dosePickerSelected:'Dose reference selected. Enter the child’s weight and calculate.',
      doseMatchedProfile:'Matched active ingredient: {ingredient}. Using the {name} reference.',
      doseUnsupportedNamed:'No pediatric weight-based dose reference is included for {name}. This calculator covers {supported}.',
      doseNonOralNamed:'{name} is not listed as an oral product in the database. This calculator only provides oral pediatric references.',
      doseCombinationNamed:'{name} is a combination product, so a single-medicine reference cannot be applied safely. Choose the single active ingredient or follow the prescribed product.',
      doseResultProduct:'Selected product: {name}',
      doseResultHeading:'Reference dose',
      doseResultFor:'Calculated for {weight} kg',
      dosePerDose:'Per dose',
      dosePerDay:'Total per day',
      doseMaxPerDay:'Maximum per day',
      doseMaxPerDose:'Maximum per dose: {max} mg',
      doseDosesPerDay:'Up to {count} doses in 24 hours',
      doseInterval:'Usual interval: {interval}',
      doseVolume:'Volume per dose: {low}–{high} mL',
      doseVolumeSingle:'Volume: {value} mL',
      doseConcentrationUsed:'Using {conc} mg per 5 mL',
      doseRulePerDose:'Reference range: {low}–{high} mg/kg per dose, not more than {max} mg per dose.',
      doseRulePerDay:'Reference range: {low}–{high} mg/kg per day, divided into {count} doses.',
      doseRulePhase:'{phase}: {mgPerKg} mg/kg once daily (maximum {max} mg).',
      doseHighDose:'A higher-dose regimen (for example, 90 mg/kg/day for some ear infections) must be selected by a prescriber and stay within the product’s maximum daily dose.',
      doseSafetyTitle:'Safety notes',
      doseAgeWarningTitle:'Age caveat',
      doseAgeBelow:'The entered age is below the usual minimum for this reference.',
      doseAgeNote:'Age entered: {age}.',
      doseAgeNotEntered:'Age was not entered. Check the minimum age on the product label before use.',
      doseInputsChanged:'Inputs changed. Calculate again to refresh the dose.',
      doseApprox:'Values are rounded for readability. Use the prescribed dose and the product’s own measuring device.',
      dosePrescription:'Prescription medicine: use only under a prescriber’s directions.',
      doseResultNote:'This is a reference range, not a prescription. The indication, formulation, kidney and liver function, and the product label determine the actual dose.',
      doseMg:'mg',
      interactionEyebrow:'DRUG INTERACTION REFERENCE',
      interactionTitle:'Drug interaction checker',
      interactionIntro:'Choose two active ingredients to review a key interaction from this curated guide, or browse the list below.',
      interactionFirstLabel:'First medicine or active ingredient',
      interactionSecondLabel:'Second medicine or active ingredient',
      interactionMatchedIngredients:'Matched guide ingredient(s): {ingredients}',
      interactionUnsupportedNamed:'{name} is not one of the active ingredients in this interaction guide, so no guide result is shown. That does not mean it is safe; check each active ingredient or ask a pharmacist.',
      interactionNonSystemicNamed:'{name} is listed for topical or local use. This guide covers systemic exposure; ask a pharmacist about interactions for this product.',
      interactionUnknownRouteNamed:'The database route for {name} does not confirm systemic exposure, so this guide may not fully apply. Check the package or ask a pharmacist.',
      interactionAspirinDoseNamed:'{name} was not matched to the low-dose aspirin reference. This guide covers low-dose aspirin (75–100 mg daily) only; ask a pharmacist about bleeding risk at any dose.',
      interactionOralOnlyNamed:'{name} is not confirmed as an oral product. This interaction depends on absorption in the gut, so this guide result may not apply; ask a pharmacist about the exact product.',
      interactionNotApplicableTitle:'Not applicable to this formulation',
      interactionCautionTitle:'Before you use this result',
      interactionSelectionContextTitle:'What was compared',
      interactionSelectionContextItem:'{medicine} · matched guide ingredient(s): {ingredients}',
      interactionSelectionContextNoMatch:'{medicine} · no active ingredient mapped to this guide',
      interactionSwapAria:'Swap medicines',
      interactionCheck:'Check interaction',
      interactionReset:'Clear',
      interactionIngredientNote:'The guide compares active ingredients, not brand names — check the package.',
      interactionExamplesTitle:'Common examples',
      interactionBrowseTitle:'Browse important interactions',
      interactionSearchLabel:'Search interactions',
      interactionSearchPlaceholder:'Search by medicine or active ingredient',
      interactionSeverityAria:'Filter by severity',
      interactionAllSeverities:'All severities',
      interactionSeverityAvoid:'Contraindicated',
      interactionSeverityMajor:'Major',
      interactionSeverityModerate:'Moderate',
      interactionSourcesTitle:'Trusted sources',
      interactionSourceNote:'Sources: FDA labeling on DailyMed and the FDA enzyme interaction table. The list is selective.',
      
      interactionDisclaimer:'Absence of a pair here does not mean the combination is safe. Ask a pharmacist or prescriber before any treatment decision.',
      interactionChooseTwo:'Choose two different active ingredients.',
      interactionSame:'Choose two different active ingredients to compare.',
      interactionNoPairTitle:'Not found in this guide',
      interactionNoPairBody:'This pair is not included in this selective guide. That does not mean the combination is safe. Food, supplements, other medicines, and patient factors can still matter. Ask a pharmacist or prescriber before combining them.',
      interactionEffectLabel:'Why it matters',
      interactionMechanismLabel:'How it happens',
      interactionManagementLabel:'What to do',
      interactionSourcesLabel:'Sources for this interaction',
      interactionResultNote:'This is general education, not a recommendation to start, stop, or change treatment. Your prescriber or pharmacist must check the full regimen.',
      interactionBrowseCount:'interactions listed',
      interactionBrowseEmpty:'No interactions match this filter.',
      interactionBrowseShowing:'Showing {shown} of {total}',
      interactionBrandExamples:'Common examples: {examples}'
    },
    ar:{
      
      doseMenu:'حاسبة الجرعات',
      doseMenuHint:'جرعات الأطفال حسب الوزن',
      interactionsMenu:'التداخلات الدوائية',
      interactionsMenuHint:'فحص دواءين معًا',
      doseEyebrow:'مرجع جرعات الأطفال',
      doseTitle:'حاسبة جرعات الأطفال',
      doseIntro:'أدخل وزن الطفل (2 إلى 50 كجم) لنطاق جرعة تعليمي مع الحدود اليومية.',
      doseMedicineLabel:'الدواء',
      clinicalPickerPlaceholder:'ابحث باسم دواء أو مادة فعالة',
      clinicalPickerToggleAria:'عرض قائمة الأدوية',
      clinicalPickerListAria:'خيارات الأدوية',
      clinicalPickerDoseGroup:'مراجع الجرعات المتاحة في الحاسبة',
      clinicalPickerGuideGroup:'مواد دليل التداخلات (دون مرجع جرعة أطفال)',
      clinicalPickerDatabaseGroup:'قاعدة بيانات الأدوية',
      clinicalPickerDoseHint:'اختر مرجع جرعة، أو اكتب اسم دواء للبحث في قاعدة البيانات.',
      clinicalPickerGuideHint:'اختر مادة من دليل التداخلات، أو اكتب اسم دواء للبحث في قاعدة البيانات.',
      clinicalPickerMoreResults:'عرض {shown} من {total} نتيجة من قاعدة البيانات. تابع الكتابة لتضييق القائمة.',
      clinicalPickerDbUnavailable:'قاعدة بيانات الأدوية غير متاحة الآن. تظل مواد دليل التداخلات متاحة.',
      clinicalPickerTypeHint:'اكتب حرفين على الأقل للبحث في قاعدة بيانات الأدوية.',
      clinicalPickerTypeHintAll:'اكتب حرفين على الأقل للبحث في {count} دواء بقاعدة البيانات.',
      clinicalPickerDbLoading:'قاعدة بيانات الأدوية قيد التحميل. يمكنك اختيار مادة من دليل التداخلات الآن.',
      clinicalPickerSearching:'جارٍ البحث في قاعدة بيانات الأدوية…',
      clinicalPickerNoResults:'لا يوجد دواء أو مادة فعالة مطابقة لهذا البحث.',
      clinicalPickerNoDbResults:'لا يوجد دواء مطابق في قاعدة البيانات. تظهر مواد الدليل أعلاه.',
      clinicalPickerChooseOne:'اختر دواءً من القائمة.',
      clinicalPickerNoIngredient:'لا تسجل قاعدة البيانات مادة فعالة لهذا المنتج، لذلك لا يمكن مطابقته بأمان.',
      clinicalPickerBadgeDose:'مرجع جرعة',
      clinicalPickerBadgeNoDose:'لا مرجع أطفال',
      clinicalPickerBadgeGuide:'مطابق للدليل',
      clinicalPickerBadgeNoGuide:'غير موجود بالدليل',
      clinicalPickerBadgeCombo:'مركب',
      clinicalPickerBadgeNonOral:'غير فموي',
      clinicalPickerBadgeNonSystemic:'موضعي أو محلي',
      clinicalPickerBadgeAspirin:'جرعة منخفضة فقط',
      clinicalPickerBadgeAspirinDose:'تنبيه جرعة الأسبرين',
      clinicalPickerBadgeRouteUnknown:'طريقة الإعطاء غير مؤكدة',
      clinicalPickerBadgeNoIngredient:'المادة غير مسجلة',
      clinicalPickerDoseSub:'مرجع جرعة أطفال حسب الوزن',
      doseWeightLabel:'وزن الطفل (كجم)',
      doseAgeLabel:'العمر (اختياري)',
      doseAgeUnitLabel:'وحدة العمر',
      doseYears:'سنوات',
      doseMonths:'أشهر',
      doseConcentrationLabel:'تركيز الشراب (مجم لكل 5 مل، اختياري)',
      doseConcentrationHint:'انسخ التركيز من العبوة لتحصل على الملليلتر. استخدم السرنجة أو الكوب المرفق.',
      doseCalculate:'احسب الجرعة المرجعية',
      doseReset:'مسح',
      doseSourcesTitle:'مراجع الجرعات',
      doseSourceNote:'النطاقات ملخّصة من نشرات FDA المعتمدة على DailyMed وإرشادات منظمة الصحة العالمية.',
      
      doseDisclaimer:'الحُمّى أو الجفاف أو مرض الكلى أو الكبد أو الحساسية أو الحمل أو أدوية أخرى تحتاج تقييمًا فرديًا. استشر الطبيب قبل تغيير جرعة موصوفة.',
      doseInvalidWeight:'أدخل وزنًا بين 2 و50 كجم.',
      doseInvalidAge:'أدخل عمرًا صحيحًا أو اترك خانة العمر فارغة.',
      doseInvalidAgeMax:'الحاسبة مخصصة للأطفال دون 18 عامًا. تحقق من الجرعة مع مختص.',
      doseInvalidConcentration:'أدخل تركيزًا بين 1 و1000 مجم لكل 5 مل، أو اتركه فارغًا.',
      doseNoResult:'اختر دواءً وأدخل الوزن لحساب نطاق مرجعي.',
      dosePickerSelected:'تم اختيار مرجع الجرعة. أدخل وزن الطفل ثم احسب.',
      doseMatchedProfile:'المادة الفعالة المطابقة: {ingredient}. يُستخدم مرجع {name}.',
      doseUnsupportedNamed:'لا يتضمن هذا المرجع مرجع جرعة أطفال حسب الوزن للدواء {name}. تشمل الحاسبة: {supported}.',
      doseNonOralNamed:'الدواء {name} غير مسجل كمنتج فموي في قاعدة البيانات. توفر هذه الحاسبة مراجع فموية للأطفال فقط.',
      doseCombinationNamed:'الدواء {name} منتج مركب، ولا يمكن تطبيق مرجع دواء واحد عليه بأمان. اختر المادة الفعالة المفردة أو اتبع جرعة المنتج الموصوفة.',
      doseResultProduct:'المنتج المختار: {name}',
      doseResultHeading:'الجرعة المرجعية',
      doseResultFor:'محسوبة لوزن {weight} كجم',
      dosePerDose:'الجرعة في المرة',
      dosePerDay:'الإجمالي اليومي',
      doseMaxPerDay:'الحد الأقصى اليومي',
      doseMaxPerDose:'الحد الأقصى للجرعة الواحدة: {max} مجم',
      doseDosesPerDay:'حتى {count} جرعات خلال 24 ساعة',
      doseInterval:'الفاصل المعتاد: {interval}',
      doseVolume:'حجم الجرعة: {low}–{high} مل',
      doseVolumeSingle:'الحجم: {value} مل',
      doseConcentrationUsed:'باستخدام تركيز {conc} مجم لكل 5 مل',
      doseRulePerDose:'النطاق المرجعي: {low}–{high} مجم/كجم لكل جرعة، وبحد أقصى {max} مجم للجرعة.',
      doseRulePerDay:'النطاق المرجعي: {low}–{high} مجم/كجم/يوم، مقسمة على {count} جرعات.',
      doseRulePhase:'{phase}: {mgPerKg} مجم/كجم مرة يوميًا (بحد أقصى {max} مجم).',
      doseHighDose:'الجرعة الأعلى (مثل 90 مجم/كجم/يوم لبعض حالات التهاب الأذن) يجب أن يحددها الطبيب وألا تتجاوز الحد الأقصى اليومي للمنتج.',
      doseSafetyTitle:'تنبيهات السلامة',
      doseAgeWarningTitle:'تنبيه العمر',
      doseAgeBelow:'العمر المدخل أقل من الحد الأدنى المعتاد لهذا المرجع.',
      doseAgeNote:'العمر المدخل: {age}.',
      doseAgeNotEntered:'لم يُدخل العمر. تحقق من الحد الأدنى للعمر على نشرة المنتج قبل الاستخدام.',
      doseInputsChanged:'تغيّرت المدخلات. اضغط احسب مرة أخرى لتحديث الجرعة.',
      doseApprox:'تُقرّب القيم لسهولة القراءة. استخدم الجرعة الموصوفة وأداة القياس المرفقة بالمنتج.',
      dosePrescription:'دواء بوصفة طبية: يُستخدم فقط وفق توجيه الطبيب.',
      doseResultNote:'هذا نطاق مرجعي وليس وصفة. يحدد الداعي الطبي وشكل الدواء ووظائف الكلى والكبد ونشرة المنتج الجرعة الفعلية.',
      doseMg:'مجم',
      interactionEyebrow:'مرجع التداخلات الدوائية',
      interactionTitle:'فاحص التداخلات الدوائية',
      interactionIntro:'اختر مادتين فعالتين لمراجعة تداخل مهم من هذا الدليل المنسق، أو تصفح التداخلات أدناه.',
      interactionFirstLabel:'الدواء أو المادة الفعالة الأولى',
      interactionSecondLabel:'الدواء أو المادة الفعالة الثانية',
      interactionMatchedIngredients:'المواد المطابقة في الدليل: {ingredients}',
      interactionUnsupportedNamed:'الدواء {name} ليس من المواد الفعالة المدرجة في دليل التداخلات، لذلك لا يمكن عرض نتيجة له. هذا لا يعني أن الدواء آمن؛ راجع كل مادة فعالة أو استشر الصيدلي.',
      interactionNonSystemicNamed:'الدواء {name} مسجل للاستخدام الموضعي أو المحلي. يغطي هذا الدليل التعرض الجهازي؛ اسأل الصيدلي عن تداخلات هذا المنتج.',
      interactionUnknownRouteNamed:'طريقة إعطاء الدواء {name} المسجلة لا تؤكد التعرض الجهازي، لذلك قد لا ينطبق هذا الدليل تمامًا. راجع العبوة أو اسأل الصيدلي.',
      interactionAspirinDoseNamed:'{name}: لم تُطابق هذه العبوة مرجع الأسبرين منخفض الجرعة. يغطي هذا الدليل الأسبرين بجرعة منخفضة (75–100 مجم يوميًا) فقط؛ اسأل الصيدلي عن خطر النزف بأي جرعة.',
      interactionOralOnlyNamed:'{name} غير مؤكد كمنتج فموي. يعتمد هذا التداخل على الامتصاص من الأمعاء، لذلك قد لا تنطبق هذه النتيجة؛ اسأل الصيدلي عن المنتج المحدد.',
      interactionNotApplicableTitle:'لا ينطبق على هذا الشكل الدوائي',
      interactionCautionTitle:'قبل استخدام هذه النتيجة',
      interactionSelectionContextTitle:'ما الذي تمت مقارنته؟',
      interactionSelectionContextItem:'{medicine} · المواد المطابقة في الدليل: {ingredients}',
      interactionSelectionContextNoMatch:'{medicine} · لم تُطابق أي مادة فعالة مع هذا الدليل',
      interactionSwapAria:'تبديل الدواءين',
      interactionCheck:'فحص التداخل',
      interactionReset:'مسح',
      interactionIngredientNote:'يقارن الدليل المواد الفعالة لا الأسماء التجارية — تحقّق منها على العبوة.',
      interactionExamplesTitle:'أمثلة شائعة',
      interactionBrowseTitle:'تصفح التداخلات المهمة',
      interactionSearchLabel:'البحث في التداخلات',
      interactionSearchPlaceholder:'ابحث باسم دواء أو مادة فعالة',
      interactionSeverityAria:'تصفية حسب درجة الخطورة',
      interactionAllSeverities:'كل الدرجات',
      interactionSeverityAvoid:'ممنوع الجمع',
      interactionSeverityMajor:'تداخل شديد',
      interactionSeverityModerate:'تداخل متوسط',
      interactionSourcesTitle:'المصادر الموثوقة',
      interactionSourceNote:'المصادر: نشرات FDA على DailyMed وجدول تداخلات الإنزيمات من FDA. الدليل انتقائي.',
      
      interactionDisclaimer:'غياب زوج من الدليل لا يعني أن الجمع آمن. استشر الصيدلي أو الطبيب قبل أي قرار علاجي.',
      interactionChooseTwo:'اختر مادتين فعالتين مختلفتين.',
      interactionSame:'لا يمكن مقارنة المادة نفسها بنفسها؛ اختر مادتين مختلفتين.',
      interactionNoPairTitle:'غير موجود في هذا الدليل',
      interactionNoPairBody:'هذا الزوج غير مدرج في هذا الدليل الانتقائي. عدم وجوده لا يعني أن الجمع آمن؛ قد تؤثر الأطعمة والمكملات والأدوية الأخرى وعوامل المريض. استشر الصيدلي أو الطبيب قبل الجمع.',
      interactionEffectLabel:'لماذا يهم؟',
      interactionMechanismLabel:'كيف يحدث؟',
      interactionManagementLabel:'ماذا تفعل؟',
      interactionSourcesLabel:'مصادر هذا التداخل',
      interactionResultNote:'هذه معلومات عامة تثقيفية، وليست توصية ببدء أو إيقاف أو تغيير العلاج. يجب أن يراجع الطبيب أو الصيدلي النظام الدوائي كاملًا.',
      interactionBrowseCount:'تداخلًا مسجلًا',
      interactionBrowseEmpty:'لا توجد تداخلات مطابقة لهذه التصفية.',
      interactionBrowseShowing:'عرض {shown} من {total}',
      interactionBrandExamples:'أمثلة شائعة: {examples}'
    }
  };
  const coreUi={
    en:{
      navReminders:'Reminders',
      remindersMenu:'Medication reminders',
      remindersMenuHint:'Daily timeline and status',
      railRemindersAction:'Medication reminders',
      railRemindersHint:'Daily schedule and timeline',
      typeScaleAria:'Text size',
      typeScaleLabel:'Text size',
      typeScaleDecrease:'Decrease text size',
      typeScaleIncrease:'Increase text size',
      listenLabel:'Listen',
      listenStop:'Stop',
      listenHint:'Reads the medicine name and the open detail section aloud using your device voice.',
      listenUnsupported:'Text-to-speech is not available in this browser. Native iOS or Android shells can connect a speech bridge.',
      nativeViewLabel:'Native view',
      shareLabel:'Share',
      shareCopied:'Medicine details were copied to the clipboard.',
      shareFailed:'Could not share or copy these medicine details.',
      shareTitle:'Drugcopeia medicine guide',
      interactionAlertAvoid:'Do not combine',
      interactionAlertMajor:'Serious interaction',
      interactionAlertModerate:'Interaction to review',
      interactionAlertKicker:'INTERACTION ALERT',
      interactionAlertMore:'All {count} flagged pairs are listed in the full result below.',
      interactionAlertAdvice:'What to do',
      interactionAlertDetails:'Review the full result',
      interactionAlertDisclaimer:'From a selective educational guide, not a complete interaction screen. Do not stop or change a prescribed medicine without advice from your prescriber or pharmacist.',
      interactionAlertSpoken:'Interaction alert.',
      remindersEyebrow:'DAILY MEDICATION PLAN',
      remindersTitle:'Medication reminders',
      remindersIntro:'Plan your daily medicines and track what is due.',
      reminderTodayKicker:'TODAY',
      reminderNextDose:'Next: {name} at {time}',
      reminderNextDue:'Due now: {name} at {time}',
      reminderNextTomorrow:'Tomorrow: {name} at {time}',
      reminderNoNext:'Nothing pending for the rest of today.',
      reminderAllTaken:'All reminders are marked as taken today.',
      reminderNoReminders:'Add a reminder to start today\u2019s timeline.',
      reminderProgressText:'{taken} of {total} taken today',
      reminderProgressAria:'{taken} of {total} reminders taken today',
      reminderTimelineTitle:'Today’s timeline',
      reminderTimelineCount:'{count} reminders',
      reminderEmptyTitle:'No reminders yet',
      reminderEmptyText:'Add a medicine and a time to start.',
      reminderTableCaption:'Daily medication reminders in time order',
      reminderTableTime:'Time',
      reminderTableMedicine:'Medicine',
      reminderTableDose:'Dose',
      reminderTableStatus:'Status',
      reminderTableActions:'Actions',
      reminderFormTitle:'Add a daily reminder',
      reminderNameLabel:'Medicine name',
      reminderNamePlaceholder:'Example: Metformin 500 mg',
      reminderDoseLabel:'Dose note (optional)',
      reminderDosePlaceholder:'Example: 1 tablet with breakfast',
      reminderTimeLabel:'Time',
      reminderFormHint:'Repeats daily. Confirm the dose with your pharmacist.',
      reminderAdd:'Add reminder',
      reminderLimitNote:'Up to 20 reminders on this device.',
      reminderLimitCount:'{count} of {limit} reminders saved.',
      
      reminderNotice:'A long alert sounds at the set time and repeats after 10 and 30 minutes until you mark the dose taken. Never double a missed dose.',
      reminderNoticeWindow:'Alerts arrive even while Drugcopeia is closed.',
      reminderStatusTaken:'Taken',
      reminderStatusDue:'Due now',
      reminderStatusOverdue:'Missed',
      reminderStatusUpcoming:'Upcoming',
      reminderTakenAction:'Mark taken',
      reminderTakenUndo:'Mark not taken',
      reminderTakenAnnounce:'{name} marked as taken.',
      reminderUntakenAnnounce:'{name} marked as not taken.',
      reminderRemove:'Remove reminder',
      reminderRemoveConfirm:'Confirm remove',
      reminderRemoved:'{name} was removed from this device.',
      reminderAdded:'{name} added at {time}.',
      reminderDuplicate:'A reminder with this medicine and time already exists.',
      reminderInvalid:'Enter a medicine name and a valid time.',
      reminderLimitReached:'This device already holds the maximum of {limit} reminders.',
      reminderSpoken:'Reminder for {name} at {time}. {status}.',
      reminderPageLabel:'Medication reminders'
    },
    ar:{
      navReminders:'التذكيرات',
      remindersMenu:'تذكيرات الأدوية',
      remindersMenuHint:'جدول يومي وحالة الجرعات',
      railRemindersAction:'تذكيرات الأدوية',
      railRemindersHint:'جدول يومي وخط زمني',
      typeScaleAria:'حجم النص',
      typeScaleLabel:'حجم النص',
      typeScaleDecrease:'تصغير حجم النص',
      typeScaleIncrease:'تكبير حجم النص',
      listenLabel:'استمع',
      listenStop:'إيقاف',
      listenHint:'يقرأ اسم الدواء وقسم التفاصيل المفتوح بصوت جهازك.',
      listenUnsupported:'القارئ الصوتي غير متاح في هذا المتصفح. يمكن لتطبيقات iOS أو Android توصيل جسر قراءة صوتية.',
      nativeViewLabel:'عرض أصلي',
      shareLabel:'مشاركة',
      shareCopied:'تم نسخ معلومات الدواء إلى الحافظة.',
      shareFailed:'تعذرت مشاركة أو نسخ معلومات الدواء.',
      shareTitle:'دليل دواء من Drugcopeia',
      interactionAlertAvoid:'لا تجمع بينهما',
      interactionAlertMajor:'تداخل شديد',
      interactionAlertModerate:'تداخل يستلزم المراجعة',
      interactionAlertKicker:'تنبيه تداخل دوائي',
      interactionAlertMore:'تظهر جميع الأزواج المحددة ({count}) في النتيجة الكاملة أدناه.',
      interactionAlertAdvice:'ما الذي يجب فعله؟',
      interactionAlertDetails:'راجع النتيجة الكاملة',
      interactionAlertDisclaimer:'من دليل تعليمي انتقائي وليس فحصًا كاملًا للتداخلات. لا توقف دواءً موصوفًا أو تغيّره دون مشورة الطبيب أو الصيدلي.',
      interactionAlertSpoken:'تنبيه تداخل دوائي.',
      remindersEyebrow:'خطة الأدوية اليومية',
      remindersTitle:'تذكيرات الأدوية',
      remindersIntro:'خطط لأدويتك اليومية وتابع ما حان موعده.',
      reminderTodayKicker:'اليوم',
      reminderNextDose:'التالي: {name} الساعة {time}',
      reminderNextDue:'حان الآن: {name} الساعة {time}',
      reminderNextTomorrow:'غدًا: {name} الساعة {time}',
      reminderNoNext:'لا توجد جرعات متبقية اليوم.',
      reminderAllTaken:'كل التذكيرات مسجلة كمأخوذة اليوم.',
      reminderNoReminders:'أضف تذكيرًا لبدء خطة اليوم.',
      reminderProgressText:'{taken} من {total} مأخوذة اليوم',
      reminderProgressAria:'تم أخذ {taken} من {total} تذكيرًا اليوم',
      reminderTimelineTitle:'الخط الزمني لليوم',
      reminderTimelineCount:'{count} تذكيرات',
      reminderEmptyTitle:'لا توجد تذكيرات بعد',
      reminderEmptyText:'أضف دواء ووقتًا للبدء.',
      reminderTableCaption:'تذكيرات الأدوية اليومية مرتبة حسب الوقت',
      reminderTableTime:'الوقت',
      reminderTableMedicine:'الدواء',
      reminderTableDose:'الجرعة',
      reminderTableStatus:'الحالة',
      reminderTableActions:'الإجراءات',
      reminderFormTitle:'إضافة تذكير يومي',
      reminderNameLabel:'اسم الدواء',
      reminderNamePlaceholder:'مثال: ميتفورمين 500 مجم',
      reminderDoseLabel:'ملاحظة الجرعة (اختياري)',
      reminderDosePlaceholder:'مثال: قرص واحد مع الإفطار',
      reminderTimeLabel:'الوقت',
      reminderFormHint:'يتكرر يوميًا. تحقق من الجرعة مع الصيدلي.',
      reminderAdd:'إضافة التذكير',
      reminderLimitNote:'حتى 20 تذكيرًا على هذا الجهاز.',
      reminderLimitCount:'تم حفظ {count} من {limit} تذكيرًا.',
      
      reminderNotice:'ينطلق تنبيه طويل في الموعد ويتكرر بعد 10 و30 دقيقة حتى تسجّل الجرعة. لا تضاعف جرعة فاتتك.',
      reminderNoticeWindow:'التنبيهات تصل حتى والتطبيق مغلق.',
      reminderStatusTaken:'تم الأخذ',
      reminderStatusDue:'حان الآن',
      reminderStatusOverdue:'فائتة',
      reminderStatusUpcoming:'قادمة',
      reminderTakenAction:'تسجيل الأخذ',
      reminderTakenUndo:'إلغاء تسجيل الأخذ',
      reminderTakenAnnounce:'تم تسجيل {name} كمأخوذ.',
      reminderUntakenAnnounce:'تم إلغاء تسجيل أخذ {name}.',
      reminderRemove:'حذف التذكير',
      reminderRemoveConfirm:'اضغط مرة أخرى للتأكيد',
      reminderRemoved:'تم حذف {name} من هذا الجهاز.',
      reminderAdded:'تمت إضافة {name} الساعة {time}.',
      reminderDuplicate:'يوجد تذكير بالدواء والوقت نفسيهما.',
      reminderInvalid:'أدخل اسم الدواء ووقتًا صحيحًا.',
      reminderLimitReached:'يحتفظ هذا الجهاز بالحد الأقصى وهو {limit} تذكيرًا.',
      reminderSpoken:'تذكير بـ {name} الساعة {time}. {status}.',
      reminderPageLabel:'تذكيرات الأدوية'
    }
  };
  Object.assign(translations.en,coreUi.en);Object.assign(translations.ar,coreUi.ar);
  const readingUi=window.DAWAYA_READING?.ui||{en:{},ar:{}};
  Object.assign(translations.en,readingUi.en);Object.assign(translations.ar,readingUi.ar);
  const t = key => conditionUi[language]?.[key] ?? labUi[language]?.[key] ?? drawerUi[language]?.[key] ?? detailUi[language]?.[key] ?? clinicalUi[language]?.[key] ?? translations[language][key] ?? translations.en[key] ?? key;
  let privacyNoticeTimer = 0, privacyInputTimer = 0;
  function showPrivacyNotice(message){
    const note = $('#privacyGuardNote');
    if (!note) return;
    const text = message || t('privacyGuardNotice');
    note.textContent = text;
    note.hidden = false;
    const status = $('#appStatus');
    if (status) status.textContent = text;
    clearTimeout(privacyNoticeTimer);
    privacyNoticeTimer = window.setTimeout(() => { note.hidden = true }, 7000);
  }
  function sanitizeField(field){
    if (!field || typeof field.value !== 'string' || !field.value) return false;
    const result = sanitizeUserText(field.value);
    if (!result.removed) return false;
    if (field.value !== result.text) field.value = result.text;
    showPrivacyNotice();
    return true;
  }
  document.addEventListener('input', event => {
    const field = event.target;
    if (!field || !field.matches || !field.matches(ID_FIELD_SELECTOR)) return;
    clearTimeout(privacyInputTimer);
    privacyInputTimer = window.setTimeout(() => sanitizeField(field), 700);
  }, true);
  document.addEventListener('change', event => {
    const field = event.target;
    if (field && field.matches && field.matches(ID_FIELD_SELECTOR)) sanitizeField(field);
  }, true);
  const tf = (key,values={}) => t(key).replace(/\{(\w+)\}/g,(match,name)=>values[name]!==undefined?values[name]:match);
  const LATIN_LETTERS='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const ARABIC_LETTERS='ابتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('');
  function responsivePageSize(kind='condition'){
    const width=window.innerWidth||document.documentElement.clientWidth||1024;
    if(kind==='condition')return width<=620?6:width<=980?9:12;
    return width<=620?8:width<=980?12:16;
  }
  const DRUG_GROUPS=[
    ['antibiotics','groupAntibiotics',/\b(antibiotic|antibacterial|penicillin|cephalosporin|macrolide|aminoglycoside|quinolone|fluoroquinolone|tetracycline|sulfonamide)\b|amoxicillin|azithromycin|cef[a-z]*|ciprofloxacin|doxycycline|metronidazole/i],
    ['antivirals','groupAntivirals',/\b(antiviral|antivirus)\b|acyclovir|oseltamivir|valacyclovir|tenofovir/i],
    ['antifungals','groupAntifungals',/\b(antifungal|antimycotic)\b|fluconazole|clotrimazole|terbinafine/i],
    ['pain','groupPain',/\b(analgesic|pain reliever|anti inflammatory|anti-inflammatory|nsaid)\b|paracetamol|acetaminophen|ibuprofen|diclofenac/i],
    ['allergy','groupAllergy',/\b(antihistamine|antiallergic|anti-allergy)\b|cetirizine|loratadine|fexofenadine/i],
    ['cardio','groupCardio',/\b(antihypertensive|cardiovascular|ace inhibitor|beta blocker|statin|anticoagulant)\b|atorvastatin|amlodipine|losartan|enalapril/i],
    ['diabetes','groupDiabetes',/\b(antidiabetic|hypoglycemic|diabetes)\b|metformin|insulin|glimepiride/i],
    ['digestive','groupDigestive',/\b(proton pump inhibitor|antacid|gastrointestinal|acid reducer)\b|omeprazole|pantoprazole|esomeprazole/i],
    ['respiratory','groupRespiratory',/\b(bronchodilator|respiratory|asthma)\b|salbutamol|albuterol|montelukast/i],
    ['psychiatry','groupPsychiatry',/\b(antidepressant|antipsychotic|anxiolytic|antiepileptic|anticonvulsant|mood stabilizer|sedative|hypnotic|adhd|attention deficit|parkinson|migraine|dementia|alzheimer|multiple sclerosis|muscle relaxant)\b|ssri|snri|benzodiazepine|fluoxetine|sertraline|escitalopram|olanzapine|risperidone|quetiapine|aripiprazole|valproate|lamotrigine|levetiracetam|gabapentin|pregabalin|sumatriptan|donepezil|memantine|levodopa|methylphenidate/i],
    ['hormones','groupHormones',/\b(thyroid|corticosteroid|glucocorticoid|estrogen|progesterone|testosterone|osteoporosis|growth hormone|prolactin|adrenal|endocrine|hormone replacement)\b|levothyroxine|prednisolone|prednisone|dexamethasone|alendronate|somatropin|cabergoline|fludrocortisone/i],
    ['urology','groupUrology',/\b(bph|benign prostatic|erectile|pde.?5|overactive bladder|urinary incontinence|kidney stone|renal stone|urolithiasis|urinary tract)\b|tamsulosin|finasteride|dutasteride|sildenafil|tadalafil|oxybutynin|solifenacin|mirabegron|nitrofurantoin|fosfomycin/i],
    ['eyeCare','groupEyeCare',/\b(ophthalmic|glaucoma|dry eye|mydriatic)\b|eye drop|timolol|latanoprost|bimatoprost|dorzolamide|tropicamide|hypromellose|carbomer/i],
    ['entCare','groupEntCare',/\b(otic|nasal|rhinitis|sinusitis|decongestant|otitis|ear wax|throat|lozenge|gargle)\b|oxymetazoline|xylometazoline|mometasone|fluticasone|saline nasal|ear drop/i],
    ['oncology','groupOncology',/\b(anticancer|antineoplastic|chemotherapy|cytotoxic|targeted therapy|kinase inhibitor|immunotherapy|checkpoint inhibitor|aromatase inhibitor|hormonal therapy)\b|cisplatin|doxorubicin|cyclophosphamide|methotrexate|fluorouracil|paclitaxel|imatinib|erlotinib|sorafenib|sunitinib|rituximab|trastuzumab|nivolumab|pembrolizumab|tamoxifen|anastrozole|letrozole/i],
    ['immunology','groupImmunology',/\b(immunosuppressant|immunosuppressive|biologic|monoclonal antibody|immunomodulator|immunoglobulin)\b|azathioprine|mycophenolate|tacrolimus|cyclosporine|adalimumab|infliximab|etanercept|tocilizumab|omalizumab|hydroxychloroquine|sulfasalazine/i],
    ['vaccines','groupVaccines',/\b(vaccine|vaccination|immunization|toxoid|antitoxin|antivenom)\b|mmr|dtap|polio|hepatitis b|hpv|pneumococcal|meningococcal|influenza vaccine|rabies vaccine|typhoid|yellow fever/i],
    ['hematology','groupHematology',/\b(antiplatelet|anticoagulant|hemostatic|fibrinolytic|anemia|anaemia|colony stimulating|blood disorder)\b|clopidogrel|ticagrelor|prasugrel|warfarin|enoxaparin|heparin|rivaroxaban|apixaban|dabigatran|tranexamic acid|erythropoietin|epoetin|ferrous|filgrastim/i],
    ['gynecology','groupGynecology',/\b(contraceptive|birth control|menopause|hormone replacement|oxytocin|uterine|vaginal|vaginitis)\b|ethinylestradiol|levonorgestrel|desogestrel|drospirenone|medroxyprogesterone|misoprostol|dinoprostone|tibolone|conjugated estrogen/i],
    ['smokingCessation','groupSmokingCessation',/\b(nicotine|smoking cessation|stop smoking)\b|varenicline|bupropion/i],
    ['weightManagement','groupWeightManagement',/\b(weight loss|weight management|obesity|appetite suppressant|glp.?1)\b|orlistat|semaglutide|liraglutide|tirzepatide|dulaglutide|exenatide|phentermine/i],
    ['dental','groupDental',/\b(dental|mouthwash|mouth rinse|oral hygiene|teething|fluoride)\b|chlorhexidine|benzydamine|benzocaine.{0,12}mouth|lidocaine.{0,12}mouth/i],
    ['hairCare','groupHairCare',/\bhair\b|shampoo|dandruff|scalp|alopecia|minoxidil|finasteride|dutasteride|anti.?lice/i,'class'],
    ['skinCare','groupSkinCare',/\bskin\b|dermat|cosmetic|anti.?acne|\bacne\b|whitening|whiting|moistur|emollient|soothing topical|healing topical|firming|\bscars?\b|sun.?block|sun.?screen|\bspf\b|eye contour|topical(?!\s+(analgesic|anaesthetic|anesthetic|lubricant|massage))|wound|\bburns?\b|diaper rash|anti.?wrinkle|anti.?aging|rejuvenat|exfoliant|keratolytic|cleanser|facial|peeling|deodorant|antiperspirant|lip care|nail care|body lotion|soothing lotion|soothing cream|healing cream/i,'class'],
    ['supplements','groupSupplements',/\bvitamins?\b|multivitamin|multi.?vitamin|dietary supplement|food supplement|\bsupplements?\b|\bherbal\b|\bminerals?\b|omega|fish oil|probiotic|prebiotic|amino acid|whey|creatine|\biron\b|calcium supplement|zinc supplement|magnesium|folic acid|folate|prenatal|nutrition|nutraceut|coenzyme|glucosamine|collagen|biotin|electrolyte|rehydration|antioxidant/i,'class']
  ];
  const CLASS_SEARCH_GROUPS=[
    [/antibiotic|antibacterial/i,'Antibiotics','مضادات حيوية المضادات الحيوية'],
    [/antiviral/i,'Antivirals','مضادات فيروسات المضادات الفيروسية'],
    [/antifungal|antimycotic/i,'Antifungals','مضادات فطريات المضادات الفطرية'],
    [/analgesic|nsaid|antipyretic|\bpain\b/i,'Pain relievers','مسكنات الألم المسكنات'],
    [/antihistamine|anti.?allerg/i,'Allergy medicines','أدوية الحساسية مضادات الحساسية'],
    [/antidiabetic|hypoglycemic|insulin/i,'Diabetes medicines','أدوية السكري'],
    [/anti.?hypertensive|cardiovascular|beta.blocker|calcium channel|ace inhibitor|angiotensin|diuretic|anticoagulant|statin/i,'Heart and blood pressure medicines','أدوية القلب والضغط أدوية القلب'],
    [/bronchodilator|respiratory|asthma/i,'Respiratory medicines','أدوية الجهاز التنفسي'],
    [/peptic ulcer|proton pump|antacid|gastro|digestive|anti.?emetic|laxative/i,'Digestive medicines','أدوية الجهاز الهضمي'],
    [/antidepress|ssri|snri|tricyclic|maoi/i,'Antidepressants','مضادات الاكتئاب'],
    [/antipsych|neuroleptic/i,'Antipsychotics','مضادات الذهان'],
    [/anxiolytic|hypnotic|sedative|benzodiazepine/i,'Anxiolytics and sedatives','مضادات القلق والمهدئات'],
    [/anticonvuls|antiepilep/i,'Anticonvulsants','مضادات التشنج والصرع'],
    [/mood stabil/i,'Mood stabilizers','مثبتات المزاج'],
    [/corticosteroid|glucocorticoid/i,'Corticosteroids','الكورتيكوستيرويدات والكورتيزون'],
    [/vitamin/i,'Vitamins','الفيتامينات'],
    [/supplement/i,'Supplements','المكملات الغذائية'],
    [/thyroid/i,'Thyroid medicines','أدوية الغدة الدرقية'],
    [/contracept/i,'Contraceptives','وسائل منع الحمل'],
    [/muscle relax/i,'Muscle relaxants','مرخيات العضلات'],
    [/osteoporosis|bisphosphon/i,'Osteoporosis medicines','أدوية هشاشة العظام'],
    [/alpha blocker|5 alpha/i,'Alpha blockers','حاصرات ألفا'],
    [/\biron\b/i,'Iron preparations','مستحضرات الحديد'],
    [/vaccine|immunization/i,'Vaccines','اللقاحات'],
    [/immunosuppress/i,'Immunosuppressants','مثبطات المناعة'],
    [/antineoplast|chemotherapy|cytotoxic/i,'Cancer medicines','أدوية الأورام'],
    [/electrolyte|rehydration/i,'Electrolytes and rehydration','محاليل الأملاح والجفاف'],
    [/colony stimulating|g-csf|erythropoietin|erythropoiesis/i,'Blood cell stimulators','محفزات خلايا الدم'],
    [/anti.?hypertensive/i,'Antihypertensives','أدوية ضغط الدم'],
    [/antihyperlipidemic|cholesterol|statin/i,'Cholesterol-lowering medicines','أدوية الكوليسترول'],
    [/peptic ulcer|proton pump|h2 receptor|antacid/i,'Acid and ulcer medicines','أدوية الحموضة والقرحة'],
    [/anti.?diarrh/i,'Antidiarrheals','مضادات الإسهال'],
    [/cough|antitussive|expectorant/i,'Cough medicines','أدوية الكحة والبلغم'],
    [/decongest|cold products|nasal/i,'Cold and nasal medicines','أدوية البرد والأنف'],
    [/probiotic/i,'Probiotics','البروبيوتيك'],
    [/antiparasitic|anthelmintic|antiprotozoal|antimalarial/i,'Antiparasitics','مضادات الطفيليات'],
    [/gout|uricosuric/i,'Gout medicines','أدوية النقرس'],
    [/erectile|pde.?5/i,'Erectile dysfunction medicines','أدوية ضعف الانتصاب'],
    [/smoking|nicotine/i,'Smoking cessation','أدوية الإقلاع عن التدخين']
  ];
  const subgroup=(id,key,pattern,children)=>({id,key,pattern,children});
  const OTHER=/__uncategorized__never_matches__/i;
  const DRUG_SUBGROUPS={
    antibiotics:[subgroup('penicillins','subPenicillins',/penicillin|amoxicillin|ampicillin|flucloxacillin|piperacillin|clavulanate|sulbactam/i),subgroup('cephalosporins','subCephalosporins',/cephalosporin|\bcef[a-z-]*/i,[subgroup('firstGeneration','subFirstGeneration',/cefazolin|cefalexin|cephalexin|cefadroxil|cefradine/i),subgroup('secondGeneration','subSecondGeneration',/cefuroxime|cefaclor|cefoxitin|cefotetan|cefprozil/i),subgroup('thirdGeneration','subThirdGeneration',/ceftriaxone|cefotaxime|cefixime|ceftazidime|cefpodoxime|cefdinir|ceftibuten/i),subgroup('fourthGeneration','subFourthGeneration',/cefepime|cefpirome/i),subgroup('otherCephalosporins','subOtherCephalosporins',OTHER)]),subgroup('fluoroquinolones','subFluoroquinolones',/fluoroquinolone|quinolone|ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin|gatifloxacin/i),subgroup('macrolides','subMacrolides',/macrolide|azithromycin|clarithromycin|erythromycin|roxithromycin/i),subgroup('tetracyclines','subTetracyclines',/tetracycline|doxycycline|minocycline/i),subgroup('aminoglycosides','subAminoglycosides',/aminoglycoside|gentamicin|amikacin|tobramycin|neomycin/i),subgroup('sulfonamides','subSulfonamides',/sulfonamide|sulfamethoxazole|trimethoprim|co-trimoxazole/i),subgroup('nitroimidazoles','subNitroimidazoles',/nitroimidazole|metronidazole|tinidazole|ornidazole/i),subgroup('otherAntibiotics','subOtherAntibiotics',OTHER)],
    antivirals:[subgroup('herpesAntivirals','subHerpesAntivirals',/acyclovir|aciclovir|valacyclovir|valaciclovir|famciclovir/i),subgroup('influenzaAntivirals','subInfluenzaAntivirals',/oseltamivir|zanamivir|baloxavir/i),subgroup('hepatitisAntivirals','subHepatitisAntivirals',/hepatitis|tenofovir|entecavir|sofosbuvir|ledipasvir/i),subgroup('otherAntivirals','subOtherAntivirals',OTHER)],
    antifungals:[subgroup('azoleAntifungals','subAzoleAntifungals',/azole|fluconazole|itraconazole|ketoconazole|clotrimazole|miconazole/i),subgroup('allylamineAntifungals','subAllylamineAntifungals',/allylamine|terbinafine|naftifine/i),subgroup('polyeneAntifungals','subPolyeneAntifungals',/polyene|nystatin|amphotericin/i),subgroup('otherAntifungals','subOtherAntifungals',OTHER)],
    pain:[subgroup('nsaids','subNsaids',/\bnsaid\b|anti-inflammatory|ibuprofen|diclofenac|naproxen|ketoprofen|celecoxib|meloxicam|aspirin/i),subgroup('nonOpioidAnalgesics','subNonOpioidAnalgesics',/analgesic|paracetamol|acetaminophen|metamizole|dipyrone/i),subgroup('opioidAnalgesics','subOpioidAnalgesics',/opioid|tramadol|morphine|codeine|fentanyl/i),subgroup('otherPainMedicines','subOtherPainMedicines',OTHER)],
    allergy:[subgroup('antihistamines','subAntihistamines',/antihistamine|cetirizine|loratadine|fexofenadine|desloratadine|chlorpheniramine|diphenhydramine/i),subgroup('allergyCorticosteroids','subAllergyCorticosteroids',/corticosteroid|prednisolone|dexamethasone|mometasone|fluticasone|budesonide/i),subgroup('leukotrieneModifiers','subLeukotrieneModifiers',/leukotriene|montelukast|zafirlukast/i),subgroup('otherAllergyMedicines','subOtherAllergyMedicines',OTHER)],
    cardio:[subgroup('aceInhibitors','subAceInhibitors',/ace inhibitor|\bpril\b|enalapril|lisinopril|ramipril|captopril/i),subgroup('arbs','subArbs',/angiotensin receptor|\bsartan\b|losartan|valsartan|candesartan|irbesartan/i),subgroup('betaBlockers','subBetaBlockers',/beta.blocker|\bolol\b|bisoprolol|metoprolol|propranolol|carvedilol/i),subgroup('calciumChannelBlockers','subCalciumChannelBlockers',/calcium channel|amlodipine|nifedipine|diltiazem|verapamil/i),subgroup('diuretics','subDiuretics',/diuretic|furosemide|frusemide|hydrochlorothiazide|indapamide|spironolactone/i),subgroup('statins','subStatins',/statin|atorvastatin|simvastatin|rosuvastatin|pravastatin/i),subgroup('anticoagulants','subAnticoagulants',/anticoagulant|warfarin|apixaban|rivaroxaban|dabigatran|heparin/i),subgroup('otherCardioMedicines','subOtherCardioMedicines',OTHER)],
    diabetes:[subgroup('biguanides','subBiguanides',/biguanide|metformin/i),subgroup('sulfonylureas','subSulfonylureas',/sulfonylurea|glimepiride|gliclazide|glibenclamide|glyburide/i),subgroup('dpp4Inhibitors','subDpp4Inhibitors',/dpp.?4|gliptin|sitagliptin|vildagliptin|linagliptin/i),subgroup('sglt2Inhibitors','subSglt2Inhibitors',/sglt.?2|gliflozin|empagliflozin|dapagliflozin/i),subgroup('glp1Agonists','subGlp1Agonists',/glp.?1|glutide|liraglutide|semaglutide/i),subgroup('insulins','subInsulins',/insulin/i),subgroup('otherDiabetesMedicines','subOtherDiabetesMedicines',OTHER)],
    digestive:[subgroup('protonPumpInhibitors','subPpis',/proton pump|\bprazole\b|omeprazole|pantoprazole|esomeprazole/i),subgroup('h2Blockers','subH2Blockers',/h2 receptor|famotidine|ranitidine|cimetidine/i),subgroup('antacids','subAntacids',/antacid|aluminium hydroxide|magnesium hydroxide|calcium carbonate/i),subgroup('antiemetics','subAntiemetics',/antiemetic|ondansetron|metoclopramide|domperidone/i),subgroup('laxatives','subLaxatives',/laxative|lactulose|bisacodyl|senna|polyethylene glycol/i),subgroup('otherDigestiveMedicines','subOtherDigestiveMedicines',OTHER)],
    respiratory:[subgroup('beta2Bronchodilators','subBeta2Bronchodilators',/beta.?2 agonist|salbutamol|albuterol|formoterol|salmeterol|terbutaline/i),subgroup('respiratoryCorticosteroids','subRespiratoryCorticosteroids',/inhaled corticosteroid|budesonide|beclomethasone|fluticasone/i),subgroup('respiratoryLeukotrieneModifiers','subRespiratoryLeukotrieneModifiers',/leukotriene|montelukast|zafirlukast/i),subgroup('mucolytics','subMucolytics',/mucolytic|acetylcysteine|bromhexine|ambroxol/i),subgroup('otherRespiratoryMedicines','subOtherRespiratoryMedicines',OTHER)],
    psychiatry:[subgroup('antidepressants','subAntidepressants',/antidepressant|ssri|snri|serotonin|tricyclic|maoi|fluoxetine|sertraline|escitalopram|paroxetine|citalopram|venlafaxine|duloxetine|mirtazapine|amitriptyline/i),subgroup('antipsychotics','subAntipsychotics',/antipsychotic|neuroleptic|olanzapine|risperidone|quetiapine|aripiprazole|haloperidol|clozapine|ziprasidone/i),subgroup('anxiolytics','subAnxiolytics',/anxiolytic|anti.?anxiety|benzodiazepine|alprazolam|diazepam|lorazepam|clonazepam|buspirone/i),subgroup('hypnotics','subHypnotics',/hypnotic|sedative|zolpidem|zopiclone|eszopiclone|melatonin/i),subgroup('antiepileptics','subAntiepileptics',/antiepileptic|anticonvulsant|epilep|seizure|carbamazepine|valproate|valproic|lamotrigine|levetiracetam|phenytoin|gabapentin|pregabalin|topiramate/i),subgroup('moodStabilizers','subMoodStabilizers',/mood stabilizer|lithium|valpro|divalproex|lamotrigin/i),subgroup('adhdMedicines','subAdhdMedicines',/adhd|attention deficit|methylphenidate|atomoxetine|amphetamine|dexamfetamine/i),subgroup('parkinsonMedicines','subParkinsonMedicines',/parkinson|levodopa|carbidopa|pramipexole|ropinirole|selegiline|entacapone|trihexyphenidyl/i),subgroup('migraineMedicines','subMigraineMedicines',/migraine|triptan|sumatriptan|rizatriptan|eletriptan/i),subgroup('dementiaMedicines','subDementiaMedicines',/alzheimer|dementia|donepezil|rivastigmine|galantamine|memantine/i),subgroup('muscleRelaxants','subMuscleRelaxants',/muscle relaxant|muscle spasm|baclofen|tizanidine|cyclobenzaprine|orphenadrine|thiocolchicoside/i),subgroup('otherPsychiatry','subOtherPsychiatry',OTHER)],
    hormones:[subgroup('thyroidMedicines','subThyroidMedicines',/thyroid|levothyroxine|liothyronine|carbimazole|methimazole|propylthiouracil/i),subgroup('corticosteroids','subCorticosteroids',/corticosteroid|glucocorticoid|prednisolone|prednisone|dexamethasone|hydrocortisone|methylprednisolone|betamethasone|budesonide/i),subgroup('sexHormones','subSexHormones',/estrogen|estradiol|oestrogen|progesterone|progestin|testosterone|androgen|hormone replacement/i),subgroup('boneHealth','subBoneHealth',/osteoporosis|alendronate|risedronate|zoledronic|ibandronate|denosumab|raloxifene|teriparatide|calcitriol/i),subgroup('pituitaryAdrenal','subPituitaryAdrenal',/growth hormone|somatropin|prolactin|cabergoline|bromocriptine|octreotide|desmopressin|pituitary|adrenal|fludrocortisone/i),subgroup('otherHormones','subOtherHormones',OTHER)],
    urology:[subgroup('prostateMedicines','subProstateMedicines',/bph|benign prostatic|prostate enlarg|tamsulosin|alfuzosin|silodosin|doxazosin|terazosin/i),subgroup('erectileMedicines','subErectileMedicines',/erectile|pde.?5|sildenafil|tadalafil|vardenafil|avanafil/i),subgroup('bladderMedicines','subBladderMedicines',/overactive bladder|urinary incontinence|bladder|oxybutynin|tolterodine|solifenacin|mirabegron|darifenacin/i),subgroup('urinaryAntiseptics','subUrinaryAntiseptics',/urinary antiseptic|urinary tract|uti|nitrofurantoin|fosfomycin|methenamine/i),subgroup('otherUrology','subOtherUrology',OTHER)],
    eyeCare:[subgroup('glaucomaMedicines','subGlaucomaMedicines',/glaucoma|timolol|latanoprost|bimatoprost|travoprost|dorzolamide|brinzolamide|pilocarpine/i),subgroup('dryEyeMedicines','subDryEyeMedicines',/dry eye|artificial tear|tear substitute|carbomer|hyaluronic|hypromellose/i),subgroup('eyeAntiInfectives','subEyeAntiInfectives',/ophthalmic.{0,20}(antibiotic|anti.?infective)|eye drop.{0,20}(antibiotic|anti)|tobramycin|chloramphenicol|moxifloxacin|ofloxacin/i),subgroup('eyeAntiInflammatories','subEyeAntiInflammatories',/ophthalmic.{0,20}(steroid|anti.?inflammatory)|ketorolac|loteprednol/i),subgroup('mydriatics','subMydriatics',/mydriatic|cyclopentolate|tropicamide|atropine.{0,12}eye|phenylephrine.{0,12}eye/i),subgroup('otherEyeCare','subOtherEyeCare',OTHER)],
    entCare:[subgroup('nasalMedicines','subNasalMedicines',/nasal|nose|rhinitis|sinus|decongestant|oxymetazoline|xylometazoline|mometasone|fluticasone|saline nasal/i),subgroup('earMedicines','subEarMedicines',/otic|ear drop|ear wax|otitis|cerumen/i),subgroup('throatMedicines','subThroatMedicines',/throat|lozenge|gargle|pharyngitis|tonsil/i),subgroup('oralCare','subOralCare',/mouthwash|mouth rinse|oral gel|dental|tooth|teething|fluoride|chlorhexidine|benzydamine/i),subgroup('otherEntCare','subOtherEntCare',OTHER)],
    oncology:[subgroup('chemotherapy','subChemotherapy',/chemotherapy|cytotoxic|antineoplastic|alkylating|antimetabolite|cisplatin|doxorubicin|cyclophosphamide|methotrexate|fluorouracil|paclitaxel/i),subgroup('targetedTherapy','subTargetedTherapy',/targeted therapy|kinase inhibitor|monoclonal antibody|imatinib|erlotinib|sorafenib|sunitinib|rituximab|trastuzumab/i),subgroup('cancerImmunotherapy','subCancerImmunotherapy',/immunotherapy|checkpoint|pd.?1|pd.?l1|nivolumab|pembrolizumab|ipilimumab/i),subgroup('hormonalTherapy','subHormonalTherapy',/hormonal therapy|antiestrogen|aromatase|tamoxifen|anastrozole|letrozole|bicalutamide|leuprolide|goserelin/i),subgroup('cancerSupportive','subCancerSupportive',/supportive care|antiemetic|ondansetron|granisetron|filgrastim|colony stimulating|erythropoietin/i),subgroup('otherOncology','subOtherOncology',OTHER)],
    immunology:[subgroup('immunosuppressants','subImmunosuppressants',/immunosuppress|azathioprine|mycophenolate|tacrolimus|cyclosporine|methotrexate|hydroxychloroquine|sulfasalazine/i),subgroup('biologics','subBiologics',/biologic|monoclonal antibody|adalimumab|infliximab|etanercept|tocilizumab|omalizumab|ustekinumab/i),subgroup('immunoglobulins','subImmunoglobulins',/immunoglobulin|ivig|antibody replacement/i),subgroup('immunomodulators','subImmunomodulators',/immunomodulat|interferon|glatiramer/i),subgroup('otherImmunology','subOtherImmunology',OTHER)],
    vaccines:[subgroup('routineVaccines','subRoutineVaccines',/vaccine|immunization|toxoid|mmr|dtap|polio|hepatitis b|hpv|pneumococcal|meningococcal|influenza vaccine|rabies vaccine/i),subgroup('travelVaccines','subTravelVaccines',/travel vaccine|typhoid|yellow fever|cholera vaccine|japanese encephalitis/i),subgroup('passiveImmunity','subPassiveImmunity',/immunoglobulin|antisera|antivenom|antitoxin/i),subgroup('otherVaccines','subOtherVaccines',OTHER)],
    hematology:[subgroup('anticoagulants','subAnticoagulants',/anticoagulant|warfarin|enoxaparin|heparin|rivaroxaban|apixaban|dabigatran|fondaparinux/i),subgroup('antiplatelets','subAntiplatelets',/antiplatelet|clopidogrel|ticagrelor|prasugrel|dipyridamole|cilostazol/i),subgroup('hemostatics','subHemostatics',/hemostatic|tranexamic|aminocaproic|ethamsylate|vitamin k|phytonadione/i),subgroup('anemiaMedicines','subAnemiaMedicines',/anemia|anaemia|erythropoietin|epoetin|darbepoetin|folic acid|ferrous|iron supplement|hydroxocobalamin|cyanocobalamin/i),subgroup('colonyStimulating','subColonyStimulating',/colony stimulating|filgrastim|pegfilgrastim|lenograstim|sargramostim/i),subgroup('otherHematology','subOtherHematology',OTHER)],
    gynecology:[subgroup('contraceptives','subContraceptives',/contracept|birth control|ethinylestradiol|levonorgestrel|desogestrel|drospirenone|medroxyprogesterone|emergency contraception/i),subgroup('menopauseMedicines','subMenopauseMedicines',/menopause|hormone replacement|estradiol|conjugated estrogen|tibolone/i),subgroup('laborMedicines','subLaborMedicines',/labor|oxytocin|misoprostol|dinoprostone|uterine|postpartum|ergometrine|methylergometrine/i),subgroup('vaginalMedicines','subVaginalMedicines',/vaginal|vaginitis|pessary/i),subgroup('otherGynecology','subOtherGynecology',OTHER)],
    smokingCessation:[subgroup('nicotineReplacement','subNicotineReplacement',/nicotine/i),subgroup('prescriptionSmokingCessation','subPrescriptionSmokingCessation',/varenicline|bupropion|smoking cessation|stop smoking/i),subgroup('otherSmokingCessation','subOtherSmokingCessation',OTHER)],
    weightManagement:[subgroup('glp1Medicines','subGlp1Medicines',/glp.?1|semaglutide|liraglutide|tirzepatide|dulaglutide|exenatide/i),subgroup('lipaseInhibitors','subLipaseInhibitors',/orlistat|lipase inhibitor/i),subgroup('appetiteMedicines','subAppetiteMedicines',/appetite suppressant|weight loss|obesity|phentermine|naltrexone/i),subgroup('otherWeightManagement','subOtherWeightManagement',OTHER)],
    dental:[subgroup('fluorideProducts','subFluorideProducts',/fluoride|fluoride varnish|toothpaste/i),subgroup('oralAntiseptics','subOralAntiseptics',/mouthwash|chlorhexidine|antiseptic.{0,12}mouth|oral antiseptic/i),subgroup('teethingProducts','subTeethingProducts',/teething|oral gel|benzocaine.{0,12}mouth|lidocaine.{0,12}mouth/i),subgroup('otherDental','subOtherDental',OTHER)],
    hairCare:[subgroup('hairLossTreatments','subHairLoss',/hair loss|hair regrowth|alopecia|minoxidil|finasteride|dutasteride/i),subgroup('antiDandruff','subAntiDandruff',/dandruff|anti.?dandruff|ketoconazole|zinc pyrithione|selenium sulfide|coal tar/i),subgroup('scalpTreatments','subScalpTreatments',/scalp|follicle|hair tonic|hair treatment|anti.?lice|\blice\b/i),subgroup('hairCleansers','subHairCleansers',/shampoo|hair wash|scalp wash/i),subgroup('hairConditioners','subHairConditioners',/conditioner|hair mask|hair oil|hair serum|hair cream|hair lotion|argan|keratin/i),subgroup('hairRemoval','subHairRemoval',/hair removal|depilat|epilat|wax|laser hair/i),subgroup('otherHairCare','subOtherHairCare',OTHER)],
    skinCare:[subgroup('acneTreatments','subAcneTreatments',/\bacne\b|benzoyl peroxide|salicylic|adapalene|isotretinoin|tretinoin|retinoid|retinol/i),subgroup('sunscreens','subSunscreens',/sun.?block|sun.?screen|\bspf\b|\buv\b/i),subgroup('skinLightening','subSkinLightening',/whitening|whiting|lightening|pigment|melasma|hydroquinone|arbutin|kojic|glutathione/i),subgroup('antiAgingSkin','subAntiAgingSkin',/anti.?aging|anti.?wrinkle|firming|rejuvenat|collagen|hyaluronic|peptide|eye contour/i),subgroup('exfoliants','subExfoliants',/exfoliant|peeling|\bpeel\b|keratolytic|glycolic|lactic acid|salicylic|urea/i),subgroup('topicalSteroids','subTopicalSteroids',/corticosteroid|glucocorticoid|adenocorticoid|hydrocortisone|betamethasone|mometasone|clobetasol|triamcinolone|desonide|prednicarbate/i),subgroup('skinAntiseptics','subSkinAntiseptics',/antibiotic|antibacterial|bactericidal|microbicidal|antiseptic|chlorhexidine|povidone|fusidic|mupirocin|neomycin|bacitracin/i),subgroup('woundScarCare','subWoundScarCare',/wound|healing|scar|\bburns?\b|diaper rash|repair/i),subgroup('skinCleansers','subSkinCleansers',/cleanser|face wash|facial wash|\bwash\b|soap|shower|bath|scrub|facial/i),subgroup('skinMoisturizers','subSkinMoisturizers',/moistur|emollient|soothing|hydrat|lotion|cream|ointment|panthenol|glycerin|urea|petrolatum/i),subgroup('otherSkinCare','subOtherSkinCare',OTHER)],
    supplements:[subgroup('multivitamins','subMultivitamins',/multivitamin|multi.?vitamin|vitamin b complex|vitamins? (and|with) minerals?/i),subgroup('prenatalSupplements','subPrenatalSupplements',/prenatal|pregnan|breastfeeding|lactation|folic acid|folate/i),subgroup('electrolyteSupplements','subElectrolyteSupplements',/electrolyte|rehydration|oral rehydration|\bors\b|hydration/i),subgroup('mineralSupplements','subMineralSupplements',/mineral|calcium|\biron\b|zinc|magnesium|potassium|selenium|iodine|copper|manganese|chromium/i),subgroup('singleVitamins','subSingleVitamins',/\bvitamin [a-k]\b|\bvitamin\b|biotin|niacin|thiamine|riboflavin|ascorbic/i),subgroup('omegaFattyAcids','subOmegaFattyAcids',/omega|fish oil|fatty acid|\bdha\b|\bepa\b|flaxseed|linoleic/i),subgroup('probioticSupplements','subProbioticSupplements',/probiotic|prebiotic|lactobacillus|bifidobacterium|gut health/i),subgroup('proteinAminos','subProteinAminos',/protein|amino acid|whey|creatine|bcaa/i),subgroup('herbalSupplements','subHerbalSupplements',/herbal|ginseng|ginkgo|botanical|plant extract/i),subgroup('antioxidantSupplements','subAntioxidant',/antioxidant/i),subgroup('jointSupplements','subJointSupplements',/joint|cartilage|glucosamine|chondroitin|collagen/i),subgroup('otherSupplements','subOtherSupplements',OTHER)]
  };
  const drugTaxonomyLabels={subAntidepressants:['Antidepressants','مضادات الاكتئاب'],subAntipsychotics:['Antipsychotics','مضادات الذهان'],subAnxiolytics:['Anti-anxiety medicines','مضادات القلق'],subHypnotics:['Sedatives and hypnotics','المهدئات والمنومات'],subAntiepileptics:['Anti-seizure medicines','مضادات التشنج'],subMoodStabilizers:['Mood stabilizers','مثبتات المزاج'],subAdhdMedicines:['ADHD medicines','أدوية فرط الحركة'],subParkinsonMedicines:['Parkinson medicines','أدوية باركنسون'],subMigraineMedicines:['Migraine medicines','أدوية الصداع النصفي'],subDementiaMedicines:['Dementia medicines','أدوية الخرف'],subMuscleRelaxants:['Muscle relaxants','مرخيات العضلات'],subOtherPsychiatry:['Other mental health medicines','أدوية نفسية أخرى'],subThyroidMedicines:['Thyroid medicines','أدوية الغدة الدرقية'],subCorticosteroids:['Corticosteroids','الكورتيكوستيرويدات'],subSexHormones:['Sex hormones','الهرمونات الجنسية'],subBoneHealth:['Bone health','صحة العظام'],subPituitaryAdrenal:['Pituitary and adrenal','الغدة النخامية والكظرية'],subOtherHormones:['Other hormone medicines','أدوية هرمونية أخرى'],subProstateMedicines:['Prostate medicines','أدوية البروستاتا'],subErectileMedicines:['Erectile dysfunction','ضعف الانتصاب'],subBladderMedicines:['Bladder control','التحكم في المثانة'],subUrinaryAntiseptics:['Urinary anti-infectives','مضادات عدوى المسالك'],subOtherUrology:['Other urology medicines','أدوية مسالك أخرى'],subGlaucomaMedicines:['Glaucoma','الجلاوكوما'],subDryEyeMedicines:['Dry eye and tears','جفاف العين والدموع'],subEyeAntiInfectives:['Eye anti-infectives','مضادات عدوى العين'],subEyeAntiInflammatories:['Eye anti-inflammatories','مضادات التهاب العين'],subMydriatics:['Eye drops for dilation','قطرات توسيع الحدقة'],subOtherEyeCare:['Other eye medicines','أدوية عيون أخرى'],subNasalMedicines:['Nasal and sinus','الأنف والجيوب'],subEarMedicines:['Ear medicines','أدوية الأذن'],subThroatMedicines:['Throat medicines','أدوية الحلق'],subOralCare:['Oral care','العناية بالفم'],subOtherEntCare:['Other ENT medicines','أدوية أنف وأذن أخرى'],subChemotherapy:['Chemotherapy','العلاج الكيميائي'],subTargetedTherapy:['Targeted therapy','العلاج الموجه'],subCancerImmunotherapy:['Cancer immunotherapy','العلاج المناعي للأورام'],subHormonalTherapy:['Hormonal therapy','العلاج الهرموني'],subCancerSupportive:['Supportive cancer care','الدعم المصاحب للعلاج'],subOtherOncology:['Other cancer medicines','أدوية أورام أخرى'],subImmunosuppressants:['Immunosuppressants','مثبطات المناعة'],subBiologics:['Biologic medicines','الأدوية البيولوجية'],subImmunoglobulins:['Immunoglobulins','الغلوبولين المناعي'],subImmunomodulators:['Immunomodulators','معدلات المناعة'],subOtherImmunology:['Other immunology medicines','أدوية مناعة أخرى'],subRoutineVaccines:['Routine vaccines','التطعيمات الروتينية'],subTravelVaccines:['Travel vaccines','تطعيمات السفر'],subPassiveImmunity:['Passive immunity','المناعة السلبية'],subOtherVaccines:['Other vaccines','تطعيمات أخرى'],subAnticoagulants:['Anticoagulants','مضادات التجلط'],subAntiplatelets:['Antiplatelets','مضادات الصفائح'],subHemostatics:['Bleeding control','إيقاف النزيف'],subAnemiaMedicines:['Anemia medicines','أدوية الأنيميا'],subColonyStimulating:['Colony-stimulating factors','محفزات المستعمرات'],subOtherHematology:['Other blood medicines','أدوية دم أخرى'],subContraceptives:['Contraceptives','وسائل منع الحمل'],subMenopauseMedicines:['Menopause','سن اليأس'],subLaborMedicines:['Labor and uterine','الولادة والرحم'],subVaginalMedicines:['Vaginal medicines','أدوية مهبلية'],subOtherGynecology:['Other women’s health','أدوية نساء أخرى'],subNicotineReplacement:['Nicotine replacement','بدائل النيكوتين'],subPrescriptionSmokingCessation:['Prescription cessation','أدوية إقلاع بوصفة'],subOtherSmokingCessation:['Other cessation aids','مساعدات إقلاع أخرى'],subGlp1Medicines:['GLP-1 medicines','أدوية GLP-1'],subLipaseInhibitors:['Lipase inhibitors','مثبطات الليباز'],subAppetiteMedicines:['Appetite and obesity','الشهية والسمنة'],subOtherWeightManagement:['Other weight medicines','أدوية وزن أخرى'],subFluorideProducts:['Fluoride','الفلورايد'],subOralAntiseptics:['Oral antiseptics','مطهرات الفم'],subTeethingProducts:['Teething and oral gels','التسنين وجل الفم'],subOtherDental:['Other dental products','منتجات أسنان أخرى'],
    subPenicillins:['Penicillins','البنسلينات'],subCephalosporins:['Cephalosporins','السيفالوسبورينات'],subFirstGeneration:['1st generation','الجيل الأول'],subSecondGeneration:['2nd generation','الجيل الثاني'],subThirdGeneration:['3rd generation','الجيل الثالث'],subFourthGeneration:['4th generation','الجيل الرابع'],subOtherCephalosporins:['Other cephalosporins','سيفالوسبورينات أخرى'],subFluoroquinolones:['Fluoroquinolones','الفلوروكينولونات'],subMacrolides:['Macrolides','الماكروليدات'],subTetracyclines:['Tetracyclines','التتراسيكلينات'],subAminoglycosides:['Aminoglycosides','الأمينوغليكوزيدات'],subSulfonamides:['Sulfonamides','السلفوناميدات'],subNitroimidazoles:['Nitroimidazoles','النيتروإيميدازولات'],subOtherAntibiotics:['Other antibiotics','مضادات حيوية أخرى'],subHerpesAntivirals:['Herpes antivirals','مضادات فيروسات الهربس'],subInfluenzaAntivirals:['Influenza antivirals','مضادات الإنفلونزا'],subHepatitisAntivirals:['Hepatitis antivirals','مضادات التهاب الكبد الفيروسية'],subOtherAntivirals:['Other antivirals','مضادات فيروسية أخرى'],subAzoleAntifungals:['Azole antifungals','مضادات الفطريات الآزولية'],subAllylamineAntifungals:['Allylamine antifungals','مضادات الفطريات الأليل أمينية'],subPolyeneAntifungals:['Polyene antifungals','مضادات الفطريات متعددة الإين'],subOtherAntifungals:['Other antifungals','مضادات فطريات أخرى'],subNsaids:['NSAIDs','مضادات الالتهاب غير الستيرويدية'],subNonOpioidAnalgesics:['Non-opioid pain relievers','مسكنات غير أفيونية'],subOpioidAnalgesics:['Opioid pain relievers','مسكنات أفيونية'],subOtherPainMedicines:['Other pain medicines','أدوية ألم أخرى'],subAntihistamines:['Antihistamines','مضادات الهيستامين'],subAllergyCorticosteroids:['Corticosteroids','الكورتيكوستيرويدات'],subLeukotrieneModifiers:['Leukotriene modifiers','معدلات اللوكوترين'],subOtherAllergyMedicines:['Other allergy medicines','أدوية حساسية أخرى'],subAceInhibitors:['ACE inhibitors','مثبطات الإنزيم المحول للأنجيوتنسين'],subArbs:['ARBs','حاصرات مستقبلات الأنجيوتنسين'],subBetaBlockers:['Beta blockers','حاصرات بيتا'],subCalciumChannelBlockers:['Calcium channel blockers','حاصرات قنوات الكالسيوم'],subDiuretics:['Diuretics','مدرات البول'],subStatins:['Statins','الستاتينات'],subAnticoagulants:['Anticoagulants','مضادات التخثر'],subOtherCardioMedicines:['Other heart medicines','أدوية قلب أخرى'],subBiguanides:['Biguanides','البيغوانيدات'],subSulfonylureas:['Sulfonylureas','السلفونيل يوريا'],subDpp4Inhibitors:['DPP-4 inhibitors','مثبطات DPP-4'],subSglt2Inhibitors:['SGLT2 inhibitors','مثبطات SGLT2'],subGlp1Agonists:['GLP-1 agonists','ناهضات GLP-1'],subInsulins:['Insulins','الإنسولينات'],subOtherDiabetesMedicines:['Other diabetes medicines','أدوية سكري أخرى'],subPpis:['Proton pump inhibitors','مثبطات مضخة البروتون'],subH2Blockers:['H2 blockers','حاصرات H2'],subAntacids:['Antacids','مضادات الحموضة'],subAntiemetics:['Antiemetics','مضادات القيء'],subLaxatives:['Laxatives','الملينات'],subOtherDigestiveMedicines:['Other digestive medicines','أدوية هضمية أخرى'],subBeta2Bronchodilators:['Beta-2 bronchodilators','موسعات الشعب بيتا-2'],subRespiratoryCorticosteroids:['Corticosteroids','كورتيكوستيرويدات تنفسية'],subRespiratoryLeukotrieneModifiers:['Leukotriene modifiers','معدلات اللوكوترين'],subMucolytics:['Mucolytics','مذيبات البلغم'],subOtherRespiratoryMedicines:['Other respiratory medicines','أدوية تنفسية أخرى'],subHairLoss:['Hair loss treatments','علاجات تساقط الشعر'],subAntiDandruff:['Anti-dandruff','مضادات القشرة'],subScalpTreatments:['Scalp treatments','علاجات فروة الرأس'],subHairCleansers:['Shampoos & cleansers','شامبوهات وغسولات الشعر'],subHairConditioners:['Conditioners & masks','بلسم وأقنعة الشعر'],subHairRemoval:['Hair removal','إزالة الشعر'],subOtherHairCare:['Other hair care','عناية أخرى بالشعر'],subSunscreens:['Sunscreens','واقيات الشمس'],subAcneTreatments:['Acne treatments','علاجات حب الشباب'],subSkinLightening:['Lightening & pigmentation','تفتيح وتوحيد لون البشرة'],subAntiAgingSkin:['Anti-aging & firming','مضادات التجاعيد والشد'],subExfoliants:['Exfoliants & keratolytics','مقشرات ومحللات الكيراتين'],subTopicalSteroids:['Topical corticosteroids','كورتيزون موضعي'],subSkinAntiseptics:['Topical antiseptics','مطهرات ومضادات ميكروبات موضعية'],subWoundScarCare:['Wound & scar care','العناية بالجروح والندبات'],subSkinCleansers:['Cleansers & washes','غسولات البشرة'],subSkinMoisturizers:['Moisturizers & emollients','مرطبات وملطفات الجلد'],subOtherSkinCare:['Other skin care','عناية أخرى بالبشرة'],subMultivitamins:['Multivitamins','فيتامينات متعددة'],subPrenatalSupplements:['Prenatal & lactation','مكملات الحمل والرضاعة'],subElectrolyteSupplements:['Electrolytes & rehydration','محاليل الأملاح والجفاف'],subMineralSupplements:['Minerals','معادن'],subSingleVitamins:['Single vitamins','فيتامينات مفردة'],subOmegaFattyAcids:['Omega & fatty acids','أوميغا وأحماض دهنية'],subProbioticSupplements:['Probiotics & prebiotics','بروبيوتيك وبريبيوتيك'],subProteinAminos:['Protein & amino acids','بروتين وأحماض أمينية'],subHerbalSupplements:['Herbal supplements','مكملات عشبية'],subAntioxidant:['Antioxidants','مضادات الأكسدة'],subJointSupplements:['Joint & cartilage support','دعم المفاصل والغضاريف'],subOtherSupplements:['Other supplements','مكملات أخرى'],subgroupAll:['Medicine groups','مجموعات الأدوية']
  };
  const groupExplanation=(mechanism,effect,mechanismAr,effectAr)=>({en:[mechanism,effect],ar:[mechanismAr,effectAr]});
  const drugGroupExplanations={
    antibiotics:groupExplanation('Antibiotics act on bacterial structures or processes such as cell-wall building, protein production, or DNA replication. The target differs by subgroup.','They can inhibit growth or kill susceptible bacteria; they do not treat viral infections, and resistance can make a drug ineffective.','تستهدف المضادات الحيوية تراكيب أو عمليات بكتيرية مثل بناء جدار الخلية أو تصنيع البروتين أو تضاعف الحمض النووي، ويختلف الهدف حسب الفئة.','قد توقف نمو البكتيريا الحساسة أو تقضي عليها، لكنها لا تعالج الفيروسات وقد تجعل المقاومة الدواء غير فعال.'),
    penicillins:groupExplanation('Penicillins are beta-lactams that bind bacterial penicillin-binding proteins and interrupt cell-wall cross-linking.','This weakens the wall and can kill susceptible bacteria as they grow; bacterial enzymes and allergy can limit use.','البنسلينات من مجموعة البيتا-لاكتام؛ ترتبط ببروتينات بناء جدار البكتيريا وتمنع تشابك مكوناته.','يضعف الجدار وقد يؤدي ذلك إلى قتل البكتيريا الحساسة أثناء نموها؛ وقد تحد إنزيمات المقاومة أو الحساسية من استخدامها.'),
    cephalosporins:groupExplanation('Cephalosporins are beta-lactams that inhibit bacterial cell-wall synthesis by binding penicillin-binding proteins.','They act against susceptible bacteria. The spectrum changes across generations, but a later generation is not automatically better for every infection.','السيفالوسبورينات من البيتا-لاكتام؛ تثبط بناء جدار البكتيريا عبر الارتباط ببروتينات بناء الجدار.','تؤثر في البكتيريا الحساسة، ويتغير نطاقها بين الأجيال؛ ولا يعني الجيل الأحدث أنه الأنسب لكل عدوى.'),
    firstGeneration:groupExplanation('First-generation cephalosporins inhibit bacterial cell-wall synthesis through penicillin-binding proteins.','Their activity is strongest against many susceptible Gram-positive bacteria, with selected Gram-negative coverage.','تثبط سيفالوسبورينات الجيل الأول بناء جدار البكتيريا عبر بروتينات الارتباط بالبنسلين.','تكون فعاليتها أوضح تجاه أنواع حساسة عديدة موجبة الغرام، مع تغطية محددة لبعض سالبة الغرام.'),
    secondGeneration:groupExplanation('Second-generation cephalosporins inhibit bacterial cell-wall synthesis.','Compared with first-generation agents, activity generally shifts toward a broader range of selected Gram-negative bacteria; individual agents differ.','تثبط سيفالوسبورينات الجيل الثاني بناء جدار البكتيريا.','يمتد نطاق بعض أدوية هذا الجيل إلى أنواع سالبة الغرام أكثر مقارنة بالجيل الأول، مع اختلاف التغطية من دواء لآخر.'),
    thirdGeneration:groupExplanation('Third-generation cephalosporins inhibit bacterial cell-wall synthesis by binding penicillin-binding proteins.','Many have useful activity against susceptible Gram-negative bacteria; resistance and infection site still determine whether they work.','تثبط سيفالوسبورينات الجيل الثالث بناء جدار البكتيريا عبر بروتينات الارتباط بالبنسلين.','يؤثر كثير منها في أنواع حساسة من البكتيريا سالبة الغرام؛ وتظل المقاومة ومكان العدوى عاملين أساسيين لفعاليتها.'),
    fourthGeneration:groupExplanation('Fourth-generation cephalosporins inhibit bacterial cell-wall synthesis and are designed to retain activity against some beta-lactamase-producing organisms.','They can cover selected Gram-positive and Gram-negative bacteria, but susceptibility must be considered.','تثبط سيفالوسبورينات الجيل الرابع بناء جدار البكتيريا، وصُممت بعض أدوية هذا الجيل لتحافظ على نشاطها أمام إنزيمات مقاومة معينة.','قد تغطي أنواعًا محددة موجبة وسالبة الغرام، لكن يلزم مراعاة حساسية البكتيريا للدواء.'),
    fluoroquinolones:groupExplanation('Fluoroquinolones inhibit bacterial DNA gyrase and topoisomerase IV, enzymes needed to copy and maintain bacterial DNA.','This blocks bacterial replication and can kill susceptible bacteria; resistance and important class-specific risks limit use.','تثبط الفلوروكينولونات إنزيمي جيراز الحمض النووي وتوبويزوميراز IV اللازمين لنسخ الحمض النووي البكتيري وصيانته.','يوقف ذلك تكاثر البكتيريا وقد يقضي على الأنواع الحساسة؛ وتحد المقاومة ومخاطر الفئة من استخدامها.'),
    macrolides:groupExplanation('Macrolides bind the 50S bacterial ribosome and interfere with protein synthesis.','They usually slow the growth of susceptible bacteria; activity and resistance vary by organism and medicine.','ترتبط الماكروليدات بالوحدة 50S من ريبوسوم البكتيريا وتعيق تصنيع البروتين.','تبطئ غالبًا نمو البكتيريا الحساسة، وتختلف الفعالية والمقاومة باختلاف النوع والدواء.'),
    tetracyclines:groupExplanation('Tetracyclines bind the 30S ribosomal subunit and prevent an essential transfer RNA step in bacterial protein synthesis.','They usually inhibit bacterial growth rather than directly kill bacteria; absorption interactions and patient-specific cautions matter.','ترتبط التتراسيكلينات بالوحدة 30S من الريبوسوم وتمنع خطوة أساسية في تصنيع البروتين البكتيري.','توقف عادة نمو البكتيريا بدلًا من قتلها مباشرة؛ كما تؤثر تداخلات الامتصاص والتحذيرات الخاصة بالمريض في استخدامها.'),
    aminoglycosides:groupExplanation('Aminoglycosides bind the 30S ribosomal subunit, disrupting bacterial protein production and causing translation errors.','They can kill susceptible aerobic bacteria; kidney and hearing toxicity are important class risks.','ترتبط الأمينوغليكوزيدات بالوحدة 30S من الريبوسوم، فتعيق تصنيع البروتين وتسبب أخطاء في ترجمته.','قد تقضي على بكتيريا هوائية حساسة؛ ومن مخاطر الفئة المهمة التأثير في الكلى والسمع.'),
    sulfonamides:groupExplanation('Sulfonamides block dihydropteroate synthase, reducing bacterial folate production needed to make DNA building blocks.','This usually slows bacterial growth; some products combine them with another folate-pathway inhibitor.','تثبط السلفوناميدات إنزيم تصنيع ثنائي هيدروبتيروات، فتقلل إنتاج الفولات البكتيري اللازم لتكوين مكونات الحمض النووي.','يؤدي ذلك عادة إلى إبطاء نمو البكتيريا؛ وتجمع بعض المنتجات بينها وبين دواء يثبط خطوة أخرى في مسار الفولات.'),
    nitroimidazoles:groupExplanation('Nitroimidazoles are activated in susceptible anaerobic microbes, forming reactive products that damage DNA.','They act against selected anaerobic bacteria and some parasites; they are not broad remedies for all infections.','تُنشط النيتروإيميدازولات داخل بعض الميكروبات اللاهوائية الحساسة، فتتكون نواتج تفاعلية تضر الحمض النووي.','تؤثر في أنواع محددة من البكتيريا اللاهوائية وبعض الطفيليات، ولا تعالج جميع أنواع العدوى.'),
    antivirals:groupExplanation('Antivirals interfere with virus-specific steps such as genome copying, protein processing, or release from infected cells.','Their effects are virus- and medicine-specific; an antiviral for one virus does not work for all viral infections.','تتداخل مضادات الفيروسات مع خطوات خاصة بالفيروس مثل نسخ مادته الوراثية أو معالجة بروتيناته أو خروجه من الخلايا المصابة.','يختلف تأثيرها حسب الفيروس والدواء؛ فمضاد فيروس معين لا يعالج كل أنواع العدوى الفيروسية.'),
    herpesAntivirals:groupExplanation('Many herpes antivirals resemble DNA building blocks and inhibit viral DNA polymerase after activation in infected cells.','They limit viral replication and may reduce outbreak duration or severity, but do not remove latent virus from the body.','يشبه كثير من مضادات الهربس وحدات بناء الحمض النووي، ويثبط إنزيم نسخ الحمض النووي الفيروسي بعد تنشيطه في الخلايا المصابة.','تحد من تكاثر الفيروس وقد تقلل مدة النوبة أو شدتها، لكنها لا تزيل الفيروس الكامن من الجسم.'),
    influenzaAntivirals:groupExplanation('Influenza medicines target viral replication or release; neuraminidase inhibitors, for example, reduce release of new virus particles.','They may shorten illness in appropriate cases, especially when started promptly; they do not replace vaccination or supportive care.','تستهدف أدوية الإنفلونزا تكاثر الفيروس أو خروجه؛ فمثبطات إنزيم نيورامينيداز مثلًا تقلل تحرر الجسيمات الفيروسية الجديدة.','قد تقصر مدة المرض في حالات مناسبة، خصوصًا عند بدء العلاج مبكرًا؛ لكنها لا تحل محل التطعيم أو الرعاية الداعمة.'),
    hepatitisAntivirals:groupExplanation('Hepatitis antivirals target virus-specific enzymes or proteins needed for genome replication and processing.','They can suppress or clear particular hepatitis viruses depending on the regimen; the different hepatitis viruses require different treatments.','تستهدف مضادات التهاب الكبد الفيروسية إنزيمات أو بروتينات خاصة بالفيروس تلزم لنسخ مادته الوراثية ومعالجتها.','قد تثبط أو تقضي على فيروسات التهاب كبد معينة حسب الخطة العلاجية؛ وتختلف علاجات الفيروسات بعضها عن بعض.'),
    antifungals:groupExplanation('Antifungals target fungal structures or pathways, commonly membrane ergosterol or its synthesis.','They inhibit or kill susceptible fungi; the organism, body site, and formulation influence the effect.','تستهدف مضادات الفطريات تراكيب أو مسارات فطرية، وغالبًا غشاء الخلية المحتوي على الإرغوستيرول أو طريقة تصنيعه.','تثبط الفطريات الحساسة أو تقضي عليها؛ ويتوقف التأثير على نوع الفطر ومكان العدوى والتركيبة.'),
    azoleAntifungals:groupExplanation('Azoles inhibit fungal lanosterol 14-alpha-demethylase, reducing ergosterol needed for the fungal cell membrane.','The weakened membrane slows fungal growth; spectrum and interactions differ among azole medicines.','تثبط الآزولات إنزيمًا فطريًا لازمًا لتصنيع الإرغوستيرول الذي تحتاجه الخلية الفطرية لغشائها.','يضعف الغشاء ويتباطأ نمو الفطر؛ ويختلف نطاق التأثير والتداخلات بين أدوية الآزول.'),
    allylamineAntifungals:groupExplanation('Allylamines inhibit squalene epoxidase, an early step in fungal ergosterol synthesis.','This disrupts the fungal membrane and can be fungicidal for susceptible organisms, especially dermatophytes.','تثبط الأليل أمينات إنزيم سكوالين إيبوكسيداز، وهو خطوة مبكرة في تصنيع الإرغوستيرول الفطري.','يخل ذلك بغشاء الفطر وقد يؤدي إلى قتله إذا كان حساسًا، خاصةً الفطريات الجلدية.'),
    polyeneAntifungals:groupExplanation('Polyenes bind ergosterol in fungal membranes and form pores that allow cell contents to leak.','This can kill susceptible fungi; route and formulation strongly affect exposure and risks.','ترتبط متعددات الإين بالإرغوستيرول في غشاء الفطر وتكوّن مسامًا تسمح بتسرب محتويات الخلية.','قد يقضي ذلك على الفطريات الحساسة؛ ويؤثر طريق الإعطاء والتركيبة كثيرًا في التعرض والمخاطر.'),
    pain:groupExplanation('Pain medicines act through varied pathways, including prostaglandin production or pain-signaling receptors.','They can reduce pain or inflammation, but effects and risks depend strongly on the medicine and formulation.','تعمل أدوية الألم بطرق متعددة، منها التأثير في إنتاج البروستاغلاندينات أو مستقبلات نقل الألم.','قد تخفف الألم أو الالتهاب، لكن التأثير والمخاطر يعتمدان كثيرًا على الدواء وتركيبته.'),
    nsaids:groupExplanation('NSAIDs inhibit cyclo-oxygenase enzymes and reduce prostaglandin production.','This can relieve pain, fever, and inflammation; reduced protective prostaglandins can also affect the stomach, kidneys, blood pressure, and heart.','تثبط مضادات الالتهاب غير الستيرويدية إنزيمات الأكسدة الحلقية وتقلل إنتاج البروستاغلاندينات.','قد تخفف الألم والحمى والالتهاب؛ لكن نقص البروستاغلاندينات الواقية قد يؤثر أيضًا في المعدة والكلى وضغط الدم والقلب.'),
    nonOpioidAnalgesics:groupExplanation('Non-opioid pain relievers use different mechanisms; paracetamol mainly alters pain and temperature signaling in the central nervous system.','They can relieve pain or fever without opioid receptor activation; each ingredient has its own dose limits and risks.','تختلف آليات المسكنات غير الأفيونية؛ ويؤثر الباراسيتامول أساسًا في إشارات الألم والحرارة بالجهاز العصبي المركزي.','قد تخفف الألم أو الحمى دون تنشيط مستقبلات الأفيون؛ ولكل مادة حدود استخدام ومخاطر خاصة بها.'),
    opioidAnalgesics:groupExplanation('Opioids activate opioid receptors in the nervous system and reduce transmission and perception of pain.','They can relieve moderate to severe pain but may cause sedation, constipation, dependence, and dangerously slow breathing.','تنشط الأفيونات مستقبلاتها في الجهاز العصبي فتقلل انتقال الألم والإحساس به.','قد تخفف الألم المتوسط أو الشديد، لكنها قد تسبب النعاس والإمساك والاعتماد الدوائي وبطء التنفس الخطير.'),
    allergy:groupExplanation('Allergy medicines reduce symptoms by blocking or dampening pathways such as histamine or leukotriene signaling and inflammation.','They can ease itching, sneezing, hives, or airway inflammation, but do not necessarily prevent severe allergic reactions.','تخفف أدوية الحساسية الأعراض عبر حجب أو تهدئة مسارات مثل الهيستامين أو اللوكوترين والالتهاب.','قد تخفف الحكة والعطس والشرى أو التهاب الشعب، لكنها لا تمنع بالضرورة التفاعلات التحسسية الشديدة.'),
    antihistamines:groupExplanation('H1 antihistamines block or stabilize histamine H1 receptors, reducing histamine-driven symptoms.','They can ease itching, sneezing, runny nose, and hives; drowsiness varies by medicine and person.','تحجب مضادات الهيستامين H1 مستقبلات الهيستامين أو تثبط نشاطها، فتقلل الأعراض الناتجة عنه.','قد تخفف الحكة والعطس وسيلان الأنف والشرى؛ ويختلف النعاس حسب الدواء والشخص.'),
    allergyCorticosteroids:groupExplanation('Corticosteroids alter gene signaling to reduce multiple inflammatory pathways.','They can reduce allergic inflammation locally or throughout the body depending on formulation; prolonged or systemic use has broader risks.','تؤثر الكورتيكوستيرويدات في تنظيم الجينات فتقلل مسارات التهابية متعددة.','قد تخفف التهاب الحساسية موضعيًا أو في الجسم كله حسب التركيبة؛ ويزيد الاستخدام المطول أو الجهازي من المخاطر.'),
    leukotrieneModifiers:groupExplanation('These medicines block leukotriene receptors or reduce leukotriene production, dampening an inflammatory signal.','They may help selected asthma or allergy symptoms but are not immediate rescue treatment for a severe attack.','تحجب هذه الأدوية مستقبلات اللوكوترين أو تقلل إنتاجه، فتهدئ إحدى إشارات الالتهاب.','قد تفيد بعض أعراض الربو أو الحساسية، لكنها ليست علاج إنقاذ فوريًا للنوبة الشديدة.'),
    cardio:groupExplanation('Cardiovascular medicines influence blood-vessel tone, heart workload, fluid balance, clotting, or cholesterol through different targets.','They can lower blood pressure or cardiovascular risk; their effects and monitoring needs depend on the particular medicine.','تؤثر أدوية القلب والأوعية في توتر الأوعية أو جهد القلب أو توازن السوائل أو التخثر أو الكوليسترول عبر أهداف مختلفة.','قد تخفض ضغط الدم أو مخاطر القلب؛ ويعتمد التأثير وما يلزم من متابعة على الدواء المحدد.'),
    aceInhibitors:groupExplanation('ACE inhibitors reduce formation of angiotensin II, a signal that tightens blood vessels and promotes aldosterone release.','This can relax vessels and lower blood pressure; kidney function and potassium may need monitoring.','تقلل مثبطات ACE تكوين الأنجيوتنسين II، وهو إشارة تضيق الأوعية وتزيد إفراز الألدوستيرون.','قد يؤدي ذلك إلى ارتخاء الأوعية وخفض الضغط؛ وقد تلزم متابعة وظائف الكلى والبوتاسيوم.'),
    arbs:groupExplanation('ARBs block angiotensin II at AT1 receptors, reducing vessel constriction and aldosterone signaling.','They can lower blood pressure and cardiac workload; kidney function and potassium may need monitoring.','تحجب حاصرات مستقبلات الأنجيوتنسين II مستقبلات AT1، فتقلل تضيق الأوعية وإشارات الألدوستيرون.','قد تخفض ضغط الدم وعبء العمل على القلب؛ وقد تلزم متابعة وظائف الكلى والبوتاسيوم.'),
    betaBlockers:groupExplanation('Beta blockers reduce beta-adrenergic signaling, often slowing heart rate and reducing cardiac workload.','Effects vary by selectivity and medicine; they may lower blood pressure or control selected rhythm and heart conditions.','تقلل حاصرات بيتا إشارات مستقبلات بيتا الأدرينالية، وغالبًا ما تبطئ النبض وتخفف جهد القلب.','يختلف تأثيرها حسب انتقائية الدواء؛ وقد تخفض الضغط أو تضبط بعض اضطرابات النظم وحالات القلب.'),
    calciumChannelBlockers:groupExplanation('Calcium-channel blockers reduce calcium entry into vascular smooth muscle or heart cells.','Some mainly relax arteries and lower blood pressure, while others also slow conduction or heart rate.','تقلل حاصرات قنوات الكالسيوم دخوله إلى العضلات الملساء للأوعية أو خلايا القلب.','يرخي بعضها الشرايين ويخفض ضغط الدم أساسًا، بينما يبطئ بعضها الآخر التوصيل أو النبض أيضًا.'),
    diuretics:groupExplanation('Diuretics alter kidney salt transport, increasing salt and water excretion to different degrees.','They can reduce fluid overload or blood pressure; electrolytes, hydration, and kidney function may need follow-up.','تؤثر مدرات البول في نقل الأملاح بالكلى، فتزيد إخراج الملح والماء بدرجات مختلفة.','قد تقلل احتباس السوائل أو ضغط الدم؛ وقد تلزم متابعة الأملاح والترطيب ووظائف الكلى.'),
    statins:groupExplanation('Statins inhibit HMG-CoA reductase, reducing cholesterol synthesis in the liver and increasing LDL removal from blood.','They lower LDL cholesterol and reduce cardiovascular risk over time; muscle symptoms and interactions should be reviewed.','تثبط الستاتينات إنزيم HMG-CoA reductase، فتقلل تصنيع الكوليسترول في الكبد وتزيد إزالة LDL من الدم.','تخفض كوليسترول LDL وتقلل مخاطر القلب مع الوقت؛ وينبغي الانتباه لأعراض العضلات والتداخلات.'),
    anticoagulants:groupExplanation('Anticoagulants reduce clot formation by inhibiting specific clotting factors or vitamin-K-dependent processes.','They help prevent or treat certain clots but increase bleeding risk; they do not directly dissolve an existing clot.','تقلل مضادات التخثر تكوّن الجلطات عبر تثبيط عوامل تخثر محددة أو مسارات تعتمد على فيتامين K.','تساعد على منع أو علاج أنواع معينة من الجلطات لكنها تزيد النزف، ولا تذيب الجلطة الموجودة مباشرة.'),
    diabetes:groupExplanation('Diabetes medicines lower blood glucose through different pathways, including reducing liver glucose output, increasing insulin action or release, or increasing glucose loss in urine.','The effect and risk of low blood sugar vary by class; these medicines are not interchangeable.','تخفض أدوية السكري سكر الدم بطرق مختلفة، مثل تقليل إنتاج الكبد للجلوكوز أو زيادة تأثير الإنسولين أو إفرازه أو زيادة طرح السكر في البول.','يختلف تأثيرها واحتمال هبوط السكر بين الفئات، ولا يمكن استبدال دواء بآخر تلقائيًا.'),
    biguanides:groupExplanation('Metformin reduces liver glucose production and improves insulin sensitivity in body tissues.','It generally lowers glucose without stimulating insulin release; digestive effects are common and kidney status matters.','يقلل الميتفورمين إنتاج الكبد للجلوكوز ويحسن حساسية أنسجة الجسم للإنسولين.','يخفض السكر عادةً دون تحفيز إفراز الإنسولين؛ وقد يسبب أعراضًا هضمية وتهم حالة الكلى.'),
    sulfonylureas:groupExplanation('Sulfonylureas stimulate pancreatic beta cells to release insulin by closing ATP-sensitive potassium channels.','They lower blood glucose but can cause hypoglycemia and weight gain.','تحفز السلفونيل يوريا خلايا بيتا في البنكرياس لإفراز الإنسولين عبر إغلاق قنوات البوتاسيوم الحساسة للطاقة.','تخفض سكر الدم لكنها قد تسبب هبوط السكر وزيادة الوزن.'),
    dpp4Inhibitors:groupExplanation('DPP-4 inhibitors prolong incretin hormone activity, supporting glucose-dependent insulin release and reducing glucagon.','They modestly improve glucose control and usually have a low hypoglycemia risk when used alone.','تطيل مثبطات DPP-4 نشاط هرمونات الإنكريتين، فتدعم إفراز الإنسولين المعتمد على الجلوكوز وتقلل الجلوكاجون.','تحسن ضبط السكر بدرجة معتدلة، ويكون خطر هبوطه منخفضًا عادةً عند استخدامها وحدها.'),
    sglt2Inhibitors:groupExplanation('SGLT2 inhibitors reduce glucose reabsorption in the kidney, increasing glucose excretion in urine.','They lower glucose and may have heart or kidney benefits for selected patients; dehydration and genital infections can occur.','تقلل مثبطات SGLT2 إعادة امتصاص الجلوكوز في الكلى، فتزيد طرحه في البول.','تخفض السكر وقد تفيد القلب أو الكلى لبعض المرضى؛ وقد تسبب الجفاف أو التهابات تناسلية.'),
    glp1Agonists:groupExplanation('GLP-1 receptor agonists mimic incretin signaling, increasing glucose-dependent insulin release, reducing glucagon, and slowing gastric emptying.','They lower glucose and often reduce appetite and weight; nausea and other digestive effects can occur.','تحاكي ناهضات مستقبلات GLP-1 إشارات الإنكريتين، فتزيد إفراز الإنسولين المعتمد على السكر وتقلل الجلوكاجون وتبطئ إفراغ المعدة.','تخفض السكر وغالبًا تقلل الشهية والوزن؛ وقد تسبب الغثيان وأعراضًا هضمية أخرى.'),
    insulins:groupExplanation('Insulin activates insulin receptors and promotes glucose uptake and storage while reducing liver glucose output.','It lowers blood glucose effectively but can cause hypoglycemia; onset and duration depend on the specific formulation.','ينشط الإنسولين مستقبلاته ويعزز امتصاص الجلوكوز وتخزينه ويقلل إنتاج الكبد للسكر.','يخفض السكر بفاعلية لكنه قد يسبب هبوطه؛ ويعتمد بدء التأثير ومدته على التركيبة المحددة.'),
    digestive:groupExplanation('Digestive medicines affect acid production, gut movement, nausea pathways, or stool water content through different mechanisms.','They can relieve selected digestive symptoms; persistent or severe symptoms need assessment rather than repeated self-treatment.','تؤثر الأدوية الهضمية بآليات مختلفة في إنتاج الحمض أو حركة الأمعاء أو مسارات الغثيان أو محتوى الماء في البراز.','قد تخفف أعراضًا هضمية معينة؛ لكن الأعراض الشديدة أو المستمرة تحتاج إلى تقييم بدل تكرار العلاج الذاتي.'),
    protonPumpInhibitors:groupExplanation('Proton-pump inhibitors suppress the stomach parietal-cell H+/K+-ATPase, the final step in acid secretion.','They reduce stomach acid and support healing in selected acid-related conditions; prolonged use should be reviewed.','تثبط مثبطات مضخة البروتون إنزيم H+/K+-ATPase في الخلايا الجدارية للمعدة، وهو الخطوة الأخيرة لإفراز الحمض.','تقلل حمض المعدة وتساعد على الالتئام في حالات محددة مرتبطة بالحمض؛ وينبغي مراجعة الاستخدام المطول.'),
    h2Blockers:groupExplanation('H2 blockers inhibit histamine H2 receptors on stomach parietal cells, reducing acid secretion.','They reduce acid-related symptoms; strength and duration differ from proton-pump inhibitors.','تحجب حاصرات H2 مستقبلات الهيستامين H2 على الخلايا الجدارية للمعدة، فتقلل إفراز الحمض.','تخفف الأعراض المرتبطة بالحمض؛ ويختلف تأثيرها ومدته عن مثبطات مضخة البروتون.'),
    antacids:groupExplanation('Antacids chemically neutralize acid already present in the stomach rather than switching off acid production.','They can provide short-term symptom relief; mineral content can affect absorption of other medicines.','تعادل مضادات الحموضة كيميائيًا الحمض الموجود في المعدة بدلًا من إيقاف إنتاجه.','قد توفر راحة قصيرة الأمد؛ ويمكن لمكوناتها المعدنية أن تؤثر في امتصاص أدوية أخرى.'),
    antiemetics:groupExplanation('Antiemetics act on varied receptors and nerve pathways involved in nausea and vomiting.','They can reduce nausea for selected causes; benefit and risks depend on the specific target and patient.','تؤثر مضادات القيء في مستقبلات ومسارات عصبية متعددة مرتبطة بالغثيان والقيء.','قد تخفف الغثيان لأسباب معينة؛ ويعتمد النفع والمخاطر على الهدف الدوائي وحالة المريض.'),
    laxatives:groupExplanation('Laxatives ease bowel movements by mechanisms such as retaining water in stool, stimulating bowel movement, or softening stool.','They can relieve constipation; the appropriate type depends on cause and duration, and overuse can cause harm.','تسهل الملينات التبرز بآليات مثل زيادة الماء في البراز أو تحفيز حركة الأمعاء أو تليين البراز.','قد تخفف الإمساك؛ ويعتمد النوع المناسب على السبب والمدة، وقد يضر الإفراط في استخدامها.'),
    respiratory:groupExplanation('Respiratory medicines may relax airway muscle, reduce airway inflammation, or change mucus properties.','They can ease selected breathing symptoms, but controller and rescue medicines have different roles.','قد ترخي أدوية الجهاز التنفسي عضلات الشعب أو تقلل التهابها أو تغير خصائص المخاط.','قد تخفف أعراضًا تنفسية معينة، لكن أدوية الوقاية وأدوية الإنقاذ لها أدوار مختلفة.'),
    beta2Bronchodilators:groupExplanation('Beta-2 agonists activate beta-2 receptors in airway smooth muscle, increasing cyclic AMP and relaxing the muscle.','They widen airways and ease bronchospasm; frequent need for a reliever may signal poor control.','تنشط ناهضات بيتا-2 مستقبلاتها في العضلات الملساء للشعب، فترفع cAMP وترخي العضلة.','توسع الشعب وتخفف التشنج؛ وقد يشير تكرار الحاجة إلى دواء الإنقاذ إلى ضعف السيطرة على الحالة.'),
    respiratoryCorticosteroids:groupExplanation('Inhaled corticosteroids reduce airway inflammatory gene signaling and inflammatory-cell activity.','They help prevent asthma symptoms over time but are not immediate bronchodilator rescue medicines.','تقلل الكورتيكوستيرويدات المستنشقة إشارات الجينات الالتهابية ونشاط الخلايا الالتهابية في الشعب.','تساعد على الوقاية من أعراض الربو مع الوقت، لكنها ليست موسعات شعب فورية لعلاج النوبة.'),
    mucolytics:groupExplanation('Mucolytics alter mucus structure or viscosity, making secretions easier to clear.','They may help loosen thick mucus in selected conditions; they do not treat the underlying cause of every cough.','تغير مذيبات البلغم بنية المخاط أو لزوجته، ما يسهل إخراجه.','قد تساعد على تليين المخاط السميك في حالات معينة، لكنها لا تعالج السبب الأساسي لكل سعال.'),
    hairCare:groupExplanation('Hair-care products act on the scalp or hair shaft: cleansers remove oil and buildup, conditioners smooth the cuticle, anti-dandruff agents reduce scalp yeast and scaling, and hair-loss medicines prolong the growth phase or block androgen effects.','These products can improve cleanliness, control dandruff or breakage, and support regrowth in selected types of hair loss; response depends on the cause and usually takes months.','تعمل منتجات العناية بالشعر على فروة الرأس أو ساق الشعرة: تزيل الغسولات الزيوت والتراكمات، وتنعم البلسمات الطبقة الخارجية، وتقلل مضادات القشرة نمو الفطريات والقشور، بينما تطيل أدوية التساقط مرحلة النمو أو تحجب تأثير الأندروجين.','قد تحسن النظافة وتتحكم في القشرة أو التقصف وتدعم إعادة النمو في أنواع محددة من التساقط؛ وتعتمد الاستجابة على السبب وتحتاج عادة إلى أشهر.'),
    hairLossTreatments:groupExplanation('Minoxidil widens the blood supply to hair follicles and prolongs the growth phase, while 5-alpha-reductase inhibitors lower scalp dihydrotestosterone, which otherwise shortens the growth phase in androgenetic alopecia.','They can slow hair loss and improve regrowth in selected patterns; benefits reverse after stopping and visible change takes months.','يوسع المينوكسيديل تدفق الدم إلى بصيلات الشعر ويطيل مرحلة النمو، بينما تقلل مثبطات إنزيم 5-ألفا ريدكتيز مستوى ثنائي هيدروتستوستيرون في فروة الرأس الذي يقصر مرحلة النمو في التساقط الأندروجيني.','قد تبطئ تساقط الشعر وتحسن النمو في أنماط محددة؛ ويعود التأثير بعد التوقف ويحتاج التغير الظاهر إلى أشهر.'),
    antiDandruff:groupExplanation('Anti-dandruff agents reduce Malassezia yeast, scalp inflammation, or scale turnover; examples include ketoconazole, zinc pyrithione, selenium sulfide, and coal tar.','They reduce flakes and itching with regular use; symptoms can return when treatment stops, and some shampoos irritate a dry scalp.','تقلل مضادات القشرة فطر الملاسيزيا أو التهاب فروة الرأس أو سرعة تقشر الجلد؛ ومن أمثلتها الكيتوكونازول وزينك بيريثيون وسيلينيوم سلفايد وقطران الفحم.','تقلل القشور والحكة مع الاستخدام المنتظم؛ وقد تعود الأعراض عند التوقف، وبعض الشامبوهات تهيج فروة الرأس الجافة.'),
    scalpTreatments:groupExplanation('Scalp treatments target inflammation, infection, or follicle signaling at the scalp surface; medicated lotions and antifungals act locally, while anti-lice products affect parasites on the hair.','They can calm itching or treat selected fungal and parasite problems; they must reach the scalp and do not replace oral treatment in severe disease.','تستهدف علاجات فروة الرأس الالتهاب أو العدوى أو إشارات البصيلات على سطح الفروة؛ تعمل اللوشنات الدوائية ومضادات الفطريات موضعيا، بينما تؤثر مضادات القمل في الطفيليات على الشعر.','قد تهدئ الحكة أو تعالج مشكلات فطرية أو طفيلية محددة؛ ويجب أن تصل إلى الفروة، ولا تغني عن العلاج الفموي في الحالات الشديدة.'),
    hairCleansers:groupExplanation('Shampoos and scalp cleansers use surfactants to lift sebum, dirt, and product residue; medicated versions may also carry antifungal or keratolytic agents.','They clean the scalp and reduce oiliness, but frequent use of harsh surfactants can dry or irritate the scalp and hair shaft.','تستخدم الشامبوهات وغسولات الفروة مواد خافضة للتوتر السطحي لإزالة الدهون والأوساخ وبقايا المنتجات؛ وقد تحمل الأنواع الدوائية عوامل مضادة للفطريات أو محللة للكيراتين.','تنظف الفروة وتقلل الدهنية، لكن كثرة استخدام المنظفات القوية قد تجفف الفروة أو تهيجها وتضر ساق الشعرة.'),
    hairConditioners:groupExplanation('Conditioners, masks, oils, and serums coat the hair shaft with emollients and cationic polymers that smooth the cuticle and reduce friction; some add humectants or proteins.','They improve combability, shine, and the appearance of split ends but do not repair the living follicle or make hair grow faster.','تغطي البلسمات والأقنعة والزيوت والسيرومات ساق الشعرة بمواد ملطفة وبوليمرات موجبة تنعم الطبقة الخارجية وتقلل الاحتكاك؛ ويضيف بعضها مرطبات أو بروتينات.','تحسن سهولة التمشيط واللمعان ومظهر الأطراف المتقصفة، لكنها لا تصلح البصيلة الحية ولا تسرع نمو الشعر.'),
    hairRemoval:groupExplanation('Depilatories break disulfide bonds in keratin to dissolve hair at the surface, while waxing and epilation pull hair from the follicle; laser and intense light target pigment in the follicle.','They remove visible hair temporarily; irritant reactions and ingrown hairs can occur, and only follicle-directed methods can slow regrowth.','تكسر مزيلات الشعر روابط ثنائي الكبريت في الكيراتين فتذيب الشعر على السطح، بينما يزيل الشمع أو النتف الشعر من البصيلة، ويستهدف الليزر والضوء المكثف الصبغة داخل البصيلة.','تزيل الشعر الظاهر مؤقتا؛ وقد تحدث تهيجات وشعر تحت الجلد، ولا تبطئ إعادة النمو إلا الطرق الموجهة للبصيلة.'),
    otherHairCare:groupExplanation('This subgroup covers hair-care products that the source record does not classify by a more specific mechanism.','The formulation and label determine where and how the product acts; check the ingredients because effects vary widely within this group.','تضم هذه المجموعة منتجات العناية بالشعر التي لا يصنفها سجل المصدر بآلية أكثر تحديدا.','تحدد التركيبة والملصق مكان تأثير المنتج وطريقته؛ راجع المكونات لأن التأثيرات تختلف كثيرا داخل هذه المجموعة.'),
    skinCare:groupExplanation('Skin-care products act at the surface or within the epidermis: cleansers remove oil and debris, moisturizers restore water and barrier lipids, sunscreens reduce UV reaching the skin, retinoids alter keratinization and collagen signaling, and lightening agents reduce melanin production.','They can protect the barrier, improve texture and pigmentation, and reduce acne or photoaging; active ingredients can irritate, and meaningful change usually takes weeks.','تعمل منتجات العناية بالبشرة على السطح أو داخل البشرة: تزيل الغسولات الزيوت والشوائب، وتعيد المرطبات الماء ودهون الحاجز الجلدي، وتقلل واقيات الشمس وصول الأشعة فوق البنفسجية، وتغير الريتينويدات التقرن وإشارات الكولاجين، وتقلل مواد التفتيح إنتاج الميلانين.','قد تحمي حاجز الجلد وتحسن الملمس واللون وتقلل حب الشباب أو علامات التقدم في العمر؛ وقد تسبب المواد الفعالة تهيجا، وتحتاج النتائج عادة إلى أسابيع.'),
    sunscreens:groupExplanation('Sunscreens absorb UV photons through organic filters or reflect and scatter them through mineral filters such as zinc oxide and titanium dioxide.','They reduce UV reaching the skin and help prevent sunburn, photoaging, and skin cancer; adequate amount and repeated application are essential.','تمتص واقيات الشمس الأشعة فوق البنفسجية عبر مرشحات عضوية أو تعكسها وتشتتها عبر مرشحات معدنية مثل أكسيد الزنك وثاني أكسيد التيتانيوم.','تقلل وصول الأشعة إلى الجلد وتساعد على منع حروق الشمس والشيخوخة الضوئية وسرطان الجلد؛ وتعد الكمية الكافية وإعادة الاستخدام أمرين أساسيين.'),
    acneTreatments:groupExplanation('Acne treatments reduce follicular plugging, sebum, Cutibacterium acnes, or inflammation; retinoids normalize keratinization, benzoyl peroxide and antibiotics reduce bacteria, and salicylic acid helps exfoliation.','They can clear comedones and inflamed lesions over weeks; irritation is common and some ingredients increase sun sensitivity.','تقلل علاجات حب الشباب انسداد البصيلات والدهون أو بكتيريا كاتيباكتيريوم أكنيز أو الالتهاب؛ تعيد الريتينويدات التقرن إلى طبيعته، ويقلل بيروكسيد البنزويل والمضادات الحيوية البكتيريا، ويساعد حمض الساليسيليك على التقشير.','قد تزيل الرؤوس السوداء والالتهابات خلال أسابيع؛ والتهيج شائع وبعض المكونات تزيد حساسية الشمس.'),
    skinLightening:groupExplanation('Lightening agents reduce melanin synthesis or transfer; hydroquinone inhibits tyrosinase, arbutin and kojic acid have similar targets, and vitamin C interferes with melanin production.','They can fade hyperpigmentation and even skin tone, but irritation, rebound pigmentation, and sun exposure limit results; some agents require supervision.','تقلل مواد التفتيح تصنيع الميلانين أو انتقاله؛ يثبط الهيدروكينون إنزيم التيروزيناز، ويملك الأربوتين وحمض الكوجيك أهدافا مشابهة، ويتداخل فيتامين C مع إنتاج الميلانين.','قد تخفف فرط التصبغ وتوحد لون البشرة، لكن التهيج وعودة التصبغ والتعرض للشمس تحد من النتائج؛ وبعض المواد تتطلب إشرافا طبيا.'),
    antiAgingSkin:groupExplanation('Retinoids, peptides, antioxidants, and humectants act on collagen signaling, cell turnover, oxidative stress, or water content; firming products may also form a temporary film.','They can improve fine lines, elasticity, and hydration over time; cosmetic claims vary and active agents can irritate.','تؤثر الريتينويدات والببتيدات ومضادات الأكسدة والمرطبات في إشارات الكولاجين أو تجدد الخلايا أو الإجهاد التأكسدي أو محتوى الماء؛ وقد تشكل منتجات الشد طبقة مؤقتة.','قد تحسن الخطوط الدقيقة والمرونة والترطيب مع الوقت؛ وتختلف الادعاءات التجميلية وقد تهيج المواد الفعالة.'),
    exfoliants:groupExplanation('Exfoliants loosen corneocytes or dissolve intercellular bonds; alpha-hydroxy acids and urea increase shedding, while retinoids accelerate epidermal turnover.','They smooth texture and reduce scaling, but overuse can damage the barrier, cause redness, and increase photosensitivity.','تفكك المقشرات الخلايا القرنية أو تذيب الروابط بينها؛ وتزيد أحماض ألفا هيدروكسي واليوريا التقشر، بينما تسرع الريتينويدات تجدد البشرة.','تنعم الملمس وتقلل القشور، لكن الإفراط قد يضر حاجز الجلد ويسبب الاحمرار ويزيد حساسية الشمس.'),
    topicalSteroids:groupExplanation('Topical corticosteroids bind glucocorticoid receptors and reduce inflammatory gene transcription and immune-cell activity in the skin.','They calm eczema, dermatitis, and other inflammatory skin conditions; strength and site determine potency, and long use can thin the skin.','ترتبط الكورتيكوستيرويدات الموضعية بمستقبلات الجلوكوكورتيكويد وتقلل نسخ الجينات الالتهابية ونشاط الخلايا المناعية في الجلد.','تهدئ الإكزيما والتهاب الجلد وحالات جلدية التهابية أخرى؛ وتحدد القوة والموقع شدة التأثير، وقد يؤدي الاستخدام الطويل إلى ترقق الجلد.'),
    skinAntiseptics:groupExplanation('Topical antiseptics and antibiotics reduce or kill microbes on the skin surface; chlorhexidine and povidone-iodine disrupt microbial membranes, while fusidic acid and mupirocin inhibit bacterial protein synthesis.','They help prevent or treat local skin infections; overuse can irritate skin and promote resistance, so they are not for every wound.','تقلل المطهرات والمضادات الحيوية الموضعية الميكروبات على سطح الجلد أو تقتلها؛ يخل الكلورهيكسيدين والبوفيدون أيودين بأغشية الميكروبات، بينما يثبط حمض الفوسيديك والميوبيروسين تصنيع البروتين البكتيري.','تساعد على منع أو علاج عدوى جلدية موضعية؛ والإفراط قد يهيج الجلد ويعزز المقاومة، ولذلك لا تستخدم لكل جرح.'),
    woundScarCare:groupExplanation('Wound-care products keep the wound moist, protect it from contamination, or supply barrier materials; scar treatments may hydrate, apply pressure, or modify collagen remodeling.','A moist protected wound heals faster with less scarring; established scars improve slowly and not all can be removed.','تحافظ منتجات العناية بالجروح على رطوبة الجرح وتحميه من التلوث أو توفر مواد حاجزة؛ وقد ترطب علاجات الندبات الجلد أو تطبق ضغطا أو تعدل إعادة تشكيل الكولاجين.','يلتئم الجرح الرطب المحمي أسرع وبندبة أقل؛ وتتحسن الندبات القديمة ببطء ولا يمكن إزالة جميعها.'),
    skinCleansers:groupExplanation('Cleansers use surfactants to remove sebum, dirt, sweat, and makeup while trying to preserve the skin barrier; syndets and gentle cleansers lower irritation compared with harsh soaps.','They keep skin clean and can reduce oiliness or acne triggers; over-cleansing or hot water can dry and irritate the barrier.','تستخدم غسولات البشرة مواد خافضة للتوتر السطحي لإزالة الدهون والأوساخ والعرق والمكياج مع محاولة الحفاظ على حاجز الجلد؛ وتقلل المنظفات اللطيفة التهيج مقارنة بالصابون القاسي.','تحافظ على نظافة البشرة وقد تقلل الدهنية أو محفزات حب الشباب؛ لكن الإفراط في الغسل أو الماء الساخن يجفف الحاجز ويهيجه.'),
    skinMoisturizers:groupExplanation('Moisturizers add humectants that attract water, emollients that soften the skin, and occlusives that reduce water loss; some also supply ceramides or other barrier lipids.','They improve dryness, roughness, and barrier comfort; they do not cure the underlying cause of a rash, and heavy occlusives may worsen acne in some people.','تضيف المرطبات مواد جاذبة للماء وملطفات تنعم الجلد ومواد سادة تقلل فقد الماء؛ ويوفر بعضها السيراميد أو دهون الحاجز الجلدي.','تحسن الجفاف والخشونة وراحة الحاجز الجلدي؛ لكنها لا تعالج سبب الطفح، وقد تزيد المواد السادة الثقيلة حب الشباب لدى بعض الأشخاص.'),
    otherSkinCare:groupExplanation('This subgroup covers skin-care products that the source record does not classify by a more specific mechanism.','The label and ingredients determine the actual site and action; review them because effects vary widely within this group.','تضم هذه المجموعة منتجات العناية بالبشرة التي لا يصنفها سجل المصدر بآلية أكثر تحديدا.','يحدد الملصق والمكونات المكان الفعلي للتأثير وطريقته؛ راجعها لأن التأثيرات تختلف كثيرا داخل هذه المجموعة.'),
    supplements:groupExplanation('Nutritional supplements supply vitamins, minerals, fatty acids, amino acids, or other nutrients that act as enzyme cofactors, structural building blocks, or signaling molecules. They help meet a requirement when diet or absorption is insufficient rather than acting like a conventional drug.','They can correct or prevent a specific deficiency and support normal body functions; benefits depend on the nutrient, dose, and baseline status, and excess intake can be harmful.','توفر المكملات الغذائية فيتامينات أو معادن أو أحماضا دهنية أو أحماضا أمينية أو غيرها من العناصر التي تعمل كمساعدات إنزيمية أو مكونات بنائية أو جزيئات إشارة. وتساعد على تغطية الاحتياج عند نقص الغذاء أو الامتصاص بدلا من أن تعمل كدواء تقليدي.','قد تعالج نقصا محددا أو تمنعه وتدعم وظائف الجسم الطبيعية؛ ويعتمد النفع على العنصر والجرعة والحالة الأساسية، وقد يضر الإفراط في تناولها.'),
    multivitamins:groupExplanation('Multivitamins combine several vitamins, often with minerals, in amounts intended to fill dietary gaps; each ingredient acts as a cofactor or structural nutrient rather than a single drug target.','They help prevent or correct multiple deficiencies, especially when intake is low; routine high-dose use is not automatically beneficial and can cause excess.','تجمع الفيتامينات المتعددة عدة فيتامينات، وغالبا مع المعادن، بكميات تهدف لسد فجوات الغذاء؛ ويعمل كل مكون كمساعد إنزيمي أو عنصر بنائي بدلا من هدف دوائي واحد.','تساعد على منع أو تصحيح نقص متعدد، خصوصا عند قلة المدخول؛ لكن الجرعات العالية الروتينية ليست مفيدة دائما وقد تسبب زيادة.'),
    prenatalSupplements:groupExplanation('Prenatal supplements usually supply folic acid, iron, iodine, and other nutrients needed for fetal development and maternal blood formation.','They reduce the risk of neural-tube defects and support increased pregnancy requirements; dosing should follow the clinician because excess vitamin A or iron can be harmful.','توفر مكملات الحمل عادة حمض الفوليك والحديد واليود وعناصر أخرى يحتاجها نمو الجنين وتكوين دم الأم.','تقلل خطر عيوب الأنبوب العصبي وتدعم الاحتياجات المتزايدة في الحمل؛ وتجب متابعة الجرعة مع الطبيب لأن زيادة فيتامين A أو الحديد قد تضر.'),
    electrolyteSupplements:groupExplanation('Oral rehydration solutions combine water, sodium, potassium, and glucose in proportions that use sodium-glucose co-transport to increase water absorption in the gut.','They replace fluid and electrolytes lost with vomiting, diarrhea, or sweating; severe dehydration or kidney disease needs medical care.','تجمع محاليل الإماهة الفموية الماء والصوديوم والبوتاسيوم والجلوكوز بنسب تستخدم النقل المشترك للصوديوم والجلوكوز لزيادة امتصاص الماء في الأمعاء.','تعوض السوائل والأملاح المفقودة مع القيء أو الإسهال أو التعرق؛ ويحتاج الجفاف الشديد أو مرض الكلى إلى رعاية طبية.'),
    mineralSupplements:groupExplanation('Mineral supplements provide calcium, iron, zinc, magnesium, iodine, or trace elements that serve as structural components, enzyme cofactors, or electrolyte signals.','They correct or prevent specific mineral deficiencies; excess can interfere with other nutrients, and iron or calcium supplements interact with several medicines.','توفر مكملات المعادن الكالسيوم أو الحديد أو الزنك أو المغنيسيوم أو اليود أو العناصر النادرة التي تعمل كمكونات بنائية أو مساعدات إنزيمية أو إشارات كهرليتية.','تصحح أو تمنع نقص معادن محددا؛ وزيادة العنصر قد تتداخل مع عناصر أخرى، ويتداخل الحديد أو الكالسيوم مع عدة أدوية.'),
    singleVitamins:groupExplanation('Single-vitamin products supply one vitamin that acts as an enzyme cofactor, antioxidant, or regulator of gene expression; examples include vitamin D, B12, and folic acid.','They treat or prevent a specific deficiency and are dosed according to need; fat-soluble vitamins can accumulate, and more is not always better.','توفر منتجات الفيتامين المفرد فيتامينًا واحدا يعمل كمساعد إنزيمي أو مضاد أكسدة أو منظم للتعبير الجيني؛ مثل فيتامين د وب12 وحمض الفوليك.','تعالج أو تمنع نقصا محددا وتجرع حسب الحاجة؛ وقد تتراكم الفيتامينات الذائبة في الدهون، وليست الزيادة دائما أفضل.'),
    omegaFattyAcids:groupExplanation('Omega-3 supplements supply EPA and DHA or their plant precursor ALA, which are incorporated into cell membranes and give rise to anti-inflammatory lipid mediators.','They can lower triglycerides and support cardiovascular or retinal functions in selected people; high doses may increase bleeding risk or interact with anticoagulants.','توفر مكملات أوميغا-3 الحمضين EPA وDHA أو مقدمتهما النباتية ALA، التي تدخل في أغشية الخلايا وتنتج وسائط دهنية مضادة للالتهاب.','قد تخفض الدهون الثلاثية وتدعم وظائف القلب أو الشبكية لدى أشخاص محددين؛ والجرعات العالية قد تزيد خطر النزف أو تتداخل مع مضادات التخثر.'),
    probioticSupplements:groupExplanation('Probiotics supply live microorganisms that may compete with pathogens, produce short-chain fatty acids, and modulate gut immune signaling; prebiotics are fermentable fibers that feed them.','They can shorten some diarrheal illnesses and support gut tolerance; strain, dose, and storage matter, and seriously ill patients should avoid them without advice.','توفر البروبيوتيك كائنات حية دقيقة قد تنافس الممرضات وتنتج أحماضا دهنية قصيرة السلسلة وتعدل إشارات مناعة الأمعاء؛ والبريبيوتيك ألياف قابلة للتخمر تغذيها.','قد تقصر بعض حالات الإسهال وتدعم تحمل الأمعاء؛ ويؤثر السلالة والجرعة والتخزين، ويجب أن يتجنبها المرضى ذوو الحالات الحرجة دون استشارة.'),
    proteinAminos:groupExplanation('Protein and amino-acid supplements supply building blocks for muscle, enzymes, and immune proteins; essential amino acids cannot be made by the body and must come from diet.','They help meet protein needs when food intake is low or demand is high; kidney disease and some metabolic disorders require controlled intake.','توفر مكملات البروتين والأحماض الأمينية مكونات بنائية للعضلات والإنزيمات والبروتينات المناعية؛ ولا يستطيع الجسم تصنيع الأحماض الأمينية الأساسية فيجب الحصول عليها من الغذاء.','تساعد على تلبية احتياج البروتين عند قلة الطعام أو زيادة الطلب؛ ويحتاج مرض الكلى وبعض اضطرابات الاستقلاب إلى ضبط المدخول.'),
    antioxidantSupplements:groupExplanation('Antioxidants such as vitamin C, vitamin E, selenium, and plant polyphenols neutralize reactive oxygen species or support antioxidant enzyme systems.','They help protect cells from oxidative damage when dietary intake is low; high-dose supplements have not consistently shown disease prevention and may interfere with some treatments.','تعادل مضادات الأكسدة مثل فيتامين C وفيتامين E والسيلينيوم والبوليفينولات النباتية الأنواع التفاعلية للأكسجين أو تدعم أنظمة الإنزيمات المضادة للأكسدة.','تساعد على حماية الخلايا من الضرر التأكسدي عند قلة المدخول الغذائي؛ لكن الجرعات العالية لم تثبت وقاية منتظمة من الأمراض وقد تتداخل مع بعض العلاجات.'),
    herbalSupplements:groupExplanation('Herbal products contain plant extracts with variable mixtures of active compounds; effects depend on the species, plant part, extraction, and standardization.','Some herbs have evidence for specific uses, but products are not equivalent and can interact with medicines or affect the liver; labels may not match contents.','تحتوي المنتجات العشبية على مستخلصات نباتية بمخاليط متغيرة من المركبات الفعالة؛ وتعتمد التأثيرات على النوع والجزء النباتي وطريقة الاستخلاص والتوحيد.','لبعض الأعشاب أدلة على استخدامات محددة، لكن المنتجات ليست متكافئة وقد تتداخل مع الأدوية أو تضر الكبد؛ وقد لا تطابق الملصقات المحتوى.'),
    jointSupplements:groupExplanation('Glucosamine, chondroitin, collagen peptides, and related supplements supply cartilage building blocks or may influence joint tissue metabolism; evidence for structural benefit is limited.','They may modestly improve joint comfort in some people; effects are slow and variable, and they do not replace treatment of inflammatory arthritis.','يوفر الجلوكوزامين والكوندرويتين وببتيدات الكولاجين والمكملات المشابهة مكونات لبناء الغضروف أو قد تؤثر في استقلاب أنسجة المفصل؛ والأدلة على فائدة بنيوية محدودة.','قد تحسن راحة المفاصل بدرجة معتدلة لدى بعض الأشخاص؛ والتأثير بطيء ومتفاوت، ولا تغني عن علاج التهاب المفاصل الالتهابي.'),
    otherSupplements:groupExplanation('This subgroup covers nutritional products that the source record does not classify by a more specific nutrient or mechanism.','Check the label for the exact nutrients and amounts; products in this group can differ substantially in action and evidence.','تضم هذه المجموعة المنتجات الغذائية التي لا يصنفها سجل المصدر بعنصر غذائي أو آلية أكثر تحديدا.','راجع الملصق لمعرفة العناصر والكميات الدقيقة؛ فقد تختلف المنتجات في هذه المجموعة كثيرا في التأثير والأدلة.')
  };
  const BODY_SYSTEMS=[
    ['blood','Blood, Heart and Circulation'],['bones','Bones, Joints and Muscles'],['brain','Brain and Nerves'],['digestive','Digestive System'],['ent','Ear, Nose and Throat'],['endocrine','Endocrine System'],['eyes','Eyes and Vision'],['immune','Immune System'],['kidney','Kidneys and Urinary System'],['lungs','Lungs and Breathing'],['mouth','Mouth and Teeth'],['skin','Skin, Hair and Nails'],['female','Female Reproductive System'],['male','Male Reproductive System']
  ];
  const CONDITION_TYPES=[
    ['cancers','Cancers & tumors','الأورام والسرطانات',/cancer|tumou?r|carcinoma|lymphoma|leukemia|leukaemia|melanoma|neoplasm|sarcoma|metasta|malignan|سرطان|ورم|لوكيميا|ليمفوما/],
    ['genetic','Genetic & congenital','الوراثة والعيوب الخلقية',/genetic|inherited|congenital|mutation|chromosom|sickle cell|thalassemia|cystic fibrosis|down syndrome|muscular dystrophy|hemophilia|birth defect|وراث|خلقي|جيني|الخلايا المنجلية|التلاسيميا|الهيموفيليا|متلازمة داون/],
    ['infections','Infections','العدوى',/infection|infectious|viral|virus|bacterial|bacterium|fungal|parasite|influenza|flu|covid|coronavirus|hepatitis|tuberculosis|hiv|aids|pneumonia|sepsis|herpes|hpv|malaria|typhoid|cholera|measles|mumps|rubella|chickenpox|candidiasis|عدوي|فيروس|بكتيريا|فطر|طفيلي|التهاب الكبد|السل|الملاريا|الجدري/],
    ['hormones','Hormones & endocrine','الهرمونات والغدد',/diabetes|thyroid|adrenal|pituitary|hormone|menopause|polycystic|pcos|cushing|addison|acromegaly|سكري|غدة|هرمون|الكظرية|النخامية|المبيض المتعدد|انقطاع الطمث/],
    ['autoimmune','Autoimmune & inflammatory','المناعة الذاتية والالتهاب',/autoimmune|lupus|rheumatoid|multiple sclerosis|psoriasis|crohn|ulcerative colitis|celiac|graves|hashimoto|myasthenia|vasculitis|sjogren|مناعي ذاتي|الذئبة|الروماتويد|التصلب المتعدد|الصدفية|كرون|الالتهاب المناعي/],
    ['blood','Blood disorders','أمراض الدم',/anemia|anaemia|hemoglobin|platelet|clotting|coagul|bleeding|thrombosis|embolism|myeloma|blood disorder|فقر الدم|أنيميا|هيموغلوبين|صفائح|تجلط|نزيف|خثار|الدم/],
    ['metabolic','Metabolic & nutritional','الأيض والتغذية',/obesity|cholesterol|lipid|metabolic|gout|vitamin|deficiency|malnutrition|electrolyte| phenylketonuria|سمنة|كوليسترول|دهون|أيض|نقرس|فيتامين|نقص|سوء التغذية/],
    ['heart','Heart & circulation','القلب والدورة الدموية',/heart|cardiac|coronary|artery|arterial|vascular|blood pressure|hypertension|hypotension|stroke|arrhythmia|atrial fibrillation|aneurysm|venous|varicose|قلب|شرايين|ضغط الدم|جلطة|نظم القلب|تصلب الشرايين/],
    ['lungs','Lungs & breathing','الرئة والتنفس',/lung|pulmonary|asthma|copd|bronch|respiratory|breathing|apnea|emphysema|pneumothorax|رئة|رئوي|ربو|شعب|تنفس|انسداد رئوي/],
    ['digestive','Digestion & liver','الهضم والكبد',/stomach|gastric|intestin|bowel|colon|rectal|liver|hepatic|gallbladder|gallstone|pancrea|reflux|gastro|ulcer|constipation|diarrhea|hemorrhoid|hernia|معدة|أمعاء|قولون|كبد|مرارة|بنكرياس|ارتجاع|قرحة|إسهال|إمساك|بواسير/],
    ['kidney','Kidneys & urinary','الكلى والمسالك',/kidney|renal|urinary|bladder|ureter|urethra|prostate|dialysis|nephro|kidney stone|incontinence|كلى|كلوي|بول|مثانة|حالب|بروستاتا|غسيل كلوي|حصوات/],
    ['brain','Brain & nerves','الدماغ والأعصاب',/brain|neurolog|nerve|epilep|seizure|migraine|parkinson|alzheimer|dementia|neuropathy|sclerosis|meningitis|encephalitis|palsy|tremor|دماغ|عصب|صرع|شقيقة|باركنسون|زهايمر|خرف|التهاب السحايا/],
    ['mental','Mental health','الصحة النفسية',/depression|anxiety|bipolar|schizophrenia|obsessive|ocd|ptsd|stress|addiction|substance|eating disorder|anorexia|bulimia|adhd|attention deficit|autism|اكتئاب|قلق|ذهان|فصام|وسواس|إدمان|اضطراب الأكل|توحد|فرط الحركة/],
    ['bones','Bones, joints & muscles','العظام والمفاصل والعضلات',/arthritis|osteoarthritis|osteoporosis|bone|muscle|muscular|joint|back pain|spine|spinal|tendon|ligament|fibromyalgia|fracture|scoliosis|مفاصل|عظام|عضلات|هشاشة|عمود فقري|ألم الظهر|كسور|تليف عضلي/],
    ['skin','Skin, hair & nails','الجلد والشعر والأظافر',/skin|dermat|rash|eczema|acne|urticaria|hives|hair loss|alopecia|nail|vitiligo|جلد|طفح|أكزيما|حب الشباب|حساسية جلدية|تساقط الشعر|أظافر|بهاق/],
    ['eyes','Eyes & vision','العيون والإبصار',/eye|vision|visual|retina|glaucoma|cataract|conjunctiv|cornea|macular|blind|strabismus|عيون|عين|بصر|شبكية|جلوكوما|مياه بيضاء|قرنية|حول|عمي/],
    ['ent','Ear, nose & throat','الأنف والأذن والحنجرة',/ear|hearing|tinnitus|sinus|nose|nasal|throat|tonsil|pharyng|laryng|voice|vertigo|أذن|سمع|طنين|جيوب|أنف|حلق|لوز|بحة|دوخة/],
    ['reproductive','Reproductive & sexual','الصحة الإنجابية والجنسية',/pregnan|fertility|infertility|menstrual|ovary|ovarian|uterus|uterine|endometriosis|pcos|vaginal|breast|testicular|testicle|erectile|prostate|حمل|خصوبة|عقم|دورة شهرية|مبيض|رحم|بطانة الرحم|مهبل|ثدي|خصية|انتصاب|بروستاتا/],
    ['immune','Allergy & immunity','الحساسية والمناعة',/allergy|allergic|anaphylaxis|immunodeficien|immune|hay fever|حساسية|تحسس|تأق|مناعة|نقص المناعة/],
    ['injuries','Injuries & poisoning','الإصابات والتسمم',/injury|trauma|fracture|burn|wound|poison|overdose|toxic|bite|sting|drowning|electrocution|إصابة|رض|كسر|حرق|جرح|تسمم|جرعة زائدة|سموم|لدغة|غرق/],
    ['sleep','Sleep disorders','اضطرابات النوم',/sleep|insomnia|apnea|narcolepsy|restless legs|نوم|أرق|انقطاع النفس|نعاس/],
    ['dental','Dental & oral','الأسنان والفم',/tooth|teeth|dental|gum|gingiv|mouth|oral|cavit|caries|periodont|jaw|أسنان|سنة|لثة|فم|تسوس|فك/],
    ['aging','Aging & degeneration','التقدم في العمر والتنكس',/degenerative|age related|aging|ageing|macular degeneration|تقدم العمر|تنكس|ضمور/],
    ['symptoms','Symptoms & syndromes','الأعراض والمتلازمات',/pain|fever|fatigue|dizziness|nausea|vomiting|swelling|edema|cough|itch|symptom|syndrome|ألم|حمي|تعب|دوخة|غثيان|قيء|تورم|كحة|حكة|أعراض|متلازمة/]
  ];
const CONDITION_SUBGROUPS={
  blood:[
    ['anemia','Anemia & hemoglobin disorders','فقر الدم واضطرابات الهيموغلوبين',/anemi|thalassem|sickle|hemoglobinopath|polycythem|aplastic|g6pd|glucose-6-phosphate|iron deficiency|pancytopeni|incompatib|فقر الدم|أنيميا|الثلاسيميا|المنجلية|الهيموغلوبين|كثرة الحمر/],
    ['bleeding','Bleeding & platelet disorders','النزيف واضطرابات الصفائح',/bleed|hemophili|haemophili|platelet|von willebrand|purpura|thrombocytopen|coagulat|clotting|نزيف|هيموفيليا|الصفائح|نقص الصفائح|تخثر/],
    ['clots','Blood clots','الجلطات الدموية',/clot|thrombo|embol|deep vein|dvt|خثار|جلطة|انسداد/],
    ['pressure','Blood pressure','ضغط الدم',/blood pressure|hypertens|hypotens|shock|ضغط الدم|ارتفاع الضغط|انخفاض الضغط|صدمة/],
    ['lipids','Cholesterol & lipids','الكوليسترول والدهون',/cholesterol|lipid|triglycerid|ldl|hdl|metabolic syndrome|دهون|كوليسترول|الدهون الثلاثية|متلازمة الأيض/],
    ['arrhythmia','Arrhythmia & palpitations','اضطرابات نظم القلب',/arrhythm|fibrillation|tachycard|bradycard|palpitat|pacemaker|defibrillator|ablation|نظم القلب|الرجفان|تسارع القلب|بطء القلب|خفقان|منظم ضربات/],
    ['heart','Heart diseases','أمراض القلب',/heart|cardiac|coronary|angina|myocard|cardiomyopath|valve|mitral|endocard|pericard|atheroscler|chest pain|قلب|تاجي|ذبحة|عضلة القلب|الصمام|الشغاف|التامور|تصلب الشرايين|ألم الصدر/],
    ['stroke','Stroke & cerebrovascular','السكتة الدماغية والأوعية الدماغية',/stroke|transient ischemic|carotid|brain aneurysm|arteriovenous|سكتة|نوبة نقص التروية|السباتي|أم الدماغ|تشوه شرياني/],
    ['vascular','Vascular & lymphatic diseases','أمراض الأوعية الدموية والليمفية',/vascular|arter|aort|aneurysm|vein|venous|varicose|raynaud|vasculiti|behcet|kawasaki|granulomatosis|lymphedem|lymphatic|gangrene|peripheral arterial|edema|diabetic foot|أوعية|شريان|أورط|تمدد الأوعية|وريد|دوالي|رينود|التهاب الأوعية|لمفية|غرغرينا|وذمة|قدم سكري/],
    ['cancers','Blood cancers','أورام الدم',/leukemi|lymphoma|myeloma|myelodysplast|myeloprolifer|لوكيميا|ليمفوما|ميلوما/],
    ['infections','Blood infections','عدوى الدم',/malaria|sepsis|septic|blood infection|ملاريا|إنتان|تسمم الدم/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|count|medicine|thinner|transfusion|donation|surgery|bypass|angioplasty|rehab|implant|device|cpr|transplant|screening|prevent|lower|diet|dash|eating|exercise|risk factor|healthy|اختبار|تحليل|دواء|نقل الدم|جراحة|مجازة|تأهيل|زراعة|وقاية|خفض|غذائي|رياضة|عوامل الخطورة/],
  ],
  bones:[
    ['arthritis','Arthritis','التهاب المفاصل',/arthrit|osteoarthrit|rheumatoid|gout|spondyl|bursitis|polymyalgia|sjogren|sjögren|psoriat|lupus|التهاب المفاصل|الفصال العظمي|الروماتويد|النقرس|الفقاري|الجيبية/],
    ['osteoporosis','Osteoporosis & bone diseases','هشاشة وأمراض العظام',/osteopor|osteopeni|paget|rickets|osteogenesis|osteonecrosis|bone disease|bone infection|bone cancer|craniofacial|dwarfism|هشاشة|تلين العظام|أمراض العظام|التهاب العظم|سرطان العظام|تشوهات قحفية|القزامة/],
    ['spine','Back & spine disorders','أمراض الظهر والعمود الفقري',/back pain|spine|spinal|disk|scoliosis|sciatica|tailbone|neck|herniated|ظهر|عمود فقري|انزلاق|الجنف|الرقبة|القرص/],
    ['neuromuscular','Neuromuscular disorders','الاضطرابات العصبية والعضلية',/neuromuscular|multiple sclerosis|polio|movement disorder|paralysis|walking|التصلب المتعدد|الشلل|اضطرابات الحركة|المشي/],
    ['muscles','Muscle disorders','اضطرابات العضلات',/muscle|muscular|myopath|myositis|fibromyalgi|myalgic|chronic fatigue|dystrophy|عضل|الحثل العضلي|التهاب العضلات|التليف العضلي|الإرهاق المزمن/],
    ['joints','Joint & connective tissue','المفاصل والنسيج الضام',/joint|cartilage|connective|ehlers|marfan|مفصل|غضروف|نسيج ضام|مارفان/],
    ['injuries','Injuries & fractures','الإصابات والكسور',/injur|fracture|sprain|strain|tendin|tendon|ligament|dislocat|rotator|limb loss|amputat|carpal tunnel|كسر|التواء|وتر|رباط|خلع|إصابة|بتر|النفق الرسغي/],
    ['feet','Foot, ankle & posture','القدم والكاحل والقوام',/foot|feet|ankle|heel|toe|posture|ergonomic|قدم|كاحل|كعب|أصابع القدم|قوام/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/replacement|graft|surgery|density|test|calcium|prevent|exercise|استبدال|زراعة|جراحة|كثافة|كالسيوم|وقاية|تمارين/],
  ],
  brain:[
    ['headache','Headache & migraine','الصداع والشقيقة',/headache|migraine|صداع|شقيقة/],
    ['epilepsy','Epilepsy & seizures','الصرع والتشنجات',/epilep|seizure|convulsion|صرع|تشنج/],
    ['stroke','Stroke','السكتة الدماغية',/stroke|transient ischemic|carotid|aneurysm|arteriovenous|سكتة|نوبة نقص التروية|السباتي|تمدد الأوعية|تشوه شرياني/],
    ['dementia','Dementia & neurodegenerative','الخرف والأمراض التنكسية',/alzheimer|dementia|lewy|cognitive|creutzfeldt|prion|parkinson|huntington|amyotrophic|lateral sclerosis|supranuclear|ataxia|spinal muscular atrophy|degenerative nerve|زهايمر|خرف|إدراك|باركنسون|هنتنغتون|التصلب الجانبي|الترنح|ضمور العضلات الشوكي|التنكس/],
    ['ms','Multiple sclerosis & demyelination','التصلب المتعدد وإزالة الميالين',/multiple sclerosis|demyelin|neuromyelitis|leukodystroph|التصلب المتعدد|إزالة الميالين|الحثل البيضاء/],
    ['nerves','Nerve & neuromuscular disorders','أمراض الأعصاب والعضلات',/neuropath|neuralgia|trigeminal|bell.s palsy|guillain|myasthenia|carpal tunnel|nerve|charcot|brachial plexus|thoracic outlet|neurofibromat|tuberous sclerosis|اعتلال الأعصاب|العصب|شلل بيل|الوهن العضلي|النفق الرسغي|التصلب الحدبي/],
    ['infections','Brain & spinal infections','التهابات الدماغ والسحايا',/meningitis|encephalitis|west nile|flaccid myelitis|reye|shingles|التهاب السحايا|التهاب الدماغ|الحزام الناري|فيروس غرب النيل/],
    ['tumors','Brain & spinal tumors','أورام الدماغ والعمود الفقري',/tumor|tumour|neuroma|neuroblastoma|ورم/],
    ['movement','Movement & developmental disorders','اضطرابات الحركة والنمو',/tourette|dystonia|tremor|rett|cerebral palsy|spina bifida|hydrocephalus|malformation|neural tube|chiari|syringomyelia|phenylketonuria|tay-sachs|attention deficit|adhd|autism|delirium|craniofacial|التوحد|فرط الحركة|الرمع|التشنج|شلل دماغي|السنسنة المشقوقة|استسقاء الدماغ|التشوهات|تاي ساكس/],
    ['pain','Pain, injuries & dizziness','الألم والإصابات والدوخة',/pain|concussion|traumatic brain|spinal cord injur|facial injur|dizziness|vertigo|fainting|back pain|sciatica|spinal stenosis|ألم|ارتجاج|إصابة الدماغ|الحبل الشوكي|دوخة|دوار|إغماء|العمود الفقري/],
    ['sleep','Sleep disorders','اضطرابات النوم',/sleep|insomnia|apnea|restless legs|نوم|أرق|انقطاع النفس/],
    ['speech','Speech & communication','النطق والتواصل',/aphasia|speech|stuttering|communication|النطق|الكلام|التأتأة|التواصل/],
    ['cognitive','Memory & cognitive health','الذاكرة والصحة الإدراكية',/memory|caregiver|الذاكرة|الرعاية/],
    ['general','General brain & nerve disorders','أمراض الدماغ والأعصاب العامة',/brain disease|neurologic|nervous system|cerebellar|autonomic|genetic brain|neuromuscular|movement disorder|paralysis|polio|walking|coma|spinal cord disease|pituitary|wilson|مرض الدماغ|الأعصاب|الجهاز العصبي/],
    ['support','Tests, treatments & rehabilitation','الفحوصات والعلاجات والتأهيل',/rehabilitation|test|surgery|medicine|therapy|treatment|تأهيل|اختبار|جراحة|علاج/],
  ],
  digestive:[
    ['upper','Stomach & esophagus','المعدة والمريء',/stomach|gastric|reflux|gerd|heartburn|peptic ulcer|ulcers?\b|gastritis|esophag|swallowing|hiatal|معدة|ارتجاع|حرقة|قرحة|التهاب المعدة|المريء|البلع|فتق حجابي/],
    ['bowel','Intestines & bowel','الأمعاء والقولون',/intestin|bowel|colon|colitis|crohn|irritable|diverticul|celiac|appendic|malabsorption|lactose|adhesion|polyp|obstruction|gluten|أمعاء|قولون|كرون|القولون العصبي|الرتج|الزائدة الدودية|سوء الامتصاص|اللاكتوز|الالتصاقات|الغلوتين|الانسداد/],
    ['liver','Liver & bile ducts','الكبد والقنوات الصفراوية',/liver|hepat|cirrhosis|jaundice|bile duct|gallbladder|gallstone|cholangi|steatotic|hemochromatosis|wilson|كبد|تليف الكبد|التهاب الكبد|الصفراء|المرارة|حصى المرارة|قنوات الصفراء|داء ويلسون/],
    ['pancreas','Pancreas','البنكرياس',/pancrea|بنكرياس/],
    ['hernia','Hernia','الفتق',/hernia|فتق/],
    ['anorectal','Hemorrhoids & anorectal','البواسير والشرج والمستقيم',/hemorrhoid|anal|rectal|fistula|ostomy|بواسير|شرج|مستقيم|ناسور|فغر/],
    ['infections','Digestive infections','عدوى الجهاز الهضمي',/infection|gastroenteritis|foodborne|norovirus|c\. diff|helicobacter|h\. pylori|عدوى|التهاب المعدة والأمعاء|بكتيريا المعدة/],
    ['symptoms','Digestive symptoms','أعراض الجهاز الهضمي',/constipation|diarrhea|nausea|vomiting|gas|hiccup|indigest|abdominal pain|bloating|gastrointestinal bleeding|إمساك|إسهال|غثيان|قيء|غازات|حازوقة|عسر الهضم|ألم البطن|انتفاخ|نزيف هضمي/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/colonoscopy|surgery|transplant|test|diet|prevent|treatment|فحص|جراحة|زراعة|نظام غذائي|وقاية|علاج/],
  ],
  ent:[
    ['ear','Ear & hearing','الأذن والسمع',/ear|hearing|tinnitus|meniere|otitis|acoustic neuroma|cochlear|barotrauma|usher|أذن|سمع|طنين|مينير|التهاب الأذن|القوقعة/],
    ['balance','Balance & dizziness','التوازن والدوخة',/balance|dizziness|vertigo|التوازن|دوخة|دوار/],
    ['nose','Nose & sinuses','الأنف والجيوب الأنفية',/sinus|nasal|nose|adenoid|snoring|epistaxis|nosebleed|taste|smell|جيوب|أنف|لحمية|شخير|رعاف|التهاب الأنف|التذوق|الشم/],
    ['throat','Throat & tonsils','الحلق واللوزتان',/throat|tonsil|pharyng|laryng|sore throat|strep|diphtheria|الحلق|لوز|التهاب الحلق|البلعوم|الدفتيريا/],
    ['voice','Swallowing, voice & esophagus','البلع والصوت والمريء',/voice|hoarse|vocal|swallow|speech|esophag|صوت|بحة|الحبال الصوتية|البلع|النطق|المريء/],
    ['allergy','Allergy & cold','الحساسية والزكام',/allergy|allergic|hay fever|common cold|cough|حساسية|زكام|كحة|السعال/],
    ['tumors','Head & neck tumors','أورام الرأس والرقبة',/cancer|tumor|سرطان|ورم/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|surgery|implant|device|screen|prevent|treatment|فحص|جراحة|زراعة|جهاز|وقاية|علاج/],
  ],
  endocrine:[
    ['diabetes','Diabetes','السكري',/diabet|insulin|a1c|blood glucose|hyperglycem|hypoglycem|prediabet|سكري|السكر|أنسولين|الغلوكوز|فرط سكر الدم|نقص سكر الدم/],
    ['parathyroid','Parathyroid & bone metabolism','الغدة الجاردرقية واستقلاب العظام',/parathyroid|rickets|osteopor|الغدة الجاردرقية|تلين العظام|هشاشة/],
    ['thyroid','Thyroid','الغدة الدرقية',/thyroid|goiter|درقية|تضخم الغدة/],
    ['adrenal','Adrenal glands','الغدد الكظرية',/adrenal|cushing|addison|pheochromocytoma|الكظرية|كوشينغ|أديسون/],
    ['pituitary','Pituitary gland','الغدة النخامية',/pituitary|acromegaly|prolactinoma|النخامية|ضخامة الأطراف/],
    ['metabolic','Metabolic & inherited disorders','الاضطرابات الأيضية والوراثية',/metabolic disorder|metabolic syndrome|amino acid|carbohydrate metabolism|lipid metabolism|phenylketonuria|mitochondrial|amyloidosis|gaucher|hemochromatosis|wilson|lactose|dehydration|التمثيل الغذائي|الأحماض الأمينية|الكربوهيدرات|دهون|بيلة الفينيل|الميتوكوندريا|النشواني|غوشيه|الحديد|اللاكتوز|الجفاف/],
    ['obesity','Obesity & weight','السمنة والوزن',/obesity|body weight|weight loss|سمنة|الوزن|إنقاص الوزن/],
    ['hormones','Hormones & reproductive endocrine','الهرمونات والغدد التناسلية',/hormone|menopause|menstruation|polycystic|ovarian|turner|testicular|هرمون|انقطاع الطمث|الطمث|المبيض المتعدد|أكياس المبيض|تيرنر|الخصية/],
    ['growth','Growth & development','النمو والتطور',/growth|dwarfism|النمو|القزامة/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|medicine|surgery|transplant|diet|prevent|treatment|فحص|دواء|جراحة|زراعة|نظام غذائي|وقاية|علاج/],
  ],
  eyes:[
    ['cataract','Cataract','المياه البيضاء',/cataract|مياه بيضاء|إعتام العدسة/],
    ['glaucoma','Glaucoma','الجلوكوما',/glaucoma|جلوكوما|الزرق/],
    ['retina','Retina & macula','الشبكية والبقعة',/retina|macular|detachment|diabetic eye|شبكية|البقعة|انفصال الشبكية|عين سكري/],
    ['refractive','Refractive errors & eyewear','عيوب الانكسار والنظارات',/refractive|myopia|hyperopia|astigmatism|presbyopia|nearsight|farsight|eyewear|glasses|قصر النظر|طول النظر|اللابؤرية|النظارات/],
    ['infections','Eye infections & inflammation','التهابات العين',/infect|pink eye|conjunctiv|keratitis|uveitis|blepharitis|stye|corneal|behcet|التهاب|الملتحمة|القرنية|العنبية|الجفن|بهجت/],
    ['nerve','Optic nerve & vision loss','العصب البصري وفقدان البصر',/optic nerve|amblyopia|vision impairment|blind|color blindness|eye movement|usher|العصب البصري|ضعف البصر|العمى|عمى الألوان|حركة العين/],
    ['injuries','Eye injuries & surgery','إصابات العين والجراحة',/injur|surgery|laser|tears|إصابة|جراحة|الليزر|الدموع/],
    ['care','Eye care & eyelid','العناية بالعين والجفون',/eye care|eyelid|cosmetic|العناية بالعين|الجفن/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|screen|prevent|treatment|medicine|فحص|وقاية|علاج|دواء/],
  ],
  immune:[
    ['allergy','Allergies','الحساسية',/allergy|allergic|anaphylaxis|hay fever|hives|food allergy|latex|حساسية|تحسس|تأق|الأرتيكاريا|الشرى|غذائية|لاتكس/],
    ['autoimmune','Autoimmune diseases','أمراض المناعة الذاتية',/autoimmune|lupus|rheumatoid|scleroderma|sjogren|sjögren|pemphigus|ankylosing|juvenile arthritis|giant cell|kawasaki|diabetes type 1|مناعة ذاتية|الذئبة|الروماتويد|التصلب الجلدي|الفقاري|الالتهاب المفصلي|خلايا عملاقة|كاواساكي|سكري من النوع الأول/],
    ['hiv','HIV & AIDS','فيروس نقص المناعة البشرية',/hiv|aids|فيروس العوز المناعي|الإيدز/],
    ['deficiency','Immunodeficiency & bone marrow','نقص المناعة ونخاع العظام',/immunodeficien|bone marrow|marrow|spleen|thymus|lymphatic|lymphedem|immune system|aplastic|eosinophilic|نقص المناعة|نخاع العظام|الطحال|التيموس|اللمفاوية|اللمفية|الجهاز المناعي|الحمضات/],
    ['vaccines','Vaccines & immunization','اللقاحات والتحصين',/vaccin|immunization|flu shot|tetanus|لقاح|تطعيم|الإنفلونزا الموسمية|الكزاز/],
    ['infections','Infections','العدوى',/infect|viral|bites|mononucleosis|cryptosporidiosis|tonsillitis|pneumocystis|عدوى|فيروس|عضات|كثرة الوحيدات|التهاب اللوزتين|الرئوية/],
    ['cancers','Blood cancers','أورام الدم',/leukemi|lymphoma|myeloma|myelodysplast|thymus cancer|لوكيميا|ليمفوما|ميلوما|ورم التيموس/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|medicine|surgery|transplant|prevent|treatment|safety|فحص|دواء|جراحة|زراعة|وقاية|علاج|السلامة/],
  ],
  kidney:[
    ['disease','Kidney disease & failure','أمراض الكلى والفشل الكلوي',/kidney disease|kidney failure|renal|nephro|diabetic kidney|kidney cyst|glomerul|diabetes insipidus|أمراض الكلى|الفشل الكلوي|كلوي|الكلى السكري|أكياس الكلى|البول السكري/],
    ['stones','Kidney stones','حصى الكلى',/kidney stone|nephrolith|urolith|حصى الكلى|حصوات/],
    ['infections','Urinary infections','عدوى المسالك البولية',/infection|uti|عدوى|التهاب المسالك/],
    ['bladder','Bladder & urination','المثانة والتبول',/bladder|urination|urinary|ureter|urethra|incontinence|overactive|interstitial cystitis|مثانة|تبول|البول|الحالب|الإحليل|سلس البول|المثانة النشطة|التهاب المثانة الخلالي/],
    ['cancers','Kidney & bladder cancers','أورام الكلى والمثانة',/cancer|tumor|wilms|سرطان|ورم/],
    ['treatment','Dialysis & transplantation','الغسيل الكلوي وزراعة الكلى',/dialysis|transplant|ostomy|غسيل|زراعة|فغر/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|urinalysis|screen|prevent|treatment|فحص|تحليل|وقاية|علاج/],
  ],
  lungs:[
    ['asthma','Asthma','الربو',/asthma|ربو/],
    ['copd','COPD & smoking','الانسداد الرئوي والتدخين',/copd|emphysema|chronic bronchitis|smoking|e-cigarette|alpha-1|انسداد رئوي|النفاخ|التهاب شعبي مزمن|تدخين|إلكترونية|ألفا-1/],
    ['infections','Lung infections','عدوى الرئة',/pneumonia|bronchitis|tuberculosis|covid|flu\b|influenza|rsv|respiratory syncytial|whooping|croup|legionnaires|bird flu|h1n1|pneumocystis|التهاب رئوي|التهاب شعبي|السل|كوفيد|الأنفلونزا|الفيروس المخلوي|السعال الديكي|الخناق|الفيلقية|إنفلونزا الطيور/],
    ['interstitial','Interstitial & rare lung diseases','أمراض الرئة الخلالية والنادرة',/interstitial|fibrosis|sarcoid|cystic fibrosis|pulmonary hypertension|collapsed lung|pleural|bronchial|tracheal|choking|breathing problem|respiratory failure|خلالي|تليف|الساركويد|التليف الكيسي|ارتفاع ضغط الرئة|انخماص|الجنبة|القصبات|القصبة الهوائية|الاختناق|صعوبة التنفس|فشل تنفسي/],
    ['cancer','Lung cancer & mesothelioma','سرطان الرئة والورم المتوسطي',/lung cancer|mesothelioma|سرطان الرئة|الورم المتوسطي/],
    ['embolism','Pulmonary embolism','الانسداد الرئوي',/embolism|thromb|انسداد|جلطة/],
    ['sleep','Sleep apnea & snoring','انقطاع النفس النومي والشخير',/sleep apnea|snoring|انقطاع النفس|الشخير/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/oxygen|transplant|rehabilitation|test|medicine|surgery|prevent|treatment|أكسجين|زراعة|تأهيل|فحص|دواء|جراحة|وقاية|علاج/],
  ],
  mouth:[
    ['decay','Tooth decay & dental care','تسوس الأسنان والعناية بها',/tooth decay|cavit|caries|dental|dentures|orthodont|tooth disorder|child dental|تسوس|الأسنان|أطقم|تقويم|العناية بالأسنان/],
    ['gum','Gum disease','أمراض اللثة',/gum|gingiv|periodont|لثة|اللثة/],
    ['infections','Oral infections & sores','عدوى وتقرحات الفم',/canker|cold sore|herpes|yeast|thrush|dry mouth|oral infection|mouth disorder|tonsillitis|behcet|تقرحات|قروح|هربس|فطريات|قلاع|جفاف الفم|التهاب الفم|التهاب اللوزتين|بهجت/],
    ['cancer','Oral & salivary cancers','أورام الفم والغدد اللعابية',/oral cancer|mouth cancer|head and neck|salivary|cancer|tumor|سرطان|ورم|اللعابية/],
    ['jaw','Jaw & temporomandibular joint','الفك والمفصل الصدغي',/jaw|temporomandibular|tmj|cleft|فك|الصدغي|الشفة المشقوقة/],
    ['tongue','Tongue, taste & smell','اللسان والتذوق والشم',/tongue|taste|smell|bad breath|لسان|التذوق|الشم|رائحة الفم/],
    ['voice','Voice & speech','الصوت والنطق',/voice|speech|stutter|hoarse|صوت|النطق|الكلام|التأتأة|بحة/],
    ['habits','Tobacco & oral habits','التبغ وعادات الفم',/tobacco|smokeless|piercing|تبغ|مضغ|ثقب/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|surgery|prevent|treatment|screen|فحص|جراحة|وقاية|علاج/],
  ],
  skin:[
    ['acne','Acne & rosacea','حب الشباب والوردية',/acne|rosacea|حب الشباب|الوردية/],
    ['autoimmune','Autoimmune skin diseases','أمراض جلدية مناعية',/pemphigus|scleroderma|lupus|behcet|psoriat|الصدفية|الفقاعي|التصلب الجلدي|الذئبة|بهجت/],
    ['eczema','Eczema, rashes & hives','الأكزيما والطفح والشرى',/eczema|dermatitis|rash|itching|hives|urticaria|dandruff|أكزيما|التهاب الجلد|طفح|حكة|الأرتيكاريا|الشرى|قشرة/],
    ['psoriasis','Psoriasis','الصدفية',/psoriasis|الصدفية/],
    ['infections','Skin infections','عدوى الجلد',/infection|fungal|tinea|athlete.s foot|ringworm|cellulitis|impetigo|wart|herpes|shingles|chickenpox|measles|rubella|fifth disease|leishmaniasis|scabies|lice|hidradenitis|عدوى|فطري|قدم الرياضي|القوباء|الثآليل|هربس|الحزام الناري|الجدري|الحصبة|الحصبة الألمانية|الليشمانيا|الجرب|القمل/],
    ['hair','Hair & scalp','الشعر وفروة الرأس',/hair|alopecia|scalp|شعر|الثعلبة|فروة الرأس/],
    ['nails','Nail disorders','أمراض الأظافر',/nail|أظافر|الأظافر/],
    ['cancer','Skin cancer','سرطان الجلد',/skin cancer|melanoma|kaposi|mole|سرطان الجلد|الميلانوما|الشامة/],
    ['appearance','Pigmentation & skin aging','التصبغ وشيخوخة الجلد',/pigmentation|vitiligo|birthmark|skin aging|sun|tanning|cosmetic|botox|piercing|scar|sweat|pigment|التصبغ|البهاق|الوحمة|شيخوخة|الشمس|تسمير|مستحضرات|ندبة|التعرق/],
    ['wounds','Wounds, burns & bites','الجروح والحروق واللسعات',/burns?|wound|bruise|blister|pressure sore|corn|callus|bite|sting|poison ivy|tick|mosquito|injur|حرق|جرح|كدمة|فقاعة|قرح الفراش|مسمار القدم|لدغة|لسعة|البلوط السام|القراد|البعوض|إصابة/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|surgery|treatment|prevent|hygiene|فحص|جراحة|علاج|وقاية|نظافة/],
  ],
  female:[
    ['pregnancy','Pregnancy & childbirth','الحمل والولادة',/pregnan|childbirth|prenatal|postpartum|cesarean|ectopic|miscarriage|stillbirth|multiple birth|twins|preterm|premature bab|birth weight|fetal|incompatib|breastfeeding|abortion|الحمل|الولادة|ما قبل الولادة|بعد الولادة|القيصرية|خارج الرحم|الإجهاض|الإملاص|التوائم|المبكرة|وزن الوليد|الجنين|عدم التوافق|الرضاعة/],
    ['fertility','Fertility & conception','الخصوبة والإنجاب',/fertil|infertil|assisted reproduc|reproductive hazard|preconception|genetic counsel|genetic test|ovarian insufficiency|خصوبة|العقم|الإنجاب|ما قبل الحمل|الاستشارة الوراثية|الفحص الوراثي|قصور المبيض/],
    ['ovarian','Ovaries & PCOS','المبايض وتكيس المبايض',/ovar|polycystic|pcos|مبيض|المبيض|تكيس/],
    ['uterus','Uterus & cervix','الرحم وعنق الرحم',/uterus|uterine|fibroid|hysterectomy|cervix|cervical|الرحم|الأورام الليفية|استئصال الرحم|عنق الرحم/],
    ['menstrual','Menstruation & pelvic pain','الدورة الشهرية وألم الحوض',/menstrual|menstruation|period pain|premenstrual|vaginal bleeding|endometriosis|pelvic|دورة|الطمث|الحيض|ألم الدورة|متلازمة ما قبل الحيض|نزيف مهبلي|بطانة الرحم|الحوض/],
    ['hormones','Menopause & hormone therapy','انقطاع الطمث والعلاج الهرموني',/menopause|hormone therapy|انقطاع الطمث|سن اليأس|العلاج الهرموني/],
    ['infections','Vaginal & sexually transmitted infections','عدوى المهبل والأمراض المنقولة جنسياً',/vagin|vulv|yeast|sexually transmitted|sti|chlamydia|gonorrhea|herpes|hpv|wart|syphilis|trichomoniasis|pelvic inflammatory|مهبل|فرج|فطريات|منقولة جنسياً|الكلاميديا|السيلان|الهربس|فيروس الورم الحليمي|الثآليل|الزهري|المشعرة|الحوض/],
    ['breast','Breast health','صحة الثدي',/breast|mammogra|mastectomy|ثدي|الثدي|تصوير الثدي|استئصال الثدي/],
    ['sexual','Sexual health & contraception','الصحة الجنسية وتنظيم النسل',/birth control|contracept|tubal|vasectomy|sexual|sexual health|تنظيم النسل|منع الحمل|ربط الأنابيب|قطع القناة|جنسي|الصحة الجنسية/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|screen|surgery|medicine|treatment|prevent|فحص|تحليل|جراحة|دواء|علاج|وقاية/],
  ],
  male:[
    ['prostate','Prostate','البروستاتا',/prostat|بروستاتا/],
    ['testicular','Testicular disorders','اضطرابات الخصية',/testic|testicle|خصية|الخصية|الخصيتين/],
    ['infections','Sexually transmitted infections','الأمراض المنقولة جنسياً',/sexually transmitted|sti|chlamydia|gonorrhea|herpes|wart|syphilis|منقولة جنسياً|الكلاميديا|السيلان|الهربس|الثآليل|الزهري/],
    ['erectile','Erectile & sexual problems','ضعف الانتصاب والمشاكل الجنسية',/erectile|impotence|sexual|penis|انتصاب|العنانة|جنسي|القضيب/],
    ['fertility','Male fertility','خصوبة الرجل',/infertil|fertil|reproduc|خصوبة|العقم|الإنجاب/],
    ['contraception','Contraception & circumcision','تنظيم النسل والختان',/birth control|contracept|vasectomy|circumcision|تنظيم النسل|منع الحمل|قطع القناة|الختان/],
    ['support','Tests, treatments & prevention','الفحوصات والعلاجات والوقاية',/test|screen|surgery|treatment|prevent|فحص|جراحة|علاج|وقاية/],
  ],
};
  function conditionTypeSpec(id){return CONDITION_TYPES.find(item=>item[0]===id)||null}
  const conditionTypeTextCache=new WeakMap();
  function conditionTypeText(topic){
    if(!topic)return '';
    let text=conditionTypeTextCache.get(topic);
    if(text===undefined){text=clean([topic.title,topic.primaryName,...(topic.synonyms||[]),topic.summary].filter(Boolean).join(' '));conditionTypeTextCache.set(topic,text)}
    return text;
  }
  function conditionMatchesType(topic,id){const spec=conditionTypeSpec(id);return spec?spec[3].test(conditionTypeText(topic)):true}
  let conditionTypeCountTopics=null,conditionTypeCountsCache=null;
  function conditionTypeCounts(topics){
    if(!topics?.length)return null;
    if(conditionTypeCountTopics===topics)return conditionTypeCountsCache;
    const counts=new Map(CONDITION_TYPES.map(spec=>[spec[0],0]));
    for(const topic of topics){const text=conditionTypeText(topic);for(const spec of CONDITION_TYPES){if(spec[3].test(text))counts.set(spec[0],counts.get(spec[0])+1)}}
    conditionTypeCountTopics=topics;conditionTypeCountsCache=counts;return counts;
  }
  const conditionSubgroupTextCache=new WeakMap();
  function conditionSubgroupsFor(group){return CONDITION_SUBGROUPS[group]||[]}
  function conditionSubgroupSpec(group,id){return conditionSubgroupsFor(group).find(spec=>spec[0]===id)||null}
  function conditionSubgroupText(topic){
    if(!topic)return '';
    let text=conditionSubgroupTextCache.get(topic);
    if(text===undefined){text=clean([topic.title,topic.primaryName].filter(Boolean).join(' ')).toLowerCase();conditionSubgroupTextCache.set(topic,text)}
    return text;
  }
  function conditionSubgroupFor(topic,group){
    const specs=conditionSubgroupsFor(group);if(!specs.length)return null;
    const text=conditionSubgroupText(topic);
    for(const spec of specs){if(spec[3].test(text))return spec}
    return null;
  }
  const conditionSubgroupCountsCache=new Map();
  function conditionSubgroupCounts(group){
    const topics=conditionLocal.topics;if(!topics?.length)return null;
    if(conditionSubgroupCountsCache.has(group))return conditionSubgroupCountsCache.get(group);
    const counts=new Map(conditionSubgroupsFor(group).map(spec=>[spec[0],0]));
    for(const topic of topics){
      if(!(topic.groups||[]).includes(group))continue;
      const spec=conditionSubgroupFor(topic,group);
      if(spec)counts.set(spec[0],counts.get(spec[0])+1);
    }
    conditionSubgroupCountsCache.set(group,counts);return counts;
  }
  function drugStartsWith(drug,letter){
    const name=language==='ar'?(val(drug,'commercial_name_ar')||brandEn(drug)):brandEn(drug);
    const first=clean(name).charAt(0);return first===clean(letter).charAt(0);
  }
  function drugMatchesGroup(drug,id){
    const spec=DRUG_GROUPS.find(group=>group[0]===id);if(!spec)return true;
    const text=spec[3]==='class'?String(val(drug,'drug_class')):`${val(drug,'drug_class')} ${val(drug,'scientific_name')} ${brandEn(drug)}`;return spec[2].test(text);
  }
  function taxonomyText(drug){return `${val(drug,'drug_class')} ${val(drug,'scientific_name')} ${brandEn(drug)}`}
  function taxonomyChild(drug,children){const text=taxonomyText(drug);return children.find(child=>child.pattern!==OTHER&&child.pattern.test(text))||children.find(child=>child.pattern===OTHER)||null}
  function drugMatchesPath(drug,path){if(!path.length)return true;if(!drugMatchesGroup(drug,path[0]))return false;let children=DRUG_SUBGROUPS[path[0]]||[];for(let depth=1;depth<path.length;depth++){const selected=children.find(child=>child.id===path[depth]);if(!selected||taxonomyChild(drug,children)?.id!==selected.id)return false;children=selected.children||[]}return true}
  function taxonomyNode(path){let children=DRUG_SUBGROUPS[path[0]]||[],node=null;for(let depth=1;depth<path.length;depth++){node=children.find(child=>child.id===path[depth])||null;children=node?.children||[]}return node}
  function taxonomyLabel(key){const labels=drugTaxonomyLabels[key];return labels?labels[language==='ar'?1:0]:t(key)}
  function taxonomyEnglishLabel(key){const labels=drugTaxonomyLabels[key];return labels?labels[0]:translations.en[key]||key}
  function taxonomyHasChildren(path){return path.length===1||Boolean(taxonomyNode(path)?.children?.length)}
  const classSearchTextCache=new WeakMap(),classStrongTextCache=new WeakMap();
  function classStrongText(drug){
    const cached=classStrongTextCache.get(drug);if(cached!==undefined)return cached;
    const className=String(val(drug,'drug_class')),parts=[className];
    CLASS_SEARCH_GROUPS.forEach(([pattern,enLabel,arLabel])=>{if(pattern.test(className))parts.push(enLabel,arLabel)});
    const text=clean(parts.filter(Boolean).join(' '));classStrongTextCache.set(drug,text);return text;
  }
  function classSearchText(drug){
    const cached=classSearchTextCache.get(drug);if(cached!==undefined)return cached;
    const parts=[classStrongText(drug)];
    DRUG_GROUPS.forEach(([id,key])=>{
      if(!drugMatchesGroup(drug,id))return;
      parts.push(translations.en[key],translations.ar[key]);
      let children=DRUG_SUBGROUPS[id]||[];
      for(let depth=0;depth<8&&children.length;depth++){
        const child=taxonomyChild(drug,children);
        if(!child||child.pattern===OTHER)break;
        const labels=drugTaxonomyLabels[child.key];
        if(labels)parts.push(labels[0],labels[1]);
        children=child.children||[];
      }
    });
    const text=clean(parts.filter(Boolean).join(' '));classSearchTextCache.set(drug,text);return text;
  }
  function groupPathCount(path){
    const key=path.join('/');let count=groupCountCache.get(key);
    if(count===undefined){count=drugs.filter(drug=>path.length===1?drugMatchesGroup(drug,path[0]):drugMatchesPath(drug,path)).length;groupCountCache.set(key,count)}
    return count;
  }
  function renderBrowseControls(){
    const medicineLetters=language==='ar'?ARABIC_LETTERS:LATIN_LETTERS;
    $('#medicineAlphabet').innerHTML=medicineLetters.map((letter,index)=>`<button type="button" class="letter-chip${!input.value.trim()&&selectedMedicineLetter===letter?' active':''}" data-medicine-letter="${letter}" aria-label="${esc(t('startsWith'))} ${letter}">${letter}</button>`).join('');
    const groups=$('#drugGroups'),heading=$('#drugGroupHeading'),trail=$('#drugGroupTrail');trail.innerHTML='';
    if(!activeDrugPath.length){groups.hidden=false;heading.hidden=false;groups.innerHTML=DRUG_GROUPS.map(([id,key])=>{const count=groupPathCount([id]);return `<button type="button" class="group-chip" data-taxonomy-group="${id}">${esc(t(key))}<span>${count.toLocaleString(language==='ar'?'ar-EG':'en-US')}</span></button>`}).join('')}
    else{const root=DRUG_GROUPS.find(group=>group[0]===activeDrugPath[0]);const crumbs=[{key:root?.[1]||activeDrugPath[0],depth:0},...activeDrugPath.slice(1).map((id,index)=>{const node=taxonomyNode(activeDrugPath.slice(0,index+2));return {key:node?.key||id,depth:index+1}})];trail.innerHTML=crumbs.map((crumb,index)=>`${index?'<span aria-hidden="true">›</span>':''}<button type="button" data-taxonomy-depth="${crumb.depth}"${index===crumbs.length-1?' aria-current="page"':''}>${esc(drugTaxonomyLabels[crumb.key]?taxonomyLabel(crumb.key):t(crumb.key))}</button>`).join('');const node=taxonomyNode(activeDrugPath),children=activeDrugPath.length===1?(DRUG_SUBGROUPS[activeDrugPath[0]]||[]):(node?.children||[]);groups.hidden=!children.length;heading.hidden=!children.length;groups.innerHTML=children.map(child=>{const count=groupPathCount([...activeDrugPath,child.id]);return `<button type="button" class="group-chip" data-taxonomy-child="${child.id}">${esc(taxonomyLabel(child.key))}<span>${count.toLocaleString(language==='ar'?'ar-EG':'en-US')}</span></button>`}).join('')}
    const info=$('#drugGroupInfo');
    let infoKey='',infoLabel='',infoLabelEn='';
    if(activeDrugPath.length){const selectedNode=activeDrugPath.length>1?taxonomyNode(activeDrugPath):null,rootSpec=DRUG_GROUPS.find(group=>group[0]===activeDrugPath[0]),labelKey=selectedNode?.key||rootSpec?.[1]||activeDrugPath[0];infoKey=selectedNode?.id||activeDrugPath[0];infoLabel=taxonomyLabel(labelKey);infoLabelEn=taxonomyEnglishLabel(labelKey)}
    const explanation=infoKey?(drugGroupExplanations[infoKey]||drugGroupExplanations[activeDrugPath[0]]):null;
    if(!infoKey){info.hidden=true;info.innerHTML=''}else{
      const copy=explanation?.[language==='ar'?'ar':'en'],groupQuery=encodeURIComponent(infoLabelEn||infoLabel);
      const groupLinks=[[`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${groupQuery}`,t('sourceDailyMed')],[`https://medlineplus.gov/search/?query=${groupQuery}`,t('sourceMedlineDrug')],[`https://www.ema.europa.eu/en/medicines?search_api_fulltext=${groupQuery}`,t('sourceEma')],['https://www.edaegypt.gov.eg/',t('sourceEda')]];
      info.innerHTML=`<h3>${esc(infoLabel)}</h3>${copy?`<div class="drug-group-info-columns"><section><h4>${esc(t('groupHowItWorks'))}</h4><p>${esc(copy[0])}</p></section><section><h4>${esc(t('groupEffect'))}</h4><p>${esc(copy[1])}</p></section></div>`:''}<div class="drug-group-sources"><h4>${esc(t('groupSourcesTitle'))}</h4><div class="detail-links">${groupLinks.map(([href,label])=>`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join('')}</div></div><p class="drug-group-info-note">${esc(t('groupInfoNote'))}</p>`;info.hidden=false;
    }
    const groupActive=Boolean(activeConditionGroup),typeActive=Boolean(activeConditionType);
    $('#conditionAlphabet').innerHTML=LATIN_LETTERS.map(letter=>`<button type="button" class="letter-chip${selectedConditionLetter===letter?' active':''}" data-condition-letter="${letter}" aria-label="${esc(t('startsWith'))} ${letter}">${letter}</button>`).join('');
    $('#conditionGroups').innerHTML=BODY_SYSTEMS.map(([id,name])=>`<button type="button" class="group-chip${activeConditionGroup===id?' active':''}" data-condition-group="${id}">${esc(t(`body${id[0].toUpperCase()}${id.slice(1)}`))}</button>`).join('');
    const systemsHeading=$('#conditionSystemsHeading'),typesHeading=$('#conditionTypesHeading'),letterLabel=$('#conditionLetterLabel'),conditionTrail=$('#conditionGroupTrail');
    if(systemsHeading)systemsHeading.hidden=groupActive;
    if($('#conditionGroups'))$('#conditionGroups').hidden=groupActive;
    if(letterLabel)letterLabel.hidden=groupActive;
    if($('#conditionAlphabet'))$('#conditionAlphabet').hidden=groupActive;
    const typeCounts=groupActive?conditionSubgroupCounts(activeConditionGroup):conditionTypeCounts(conditionLocal.topics);
    const visibleTypes=groupActive?conditionSubgroupsFor(activeConditionGroup).filter(spec=>!typeCounts||(typeCounts.get(spec[0])||0)>0):CONDITION_TYPES;
    if(typesHeading){
      typesHeading.textContent=groupActive?t('conditionSubgroups'):t('browseConditionTypes');
      typesHeading.hidden=typeActive||(groupActive&&!visibleTypes.length);
    }
    const conditionTypes=$('#conditionTypes');
    conditionTypes.hidden=typeActive;
    conditionTypes.innerHTML=visibleTypes.map(([id,en,ar])=>{const count=typeCounts?.get(id);return `<button type="button" class="group-chip${activeConditionType===id?' active':''}" data-condition-type="${id}">${esc(language==='ar'?ar:en)}${count!==undefined?`<span>${count.toLocaleString(language==='ar'?'ar-EG':'en-US')}</span>`:''}</button>`}).join('');
    if(conditionTrail){
      if(!groupActive){conditionTrail.hidden=true;conditionTrail.innerHTML=''}
      else{
        const groupLabel=t(`body${activeConditionGroup[0].toUpperCase()}${activeConditionGroup.slice(1)}`),typeSpec=activeConditionType?conditionSubgroupSpec(activeConditionGroup,activeConditionType):null;
        conditionTrail.hidden=false;
        conditionTrail.innerHTML=`<button type="button" class="condition-trail-back" data-condition-depth="0"><span class="condition-back-arrow" aria-hidden="true">‹</span> ${esc(t('allBodySystems'))}</button><span aria-hidden="true">›</span><button type="button" data-condition-depth="1"${typeSpec?'':' aria-current="page"'}>${esc(groupLabel)}</button>${typeSpec?`<span aria-hidden="true">›</span><span aria-current="page">${esc(language==='ar'?typeSpec[2]:typeSpec[1])}</span>`:''}`;
      }
    }
    $('#conditionAlphabetNote').textContent=t('conditionAlphabetNote');
    updateAppBack();
  }

  let labSelectedSpecialty='',labSelectedGroup='',labSelectedTest='',labSelectedLetter='',labSelectedPurpose='',labSelectedSample='',labVisible=8;
  const labCatalog=window.LAB_CATALOG||{specialties:[],tests:[]};
  const LAB_PURPOSES=[
    ['screening','Screening & risk','الفحص المسحي وتقييم الخطورة',['cbc','glucose','hba1c','lipid','urinalysis','uacr','tsh','vitd','hiv','hepatitis','pregnancy','fobt']],
    ['diagnosis','Diagnosis','التشخيص',['cbc','diff','ferritin','bmp','cmp','glucose','hba1c','tsh','vitd','creatinine','egfr','urinalysis','urine-culture','uacr','lipid','troponin','lft','alt','h-pylori','fobt','crp','esr','hepatitis','hiv','pregnancy','prolactin']],
    ['monitoring','Monitoring & follow-up','المتابعة والمراقبة',['cbc','bmp','cmp','glucose','hba1c','tsh','creatinine','egfr','uacr','ptinr','lft','alt','crp','esr','prolactin']],
    ['acute','Emergency & acute care','الطوارئ والحالات الحادة',['cbc','bmp','troponin','ptinr','crp','glucose']]
  ];
  const LAB_SAMPLES=[
    ['blood','Blood','الدم',['cbc','diff','ferritin','ptinr','bmp','cmp','glucose','hba1c','tsh','vitd','creatinine','egfr','lipid','troponin','lft','alt','hepatitis','hiv','crp','esr','pregnancy','prolactin']],
    ['urine','Urine','البول',['urinalysis','urine-culture','uacr']],
    ['stool','Stool','البراز',['fobt','h-pylori']]
  ];
  function labPurposeSpec(id){return LAB_PURPOSES.find(item=>item[0]===id)||null}
  function labSampleSpec(id){return LAB_SAMPLES.find(item=>item[0]===id)||null}
  function labFilterLabel(){const spec=labPurposeSpec(labSelectedPurpose)||labSampleSpec(labSelectedSample);return spec?(language==='ar'?spec[2]:spec[1]):''}
  function labPasses(test){
    if(labSelectedPurpose&&!labPurposeSpec(labSelectedPurpose)?.[3].includes(test[0]))return false;
    if(labSelectedSample&&!labSampleSpec(labSelectedSample)?.[3].includes(test[0]))return false;
    return true;
  }
  function labFilterLabels(test){
    const labels=[];
    LAB_PURPOSES.forEach(spec=>{if(spec[3].includes(test[0]))labels.push(language==='ar'?spec[2]:spec[1])});
    LAB_SAMPLES.forEach(spec=>{if(spec[3].includes(test[0]))labels.push(language==='ar'?spec[2]:spec[1])});
    return labels;
  }
  const labText=(object)=>object?.[language==='ar'?'ar':'en']||object?.en||'';
  function labSpecialty(id){return labCatalog.specialties.find(item=>item.id===id)}
  function labGroup(specialtyId,groupId){return labSpecialty(specialtyId)?.groups.find(item=>item.id===groupId)}
  function labSearchItems(query,limit=8){
    const parsed=buildWildcardQuery(query);if(!parsed)return[];const found=[];
    for(const test of labCatalog.tests){
      const nameEn=clean(test[3]),nameAr=clean(test[4]),code=clean(test[0]),specialty=clean(labText(labSpecialty(test[1])?.name)),group=clean(labText(labGroup(test[1],test[2])?.name)),filters=clean(labFilterLabels(test).join(' ')),hay=`${code} ${nameEn} ${nameAr} ${specialty} ${group} ${filters}`;
      let score=wildcardScore(parsed,hay);if(score<0)continue;
      const nameScore=Math.max(wildcardScore(parsed,nameEn),wildcardScore(parsed,nameAr));if(nameScore>=0)score+=Math.round(nameScore*.5);else if(wildcardScore(parsed,code)>=0)score+=18;
      found.push({test,score});
    }
    found.sort((a,b)=>b.score-a.score||String(a.test[3]).localeCompare(String(b.test[3])));
    return found.slice(0,limit).map(item=>item.test);
  }
  const POPULAR_LAB_TESTS=['cbc','glucose','hba1c','lipid','tsh','vitd','lft','urinalysis'];
  const labSuggestions=$('#labSuggestions');
  function popularLabTests(){return POPULAR_LAB_TESTS.map(id=>labCatalog.tests.find(test=>test[0]===id)).filter(Boolean)}
  function renderLabSuggestions(force=false){
    const field=$('#labTestSearch');
    if(!force&&document.activeElement!==field){labSuggestions.hidden=true;return}
    const tests=field.value.trim()?labSearchItems(field.value,30):popularLabTests();if(!tests.length){labSuggestions.hidden=true;return}
    labSuggestions.innerHTML=`<div class="suggestion-label">${esc(t('popularLabTests'))}</div>`+tests.map((test,index)=>{const specialty=labText(labSpecialty(test[1])?.name),group=labText(labGroup(test[1],test[2])?.name);return `<button type="button" class="suggestion" role="option" aria-selected="false" data-index="${index}"><span class="suggestion-icon">⌕</span><span class="suggestion-copy"><span class="suggestion-name">${esc(language==='ar'?test[4]:test[3])}</span><span class="suggestion-meta">${esc([language==='ar'?test[3]:'',specialty,group].filter(Boolean).join(' · '))}</span></span><span aria-hidden="true">›</span></button>`}).join('');
    labSuggestions.hidden=false;
    labSuggestions.querySelectorAll('.suggestion').forEach((button,index)=>{button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>{labSuggestions.hidden=true;openLabTestFromSearch(tests[index])})});
  }
  function renderUnifiedLabResults(){if(input.value.trim()){$('#unifiedLabSection').hidden=true;return}
    const section=$('#unifiedLabSection'),container=$('#unifiedLabResults'),query=input.value.trim(),show=isUnifiedView()&&Boolean(query)&&unifiedLabItems.length>0;
    section.hidden=!show;container.innerHTML='';if(!show)return;
    $('#unifiedLabCount').textContent=String(unifiedLabItems.length);
    unifiedLabItems.forEach(test=>{
      const displayName=language==='ar'?test[4]:test[3],specialty=labText(labSpecialty(test[1])?.name),group=labText(labGroup(test[1],test[2])?.name);
      const card=document.createElement('button');card.type='button';card.className='unified-condition-card';card.innerHTML=`<span class="condition-result-icon">＋</span><span><b>${esc(displayName)}</b><small>${esc([language==='ar'?test[3]:'',specialty,group].filter(Boolean).join(' · '))}</small></span><span aria-hidden="true">›</span>`;
      card.addEventListener('click',()=>openLabTestFromSearch(test));container.append(card);
    });
  }
  function updateUnifiedLabSearch(){unifiedLabItems=isUnifiedView()&&input.value.trim()?labSearchItems(input.value,10):[];renderUnifiedLabResults()}
  function openLabTestFromSearch(test){
    if(!test)return;suggestions.hidden=true;const id=test[0],specialty=test[1],group=test[2];
    switchPage('lab-tests','lab-tests');labSelectedSpecialty=specialty;labSelectedGroup=group;labSelectedLetter='';labSelectedPurpose='';labSelectedSample='';labSelectedTest=id;renderLabCatalog();
    setTimeout(()=>{const detail=$('#labTestDetail');if(detail&&!detail.hidden)revealResult(detail,'start')},180);
  }
  const labContentLocal={promise:null,tests:null};
  function loadLabContent(){
    if(!labContentLocal.promise){
      labContentLocal.promise=fetchWithTimeout(withRev(LAB_CONTENT_URL),{cache:'force-cache'},20000)
        .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
        .then(data=>{
          const tests=data&&data.tests;
          if(!tests||!Object.keys(tests).length)throw new Error('Empty lab guide');
          labContentLocal.tests=tests;return tests;
        })
        .catch(error=>{console.warn('Bundled lab guide unavailable:',error);labContentLocal.promise=null;return null});
    }
    return labContentLocal.promise;
  }
  /* MedlinePlus publishes each guide as headed sections of paragraphs and lists.
     The whole guide is kept, in page order, and every heading becomes its own
     collapsible section so the reader opens only the part they need. */
  function labGuideSections(entry){
    const sections=entry?.en?.sections;
    if(!Array.isArray(sections)||!sections.length)return '';
    return sections.map(section=>{
      const blocks=(section.blocks||[]).map(block=>block.type==='list'
        ?`<ul>${(block.items||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`
        :`<p>${esc(block.text||'')}</p>`).join('');
      return `<section><h3>${esc(section.heading||'')}</h3>${blocks}</section>`;
    }).join('');
  }
  function renderLabTestDetail(selected){
    const detail=$('#labTestDetail');if(!detail)return;
    const title=selected[3+(language==='ar'?1:0)],guide=labContentLocal.tests?.[selected[0]],
      slug=String(selected[13]),
      source=guide?.url||(slug.includes('/')?`https://medlineplus.gov/${slug}`:`https://medlineplus.gov/lab-tests/${slug}/`),
      specialtyName=labText(labSpecialty(selected[1])?.name),groupName=labText(labGroup(selected[1],selected[2])?.name),
      testQuery=encodeURIComponent(String(selected[3]).replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim());
    const summarySections=`<section><h3>${esc(t('labWhatMeasures'))}</h3><p>${esc(selected[5+(language==='ar'?1:0)])}</p></section><section><h3>${esc(t('labResults'))}</h3><p>${esc(selected[7+(language==='ar'?1:0)])}</p></section><section><h3>${esc(t('labMethod'))}</h3><p>${esc(selected[9+(language==='ar'?1:0)])}</p></section><section><h3>${esc(t('labPreparation'))}</h3><p>${esc(selected[11+(language==='ar'?1:0)])}</p></section>`;
    const guideSections=labGuideSections(guide);
    const body=language==='ar'
      ?summarySections+(guideSections?`<p class="lab-guide-note">${esc(t('labGuideNote'))}</p>${guideSections}`:'')
      :(guideSections?`${guideSections}<p class="lab-guide-credit">${esc(t('labGuideCredit'))}</p>`:summarySections);
    detail.innerHTML=`<span class="lab-test-code">${esc(selected[3+(language==='ar'?0:1)])}</span><h2>${esc(title)}</h2><div class="lab-detail-meta"><span>${esc(t('labSpecialtyLabel'))}: <b>${esc(specialtyName)}</b></span><span>${esc(t('labGroupLabel'))}: <b>${esc(groupName)}</b></span></div>${body}`;
    const ref=window.LAB_REFERENCE?.[selected[0]]||{},normal=ref.normal?.[language==='ar'?'ar':'en']||(language==='ar'?'اعتمد المجال المرجعي المطبوع في تقرير المختبر؛ لا يوجد مجال موحد لجميع الطرق والفئات.':'Use the reference interval printed on your lab report; intervals are not universal across methods and groups.'),critical=ref.critical?.[language==='ar'?'ar':'en']||(language==='ar'?'لا يوجد حد رقمي موحد. يحدد المختبر قيم التنبيه الحرجة وفق طريقته وسياسة الإبلاغ لديه.':'There is no universal numeric cutoff. The laboratory sets critical alert limits for its method and reporting policy.'),valueSource=ref.normalSource||source,criticalSource=ref.source;
    detail.insertAdjacentHTML('beforeend',`<section class="lab-value-panel"><h3>${esc(t('labReference'))}</h3><p>${esc(normal)}</p><a href="${valueSource}" target="_blank" rel="noopener noreferrer">${esc(t('labValueSource'))} ↗</a></section><section class="lab-value-panel lab-critical-panel"><h3>${esc(t('labCritical'))}</h3><p>${esc(critical)}</p>${criticalSource?`<a href="${criticalSource}" target="_blank" rel="noopener noreferrer">${esc(t('labValueSource'))} ↗</a>`:''}</section><p class="lab-value-disclaimer">${esc(t('labValueDisclaimer'))}</p><section class="lab-sources"><h3>${esc(t('labOfficialSources'))}</h3><div class="detail-links"><a href="${source}" target="_blank" rel="noopener noreferrer">${esc(t('labSource'))} ↗</a><a href="https://medlineplus.gov/lab-tests/" target="_blank" rel="noopener noreferrer">MedlinePlus · Lab Tests ↗</a><a href="https://www.testing.com/?s=${testQuery}" target="_blank" rel="noopener noreferrer">${esc(t('sourceTestingCom'))} ↗</a><a href="https://www.nhs.uk/search/results?q=${testQuery}%20test" target="_blank" rel="noopener noreferrer">${esc(t('sourceNhs'))} ↗</a><a href="https://search.cdc.gov/search/?query=${testQuery}" target="_blank" rel="noopener noreferrer">${esc(t('sourceCdc'))} ↗</a></div></section>`);
    if(!labContentLocal.tests)loadLabContent().then(tests=>{if(tests&&labSelectedTest===selected[0])renderLabTestDetail(selected)});
  }
  function renderLabCatalog(){
    const query=$('#labTestSearch').value.trim().toLocaleLowerCase();
    const specialties=$('#labSpecialties'),groups=$('#labSubgroups'),list=$('#labTestList'),detail=$('#labTestDetail'),crumb=$('#labBreadcrumb'),alphabet=$('#labAlphabet'),alphabetWrap=$('#labAlphabetWrap');
    const purposeChips=$('#labPurposes'),sampleChips=$('#labSamples'),filterBlock=$('#labFilterBlock');
    const selected=labCatalog.tests.find(test=>test[0]===labSelectedTest);
    const currentSpecialty=labSpecialty(labSelectedSpecialty),currentGroup=labGroup(labSelectedSpecialty,labSelectedGroup);
    const letterMode=!query&&Boolean(labSelectedLetter)&&!labSelectedSpecialty;
    const filterMode=!query&&Boolean(labSelectedPurpose||labSelectedSample);
    const filterName=labFilterLabel();
    if(query&&!selected){specialties.hidden=true;groups.hidden=true;list.hidden=true;detail.hidden=true;alphabetWrap.hidden=true;renderLabSuggestions(true);return}
    const searchResults=query?labSearchItems(query,200):[];
    const letterCounts=new Map();labCatalog.tests.forEach(test=>{const letter=String(test[3]).trim().charAt(0).toUpperCase();letterCounts.set(letter,(letterCounts.get(letter)||0)+1)});
    alphabet.innerHTML=LATIN_LETTERS.map(letter=>{const count=letterCounts.get(letter)||0;return `<button type="button" class="letter-chip${labSelectedLetter===letter?' active':''}" data-lab-letter="${letter}"${count?'':' disabled'} aria-label="${esc(t('startsWith'))} ${letter}">${letter}</button>`}).join('');
    alphabetWrap.hidden=Boolean(query)||Boolean(labSelectedSpecialty)||Boolean(labSelectedTest);
    if(purposeChips)purposeChips.innerHTML=LAB_PURPOSES.map(([id,en,ar,ids])=>`<button type="button" class="group-chip${labSelectedPurpose===id?' active':''}" data-lab-purpose="${id}">${esc(language==='ar'?ar:en)}<span>${ids.length}</span></button>`).join('');
    if(sampleChips)sampleChips.innerHTML=LAB_SAMPLES.map(([id,en,ar,ids])=>`<button type="button" class="group-chip${labSelectedSample===id?' active':''}" data-lab-sample="${id}">${esc(language==='ar'?ar:en)}<span>${ids.length}</span></button>`).join('');
    if(filterBlock)filterBlock.hidden=Boolean(query)||Boolean(labSelectedSpecialty)||Boolean(labSelectedLetter)||Boolean(labSelectedTest);
    const testCard=(test,meta)=>`<button type="button" class="lab-directory-card" data-lab-test="${test[0]}"><span class="lab-directory-icon">⌕</span><span><strong>${esc(test[3+(language==='ar'?1:0)])}</strong><small>${esc(meta||test[3+(language==='ar'?0:1)])}</small></span><span aria-hidden="true">›</span></button>`;
    const letterTests=letterMode?labCatalog.tests.filter(test=>String(test[3]).trim().charAt(0).toUpperCase()===labSelectedLetter):[];
    crumb.hidden=Boolean(query)||(!labSelectedSpecialty&&!labSelectedLetter&&!filterMode);
    if(filterMode)crumb.innerHTML=`<button type="button" data-lab-level="root">${esc(t('labTestsTitle'))}</button><span>›</span><button type="button" data-lab-level="purpose"${selected?'':` aria-current="page"`}>${esc(filterName)}</button>${selected?`<span>›</span><span aria-current="page">${esc(selected[3+(language==='ar'?1:0)])}</span>`:''}`;
    else if(labSelectedLetter&&!labSelectedSpecialty)crumb.innerHTML=`<button type="button" data-lab-level="root">${esc(t('labTestsTitle'))}</button><span>›</span><button type="button" data-lab-level="letter"${selected?'':` aria-current="page"`}>${esc(labSelectedLetter)}</button>${selected?`<span>›</span><span aria-current="page">${esc(selected[3+(language==='ar'?1:0)])}</span>`:''}`;
    else crumb.innerHTML=labSelectedSpecialty?`<button type="button" data-lab-level="root">${esc(t('labTestsTitle'))}</button>${currentSpecialty?`<span>›</span><button type="button" data-lab-level="specialty">${esc(labText(currentSpecialty.name))}</button>`:''}${currentGroup?`<span>›</span><button type="button" data-lab-level="group">${esc(labText(currentGroup.name))}</button>`:''}${selected?`<span>›</span><span aria-current="page">${esc(selected[3+(language==='ar'?1:0)])}</span>`:''}`:'';
    specialties.hidden=Boolean(query)||Boolean(labSelectedSpecialty)||Boolean(labSelectedLetter)||filterMode;
    groups.hidden=Boolean(query)||!labSelectedSpecialty||Boolean(labSelectedGroup)||Boolean(labSelectedLetter);
    list.hidden=Boolean(query)?false:(letterMode?Boolean(labSelectedTest):(Boolean(labSelectedTest)||(!labSelectedGroup&&!filterMode)));
    detail.hidden=!labSelectedTest||Boolean(query);
    if(!query&&!labSelectedSpecialty&&!labSelectedLetter&&!filterMode){specialties.innerHTML=`<h2 class="browse-toggle${labSpecOpen?' is-open':''}" role="button" tabindex="0" data-lab-spec-toggle aria-expanded="${labSpecOpen?'true':'false'}">${esc(t('labSpecialtyHeading'))}</h2><div class="lab-spec-cards${labSpecOpen?'':' fold-collapsed'}">`+labCatalog.specialties.map(item=>{const count=labCatalog.tests.filter(test=>test[1]===item.id).length;return `<button type="button" class="lab-directory-card" data-lab-specialty="${item.id}"><span class="lab-directory-icon">＋</span><span><strong>${esc(labText(item.name))}</strong><small>${count} ${esc(t('labTestCount'))}</small></span><span aria-hidden="true">›</span></button>`}).join('')+'</div>'}
    if(!query&&labSelectedSpecialty&&!labSelectedGroup){groups.innerHTML=`<h2>${esc(t('labGroupHeading'))}</h2>`+(currentSpecialty?.groups||[]).map(item=>{const count=labCatalog.tests.filter(test=>test[1]===labSelectedSpecialty&&test[2]===item.id).length;return `<button type="button" class="lab-directory-card" data-lab-group="${item.id}"><span class="lab-directory-icon">＋</span><span><strong>${esc(labText(item.name))}</strong><small>${count} ${esc(t('labTestCount'))}</small></span><span aria-hidden="true">›</span></button>`}).join('')}
    if(!query&&labSelectedSpecialty&&labSelectedGroup&&!labSelectedTest){const tests=labCatalog.tests.filter(test=>test[1]===labSelectedSpecialty&&test[2]===labSelectedGroup);list.innerHTML=`<h2>${esc(t('labTestHeading'))}</h2>`+tests.map(test=>testCard(test)).join('')}
    if(filterMode&&!labSelectedTest){const tests=labCatalog.tests.filter(test=>labPasses(test));list.innerHTML=`<h2>${esc(filterName)} <small>${tests.length} ${esc(t('labTestCount'))}</small></h2>`+(tests.length?tests.map(test=>testCard(test,`${labText(labSpecialty(test[1])?.name)} · ${labText(labGroup(test[1],test[2])?.name)}`)).join(''):`<p class="lab-empty">${esc(t('labNoResults'))}</p>`)}
    if(letterMode&&!labSelectedTest){const shownTests=letterTests.slice(0,labVisible);list.innerHTML=`<h2>${esc(t('labLetterHeading'))} ${esc(labSelectedLetter)} <small>${letterTests.length} ${esc(t('labTestCount'))}</small></h2>`+(shownTests.length?shownTests.map(test=>testCard(test,`${labText(labSpecialty(test[1])?.name)} · ${labText(labGroup(test[1],test[2])?.name)}`)).join(''):`<p class="lab-empty">${esc(t('labLetterEmpty'))}</p>`)+(letterTests.length>labVisible?`<button type="button" class="load-more" data-lab-more>${esc(t('showMore'))} (${letterTests.length-labVisible}) ↓</button>`:'')}
    if(query){specialties.hidden=true;groups.hidden=true;list.hidden=false;detail.hidden=true;list.innerHTML=`<h2>${esc(t('labSearchHeading'))}</h2>`+(searchResults.length?searchResults.map(test=>testCard(test,`${labText(labSpecialty(test[1])?.name)} · ${labText(labGroup(test[1],test[2])?.name)}`)).join(''):`<p class="lab-empty">${esc(t('labNoResults'))}</p>`)}
    if(selected)renderLabTestDetail(selected);
    updateAppBack();
  }
  function splitWikiSentences(text){
    return String(text||'').replace(/\s+/g,' ').trim().match(/[^.!?؟]+[.!?؟]+[”"']?|[^.!?؟]+$/g)?.map(sentence=>sentence.trim()).filter(Boolean)||[];
  }
  function wikiParagraphHtml(text,limit=2800){
    let content=String(text||'').replace(/\s+/g,' ').trim();if(!content)return '';
    if(content.length>limit)content=content.slice(0,limit).replace(/\s+\S*$/,'')+'…';
    const sentences=splitWikiSentences(content),paragraphs=[];let buffer='';
    sentences.forEach(sentence=>{if((buffer?buffer.length+1:0)+sentence.length>520){if(buffer)paragraphs.push(buffer);buffer=sentence}else buffer=buffer?`${buffer} ${sentence}`:sentence});
    if(buffer)paragraphs.push(buffer);
    return paragraphs.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('');
  }
  function appNavActionFor(page,view){
    if(page==='medicines')return view==='medicine-list'?'medicine-list':'unified-search';
    if(page==='conditions')return 'condition-list';
    return ['lab-tests','dose-calculator','interactions','reminders','pregnancy','calculators','study','assistant','suggestions','about','privacy','settings'].includes(page)?page:'';
  }
  function setActiveAppNav(action){
    document.querySelectorAll('[data-app-nav]').forEach(button=>{
      const primary=Boolean(button.closest('.app-sidenav,.bottom-nav,.app-drawer'));
      const active=primary&&button.dataset.appNav===action;
      button.classList.toggle('is-active',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    });
  }
  function scrollPageTop(){
    const root=document.documentElement,previous=root.style.scrollBehavior;
    root.style.scrollBehavior='auto';
    window.scrollTo(0,0);root.scrollTop=0;document.body.scrollTop=0;
    root.style.scrollBehavior=previous;
  }
  /* On phones the document is locked and <body> is the only scroller, so
     scrollIntoView is not usable for page results: WebKit pans the locked
     document as well and the reader is left with a page that will not move and
     a blank band below the content. Scroll the body scroller itself, once the
     keyboard has finished closing. */
  function bodyScrolls(){return document.body.scrollHeight>document.body.clientHeight+1}
  /* The header carries the only back arrow and stays pinned while the page
     scrolls, so revealed results have to land below it, not under the arrow. */
  function headerClearance(){
    const bar=document.querySelector('.topbar');
    if(!bar||document.body.classList.contains('overlay-open'))return 14;
    if(getComputedStyle(bar).position!=='sticky')return 14;
    return Math.ceil(bar.getBoundingClientRect().height)+14;
  }
  function pageScroller(){return bodyScrolls()?document.body:(document.scrollingElement||document.documentElement)}
  function revealInPage(element,block='nearest'){
    if(!element)return;
    const scroller=pageScroller(),limit=scroller.scrollHeight-scroller.clientHeight;
    if(limit<=0)return;
    const viewHeight=scroller===document.body?scroller.clientHeight:window.innerHeight;
    const rect=element.getBoundingClientRect(),gap=headerClearance();
    const delta=block==='start'?rect.top-gap:rect.bottom>viewHeight-gap?rect.bottom-viewHeight+gap:rect.top<gap?rect.top-gap:0;
    if(Math.abs(delta)<2)return;
    const top=Math.max(0,Math.min(scroller.scrollTop+delta,limit));
    if(typeof scroller.scrollTo==='function')scroller.scrollTo({top,behavior:'smooth'});
    else scroller.scrollTop=top;
  }
  function revealResult(element,block='nearest'){
    setTimeout(()=>{
      if(bodyScrolls()){window.scrollTo(0,0);document.documentElement.scrollTop=0}
      revealInPage(element,block);
    },340);
  }
  /* One back control for the whole app, in the header, arrow only. A step pops
     the deepest thing the reader is inside: a drill-down on the current page
     first, then the page they came from. Sheets keep their own dismiss button
     because the header is hidden behind them. */
  let labSpecOpen=false;
  /* Display only: the directory stores brand names in capitals; show them as Title Case. */
  const NAME_KEEP_UPPER=/^(?:[A-Z]\.)+[A-Z]*\.?$/;
  const NAME_LOWER_UNITS=/^(mg|gm|g|ml|mcg|iu|kg|l|%)$/i;
  function fullMaker(m){m=clean(m||'');if(!m)return '';return m.split(/\s*>\s*/).map(p=>p.toLowerCase().replace(/(^|[\s(.-])([a-z])/g,(x,s,ch)=>s+ch.toUpperCase())).join(' › ');}
  function prettyDrugName(value){
    const s=String(value==null?'':value);
    if(!s||/[a-z]/.test(s)||!/[A-Z]/.test(s))return s;
    return s.replace(/[A-Za-z0-9.%]+/g,w=>{
      if(NAME_KEEP_UPPER.test(w))return w;
      if(NAME_LOWER_UNITS.test(w))return w.toLowerCase();
      const m=w.match(/^(\d+)([A-Za-z]+)$/);
      if(m)return m[1]+(NAME_LOWER_UNITS.test(m[2])?m[2].toLowerCase():m[2].toLowerCase());
      if(/^\d/.test(w)||w.replace(/[^A-Za-z]/g,'').length<=3)return w;
      return w.charAt(0)+w.slice(1).toLowerCase();
    });
  }
  const appBackButton=$('#appBack');
  const backTrail=[];
  let backLocation={page:'medicines',view:'home'};
  let restoringScreen=false;
  const SCREEN_VIEWS={medicines:['home','medicine-list'],conditions:['condition-list'],'lab-tests':['lab-tests'],'dose-calculator':['dose-calculator'],interactions:['interactions'],reminders:['reminders'],pregnancy:['pregnancy'],calculators:['calculators'],study:['study'],suggestions:['suggestions'],'add-medicine':['add-medicine'],about:['about'],privacy:['privacy'],settings:['settings'],assistant:['assistant']};
  /* Callers name the view their own way, so a screen can reach here twice under
     two spellings; the trail keys on the canonical one or back lands on a page
     the reader is already looking at. */
  function screenView(page,view){
    const views=SCREEN_VIEWS[page];
    if(!views)return 'home';
    return views.includes(view)?view:views[0];
  }
  function rememberLocation(page,view){
    if(restoringScreen)return;
    if(page===backLocation.page&&view===backLocation.view)return;
    const previous=backLocation;
    backLocation={page,view};
    /* The first entry is always the home screen; keep it so the walk ends there. */
    if(backTrail.length>60)backTrail.splice(1,1);
    backTrail.push(previous);
  }
  function browseDepth(){
    if(backLocation.page==='medicines')return activeDrugPath.length+(selectedMedicineLetter?1:0);
    if(backLocation.page==='conditions')return Number(Boolean(activeConditionType))+Number(Boolean(activeConditionGroup))+Number(Boolean(selectedConditionLetter));
    if(backLocation.page==='lab-tests')return Number(Boolean(labSelectedTest))+Number(Boolean(labSelectedPurpose||labSelectedSample))+Number(Boolean(labSelectedLetter))+Number(Boolean(labSelectedGroup))+Number(Boolean(labSelectedSpecialty));
    return 0;
  }
  function popBrowse(){
    if(backLocation.page==='medicines'){
      if(activeDrugPath.length){activeDrugPath=activeDrugPath.slice(0,-1);activeDrugGroup=activeDrugPath[0]||'';selectedMedicineLetter=null;input.value='';search();return true}
      if(selectedMedicineLetter){selectedMedicineLetter=null;input.value='';search();return true}
      return false;
    }
    if(backLocation.page==='conditions'){
      if(activeConditionType){browseConditions({letter:null,group:activeConditionGroup,type:''});return true}
      if(activeConditionGroup||selectedConditionLetter){browseConditions({letter:null,group:'',type:''});return true}
      return false;
    }
    if(backLocation.page==='lab-tests'){
      if(!browseDepth())return false;
      if(labSelectedTest)labSelectedTest='';
      else if(labSelectedPurpose||labSelectedSample){labSelectedPurpose='';labSelectedSample=''}
      else if(labSelectedLetter)labSelectedLetter='';
      else if(labSelectedGroup)labSelectedGroup='';
      else labSelectedSpecialty='';
      renderLabCatalog();
      return true;
    }
    return false;
  }
  function popPage(){
    if(!backTrail.length)return false;
    backLocation=backTrail.pop();
    restoringScreen=true;
    try{switchPage(backLocation.page,backLocation.view)}finally{restoringScreen=false}
    return true;
  }
  function updateAppBack(){if(appBackButton)appBackButton.hidden=!(browseDepth()||!(backLocation.page==='medicines'&&backLocation.view==='home'))}
  function atHome(){return backLocation.page==='medicines'&&backLocation.view==='home'}
  /* Back climbs one level of the page hierarchy: first out of a drill-down on the page, then to the home screen. */
  function goBack(){
    if(popBrowse())return;
    if(atHome())return;
    backTrail.length=0;
    backLocation={page:'medicines',view:'home'};
    restoringScreen=true;
    try{switchPage('medicines','home')}finally{restoringScreen=false}
    updateAppBack();
  }
  function switchPage(page,view='home'){
    page=String(page||'medicines');
    view=screenView(page,view);
    rememberLocation(page,view);
    document.querySelectorAll('[data-main-page]').forEach(section=>{section.hidden=section.dataset.mainPage!==page});
    document.body.dataset.view=page==='conditions'?'condition-list':view;document.body.classList.remove('searching');applySearchScope();setActiveAppNav(appNavActionFor(page,view));
    if(page==='conditions'){conditionInput.value='';selectedConditionLetter=null;activeConditionGroup='';activeConditionType='';conditionRequest++;conditionTopicList=[];conditionResults.innerHTML='';conditionStatus.textContent='';renderBrowseControls();loadConditionDatabase().then(()=>{if(document.body.dataset.view==='condition-list')renderBrowseControls()});}
    else if(page==='lab-tests'){labSelectedSpecialty='';labSelectedGroup='';labSelectedTest='';labSelectedLetter='';labSelectedPurpose='';labSelectedSample='';labVisible=responsivePageSize('lab');$('#labTestSearch').value='';loadLabContent();renderLabCatalog();}
    else if(page==='dose-calculator'){initDosePage();}
    else if(page==='interactions'){initInteractionsPage();}
    else if(page==='reminders'){initRemindersPage();}
    else if(page==='pregnancy'){initPregnancyPage();}
    else if(page==='calculators'||page==='study'){if(window.DawayaFeatures&&window.DawayaFeatures.pages[page])window.DawayaFeatures.pages[page]();}
    else if(page==='privacy'){initPrivacyPage();}
    else if(page==='settings'){initSettingsPage();}
    else if(page==='assistant'){if(window.DawayaAIChat)window.DawayaAIChat.open();}
    else if(view==='medicine-list'){input.value='';selectedMedicineLetter=null;activeDrugGroup='';activeDrugPath=[];unifiedConditionItems=[];unifiedConditionLoading=false;unifiedLabItems=[];renderUnifiedConditionResults();renderUnifiedLabResults();search();}
    else {input.value='';selectedMedicineLetter=null;activeDrugGroup='';activeDrugPath=[];unifiedConditionItems=[];unifiedConditionLoading=false;unifiedLabItems=[];renderUnifiedConditionResults();renderUnifiedLabResults();search();}
    scrollPageTop();
    updateAppBack();
  }
  function googleSourceSearch(host,query){return `https://www.google.com/search?q=${encodeURIComponent(`site:${host} ${query}`)}`}
  function appendConditionSourceLinks(query){const fallback=document.createElement('div');fallback.className='condition-fallback';[['medlineplus.gov',t('readMedlinePlus')],['drugs.com',t('searchDrugsCom')],['medscape.com',t('searchMedscape')]].forEach(([host,label])=>{const a=document.createElement('a');a.href=googleSourceSearch(host,query);a.target='_blank';a.rel='noopener noreferrer';a.textContent=label+' ↗';fallback.append(a)});conditionResults.append(fallback)}
  const BODY_QUERY={blood:'heart',bones:'bone',brain:'brain',digestive:'digestive',ent:'ear',endocrine:'diabetes',eyes:'eye',immune:'immune',kidney:'kidney',lungs:'lung',mouth:'mouth',skin:'skin',female:'female',male:'prostate'};
  const ARABIC_CONDITION_QUERY={'الربو':'asthma','السكري':'diabetes','السكر':'diabetes','ارتفاع ضغط الدم':'hypertension','ضغط الدم':'hypertension','الصداع النصفي':'migraine','الشقيقة':'migraine','الحساسية':'allergy','حساسية':'allergy','الاكتئاب':'depression','التهاب رئوي':'pneumonia','الالتهاب الرئوي':'pneumonia','مرض الكلى':'kidney disease','أمراض الكلى':'kidney disease','القلب':'heart disease','الأنفلونزا':'influenza','الانفلونزا':'influenza','فقر الدم':'anemia','السرطان':'cancer','السكري من النوع الثاني':'type 2 diabetes'};
  const conditionLocal={promise:null,topics:null};
  function loadConditionDatabase(){
    if(!conditionLocal.promise){
      conditionLocal.promise=fetchWithTimeout(withRev(CONDITION_DATA_URL),{cache:'force-cache'},20000)
        .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
        .then(data=>{
          if(!data||!Array.isArray(data.topics)||!data.topics.length)throw new Error('Empty condition dataset');
          data.topics.forEach(topic=>{if(topic.url&&!topic.links)topic.links=[{url:topic.url,title:'MedlinePlus'}]});
          conditionLocal.topics=data.topics;return data.topics;
        })
        .catch(error=>{console.warn('Bundled condition database unavailable:',error);conditionLocal.promise=null;return null});
    }
    return conditionLocal.promise;
  }
  const knowledgeLocal={promise:null};
  function loadKnowledgeIndex(){
    if(!knowledgeLocal.promise){
      knowledgeLocal.promise=fetchWithTimeout(withRev('assets/ai/knowledge-index.json'),{cache:'force-cache'},20000)
        .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
        .then(data=>{
          if(!data||!Array.isArray(data.entries)||!data.entries.length)throw new Error('Empty knowledge index');
          return data;
        })
        .catch(error=>{console.warn('Bundled knowledge index unavailable:',error);knowledgeLocal.promise=null;return null});
    }
    return knowledgeLocal.promise;
  }
  function localConditionHay(topic){return clean([topic.title,topic.primaryName,...(topic.synonyms||[]),topic.code].join(' '))}  async function searchLocalConditions(query,count=100){
    const topics=await loadConditionDatabase();if(!topics)return[];
    const parsed=buildWildcardQuery(conditionApiQuery(query));if(!parsed)return[];
    const found=[];
    for(const topic of topics){const score=wildcardScore(parsed,localConditionHay(topic));if(score>=0)found.push({topic,score})}
    found.sort((a,b)=>b.score-a.score||a.topic.title.localeCompare(b.topic.title));
    return found.slice(0,count).map(item=>item.topic);
  }
  async function browseLocalConditions({group='',type='',letter=null},count=500){
    const topics=await loadConditionDatabase();if(!topics)return null;
    let list=topics;
    if(group)list=list.filter(topic=>(topic.groups||[]).includes(group));
    if(type)list=list.filter(topic=>group?conditionSubgroupFor(topic,group)?.[0]===type:conditionMatchesType(topic,type));
    if(letter)list=list.filter(topic=>clean(topic.title).startsWith(clean(letter)));
    return list.slice().sort((a,b)=>a.title.localeCompare(b.title)).slice(0,count);
  }
  function localConditionSummary(topic){
    const topics=conditionLocal.topics;if(!topics||!topic)return null;
    const key=clean(topic.primaryName||topic.title);
    const match=topics.find(item=>clean(item.primaryName||item.title)===key)||topics.find(item=>clean(item.title)===clean(topic.title));
    if(!match||!match.summary)return null;
    return {title:match.title,url:match.url,sections:{overview:match.summary},project:'offline'};
  }
  function renderConditionTopics(topics,request,sourceQuery){
    if(request!==conditionRequest)return;
    conditionResults.innerHTML='';conditionTopicList=topics;conditionVisible=responsivePageSize('condition');
    if(!topics.length){conditionStatus.textContent=t('conditionNoResults');appendConditionSourceLinks(sourceQuery);return}
    conditionStatus.textContent=`${topics.length} ${language==='ar'?'حالة صحية':(topics.length===1?'health condition':'health conditions')}`;appendConditionTopicCards();
  }
  function appendConditionTopicCards(){
    const fragment=document.createDocumentFragment();conditionTopicList.slice(0,conditionVisible).forEach(topic=>{
      const card=document.createElement('article');card.className='condition-card';const title=document.createElement('h2'),titleButton=document.createElement('button');titleButton.type='button';titleButton.className='condition-title-button';titleButton.textContent=topic.title;titleButton.addEventListener('click',()=>openCondition(topic));title.append(titleButton);card.append(title);
      if(topic.primaryName&&topic.primaryName!==topic.title){const summary=document.createElement('p');summary.className='condition-summary';summary.textContent=topic.primaryName;card.append(summary)}
      if(topic.code){const code=document.createElement('p');code.className='condition-code';code.textContent=`${language==='ar'?'رمز ICD':'ICD code'}: ${topic.code}`;card.append(code)}
      if(topic.synonyms?.length){const synonyms=document.createElement('p');synonyms.className='condition-summary condition-synonyms';synonyms.textContent=`${language==='ar'?'أسماء أخرى:':'Also known as:'} ${topic.synonyms.join(', ')}`;card.append(synonyms)}
      const summaryDetails=document.createElement('details');summaryDetails.className='condition-inline-summary';summaryDetails.dataset.conditionTitle=topic.primaryName||topic.title;const summaryLabel=document.createElement('summary'),summaryHeading=document.createElement('strong'),summaryPreview=document.createElement('span');summaryHeading.textContent=t('wikiConditionTitle');summaryPreview.className='condition-inline-preview';summaryPreview.textContent=t('conditionSummaryLoading');summaryLabel.append(summaryHeading,summaryPreview);const summaryBody=document.createElement('div');summaryBody.className='condition-inline-summary-body';summaryDetails.append(summaryLabel,summaryBody);summaryDetails.addEventListener('toggle',()=>{if(summaryDetails.open&&summaryDetails.dataset.loaded!=='true')loadConditionCardSummary(summaryDetails)});card.append(summaryDetails);
      const imageButton=document.createElement('button');imageButton.type='button';imageButton.className='condition-image-button';imageButton.textContent=language==='ar'?'عرض صور الحالة':'Show condition images';imageButton.addEventListener('click',()=>openConditionGoogleImages(topic));card.append(imageButton);
      const links=document.createElement('div');links.className='condition-links';const sourceLinks=[...(topic.links||[]).map(item=>[item.url,item.title||t('conditionSource')]),[googleSourceSearch('medlineplus.gov',topic.title),t('readMedlinePlus')],[googleSourceSearch('drugs.com',topic.title),t('searchDrugsCom')],[googleSourceSearch('medscape.com',topic.title),t('searchMedscape')]];sourceLinks.forEach(([href,label])=>{const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label+' ↗';links.append(a)});card.append(links);fragment.append(card);
      if(conditionSummaryObserver)conditionSummaryObserver.observe(summaryDetails);else loadConditionCardSummary(summaryDetails);
    });conditionResults.append(fragment);
    if(conditionVisible<conditionTopicList.length){const more=document.createElement('button');more.type='button';more.className='condition-more';more.textContent=`${t('showMore')} (${conditionTopicList.length-conditionVisible}) ↓`;conditionResults.append(more)}
  }
  async function browseConditions({letter=null,group=activeConditionGroup,type=activeConditionType}={}){
    selectedConditionLetter=(group||type)?null:(letter||null);activeConditionGroup=group||'';activeConditionType=type||'';conditionInput.value='';renderBrowseControls();conditionSuggestions.hidden=true;
    const request=++conditionRequest;
    if(!activeConditionGroup&&!activeConditionType&&!selectedConditionLetter){conditionTopicList=[];conditionResults.innerHTML='';conditionStatus.textContent='';return}
    conditionStatus.textContent=t('conditionLoading');conditionResults.innerHTML='';
    const term=activeConditionGroup?BODY_QUERY[activeConditionGroup]:(activeConditionType?conditionTypeSpec(activeConditionType)?.[1]:selectedConditionLetter);
    try{
      const local=await browseLocalConditions({group:activeConditionGroup,type:activeConditionType,letter:selectedConditionLetter},500);
      if(local){
        if(request!==conditionRequest)return;
        renderBrowseControls();
        renderConditionTopics(local,request,term);
        return;
      }
      conditionStatus.textContent=t('conditionError');appendConditionSourceLinks(term)
    }catch(error){if(request!==conditionRequest)return;console.warn('Condition browse failed:',error);conditionStatus.textContent=t('conditionError');appendConditionSourceLinks(term)}
  }
  async function searchConditions(query=conditionInput.value.trim()){
    if(!query)return;clearTimeout(conditionSuggestionTimer);conditionSuggestionRequest++;conditionSuggestions.hidden=true;conditionInput.value=query;selectedConditionLetter=null;activeConditionGroup='';renderBrowseControls();const request=++conditionRequest;conditionStatus.textContent=t('conditionLoading');conditionResults.innerHTML='';
    try{const topics=await fetchConditionSearchTopics(query,request,100);renderConditionTopics(topics,request,query)}catch(error){if(request!==conditionRequest)return;console.warn('Condition search failed:',error);conditionStatus.textContent=t('conditionError');conditionResults.innerHTML='';appendConditionSourceLinks(query)}
  }
  function conditionApiQuery(query){const normalizedQuery=clean(query);return Object.entries(ARABIC_CONDITION_QUERY).find(([arabic])=>clean(arabic)===normalizedQuery)?.[1]||query}
  function conditionTopicHay(topic){return clean([topic.title,topic.primaryName,...(topic.synonyms||[]),topic.code].join(' '))}
  async function fetchConditionSearchTopics(query,request,count=100){
    return await searchLocalConditions(query,count)||[];
  }
  const POPULAR_CONDITIONS=[['High Blood Pressure','ارتفاع ضغط الدم'],['Diabetes Type 2','السكري من النوع الثاني'],['Asthma','الربو'],['Migraine','الصداع النصفي'],['Anemia','الأنيميا'],['Flu','الإنفلونزا'],['Sinusitis','التهاب الجيوب الأنفية'],['Eczema','الأكزيما'],['Hypothyroidism','قصور الغدة الدرقية'],['Peptic Ulcer','قرحة المعدة']];
  function popularConditionTopics(){
    const topics=conditionLocal.topics||[];
    return POPULAR_CONDITIONS.map(([en,ar])=>{
      const local=topics.find(topic=>clean(topic.title)===clean(en));
      return local?{...local,_popularAr:ar}:{title:en,primaryName:en,_popularAr:ar};
    });
  }
  async function updatePopularConditionSuggestions(){
    const request=++conditionSuggestionRequest;
    conditionSuggestionActive=-1;conditionSuggestionItems=[];conditionInput.removeAttribute('aria-activedescendant');
    await loadConditionDatabase();
    if(request!==conditionSuggestionRequest||document.activeElement!==conditionInput||conditionInput.value.trim())return;
    const topics=popularConditionTopics();if(!topics.length){conditionSuggestions.hidden=true;return}
    conditionSuggestionItems=topics;
    conditionSuggestions.innerHTML=`<div class="suggestion-label">${esc(t('popularConditions'))}</div>`+topics.map((topic,index)=>{const title=language==='ar'?topic._popularAr||topic.title:topic.title,meta=language==='ar'?(topic.title!==title?topic.title:''):(topic.primaryName!==topic.title?topic.primaryName:topic.code?`ICD ${topic.code}`:'MedlinePlus');return `<button type="button" id="condition-suggestion-${index}" class="suggestion condition-suggestion" role="option" aria-selected="false" data-index="${index}"><span class="suggestion-icon">⌕</span><span class="suggestion-copy"><span class="suggestion-name">${esc(title)}</span><span class="suggestion-meta">${esc(meta)}</span></span><span class="suggestion-price" aria-hidden="true">↵</span></button>`}).join('');
    conditionSuggestions.hidden=false;
    conditionSuggestions.querySelectorAll('.condition-suggestion').forEach((button,index)=>{button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>selectConditionSuggestion(conditionSuggestionItems[index]))});
  }
  async function updateConditionSuggestions(){
    const query=conditionInput.value.trim(),request=++conditionSuggestionRequest;conditionSuggestionActive=-1;conditionSuggestionItems=[];conditionInput.removeAttribute('aria-activedescendant');
    if(!query){conditionSuggestions.hidden=true;return}
    conditionSuggestions.innerHTML=`<div class="suggestion-label">${esc(t('conditionSuggestLoading'))}</div>`;conditionSuggestions.hidden=false;
    try{
      const topics=await fetchConditionSearchTopics(query,null,7);if(request!==conditionSuggestionRequest||conditionInput.value.trim()!==query)return;
      conditionSuggestionItems=topics;
      if(!topics.length){conditionSuggestions.innerHTML=`<div class="suggestion-label">${esc(t('conditionSuggestEmpty'))}</div>`;return}
      conditionSuggestions.innerHTML=`<div class="suggestion-label">${esc(t('suggestions'))}</div>`+topics.map((topic,index)=>`<button type="button" id="condition-suggestion-${index}" class="suggestion condition-suggestion${index===conditionSuggestionActive?' active':''}" role="option" aria-selected="false" data-index="${index}"><span class="suggestion-icon">⌕</span><span class="suggestion-copy"><span class="suggestion-name">${esc(topic.title)}</span><span class="suggestion-meta">${esc(topic.primaryName!==topic.title?topic.primaryName:topic.code?`${language==='ar'?'رمز ICD':'ICD'} ${topic.code}`:'NLM ClinicalTables')}</span></span><span class="suggestion-price" aria-hidden="true">↵</span></button>`).join('');
      conditionSuggestions.querySelectorAll('.condition-suggestion').forEach((button,index)=>{button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>selectConditionSuggestion(conditionSuggestionItems[index]))});
    }catch(error){if(request!==conditionSuggestionRequest)return;conditionSuggestions.hidden=true;console.warn('Condition autocomplete failed:',error)}
  }
  function setConditionSuggestionActive(options){
    options.forEach((option,index)=>{const active=index===conditionSuggestionActive;option.classList.toggle('active',active);option.setAttribute('aria-selected',String(active))});
    const current=options[conditionSuggestionActive];if(current)conditionInput.setAttribute('aria-activedescendant',current.id);else conditionInput.removeAttribute('aria-activedescendant');
  }
  if('MutationObserver' in window)new MutationObserver(()=>{conditionInput.setAttribute('aria-expanded',String(!conditionSuggestions.hidden));if(conditionSuggestions.hidden)conditionInput.removeAttribute('aria-activedescendant')}).observe(conditionSuggestions,{attributes:true,attributeFilter:['hidden']});
  function selectConditionSuggestion(topic){if(!topic)return;conditionInput.value=topic.title;conditionSuggestions.hidden=true;conditionSuggestionActive=-1;openCondition(topic)}
  async function loadConditionCardSummary(details){
    if(details.dataset.loaded==='true')return;details.dataset.loaded='true';const body=details.querySelector('.condition-inline-summary-body'),preview=details.querySelector('.condition-inline-preview');if(!body||!preview)return;
    const title=details.dataset.conditionTitle;
    try{
      const data=await fetchEncyclopediaCondition({title,primaryName:title});
      if(!data){preview.textContent=t('conditionSummaryUnavailable');body.innerHTML=`<p>${esc(t('conditionSummaryUnavailable'))}</p>`;return}
      const overview=String(data.sections.overview||'').trim().replace(/\s+/g,' '),plain=overview.slice(0,1600);
      preview.textContent=plain?(plain.length>240?`${plain.slice(0,237)}…`:plain):t('conditionSummaryUnavailable');
      body.innerHTML=`${conditionWikiSectionHtml(t('wikiOverview'),plain)}<p class="condition-summary-credit"><a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">${esc(t('labWikiSource'))}: ${esc(data.title)} ↗</a></p>`;
    }catch(error){details.dataset.loaded='false';preview.textContent=t('conditionInfoUnavailable');body.innerHTML=`<p>${esc(t('conditionInfoUnavailable'))}</p>`;console.warn('Encyclopedia condition summary unavailable:',error)}
  }
  async function openCondition(topic){
    if(!topic)return;
    if(conditionDetailBackdrop.hidden&&document.activeElement&&document.activeElement!==document.body)conditionReturnFocus=document.activeElement;
    if(document.body.dataset.view!=='condition-list')switchPage('conditions','condition-list');modal.hidden=true;activeDrug=null;activeConditionTopic=topic;document.body.style.overflow='hidden';conditionDetailBackdrop.hidden=false;
    $('#conditionDetailTitle').textContent=topic.title;$('#conditionDetailCode').textContent=topic.code?`${language==='ar'?'رمز ICD':'ICD'}: ${topic.code}`:'';
    $('#conditionDetailAliases').textContent=topic.synonyms?.length?`${language==='ar'?'أسماء أخرى:':'Also known as:'} ${topic.synonyms.join(', ')}`:'';
    $('#conditionDetailBody').innerHTML='';
    const sources=$('#conditionDetailSources');sources.innerHTML=`<strong class="condition-sources-heading">${esc(t('sourcesHeading'))}</strong>`;
    const addSource=(href,label)=>{if(!/^https?:\/\//.test(href))return;const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label+' ↗';sources.append(a)};
    addSource(`https://medlineplus.gov/search/?query=${encodeURIComponent(topic.primaryName||topic.title)}`,t('conditionMedlineSource'));
    const topicQuery=encodeURIComponent(topic.primaryName||topic.title);
    addSource('https://www.nhs.uk/search/results?q='+topicQuery,t('sourceNhs'));
    addSource('https://search.cdc.gov/search/?query='+topicQuery,t('sourceCdc'));
    addSource('https://www.who.int/search?query='+topicQuery,t('sourceWho'));
    topic.links?.forEach(item=>addSource(item.url,item.title||t('conditionSource')));
    const summaryBox=$('#conditionOverviewSummary');summaryBox.innerHTML=`<h3>${esc(t('wikiConditionTitle'))}</h3><p class="condition-detail-loading">${esc(t('wikiConditionLoading'))}</p>`;loadEncyclopediaCondition(topic);
    $('#conditionDetailClose').focus();
  }
  const encyclopediaConditionCache=new Map();
  async function fetchEncyclopediaCondition(topic){
    const term=topic.primaryName||topic.title,cacheKey=`${language}:${clean(term)}`;
    if(encyclopediaConditionCache.has(cacheKey))return encyclopediaConditionCache.get(cacheKey);
    await loadConditionDatabase();
    const summary=localConditionSummary(topic);
    encyclopediaConditionCache.set(cacheKey,summary||null);
    return summary||null;
  }
  function conditionWikiSectionHtml(title,text){const content=String(text||'').trim();if(!content)return '';return `<section><h4>${esc(title)}</h4>${wikiParagraphHtml(content,24000)}</section>`}
  async function loadEncyclopediaCondition(topic){
    const box=$('#conditionOverviewSummary');
    try{
      const data=await fetchEncyclopediaCondition(topic);
      if(activeConditionTopic!==topic||conditionDetailBackdrop.hidden)return;
      if(!data){box.innerHTML=`<h3>${esc(t('wikiConditionTitle'))}</h3><p>${esc(t('wikiConditionMissing'))}</p><p>${esc(t('wikiMedicalNote'))}</p>`;enableReadMore(box);return}
      const parts=Object.entries({overview:t('wikiOverview'),types:t('wikiTypes'),symptoms:t('wikiSymptoms'),causes:t('wikiCauses'),riskFactors:t('wikiRiskFactors'),diagnosis:t('wikiDiagnosis'),treatment:t('wikiTreatment'),complications:t('wikiComplications'),prevention:t('wikiPrevention'),prognosis:t('wikiPrognosis')}).map(([key,title])=>conditionWikiSectionHtml(title,data.sections[key])).filter(Boolean).join('');
      box.innerHTML=`<h3>${esc(t('wikiConditionTitle'))}: ${esc(data.title)}</h3>${parts}<a class="wiki-article-link" href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">${esc(t('labWikiSource'))}: ${esc(data.title)} ↗</a>${data.project==='offline'?`<p class="condition-source-scope">${esc(t('offlineConditionNote'))}</p>`:''}<p class="condition-source-scope">${esc(t('wikiMedicalNote'))}</p>`;
      /* Each section already opens on its own heading, so the panel is not clipped again. */
      box.classList.remove('read-more','is-expanded','is-overflowing');
    }catch(error){
      if(activeConditionTopic===topic){box.innerHTML=`<h3>${esc(t('wikiConditionTitle'))}</h3><p>${esc(t('conditionInfoUnavailable'))}</p><p>${esc(t('wikiMedicalNote'))}</p>`;enableReadMore(box)}
      console.warn('Encyclopedia condition summary unavailable:',error);
    }
  }
  function closeConditionDetail(){
    conditionDetailBackdrop.hidden=true;activeConditionTopic=null;if(modal.hidden)document.body.style.overflow='';
    const previous=conditionReturnFocus&&conditionReturnFocus.isConnected&&conditionReturnFocus.getClientRects().length?conditionReturnFocus:conditionInput;
    conditionReturnFocus=null;if(previous)previous.focus({preventScroll:true});
  }

  const isUnifiedView=()=>document.body.dataset.view==='home';
  function applySearchScope(){
    const unified=isUnifiedView();
    const chipBar=document.querySelector('.search-by');if(chipBar){chipBar.hidden=unified;chipBar.setAttribute('aria-hidden',String(unified))}
    if(unified)setSearchModeMenu(false);
    if(input){input.placeholder=unified?t('unifiedSearchPlaceholder'):t('medicineSearchPlaceholder');input.setAttribute('aria-label',unified?t('unifiedSearchAria'):t('medicineSearchAria'))}
    const kicker=$('#searchKicker');if(kicker)kicker.textContent=unified?t('unifiedKicker'):t('medicineKicker');
    const headline=$('#searchHeadline');if(headline)headline.textContent=unified?t('unifiedSearchHeading'):t('medicineSearchHeading');
    const hint=$('#searchHintText');if(hint)hint.textContent=unified?t('unifiedSearchHint'):t('medicineSearchHint');
    const scope=$('#searchScopeHint');if(scope)scope.textContent=unified?t('unifiedScopeHint'):t('medicineScopeHint');
    const emptyTitle=$('#emptyTitle');if(emptyTitle)emptyTitle.textContent=unified?t('noUnifiedResults'):t('noResults');
    const emptyHint=$('#emptyHint');if(emptyHint)emptyHint.textContent=unified?t('noUnifiedResultsHint'):t('noResultsHint');
    if(suggestions)suggestions.setAttribute('aria-label',unified?t('unifiedSearchAria'):t('medicineSearchAria'));
  }

  function applyTheme(){
    const preference=core?.theme?core.theme.preference:themePreference;
    const dark=core?.theme?core.theme.isDark():preference==='dark'||(preference==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light';
    document.documentElement.dataset.themePreference=preference;
    const themeMeta=document.querySelector('meta[name="theme-color"]');if(themeMeta)themeMeta.setAttribute('content',dark?'#121212':'#F8F9FA');
    renderSettingsPage();
  }
  function applyLanguage(){
    const isArabic=language==='ar';
    document.documentElement.lang=language;document.documentElement.dir=isArabic?'rtl':'ltr';document.body.classList.toggle('rtl',isArabic);
    document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n)});
    /* A wipe button re-labelled by this pass must not stay armed: its confirm
       wording is gone, so the next tap would delete data without a warning. */
    document.querySelectorAll('.privacy-danger[data-armed="true"]').forEach(button=>{button.dataset.armed='false'});
    renderReadingList();renderReadingStatus('ok');
    document.querySelectorAll('[data-i18n-placeholder]').forEach(node=>{node.placeholder=t(node.dataset.i18nPlaceholder)});
    document.querySelectorAll('[data-i18n-aria]').forEach(node=>{node.setAttribute('aria-label',t(node.dataset.i18nAria))});
    document.querySelectorAll('[data-i18n-title]').forEach(node=>{node.title=t(node.dataset.i18nTitle)});
    $('#brandName').textContent=isArabic?'Drugcopeia':'Drugcopeia';$('#brandSubtitle').textContent=t('brandSubtitle');
    $('.footer-brand-name').textContent=isArabic?'Drugcopeia':'Drugcopeia';$('.footer-brand-subtitle').textContent=t('brandSubtitle');
    $('#conditionSuggestions')?.setAttribute('aria-label',isArabic?'اقتراحات الحالات':'Condition suggestions');
    updateMenuToggleLabel();
    $('#dbStatus').textContent=loadFailed?t('databaseUnavailable'):drugs.length?`${drugs.length.toLocaleString(isArabic?'ar-EG':'en-US')} ${t('indexed')}`:t('connectDatabase');
    $('#dbCount').textContent=loadFailed?t('connectionRequired'):drugs.length?t('updatedDataset'):'Live database';
    syncSearchModeChips();
    document.title=isArabic?'Drugcopeia — دليل الأدوية المصري':'Drugcopeia — Egypt Medicine Guide';
    document.querySelector('meta[name="description"]').content=isArabic?'دليل للبحث عن الأدوية المتداولة في مصر بالاسم التجاري أو المادة الفعالة أو الشركة أو السعر.':'Search medicines in Egypt by brand name, active ingredient, company, or price.';
    if(input){input.lang=language;input.inputMode=mode==='price'?'decimal':'search'}
    selectedMedicineLetter=null;renderBrowseControls();
    if(activeDrug&&!modal.hidden)openDrug(activeDrug);
    else if(drugs.length)search();
    if(activeConditionTopic&&!conditionDetailBackdrop.hidden)openCondition(activeConditionTopic);
    if(conditionInput?.value.trim())searchConditions(conditionInput.value.trim());
    else if(conditionResults?.children.length&&(selectedConditionLetter||activeConditionGroup||activeConditionType))browseConditions();
    if(!$('#labTestsPage').hidden)renderLabCatalog();
    refreshClinicalLanguage();
    renderReminders();
    const noticeExtra=$('#reminderNoticeExtra');
    if(noticeExtra){noticeExtra.hidden=!reminderNotifications.supported;noticeExtra.textContent=reminderNotifications.supported?` ${t('reminderNoticeWindow')}`:''}
    applyTheme();applySearchScope();
    if($('#privacyPage'))renderPrivacyPage();
    renderSettingsPage();
    if(window.DawayaAIChat&&typeof window.DawayaAIChat.applyLanguage==='function')window.DawayaAIChat.applyLanguage(language);
  }

  let appStatusTimer=0;
  function announce(message){
    const node=$('#appStatus');if(!node||!message)return;
    node.textContent='';clearTimeout(appStatusTimer);
    appStatusTimer=window.setTimeout(()=>{node.textContent=message},60);
  }
  function applyTypeScale(){
    const scale=core?.typeScale?core.typeScale.get():1;
    const percent=Math.round(scale*100);
    document.documentElement.style.setProperty('--type-scale',String(scale));
    document.documentElement.dataset.typeScalePercent=String(percent);
    document.querySelectorAll('[data-type-scale-value]').forEach(node=>{node.textContent=`${percent}%`;node.setAttribute('aria-label',`${t('typeScaleLabel')}: ${percent}%`)});
    const canDown=core?.typeScale?core.typeScale.canDecrease():false;
    const canUp=core?.typeScale?core.typeScale.canIncrease():false;
    document.querySelectorAll('[data-type-scale="down"]').forEach(button=>{button.disabled=!canDown;button.setAttribute('aria-disabled',String(!canDown))});
    document.querySelectorAll('[data-type-scale="up"]').forEach(button=>{button.disabled=!canUp;button.setAttribute('aria-disabled',String(!canUp))});
    renderSettingsSummary();
  }
  function refreshScaleLayout(){
    window.requestAnimationFrame(()=>{
      document.querySelectorAll('.read-more').forEach(panel=>{if(panel.offsetParent)refreshReadMore(panel)});
      refreshDrugReadMore();
    });
  }
  function initTypeScale(){
    if(!core?.typeScale){document.querySelectorAll('.type-scale-button').forEach(button=>{button.disabled=true});return}
    document.addEventListener('click',event=>{
      const button=event.target.closest('.type-scale-button[data-type-scale]');if(!button||button.disabled)return;
      if(button.dataset.typeScale==='down')core.typeScale.decrease();else core.typeScale.increase();
      announce(`${t('typeScaleLabel')}: ${core.typeScale.percent()}%`);
    });
    core.typeScale.subscribe(()=>{applyTypeScale();refreshScaleLayout()});
    applyTypeScale();
  }
  const brandEn = drug => val(drug,'commercial_name_en') || val(drug,'commercial_name_ar');
  const priceText = drug => { const p=val(drug,'price_egp'); return p!=='' && Number.isFinite(Number(p)) ? Number(p).toFixed(Number(p)%1?2:0) : ''; };
  function medicineLogoMark(){
    return `<div class="medicine-picture logo-picture"><img src="assets/red-crescent-rx-96.png" srcset="assets/red-crescent-rx-96.png 1x, assets/red-crescent-rx-192.png 2x" alt="${esc(language==='ar'?'شعار Drugcopeia':'Drugcopeia logo')}" loading="lazy" decoding="async"></div>`;
  }
  function medicinePackShape(drug){
    const route=normalizeDrugClass(val(drug,'route'));
    if(/INHAL/.test(route))return 'inhaler';
    if(/INJECT|INFUS|INTRAMUSC|SUBCUT|INTRAVEN/.test(route))return 'vial';
    if(/OPHTHALM|OTIC|NASAL|EAR|EYE/.test(route))return 'bottle';
    if(/TOPICAL|DERM|CUTANEOUS|CREAM|OINTMENT|GEL/.test(route))return 'tube';
    return 'box';
  }
  function medicinePackMark(drug){
    const shape=medicinePackShape(drug),name=medicineDisplayName(drug);
    return `<div class="medicine-picture"><div class="medicine-pack${shape==='box'?'':' '+shape}" role="img" aria-label="${esc(name)}"><span class="pack-glint" aria-hidden="true"></span><span class="pack-cross" aria-hidden="true">℞</span><b class="pack-name">${esc(name)}</b><span class="pack-mark">${esc(language==='ar'?'Drugcopeia':'DRUGCOPEIA')}</span></div></div>`;
  }
  function setStatus(text,state=''){ $('#dbStatus').textContent=text; $('.top-note').className=`top-note ${state}`; }
  function routeLabel(route){const key=clean(route).toUpperCase().replaceAll(' ','.');return translations[language].routeNames?.[key]||routeNames[key]||route||t('notListed');}
  function medicineDisplayName(drug){const en=brandEn(drug),ar=val(drug,'commercial_name_ar');return en||ar||t('medicine')}
  function ingredientSignature(drug){
    if(!drug||typeof drug!=='object')return '';
    if(ingredientSignatureCache.has(drug))return ingredientSignatureCache.get(drug);
    const raw=val(drug,'scientific_name');let signature='';
    if(raw){
      const parts=String(raw).replace(/\([^)]*\)/g,' ').split(/[+,;/]+/).map(part=>clean(part)).filter(Boolean);
      signature=[...new Set(parts)].sort().join('+');
    }
    ingredientSignatureCache.set(drug,signature);return signature;
  }
  function normalizeDrugClass(raw){return String(raw??'').trim().toUpperCase().replace(/\s+/g,' ').replace(/^\.+|\.+$/g,'')}
  function drugClassRoot(value){const normalized=normalizeDrugClass(value);return normalized?normalized.split('.')[0].trim():''}
  function routeFamily(drug){return normalizeDrugClass(val(drug,'route')).split('.')[0].trim()}
  function classGroupLabel(value){
    return String(value||'').split(/\s+/).map(word=>{if(!word)return '';return word.length<=5&&word===word.toUpperCase()?word:word.charAt(0)+word.slice(1).toLowerCase()}).filter(Boolean).join(' ');
  }
  function sortRelated(list,reference){
    const preferred=routeFamily(reference);
    return list.sort((a,b)=>{
      const aRoute=preferred&&routeFamily(a)===preferred?0:1,bRoute=preferred&&routeFamily(b)===preferred?0:1;
      return aRoute-bRoute||String(brandEn(a)).localeCompare(String(brandEn(b)),language==='ar'?'ar-EG':'en')||String(val(a,'commercial_name_ar')).localeCompare(String(val(b,'commercial_name_ar')));
    });
  }
  function relatedPool(drug,kind){
    if(kind==='similar'){
      const signature=ingredientSignature(drug);
      if(!signature)return {items:[],scope:'signature'};
      return {items:(similarIndex.get(signature)||[]).filter(item=>item!==drug),scope:'signature'};
    }
    const className=normalizeDrugClass(val(drug,'drug_class')),signature=ingredientSignature(drug);
    const isDifferent=item=>item!==drug&&(!signature||(Boolean(ingredientSignature(item))&&ingredientSignature(item)!==signature));
    let items=className?(classIndex.get(className)||[]).filter(isDifferent):[];
    if(!items.length&&className){
      const root=drugClassRoot(className);
      if(root&&root!==className){
        const broader=(rootClassIndex.get(root)||[]).filter(isDifferent);
        if(broader.length)return {items:broader,scope:'root',root};
      }
    }
    return {items,scope:'class'};
  }
  function buildRelatedIndexes(){
    similarIndex=new Map();classIndex=new Map();rootClassIndex=new Map();
    for(const drug of drugs){
      const signature=ingredientSignature(drug);
      if(signature){const bucket=similarIndex.get(signature);if(bucket)bucket.push(drug);else similarIndex.set(signature,[drug])}
      const className=normalizeDrugClass(val(drug,'drug_class'));if(!className)continue;
      const exact=classIndex.get(className);if(exact)exact.push(drug);else classIndex.set(className,[drug]);
      const root=drugClassRoot(className);if(!root)continue;
      const broader=rootClassIndex.get(root);if(broader)broader.push(drug);else rootClassIndex.set(root,[drug]);
    }
  }
  function updateRelatedActions(drug){
    const similar=relatedPool(drug,'similar').items.length,alternatives=relatedPool(drug,'alternatives').items.length;
    const format=value=>Number(value).toLocaleString(language==='ar'?'ar-EG':'en-US');
    const similarButton=$('#similarButton'),alternativesButton=$('#alternativesButton');
    $('#similarCount').textContent=format(similar);$('#alternativesCount').textContent=format(alternatives);
    similarButton.disabled=!similar;alternativesButton.disabled=!alternatives;
    similarButton.title=similar?'':t('relatedSimilarEmpty');
    alternativesButton.title=alternatives?'':t('relatedAlternativesEmpty');
  }
  function paintRelated(){
    if(!relatedDrug)return;
    const isArabic=language==='ar',isSimilar=relatedKind==='similar',format=value=>Number(value).toLocaleString(isArabic?'ar-EG':'en-US');
    const ingredient=val(relatedDrug,'scientific_name'),hasIngredient=Boolean(ingredientSignature(relatedDrug));
    $('#relatedKicker').textContent=t(isSimilar?'relatedSimilarKicker':hasIngredient?'relatedAlternativesKicker':'relatedAlternativesClassKicker');
    $('#relatedTitle').textContent=t(isSimilar?'relatedSimilarTitle':'relatedAlternativesTitle');
    $('#relatedCurrent').textContent=t('relatedComparedWith').replace('{name}',medicineDisplayName(relatedDrug));
    $('#relatedIntro').textContent=isSimilar?t('relatedSimilarIntro').replace('{ingredient}',ingredient||t('notListed')):relatedScope==='root'?t('relatedRootIntro').replace('{group}',classGroupLabel(relatedRoot)):t(hasIngredient?'relatedAlternativesIntro':'relatedAlternativesUnverifiedIntro');
    const note=$('#relatedNote');note.hidden=false;note.textContent=isSimilar?t('relatedSimilarNote'):relatedScope==='root'?t('relatedRootNote'):t('relatedAlternativesNote');
    const parsed=buildWildcardQuery($('#relatedFilter').value),query=clean($('#relatedFilter').value);
    const searched=parsed?relatedItems.filter(item=>[brandEn(item),val(item,'commercial_name_ar'),val(item,'scientific_name'),val(item,'manufacturer'),val(item,'drug_class'),routeLabel(val(item,'route'))].some(value=>wildcardScore(parsed,clean(value))>=0)):relatedItems;
    let filtered=searched;
    if(relatedPriceSort!=='default'){
      const priceValue=item=>{const price=priceText(item);return price?Number(price):null};
      filtered=searched.slice().sort((a,b)=>{
        const aPrice=priceValue(a),bPrice=priceValue(b);
        if(aPrice===null&&bPrice===null)return 0;
        if(aPrice===null)return 1;
        if(bPrice===null)return -1;
        return relatedPriceSort==='high'?bPrice-aPrice:aPrice-bPrice;
      });
    }
    const visible=filtered.slice(0,relatedShown);
    $('#relatedStatus').textContent=filtered.length?t(query?'relatedShowingFiltered':'relatedShowing').replaceAll('{shown}',format(visible.length)).replaceAll('{total}',format(filtered.length)):(query?t('relatedNoMatches'):t('relatedEmpty'));
    const list=$('#relatedList');list.innerHTML='';
    if(!filtered.length){
      list.innerHTML=`<p class="related-empty">${esc(query?t('relatedNoMatches'):t('relatedEmpty'))}</p>`;
    }else{
      const fragment=document.createDocumentFragment();
      visible.forEach(item=>{
        const name=medicineDisplayName(item),sci=val(item,'scientific_name'),maker=val(item,'manufacturer'),route=val(item,'route'),price=priceText(item),arabicName=(()=>{const ar=val(item,'commercial_name_ar');return ar&&clean(ar)!==clean(name)?ar:''})();
        const meta=[maker,route?routeLabel(route):'',item._custom?t('addMedicineTag'):''].filter(Boolean).join(' · ');
        const button=document.createElement('button');button.type='button';button.className='related-card';
        button.innerHTML=`<span class="related-card-copy"><span class="related-card-name">${esc(name)}</span>${arabicName?`<span class="related-card-name-ar" lang="ar" dir="rtl">${esc(arabicName)}</span>`:''}<span class="related-card-ingredient">${esc(sci||t('notListed'))}</span>${meta?`<span class="related-card-meta">${esc(meta)}</span>`:''}</span><span class="related-card-side">${price?`<b>${esc(format(price))} ${isArabic?'ج.م':'EGP'}</b>`:''}<span class="related-card-arrow" aria-hidden="true">›</span></span>`;
        button.addEventListener('click',()=>selectRelatedDrug(item));fragment.append(button);
      });
      list.append(fragment);
    }
    const more=$('#relatedMore');more.hidden=filtered.length<=relatedShown;if(!more.hidden)more.textContent=`${t('showMore')} · ${format(filtered.length-relatedShown)}`;
  }
  function openRelated(kind){
    if(!activeDrug)return;
    const pool=relatedPool(activeDrug,kind);if(!pool.items.length)return;
    relatedDrug=activeDrug;relatedKind=kind;relatedScope=pool.scope;relatedRoot=pool.root||'';relatedItems=sortRelated(pool.items.slice(),activeDrug);relatedShown=20;
    $('#relatedFilter').value='';$('#relatedPriceSort').value=relatedPriceSort;relatedBackdrop.hidden=false;document.body.style.overflow='hidden';paintRelated();
    const panel=relatedBackdrop.querySelector('.related-panel'),body=relatedBackdrop.querySelector('.related-body');if(panel)panel.scrollTop=0;if(body)body.scrollTop=0;
    $('#relatedBack').focus({preventScroll:true});
  }
  function closeRelated(restoreFocus=true){
    if(relatedBackdrop.hidden)return;
    const kind=relatedKind;relatedBackdrop.hidden=true;relatedDrug=null;relatedKind='';relatedScope='';relatedRoot='';relatedItems=[];
    if(restoreFocus){const target=kind==='similar'?$('#similarButton'):kind==='alternatives'?$('#alternativesButton'):null;(target&&!target.disabled?target:$('#modalClose')).focus({preventScroll:true})}
  }
  function selectRelatedDrug(drug){
    if(!drug)return;
    relatedBackdrop.hidden=true;relatedDrug=null;relatedKind='';relatedScope='';relatedRoot='';relatedItems=[];openDrug(drug);
  }

  function customMedicineName(drug){return val(drug,'commercial_name_en')||val(drug,'commercial_name_ar')}
  function customMedicineKey(drug){return [customMedicineName(drug),val(drug,'scientific_name'),val(drug,'custom_concentration')].map(clean).join('|')}
  function normalizeCustomDrug(raw){
    if(!raw||typeof raw!=='object')return null;
    const name=String(raw.commercial_name_en||raw.commercial_name_ar||'').trim().replace(/\s+/g,' ').slice(0,160);
    const ingredient=String(raw.scientific_name||'').trim().replace(/\s+/g,' ').slice(0,160);
    if(!name||!ingredient)return null;
    const arabicOnly=/[\u0600-\u06FF]/.test(name)&&!/[A-Za-z]/.test(name);
    const price=raw.price_egp===''||raw.price_egp===null||raw.price_egp===undefined?'':Number(raw.price_egp);
    const drug={
      commercial_name_en:arabicOnly?'':name,
      commercial_name_ar:arabicOnly?name:'',
      scientific_name:ingredient,
      drug_class:'',
      manufacturer:'',
      route:'',
      price_egp:Number.isFinite(price)&&price>=0?price:'',
      _custom:true,
      _customId:typeof raw._customId==='string'&&raw._customId?raw._customId.slice(0,80):`custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
      custom_concentration:String(raw.custom_concentration||'').trim().replace(/\s+/g,' ').slice(0,80),
      custom_units:String(raw.custom_units||'').trim().replace(/\s+/g,' ').slice(0,80),
      custom_added:typeof raw.custom_added==='string'&&raw.custom_added?raw.custom_added:new Date().toISOString()
    };
    if(typeof raw.custom_updated==='string'&&raw.custom_updated)drug.custom_updated=raw.custom_updated;
    return drug;
  }
  function loadCustomDrugs(){
    try{
      const stored=JSON.parse(localStorage.getItem(CUSTOM_DRUGS_KEY)||'[]');
      if(!Array.isArray(stored))return [];
      const seen=new Set(),list=[];
      for(const raw of stored){
        const drug=normalizeCustomDrug(raw);if(!drug)continue;
        const key=customMedicineKey(drug);if(seen.has(key))continue;
        seen.add(key);list.push(drug);
      }
      return list.slice(0,200);
    }catch(_){return []}
  }
  function saveCustomDrugs(){
    customDrugs=customDrugs.slice(0,200);
    try{localStorage.setItem(CUSTOM_DRUGS_KEY,JSON.stringify(customDrugs));return true}catch(_){return false}
  }
  function updateDatabaseStatus(){
    if(loadFailed||!drugs.length)return;
    setStatus(`${drugs.length.toLocaleString(language==='ar'?'ar-EG':'en-US')} ${t('indexed')}`,'ready');
    $('#dbCount').textContent=usingBundledData?t('builtInDataset'):t('updatedDataset');
  }
  function applyCustomDrugs(){
    drugs=[...customDrugs,...baseDrugs];groupCountCache.clear();lastSearchMatches=null;buildRelatedIndexes();updateDatabaseStatus();
    document.dispatchEvent(new CustomEvent('dawaya:dataset-updated'));
  }
  function addCustomDrug(fields){
    const drug=normalizeCustomDrug({commercial_name_en:fields.name,scientific_name:fields.ingredient,custom_concentration:fields.concentration,custom_units:fields.units,price_egp:fields.price});
    if(!drug)return null;
    const key=customMedicineKey(drug),existing=customDrugs.findIndex(item=>customMedicineKey(item)===key);
    if(existing>=0){
      drug._customId=customDrugs[existing]._customId;
      drug.custom_added=customDrugs[existing].custom_added;
      drug.custom_updated=new Date().toISOString();
      customDrugs.splice(existing,1);
    }
    customDrugs.unshift(drug);customDrugs=customDrugs.slice(0,200);return drug;
  }
  function composeEmailUrl(subject,body){
    const query=[`subject=${encodeURIComponent(subject)}`];
    if(body)query.push(`body=${encodeURIComponent(body)}`);
    return `mailto:${SUGGESTION_EMAIL}?${query.join('&')}`;
  }
  function openEmailCompose(subject,body){
    const url=composeEmailUrl(subject,body);
    const nativeBridge=window.DawayaNative;
    if(nativeBridge&&typeof nativeBridge.openMail==='function'){
      return {url,native:true,result:nativeBridge.openMail(SUGGESTION_EMAIL,subject,body)};
    }
    try{window.location.href=url}catch(_){}
    return {url,native:false,result:Promise.resolve(true)};
  }
  function fetchWithTimeout(url,options={},timeout=25000){
    if(!window.DawayaNet||typeof window.DawayaNet.request!=='function')return Promise.reject(new Error('Network gate unavailable'));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    return window.DawayaNet.request(url,{...options,signal:controller.signal}).finally(()=>clearTimeout(timer));
  }
  async function fetchBundledDrugData(){
    const response=await fetchWithTimeout(withRev(BUNDLED_DATA_URL),{cache:'force-cache'},20000);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!Array.isArray(data)||!data.length)throw new Error('Invalid bundled data format');
    return data;
  }
  function applyLoadedDrugs(data){
    baseDrugs=data;customDrugs=loadCustomDrugs();loadFailed=false;applyCustomDrugs();
    search();renderBrowseControls();
    if(document.activeElement===input)renderSuggestions();
  }
  async function loadDatabase(){
    setStatus(t('builtInLoading'));
    try{
      const bundled=await fetchBundledDrugData();
      usingBundledData=true;loadFailed=false;applyLoadedDrugs(bundled);
      return;
    }catch(error){
      console.warn('Bundled medicine dataset unavailable:',error);
    }
    usingBundledData=false;
    customDrugs=loadCustomDrugs();
    if(customDrugs.length){
      baseDrugs=[];drugs=[...customDrugs];loadFailed=false;buildRelatedIndexes();
      setStatus(`${drugs.length.toLocaleString(language==='ar'?'ar-EG':'en-US')} ${t('indexed')}`,'ready');
      $('#dbCount').textContent=t('addMedicineLocalDb');
      document.dispatchEvent(new CustomEvent('dawaya:dataset-updated'));
      search();renderBrowseControls();return;
    }
    loadFailed=true;setStatus(t('databaseUnavailable'),'error');$('#dbCount').textContent=t('connectionRequired');render();
    document.dispatchEvent(new CustomEvent('dawaya:dataset-updated'));
  }
  function fieldText(drug,field){
    let cache=fieldTextCache.get(drug);if(!cache){cache={};fieldTextCache.set(drug,cache)}
    if(cache[field]!==undefined)return cache[field];
    let text='';
    if(field==='brand')text=clean(val(drug,'commercial_name_en')+' '+val(drug,'commercial_name_ar'));
    else if(field==='generic')text=clean(`${val(drug,'scientific_name')} ${val(drug,'custom_concentration')}`);
    else if(field==='class')text=classSearchText(drug);
    else if(field==='manufacturer')text=clean(val(drug,'manufacturer'));
    else if(field==='price')text=clean(priceText(drug));
    cache[field]=text;return text;
  }
  function drugSearchScore(drug,parsed){
    if(!isUnifiedView())return drugFieldScore(drug,mode,parsed);
    return Math.max(drugFieldScore(drug,'brand',parsed),drugFieldScore(drug,'generic',parsed),drugFieldScore(drug,'class',parsed),drugFieldScore(drug,'manufacturer',parsed));
  }
  function search(){
    sanitizeField(input);
    const query=clean(input.value),parsed=buildWildcardQuery(input.value);$('#clearSearch').hidden=!input.value;document.body.classList.toggle('searching',Boolean(input.value.trim()));
    if(!drugs.length){matching=[];shown=responsivePageSize('medicine');render();renderBrowseControls();return}
    if(!query&&document.body.dataset.view!=='medicine-list'){matching=[];shown=responsivePageSize('medicine');render();renderBrowseControls();return}
    if(!query){const groupsOnly=taxonomyHasChildren(activeDrugPath)||(!activeDrugPath.length&&!selectedMedicineLetter);matching=groupsOnly?[]:drugs.filter(drug=>(!selectedMedicineLetter||drugStartsWith(drug,selectedMedicineLetter))&&(!activeDrugGroup||drugMatchesPath(drug,activeDrugPath))).sort((a,b)=>String(brandEn(a)).localeCompare(String(brandEn(b))));shown=responsivePageSize('medicine');render();renderBrowseControls();return}
    activeDrugGroup='';activeDrugPath=[];
    const found=[];
    if(parsed)for(const drug of drugs){const score=drugSearchScore(drug,parsed);if(score>=0)found.push({drug,score})}
    found.sort((a,b)=>b.score-a.score||String(brandEn(a.drug)).localeCompare(String(brandEn(b.drug))));
    matching=found.map(item=>item.drug);lastSearchQuery=query;lastSearchMode=isUnifiedView()?'all':mode;lastSearchMatches=matching;
    shown=responsivePageSize('medicine');render();renderSuggestions(false);
  }
  function resultNoun(count){
    if(language!=='ar')return count===1?t('match'):t('matchesPlural');
    if(count===1)return t('match');
    if(count===2)return t('matchDual');
    return count>=3&&count<=10?t('matchesPlural'):t('match');
  }
  function render(){
    if(input.value.trim()){results.innerHTML='';['resultsHead','emptyState','moreWrap','welcomeState','unifiedConditionSection','unifiedLabSection'].forEach(id=>{const n=$('#'+id);if(n)n.hidden=true});renderBrowseControls();return}
    results.innerHTML='';const query=input.value.trim(),medicineView=document.body.dataset.view==='medicine-list',navigatingGroups=!query&&activeDrugPath.length>0&&taxonomyHasChildren(activeDrugPath),idleBrowse=!query&&medicineView&&!activeDrugPath.length&&!selectedMedicineLetter,browsing=!query&&medicineView&&drugs.length>0&&!navigatingGroups&&!idleBrowse;
    unifiedLabItems=isUnifiedView()&&query?labSearchItems(query,10):[];renderUnifiedLabResults();renderBrowseControls();
    if(loadFailed&&!drugs.length){$('#resultsHead').hidden=true;$('#emptyState').hidden=true;$('#moreWrap').hidden=true;$('#welcomeState').hidden=false;$('#welcomeState').innerHTML=`<span class="welcome-icon">↻</span><span>${esc(t('databaseError'))}</span><span class="welcome-examples">${esc(t('databaseErrorHint'))}</span><button type="button" class="load-more" data-retry-database>${esc(t('databaseRetry'))}</button>`;return}
    $('#welcomeState').hidden=!(!query&&isUnifiedView());
    $('#resultsHead').hidden=(!query&&!browsing)||!drugs.length||(Boolean(query)&&!matching.length);$('#emptyState').hidden=navigatingGroups||idleBrowse||(!query&&!browsing)||!drugs.length||matching.length>0||unifiedConditionItems.length>0||unifiedConditionLoading||unifiedLabItems.length>0;$('#moreWrap').hidden=matching.length<=shown;
    if((!query&&!browsing)||!drugs.length||!matching.length){$('#resultCount').textContent='';return}
    const modeLabel={brand:t('brandMatches'),generic:t('genericMatches'),class:t('classMatches'),manufacturer:t('manufacturerMatches'),price:t('priceMatches')}[mode];
    const activeGroup=DRUG_GROUPS.find(group=>group[0]===activeDrugGroup),taxonomyTitle=$('#drugGroupTrail').innerText.replace(/\s*›\s*/g,' · ');$('#resultsTitle').textContent=query?`${t('matches')} “${query}”`:activeDrugPath.length?taxonomyTitle:activeGroup?`${t(activeGroup[1])}${selectedMedicineLetter?` · ${t('startsWith')} ${selectedMedicineLetter}`:''}`:`${t('startsWith')} ${selectedMedicineLetter||t('browseAll')}`;const matchCount=matching.length.toLocaleString(language==='ar'?'ar-EG':'en-US'),matchNoun=resultNoun(matching.length);$('#resultCount').textContent=`${matchCount} ${matchNoun}${query&&modeLabel?` · ${modeLabel}`:''}`;
    const frag=document.createDocumentFragment();matching.slice(0,shown).forEach(drug=>{
      const ar=val(drug,'commercial_name_ar'),en=brandEn(drug),sci=val(drug,'scientific_name'),cls=val(drug,'drug_class'),price=priceText(drug),isCustom=Boolean(drug&&drug._custom),genericLabel=[sci,isCustom?val(drug,'custom_concentration'):''].filter(Boolean).join(' · '),tag=cls||val(drug,'manufacturer')||(isCustom?t('addMedicineTag'):t('medicine')),displayName=prettyDrugName(en)||ar,arabicName=ar&&clean(ar)!==clean(en||'')?ar:'';
      const card=document.createElement('article');card.className='drug-card';
      card.innerHTML=`<span class="medicine-thumbnail" aria-hidden="true">${medicineLogoMark()}</span><button type="button" class="drug-info" aria-label="${esc(t('medicine'))} ${esc(displayName)}"><span class="drug-name">${esc(displayName||t('medicine'))}</span>${arabicName?`<span class="drug-name-ar" lang="ar" dir="rtl">${esc(arabicName)}</span>`:''}<span class="drug-generic">${esc(genericLabel||t('notListed'))}</span><span class="drug-card-bottom"><span class="drug-tag">${esc(tag)}</span><span class="drug-price">${price?`${esc(Number(price).toLocaleString(language==='ar'?'ar-EG':'en-US'))} ${language==='ar'?'ج.م':'EGP'}`:''}</span></span></button><span class="card-arrow" aria-hidden="true">›</span>`;
      card.querySelector('.drug-info').addEventListener('click',()=>openDrug(drug));frag.append(card);
    });results.append(frag);
  }
  function suggestionCandidates(query){
    const parsed=buildWildcardQuery(query);
    if(!parsed)return [];
    if(lastSearchMatches&&lastSearchQuery===clean(query)&&lastSearchMode===(isUnifiedView()?'all':mode))return lastSearchMatches.slice(0,7);
    const found=[];for(const drug of drugs){const score=drugSearchScore(drug,parsed);if(score>=0)found.push({drug,score})}
    found.sort((a,b)=>b.score-a.score||String(brandEn(a.drug)).localeCompare(String(brandEn(b.drug))));
    return found.slice(0,7).map(item=>item.drug);
  }
  function renderUnifiedConditionResults(){if(input.value.trim()){$('#unifiedConditionSection').hidden=true;return}const section=$('#unifiedConditionSection'),container=$('#unifiedConditionResults'),query=input.value.trim(),show=isUnifiedView()&&Boolean(query)&&(unifiedConditionLoading||unifiedConditionItems.length);section.hidden=!show;container.innerHTML='';if(!show)return;$('#unifiedConditionCount').textContent=unifiedConditionLoading?(language==='ar'?'جارٍ البحث…':'Searching…'):String(unifiedConditionItems.length);if(unifiedConditionLoading&&!unifiedConditionItems.length){container.innerHTML=`<p class="unified-condition-loading">${language==='ar'?'جارٍ البحث عن الحالات…':'Searching health conditions…'}</p>`;return}unifiedConditionItems.forEach(topic=>{const card=document.createElement('button');card.type='button';card.className='unified-condition-card';card.innerHTML=`<span class="condition-result-icon">＋</span><span><b>${esc(topic.title)}</b><small>${esc(topic.primaryName!==topic.title?topic.primaryName:(topic.code?`ICD ${topic.code}`:'NLM ClinicalTables'))}</small></span><span aria-hidden="true">›</span>`;card.addEventListener('click',()=>openCondition(topic));container.append(card)})}
  async function updateUnifiedConditionSearch(){const query=input.value.trim(),request=++unifiedConditionRequest;if(!query||!isUnifiedView()){unifiedConditionItems=[];unifiedConditionLoading=false;renderUnifiedConditionResults();renderSuggestions(false);return}unifiedConditionLoading=true;renderUnifiedConditionResults();renderSuggestions(false);render();try{const topics=await fetchConditionSearchTopics(query,null,10);if(request!==unifiedConditionRequest||input.value.trim()!==query||!isUnifiedView())return;unifiedConditionItems=topics;unifiedConditionLoading=false;renderUnifiedConditionResults();renderSuggestions(false);render()}catch(error){if(request!==unifiedConditionRequest||!isUnifiedView())return;unifiedConditionItems=[];unifiedConditionLoading=false;renderUnifiedConditionResults();renderSuggestions(false);render();console.warn('Unified condition search unavailable:',error)}}
  function setSuggestionActive(options){
    options.forEach((option,index)=>{const active=index===activeSuggestion;option.classList.toggle('active',active);option.setAttribute('aria-selected',String(active))});
    const current=options[activeSuggestion];if(current)input.setAttribute('aria-activedescendant',current.id);else input.removeAttribute('aria-activedescendant');
  }
  function renderSuggestions(force=false){
    if(!force&&document.activeElement!==input){suggestions.hidden=true;return}
    /* An empty field stays empty: the list opens on the first character, so a
       tap on the field never buries the page under a popular-medicines panel. */
    const query=input.value.trim();
    if(!query){suggestions.hidden=true;return}
    const drugsFound=suggestionCandidates(query);
    const conditions=isUnifiedView()&&query?unifiedConditionItems:[],labs=isUnifiedView()&&query?labSearchItems(query,5):[];mainSuggestionItems=[...drugsFound.map(item=>({kind:'drug',item})),...conditions.map(item=>({kind:'condition',item})),...labs.map(item=>({kind:'lab',item}))];activeSuggestion=Math.min(activeSuggestion,mainSuggestionItems.length-1);
    if(!mainSuggestionItems.length){suggestions.hidden=true;return}
    const drugHtml=drugsFound.length?`<div class="suggestion-label">${esc(t('medicineMatches'))}</div>`+drugsFound.map((drug,i)=>{const price=priceText(drug),meta=(mode==='class'?[val(drug,'drug_class'),val(drug,'scientific_name')]:[val(drug,'scientific_name'),drug._custom?val(drug,'custom_concentration'):val(drug,'manufacturer')]).filter(Boolean).slice(0,2).join(' · '),en=brandEn(drug),ar=val(drug,'commercial_name_ar'),displayName=prettyDrugName(en)||ar,arabicName=ar&&clean(ar)!==clean(en||'')?ar:'';return `<button type="button" class="suggestion${i===activeSuggestion?' active':''}" role="option" aria-selected="${i===activeSuggestion}" data-kind="drug" data-index="${i}"><span class="drug-search-logo" aria-hidden="true"><img src="assets/red-crescent-rx-96.png" alt=""></span><span class="suggestion-copy"><span class="suggestion-name">${esc(displayName||t('medicine'))}</span>${arabicName?`<span class="suggestion-name-ar" lang="ar" dir="rtl">${esc(arabicName)}</span>`:''}<span class="suggestion-meta">${esc(meta)}</span></span>${price?`<span class="suggestion-price">${esc(price)} EGP</span>`:''}</button>`}).join(''):'';
    const conditionHtml=conditions.length?`<div class="suggestion-label">${esc(language==='ar'?'الحالات المرضية':'Health conditions')}</div>`+conditions.map((topic,i)=>`<button type="button" class="suggestion" role="option" aria-selected="false" data-kind="condition" data-index="${i}"><span class="suggestion-icon">＋</span><span class="suggestion-copy"><span class="suggestion-name">${esc(topic.title)}</span><span class="suggestion-meta">${esc(topic.primaryName!==topic.title?topic.primaryName:'NLM ClinicalTables')}</span></span></button>`).join(''):'';
    const labHtml=labs.length?`<div class="suggestion-label">${esc(t('labSuggestionLabel'))}</div>`+labs.map((test,i)=>{const specialty=labText(labSpecialty(test[1])?.name),group=labText(labGroup(test[1],test[2])?.name);return `<button type="button" class="suggestion" role="option" aria-selected="false" data-kind="lab" data-index="${i}"><span class="suggestion-icon">＋</span><span class="suggestion-copy"><span class="suggestion-name">${esc(language==='ar'?test[4]:test[3])}</span><span class="suggestion-meta">${esc([language==='ar'?test[3]:'',specialty,group].filter(Boolean).join(' · '))}</span></span></button>`}).join(''):'';
    suggestions.innerHTML=drugHtml+conditionHtml+labHtml;suggestions.hidden=false;
    const suggestionButtons=[...suggestions.querySelectorAll('.suggestion')];suggestionButtons.forEach((button,index)=>{button.id=`search-suggestion-${index}`;button.addEventListener('click',()=>{const kind=button.dataset.kind,index=Number(button.dataset.index);if(kind==='drug')selectSuggestion(drugsFound[index]);else if(kind==='lab')openLabTestFromSearch(labs[index]);else{const item=conditions[index];input.value=item.title;suggestions.hidden=true;openCondition(item)}})});setSuggestionActive(suggestionButtons);
  }
  if('MutationObserver' in window)new MutationObserver(()=>{input.setAttribute('aria-expanded',String(!suggestions.hidden));if(suggestions.hidden)input.removeAttribute('aria-activedescendant')}).observe(suggestions,{attributes:true,attributeFilter:['hidden']});
  function selectSuggestion(drug){
    input.value=brandEn(drug)||val(drug,'commercial_name_ar');suggestions.hidden=true;activeSuggestion=-1;search();openDrug(drug);
  }
  function findClinicalNotes(drug){
    const raw=val(drug,'scientific_name'),sci=clean(raw),ingredients=String(raw).split(/[+,;/]/).map(clean);
    return clinicalNotes.find(item=>item.keys.some(key=>{const normalized=clean(key);return sci===normalized||(!normalized.includes(' ')&&ingredients.includes(normalized))}));
  }
  function clinicalText(notes,key){
    if(language!=='ar')return notes[key];
    const profile=arabicClinical.find(item=>item.keys.some(name=>notes.keys.some(keyName=>clean(name)===clean(keyName))));
    return profile?.[key]||notes[key];
  }
  function googleImageSearchUrl(query){return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`}
  function openConditionGoogleImages(topic){const query=`${topic.title} disease symptoms diagnosis medical`;openExternal(googleImageSearchUrl(query))}
  function openGoogleImages(drug){
    /* The offline database holds no pack photograph, so the real pictures only exist on the
       open web. The query carries the full registered pack name, the manufacturer and the
       Egyptian market, so the results show this carton rather than the molecule's structural
       formula or a foreign pack that happens to share the brand. */
    const query=[brandEn(drug),val(drug,'manufacturer'),language==='ar'?'مصر عبوة':'Egypt package'].filter(Boolean).join(' ');
    openExternal(googleImageSearchUrl(query));
  }
  /* Commons is the one free source that keeps a photograph of the pack itself,
     and it answers with anything that mentions the ingredient, so the trade name
     leads the search and the files that name it come first. MediaWiki hangs a
     utm_* trail on every URL it hands back and the privacy gate refuses those
     parameters, so each address is cut at the question mark before it is used. */
  const COMMONS_ENDPOINT='https://commons.wikimedia.org/w/api.php';
  const COMMONS_FILE_URL=/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/[^\s"'<>]+$/;
  let commonsPhotos=[],commonsObjectUrls=[],commonsRequestId=0,commonsReturnFocus=null;
  /* The phrase Commons is asked for is the brand name up to its strength: quoting
     the whole catalogue line ("PANADOL ACUTE HEAD COLD 20 F.C.TABS.") matches
     almost nothing, and strength and pack words are noise either way. */
  const COMMONS_NOISE=/^(mg|mcg|ug|ml|l|g|kg|iu|unit|units|tab|tabs|tablet|tablets|cap|caps|capsule|capsules|sachet|sachets|supp|suppository|suppositories|f|fc|syr|syp|inj|sol|susp|solution|suspension|drops|cream|ointment|gel|lotion|patch|patches|vial|vials|amp|ampoule|ampoules|syrup|chew|mouthwash|spray|inhaler|puff|puffs|eye|ear|nasal|topical|oral|the|and|for|with|of|box|pack|packs|strip|strips|egp|le|osm|forte|max|mini)$/;
  function commonsWords(value){
    return String(value===null||value===undefined?'':value).trim().toLowerCase()
      .replace(/[\u064B-\u0652\u0670]/g,'')
      .replace(/[\u0622\u0623\u0625]/g,'\u0627')
      .replace(/[\u0629]/g,'\u0647')
      .replace(/[^a-z0-9\u0600-\u06ff]+/g,' ')
      .replace(/\s+/g,' ').split(' ').filter(Boolean);
  }
  function commonsPhrase(value){
    const list=commonsWords(value), phrase=[];
    for(let i=0;i<list.length;i++){
      if(COMMONS_NOISE.test(list[i])||/^\d/.test(list[i]))break;
      phrase.push(list[i]);
      if(phrase.length===4)break;
    }
    return phrase.join(' ');
  }
  function commonsTerm(drug){
    const brand=val(drug,'commercial_name_en')||val(drug,'commercial_name')||val(drug,'commercial_name_ar');
    return commonsPhrase(brand)||commonsPhrase(val(drug,'scientific_name'));
  }
  function commonsFile(url){return String(url||'').split('?')[0]}
  function commonsRows(payload,term){
    const pages=payload&&payload.query&&payload.query.pages;
    if(!pages||typeof pages!=='object')return[];
    const words=clean(term).split(' ').filter(Boolean),lead=words[0]||'';
    const rows=[];
    Object.keys(pages).forEach(key=>{
      const page=pages[key]||{},info=(page.imageinfo||[])[0]||{};
      const original=commonsFile(info.url),preview=commonsFile(info.thumburl||info.url);
      const name=String(page.title||'').replace(/^File:/i,'').trim();
      if(!name||!COMMONS_FILE_URL.test(original)||!COMMONS_FILE_URL.test(preview))return;
      if(!/^image\//.test(String(info.mime||'')))return;
      /* Commons searches the text around a file, not the file itself, so a
         Flickr snapshot captioned with the trade name comes back for one
         painkiller. A picture earns its place only when it looks filed AS
         this product: its own file name starts with the trade name and
         carries every word of it, and the file sits in a Commons category
         named for it. Anything less gets the honest "nothing came back" line
         and the browser-search buttons, not a photo a reader might mistake
         for the pack. */
      const title=clean(name);
      if(!lead||title.indexOf(lead)!==0)return;
      if(!words.every(word=>title.indexOf(word)>=0))return;
      const categories=(page.categories||[]).map(cat=>clean(String(cat.title||'').replace(/^Category:/i,'')));
      if(!categories.some(cat=>cat.indexOf(lead)>=0))return;
      if(rows.some(row=>row.original===original))return;
      rows.push({name,original,preview,mime:String(info.mime||''),vector:/svg/i.test(String(info.mime||''))});
    });
    return rows.slice(0,8);
  }
  function setCommonsToggle(open){
    const button=$('#commonsToggle');if(!button)return;
    button.textContent=t(open?'commonsHide':'commonsShow');
    button.setAttribute('aria-expanded',open?'true':'false');
  }
  function hideCommonsPhotos(){
    commonsRequestId+=1;
    const grid=$('#commonsGrid'),status=$('#commonsStatus');
    closePhotoViewer();
    commonsObjectUrls.forEach(url=>URL.revokeObjectURL(url));
    commonsObjectUrls=[];commonsPhotos=[];
    if(grid){grid.innerHTML='';grid.hidden=true}
    if(status){status.hidden=true;status.textContent=''}
    setCommonsToggle(false);
  }
  async function showCommonsPhotos(drug){
    const grid=$('#commonsGrid'),status=$('#commonsStatus');
    if(!grid||!status)return;
    if(window.DawayaNet?.isOffline?.()){status.hidden=false;status.textContent=t('offlineBrowserBlocked');return}
    const term=commonsTerm(drug);
    if(!term){status.hidden=false;status.textContent=t('commonsNoTerm');setCommonsToggle(false);return}
    const request=commonsRequestId+=1;
    setCommonsToggle(true);grid.hidden=false;grid.innerHTML='';status.hidden=false;status.textContent=t('commonsLoading');
    const endpoint=`${COMMONS_ENDPOINT}?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(term)}&gsrlimit=12&prop=imageinfo%7Ccategories&iiprop=url%7Cmime&iiurlwidth=400&cllimit=50&format=json&origin=*`;
    try{
      const response=await fetchWithTimeout(endpoint,{userInitiated:true},15000);
      const payload=response.ok?await response.json():null;
      if(request!==commonsRequestId||activeDrug!==drug)return;
      if(!response.ok){grid.hidden=true;status.textContent=t('photosFailed');setCommonsToggle(false);return}
      const rows=commonsRows(payload,term);
      if(!rows.length){grid.hidden=true;status.textContent=t('commonsEmpty');setCommonsToggle(false);return}
      const loaded=await Promise.all(rows.map(async row=>{
        try{
          const image=await fetchWithTimeout(row.preview,{userInitiated:true},20000);
          if(!image.ok)return null;
          return Object.assign({},row,{thumb:URL.createObjectURL(await image.blob())});
        }catch(_){return null}
      }));
      if(request!==commonsRequestId||activeDrug!==drug){loaded.forEach(row=>{if(row)URL.revokeObjectURL(row.thumb)});return}
      const usable=loaded.filter(Boolean);
      if(!usable.length){grid.hidden=true;status.textContent=t('photosFailed');setCommonsToggle(false);return}
      commonsPhotos=usable;
      commonsObjectUrls=usable.map(row=>row.thumb);
      grid.innerHTML=usable.map((row,index)=>`<button type="button" class="commons-cell${row.vector?' is-vector':''}" data-commons-open="${index}"><img class="commons-thumb" src="${row.thumb}" alt="${esc(row.name)}" loading="lazy" decoding="async"><span class="commons-name">${esc(row.name)}</span></button>`).join('');
      status.textContent=t('commonsShownNote');
    }catch(_){
      if(request!==commonsRequestId||activeDrug!==drug)return;
      grid.hidden=true;status.textContent=t('photosFailed');setCommonsToggle(false);
    }
  }
  let zoomScale=1,zoomX=0,zoomY=0;
  function applyZoom(){
    const viewer=$('#photoViewer'),image=$('#photoViewerImage'),stage=$('#photoViewerStage');
    if(!viewer||!image||!stage)return;
    zoomScale=Math.min(8,Math.max(1,zoomScale));
    if(zoomScale===1){zoomX=0;zoomY=0}
    const limitX=Math.max(0,(image.clientWidth*zoomScale-stage.clientWidth)/2);
    const limitY=Math.max(0,(image.clientHeight*zoomScale-stage.clientHeight)/2);
    zoomX=Math.min(limitX,Math.max(-limitX,zoomX));
    zoomY=Math.min(limitY,Math.max(-limitY,zoomY));
    image.style.transform=`translate(${zoomX}px,${zoomY}px) scale(${zoomScale})`;
    viewer.classList.toggle('is-zoomed',zoomScale>1.01);
  }
  function resetZoom(){
    zoomScale=1;zoomX=0;zoomY=0;
    const image=$('#photoViewerImage');if(image)image.style.transform='';
    const viewer=$('#photoViewer');if(viewer)viewer.classList.remove('is-zoomed','dragging');
  }
  function zoomAt(clientX,clientY,next){
    const stage=$('#photoViewerStage');if(!stage)return;
    const bounded=Math.min(8,Math.max(1,next));
    const box=stage.getBoundingClientRect();
    const offsetX=clientX-(box.left+box.width/2),offsetY=clientY-(box.top+box.height/2);
    const factor=bounded/zoomScale;
    zoomX=offsetX-factor*(offsetX-zoomX);
    zoomY=offsetY-factor*(offsetY-zoomY);
    zoomScale=bounded;
    applyZoom();
  }
  function closePhotoViewer(){
    const viewer=$('#photoViewer');
    if(!viewer||viewer.hidden)return;
    const returnTo=commonsReturnFocus;
    commonsReturnFocus=null;
    viewer.hidden=true;
    resetZoom();
    if(modal.hidden&&conditionDetailBackdrop.hidden)document.body.style.overflow='';
    if(returnTo&&returnTo.isConnected&&returnTo.focus)returnTo.focus({preventScroll:true});
  }
  async function openCommonsPhoto(index){
    const photo=commonsPhotos[index];if(!photo)return;
    const viewer=$('#photoViewer'),image=$('#photoViewerImage'),caption=$('#photoViewerCaption'),status=$('#photoViewerStatus');
    if(!viewer||!image||!caption||!status)return;
    commonsReturnFocus=document.activeElement;
    viewer.hidden=false;document.body.style.overflow='hidden';
    caption.textContent=photo.name;
    image.alt=photo.name;
    resetZoom();
    image.src=photo.thumb;
    if(photo.full){status.hidden=true;image.src=photo.full;return}
    status.hidden=false;status.textContent=t('commonsLoading');
    try{
      const response=await fetchWithTimeout(photo.original,{userInitiated:true},30000);
      if(!response.ok)throw new Error('HTTP');
      const objectUrl=URL.createObjectURL(await response.blob());
      if(commonsPhotos.indexOf(photo)<0||viewer.hidden){URL.revokeObjectURL(objectUrl);return}
      photo.full=objectUrl;commonsObjectUrls.push(objectUrl);
      image.src=objectUrl;status.hidden=true;
      applyZoom();
    }catch(_){
      if(commonsPhotos.indexOf(photo)<0||viewer.hidden)return;
      /* Some originals are tens of megabytes and drop the connection; the
         preview already on screen is worth more than an error message. */
      status.textContent=t('commonsPreviewOnly');
    }
  }
  (function wirePhotoViewer(){
    const viewer=$('#photoViewer'),stage=$('#photoViewerStage'),image=$('#photoViewerImage'),closeButton=$('#photoViewerClose'),grid=$('#commonsGrid');
    if(!viewer||!stage||!image)return;
    const pointers=new Map();
    let pinchDistance=0,pinchScale=1,panFrom=null,dragged=false,lastTapTime=0,lastTapPlace=null;
    stage.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      try{stage.setPointerCapture(event.pointerId)}catch(_){}
      if(pointers.size===2){
        const[first,second]=[...pointers.values()];
        pinchDistance=Math.hypot(first.x-second.x,first.y-second.y)||1;pinchScale=zoomScale;
      }else if(pointers.size===1){panFrom={x:event.clientX-zoomX,y:event.clientY-zoomY}}
      dragged=false;viewer.classList.add('dragging');
    });
    stage.addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size>=2){
        const[first,second]=[...pointers.values()];
        const distance=Math.hypot(first.x-second.x,first.y-second.y);
        if(distance&&pinchDistance){zoomScale=pinchScale*(distance/pinchDistance);dragged=true;applyZoom()}
      }else if(pointers.size===1&&panFrom&&zoomScale>1.01){
        zoomX=event.clientX-panFrom.x;zoomY=event.clientY-panFrom.y;dragged=true;applyZoom();
      }
    });
    function lift(event){
      pointers.delete(event.pointerId);
      if(pointers.size<2)pinchDistance=0;
      if(pointers.size===1){const[only]=[...pointers.values()];panFrom={x:only.x-zoomX,y:only.y-zoomY}}
      if(pointers.size)return;
      panFrom=null;viewer.classList.remove('dragging');
      if(event.pointerType==='mouse')return;
      const now=Date.now();
      const again=lastTapPlace&&now-lastTapTime<330&&Math.hypot(event.clientX-lastTapPlace.x,event.clientY-lastTapPlace.y)<44;
      if(again&&!dragged){zoomAt(event.clientX,event.clientY,zoomScale>1.05?1:2.5);lastTapTime=0;lastTapPlace=null}
      else{lastTapTime=now;lastTapPlace={x:event.clientX,y:event.clientY}}
    }
    ['pointerup','pointercancel'].forEach(type=>stage.addEventListener(type,lift));
    stage.addEventListener('dblclick',event=>{event.preventDefault();zoomAt(event.clientX,event.clientY,zoomScale>1.05?1:2.5)});
    /* Desktop has no fingers: the wheel magnifies around the pointer. */
    stage.addEventListener('wheel',event=>{event.preventDefault();zoomAt(event.clientX,event.clientY,zoomScale*(event.deltaY<0?1.18:1/1.18))},{passive:false});
    stage.addEventListener('click',event=>{if(!dragged&&event.target===stage&&zoomScale===1)closePhotoViewer()});
    closeButton&&closeButton.addEventListener('click',closePhotoViewer);
    viewer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePhotoViewer()}});
    grid&&grid.addEventListener('click',event=>{
      const cell=event.target.closest&&event.target.closest('[data-commons-open]');
      if(!cell)return;
      openCommonsPhoto(Number(cell.dataset.commonsOpen));
    });
  })();
  function readMoreLabel(expanded){
    return `${esc(t(expanded?'readLess':'readMore'))}<span class="read-more-chevron" aria-hidden="true">${expanded?'⌃':'⌄'}</span>`;
  }
  function enableReadMore(container){
    if(!container)return;
    let body=container.querySelector(':scope > .read-more-body'),button=container.querySelector(':scope > .read-more-toggle');
    if(!body){body=document.createElement('div');body.className='read-more-body';container.prepend(body)}
    [...container.children].forEach(child=>{if(child!==body&&child!==button)body.append(child)});
    if(!button){
      button=document.createElement('button');button.type='button';button.className='read-more-toggle';container.append(button);
      button.addEventListener('click',()=>{
        const expanded=container.classList.toggle('is-expanded');
        button.setAttribute('aria-expanded',String(expanded));button.innerHTML=readMoreLabel(expanded);
        refreshReadMore(container);
      });
    }
    container.classList.add('read-more');container.classList.remove('is-expanded');
    button.setAttribute('aria-expanded','false');button.innerHTML=readMoreLabel(false);button.hidden=true;
    refreshReadMore(container);
  }
  function refreshReadMore(container){
    if(!container||!container.classList.contains('read-more'))return;
    const body=container.querySelector(':scope > .read-more-body'),button=container.querySelector(':scope > .read-more-toggle');
    if(!body||!button)return;
    if(container.classList.contains('is-expanded')){container.classList.add('is-overflowing');button.hidden=false;return}
    const overflowing=body.scrollHeight>body.clientHeight+2;
    container.classList.toggle('is-overflowing',overflowing);
    button.hidden=!overflowing;
  }
  function refreshDrugReadMore(){
    ['overview','use','caution'].forEach(name=>{const panel=$('#'+name+'Panel');if(panel)refreshReadMore(panel)});
  }
  function nativeDrugDetailStrings(){
    const ar=language==='ar';
    return {
      dosageFooter:ar?'راجع النشرة الداخلية أو اسأل الصيدلي.':'Check the leaflet or ask your pharmacist.',
      warningsTitle:ar?'تحذيرات':'Warnings',
      warningsFooter:ar?'اتبع دائمًا تعليمات الطبيب أو الصيدلي.':'Always follow your doctor or pharmacist instructions.',
      ingredientsTitle:ar?'المواد الفعالة':'Active Ingredients',
      activeIngredient:ar?'مادة فعالة':'Active ingredient',
      addAction:ar?'أضف إلى أدويتي':'Add to My Medications',
      addedAction:ar?'أُضيف إلى أدويتي':'Added to My Medications',
      addHint:ar?'يضيف هذا الدواء إلى قائمة أدويتك الشخصية':'Adds this drug to your personal medication list',
      bookmark:ar?'حفظ الدواء':'Bookmark drug',
      removeBookmark:ar?'إزالة الحفظ':'Remove bookmark',
      closeAction:ar?'تم':'Done'
    };
  }
  function nativeDrugDetailPayload(drug){
    const en=brandEn(drug),ar=val(drug,'commercial_name_ar'),sci=val(drug,'scientific_name'),cls=val(drug,'drug_class'),route=val(drug,'route');
    const isCustom=Boolean(drug&&drug._custom),concentration=val(drug,'custom_concentration'),units=val(drug,'custom_units');
    const notes=findClinicalNotes(drug);
    const strength=[concentration,units].filter(Boolean).join(' ').trim();
    const facts=[];
    if(strength)facts.push({icon:'drop.fill',title:language==='ar'?'التركيز':'Concentration',value:strength});
    if(route&&!isCustom)facts.push({icon:'arrow.triangle.branch',title:language==='ar'?'طريقة الإعطاء':'Route',value:routeLabel(route)});
    const ingredients=String(sci||'').split(/[+,;/]/).map(part=>part.trim()).filter(Boolean).slice(0,20).map((name,index)=>({name,strength:index===0?strength:'',isActive:true}));
    const warnings=[];
    if(notes){
      const safety=clinicalText(notes,'safety');
      if(safety)warnings.push({severity:'caution',text:String(safety).slice(0,1200)});
    }
    return {
      name:(language==='ar'?(ar||en):(en||ar))||t('medicine'),
      classification:isCustom?t('addMedicineTag'):(cls||''),
      form:[isCustom?'':routeLabel(route),strength].filter(Boolean).join(' · '),
      factsTitle:language==='ar'?'تفاصيل الدواء':'Drug details',
      facts,
      warnings,
      ingredients,
      strings:nativeDrugDetailStrings(),
      showsAddAction:false,
      showsBookmark:false
    };
  }
  function refreshNativeDetailButton(drug){
    const button=$('#modalNativeButton');
    if(!button)return;
    const native=window.DawayaNative;
    const available=Boolean(native&&typeof native.presentDrugDetail==='function');
    button.hidden=!available;
    if(!available)return;
    const label=$('#modalNativeLabel');
    if(label)label.textContent=t('nativeViewLabel');
    button.onclick=()=>{
      if(button.dataset.busy==='true')return;
      button.dataset.busy='true';button.disabled=true;
      Promise.resolve(native.presentDrugDetail(nativeDrugDetailPayload(drug)))
        .catch(error=>console.warn('[Drugcopeia] Native detail failed',error))
        .finally(()=>{button.disabled=false;button.dataset.busy='false'});
    };
  }
  /* Detail panels list their headings; the reader opens the text they want.
     Panels refill their markup asynchronously, so the transform has to survive
     innerHTML replacement and keep element ids that other code looks up. */
  function makeSectionCollapsible(host){
    if(!host)return;
    if(host.querySelector(':scope > summary'))return;
    const heading=host.querySelector(':scope > h3, :scope > h4');
    if(!heading||host.querySelector(':scope > .wiki-loading'))return;
    if(![...host.childNodes].some(node=>node!==heading&&String(node.textContent||'').trim()))return;
    const keeps=host.tagName==='DETAILS';
    const details=keeps?host:document.createElement('details');
    if(!keeps){
      details.className=`${host.className} collapsible-section`.trim();
      if(host.id)details.id=host.id;
    }
    details.dataset.collapsible='true';
    const summary=document.createElement('summary');
    summary.textContent=heading.textContent;
    heading.remove();
    if(keeps){details.prepend(summary);return}
    details.append(summary,...[...host.childNodes]);
    host.replaceWith(details);
  }
  function markCollapsibleSections(root){root?.querySelectorAll('section,details.collapsible-section').forEach(makeSectionCollapsible)}
  function observeCollapsibleSections(root){
    if(!root||root.dataset.collapsibleObserver==='true')return;
    root.dataset.collapsibleObserver='true';
    const observer=new MutationObserver(()=>{observer.disconnect();markCollapsibleSections(root);observer.observe(root,{childList:true,subtree:true})});
    observer.observe(root,{childList:true,subtree:true});
    markCollapsibleSections(root);
  }
  /* Sourced monographs: per-ingredient sections from official U.S. FDA labels
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
      [part,part.replace(/\([^)]*\)/g,' ')].forEach(variant=>{
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
  /* Match gate: a U.S. label is woven into the tabs as this product's own
     dosing/warnings ONLY when the Egyptian brand matches it on every check we
     can verify: single ingredient, route, release form (ordinary vs
     extended-release) and strength. Anything else renders as a clearly
     separate "US reference (FDA label)" block with its DailyMed link, label
     date and the not-clinically-reviewed note. */
  const MONO_XR_EG=/\b(XR|SR|RETARD|DEPOT)\b|EXTENDED[- ]?RELEASE|MODIFIED[- ]?RELEASE|SUSTAINED[- ]?RELEASE|PROLONGED[- ]?RELEASE|EXT\.\s?REL/i;
  const MONO_ROUTES=[['ORAL',['ORAL']],['EFF',['ORAL']],['TOPICAL',['TOPICAL','DERMAL']],['SOAP',['TOPICAL','DERMAL']],['INJECT',['INTRAVENOUS','INTRAMUSCULAR','SUBCUTANEOUS','PARENTERAL','INFUSION','INTRADERMAL','INTRATHECAL','EPIDURAL','INTRA-ARTICULAR']],['RECTAL',['RECTAL']],['VAGINAL',['VAGINAL','INTRAUTERINE']],['EYE',['OPHTHALMIC']],['EAR',['OTIC']],['MOUTH',['BUCCAL','SUBLINGUAL','ORAL','DENTAL','PERIODONTAL']],['SPRAY',['NASAL','TOPICAL','DERMAL']]];
  function monoStrengths(text){
    const out=[],re=/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%|units?)\b/gi;let m;
    while((m=re.exec(String(text)))&&out.length<12){const unit=m[2].toLowerCase().replace(/s$/,'');const pair=`${m[1]} ${unit}`;if(!out.includes(pair))out.push(pair)}
    return out;
  }
  function monoStrengthEq(a,b){
    const pa=a.split(' '),pb=b.split(' ');
    if(pa[1]===pb[1])return Number(pa[0])===Number(pb[0]);
    const conv={g:1000,mg:1,mcg:0.001};
    if(conv[pa[1]]&&conv[pb[1]])return Number(pa[0])*conv[pa[1]]===Number(pb[0])*conv[pb[1]];
    return false;
  }
  function monographGate(drug,item){
    const sci=String(val(drug,'scientific_name')||'');
    if(sci.split(/[+,;/]/).filter(part=>part.trim()).length>1)return {match:false,reason:'combo'};
    const src=item.source||{};
    const routes=(src.routes||[]).map(route=>String(route).toUpperCase());
    const brandRoute=String(val(drug,'route')||'').toUpperCase();
    let routeKnown=false,routeOK=false;
    MONO_ROUTES.some(([needle,fda])=>{
      if(!brandRoute.startsWith(needle))return false;
      routeKnown=true;
      routeOK=routes.some(route=>fda.some(want=>route===want||route.startsWith(want)));
      return true;
    });
    if(!routeKnown||!routeOK)return {match:false,reason:'route'};
    const brandXR=MONO_XR_EG.test(String(val(drug,'commercial_name_en')||''));
    if(brandXR!==Boolean(src.extended_release))return {match:false,reason:'form'};
    const brandStr=monoStrengths(val(drug,'commercial_name_en')||'');
    const labelStr=src.strengths||[];
    if(!brandStr.length||!labelStr.length)return {match:false,reason:'strength-unknown'};
    if(!brandStr.some(brand=>labelStr.some(label=>monoStrengthEq(brand,label))))return {match:false,reason:'strength'};
    return {match:true,reason:''};
  }
  function monographBlock(item,key,text){
    const boxed=key==='boxed_warning'?' monograph-boxed':'';
    const src=item.source||{};
    const date=src.label_date?` · ${esc(t('monoUpdated'))} ${esc(src.label_date)}`:'';
    const cap=src.dailymed?`<p class="monograph-caption"><a href="${esc(src.dailymed)}" target="_blank" rel="noopener noreferrer">${esc(t('monoSrcLine'))}${date} ↗</a></p>`:'';
    return `<section class="detail-block monograph-block${boxed}"><h3>${esc(t(MONO_LABELS[key]))} <span class="monograph-tag">${esc(monographName(item))} · ${esc(t('monoUsLabel'))}</span></h3><p>${esc(text)}</p>${cap}</section>`;
  }
  function monographSectionsHtml(drug,panel){
    const items=findMonographs(drug);
    if(!items.length)return '';
    let html='';
    items.forEach(item=>{
      let inner='';
      (MONO_PANELS[panel]||[]).forEach(key=>{
        const text=item.sections&&item.sections[key];
        if(text)inner+=monographBlock(item,key,text);
      });
      if(!inner)return;
      const gate=monographGate(drug,item);
      if(gate.match){html+=inner;return}
      const src=item.source||{};
      const noteKey=gate.reason==='combo'?'monoRefCombo':'monoRefDiff';
      const link=src.dailymed?` <a href="${esc(src.dailymed)}" target="_blank" rel="noopener noreferrer">${esc(t('monoFullLabel'))} ↗</a>`:'';
      const date=src.label_date?` <span class="monograph-date">${esc(t('monoUpdated'))} ${esc(src.label_date)}</span>`:'';
      html+=`<div class="monograph-reference"><p class="monograph-ref-head"><strong>${esc(t('monoRefTitle'))} · ${esc(monographName(item))}</strong>${date}${link}</p><p class="monograph-note">${esc(t(noteKey))}</p>${inner}</div>`;
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
  function openDrug(drug){
    if(modal.hidden&&document.activeElement&&document.activeElement!==document.body)modalReturnFocus=document.activeElement;
    if(core?.speech)core.speech.stop(true);
    activeDrug=drug;
    refreshNativeDetailButton(drug);
    const en=brandEn(drug),ar=val(drug,'commercial_name_ar'),sci=val(drug,'scientific_name'),cls=val(drug,'drug_class'),maker=val(drug,'manufacturer'),route=val(drug,'route'),price=priceText(drug),notes=findClinicalNotes(drug);
    const isCustom=Boolean(drug&&drug._custom),concentration=val(drug,'custom_concentration'),units=val(drug,'custom_units');
    const priceLabel=price?`${Number(price).toLocaleString(language==='ar'?'ar-EG':'en-US')} ${language==='ar'?'ج.م':'EGP'}`:t('notAvailable');
    const primaryName=en||ar,arabicName=ar&&clean(ar)!==clean(primaryName||'')?ar:'';
    $('#modalTitle').textContent=prettyDrugName(primaryName)||t('medicine');
    $('#modalEnglish').textContent=sci||'';
    $('#modalArabic').textContent=arabicName;
    $('#modalClass').textContent=isCustom?t('addMedicineTag'):(cls||t('classificationMissing'));
    $('#modalManufacturer').textContent=fullMaker(maker);
    const facts=$('#modalFacts');facts.className=`modal-facts${isCustom?' custom-facts':''}`;
    facts.innerHTML=isCustom
      ?`<div class="fact"><span>${esc(t('activeIngredient'))}</span><b>${esc(sci||t('notListed'))}</b></div><div class="fact"><span>${esc(t('addMedicineConcentrationLabel'))}</span><b>${esc(concentration||t('notListed'))}</b></div><div class="fact"><span>${esc(t('addMedicineUnitsLabel'))}</span><b>${esc(units||t('notListed'))}</b></div><div class="fact"><span>${esc(t('listedPrice'))}</span><b>${esc(priceLabel)}</b></div>`
      :`<div class="fact"><span>${esc(t('activeIngredient'))}</span><b>${esc(sci||t('notListed'))}</b></div><div class="fact"><span>${esc(t('route'))}</span><b>${esc(routeLabel(route))}</b></div><div class="fact"><span>${esc(t('listedPrice'))}</span><b>${esc(priceLabel)}</b></div>`;
    const customNote=$('#modalCustomNote');customNote.hidden=!isCustom;customNote.textContent=isCustom?t('customMedicineNote'):'';
    updateRelatedActions(drug);
    $('#modalImage').innerHTML=medicinePackMark(drug);
    const imageSearch=$('#modalImageSearch');
    imageSearch.setAttribute('aria-label',`${t('imageSearchAria')} — ${primaryName||t('medicine')}`);
    imageSearch.onclick=()=>openGoogleImages(drug);
    $('#modalImagePanel').hidden=false;
    /* A hand-added record has a name the reader typed, and Commons would be
        asked to search for that. The section stays off those medicines. */
    hideCommonsPhotos();
    $('#commonsPanel').hidden=isCustom;$('#commonsToggle').hidden=isCustom;
    const commonsToggle=$('#commonsToggle');
    commonsToggle.onclick=()=>{commonsToggle.getAttribute('aria-expanded')==='true'?hideCommonsPhotos():showCommonsPhotos(drug)};
    $('#modalImageCaption').textContent=t('noPackPhoto');
    const usageSection=isCustom
      ?`<section class="detail-block"><h3>${esc(t('addMedicineUnitsLabel'))}</h3><p>${esc(units||t('notListed'))}</p></section>`
      :`<section class="detail-block"><h3>${esc(t('howGiven'))}</h3><p>${esc(t('databaseRouteProduct'))}: <b>${esc(routeLabel(route))}</b>. ${esc(t('routeInstruction'))}</p></section>`;
    if(notes){
      $('#overviewPanel').innerHTML=`<section class="detail-block"><h3>${esc(t('howWorks'))}</h3><p class="detail-lead">${esc(clinicalText(notes,'mechanism'))}</p></section><section class="detail-block"><h3>${esc(t('pharmacology'))}</h3><p>${esc(clinicalText(notes,'pharmacology'))}</p></section>`;
      $('#usePanel').innerHTML=`<section class="detail-block"><h3>${esc(t('commonUse'))}</h3><p>${esc(clinicalText(notes,'uses'))}</p></section><section class="detail-block"><h3>${esc(t('sideEffects'))}</h3><p>${esc(clinicalText(notes,'effects'))}</p></section>${usageSection}`;
      $('#cautionPanel').innerHTML=`<div class="no-clinical">${esc(clinicalText(notes,'safety'))}</div><p style="margin-top:12px">${esc(t('leafletAdvice'))}</p>`;
    }else{
      const classification=cls?`${t('sourceClassificationLead')} “${cls}.” ${t('classLimits')}`:t('missingMonograph');
      $('#overviewPanel').innerHTML=isCustom
        ?`<section class="detail-block"><h3>${esc(t('activeIngredient'))}</h3><p class="detail-lead">${esc(sci||t('ingredientNotAvailable'))}</p></section><div class="no-clinical">${esc(t('noVerifiedMechanism'))}</div>`
        :`<section class="detail-block"><h3>${esc(t('howWorks'))}</h3><p class="detail-lead">${esc(classification)}</p></section><section class="detail-block"><h3>${esc(t('activeIngredient'))}</h3><p>${esc(sci||t('ingredientNotAvailable'))}</p></section><div class="no-clinical">${esc(t('noVerifiedMechanism'))}</div>`;
      $('#usePanel').innerHTML=isCustom?`${usageSection}<div class="no-clinical">${esc(t('safeUse'))}</div>`:`<div class="no-clinical">${esc(t('routeOnly'))} “${esc(routeLabel(route))}.” ${esc(t('noInstructions'))}</div>`;
      $('#cautionPanel').innerHTML=`<div class="no-clinical">${esc(t('safeUse'))}</div>`;
    }
    appendMonographSections(drug);
    const detailPanels=['overview','use','caution'].map(name=>$('#'+name+'Panel'));
    detailPanels.forEach(panel=>enableReadMore(panel));
    const searchTerm=sci||en,officialSources=[
      [`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(searchTerm)}`,t('sourceDailyMed')],
      [`https://medlineplus.gov/search/?query=${encodeURIComponent(`${searchTerm} ${en}`.trim())}`,t('sourceMedlineDrug')],
      [`https://www.ema.europa.eu/en/medicines?search_api_fulltext=${encodeURIComponent(searchTerm)}`,t('sourceEma')],
      [`https://www.nhs.uk/search/results?q=${encodeURIComponent(`${en} ${searchTerm}`.trim())}`,t('sourceNhs')],
      [`https://www.drugs.com/search.php?searchterm=${encodeURIComponent(searchTerm)}`,t('searchDrugsCom')],
      ['https://www.edaegypt.gov.eg/',t('sourceEda')]
    ];
    $('#modalSources').innerHTML=`<details class="sources-box"><summary class="sources-toggle">${esc(t('officialSourcesTitle'))}</summary><div class="detail-links">${officialSources.map(([href,label])=>`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join('')}</div><p class="wiki-source-note">${esc(t('officialProductAdvice'))}</p></details>`;
    document.querySelectorAll('.detail-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.panel==='overview'));
    ['overview','use','caution'].forEach(panel=>$('#'+panel+'Panel').hidden=panel!=='overview');
    const drugModal=modal.querySelector('.drug-modal');if(drugModal)drugModal.scrollTop=0;
    modal.hidden=false;document.body.style.overflow='hidden';refreshDrugReadMore();
    try{document.dispatchEvent(new CustomEvent('dawaya:drug-opened',{detail:drug}))}catch(_){}
    if(relatedBackdrop.hidden)$('#modalClose').focus();
    else if(relatedDrug===drug){relatedItems=sortRelated(relatedItems.slice(),drug);paintRelated()}
  }
  function closeModal(){
    if(core?.speech)core.speech.stop(true);
    relatedBackdrop.hidden=true;relatedDrug=null;relatedKind='';relatedScope='';relatedRoot='';relatedItems=[];modal.hidden=true;document.body.style.overflow='';activeDrug=null;
    hideCommonsPhotos();
    const target=modalReturnFocus&&modalReturnFocus.isConnected&&modalReturnFocus.getClientRects().length?modalReturnFocus:input;modalReturnFocus=null;
    if(target&&target.getClientRects().length)target.focus({preventScroll:true});
  }
  input.addEventListener('input',()=>{sanitizeField(input);activeSuggestion=-1;clearTimeout(debounce);clearTimeout(unifiedConditionTimer);document.body.classList.toggle('searching',Boolean(input.value.trim()));updateUnifiedLabSearch();debounce=setTimeout(()=>{search();renderSuggestions(false)},100);unifiedConditionTimer=setTimeout(updateUnifiedConditionSearch,180)});
  /* Replacing the suggestion subtree during pointerdown/touchstart races the
     tap that iOS is about to turn into focus, and the soft keyboard never
     opens. Only touch the DOM once the field already owns focus. */
  function openSearchSuggestions(){
    renderSuggestions(true);
    requestAnimationFrame(()=>{if(document.activeElement===input&&suggestions.hidden)renderSuggestions(true)});
  }
  input.addEventListener('focus',openSearchSuggestions);
  input.addEventListener('click',()=>{if(document.activeElement===input)openSearchSuggestions()});
  $('.search-composer')?.addEventListener('click',event=>{if(event.target.closest('button,input'))return;input.focus()});
  input.addEventListener('keydown',event=>{
    const options=[...suggestions.querySelectorAll('.suggestion')];
    if(event.key==='ArrowDown'&&options.length){event.preventDefault();activeSuggestion=(activeSuggestion+1)%options.length;setSuggestionActive(options);options[activeSuggestion].scrollIntoView({block:'nearest'});return}
    if(event.key==='ArrowUp'&&options.length){event.preventDefault();activeSuggestion=(activeSuggestion-1+options.length)%options.length;setSuggestionActive(options);options[activeSuggestion].scrollIntoView({block:'nearest'});return}
    if(event.key==='Enter'){event.preventDefault();if(activeSuggestion>=0&&options[activeSuggestion])options[activeSuggestion].click();else{input.focus();updateUnifiedLabSearch();search();updateUnifiedConditionSearch();renderSuggestions(true)}}
    if(event.key==='Escape'){suggestions.hidden=true;input.removeAttribute('aria-activedescendant')}
  });
  conditionResults.addEventListener('click',event=>{if(!event.target.closest('.condition-more'))return;conditionVisible+=responsivePageSize('condition');conditionResults.innerHTML='';appendConditionTopicCards()});
  $('#conditionSearchButton').addEventListener('click',()=>{conditionInput.focus();updateConditionSuggestions()});conditionInput.addEventListener('keydown',event=>{
    const options=[...conditionSuggestions.querySelectorAll('.condition-suggestion')];
    if(event.key==='ArrowDown'&&options.length){event.preventDefault();conditionSuggestionActive=(conditionSuggestionActive+1)%options.length;setConditionSuggestionActive(options);options[conditionSuggestionActive].scrollIntoView({block:'nearest'});return}
    if(event.key==='ArrowUp'&&options.length){event.preventDefault();conditionSuggestionActive=(conditionSuggestionActive-1+options.length)%options.length;setConditionSuggestionActive(options);options[conditionSuggestionActive].scrollIntoView({block:'nearest'});return}
    if(event.key==='Enter'){event.preventDefault();if(conditionSuggestionActive>=0&&conditionSuggestionItems[conditionSuggestionActive])selectConditionSuggestion(conditionSuggestionItems[conditionSuggestionActive]);else{conditionInput.focus();updateConditionSuggestions()}}
    if(event.key==='Escape')conditionSuggestions.hidden=true;
  });
  conditionInput.addEventListener('input',()=>{selectedConditionLetter=null;activeConditionGroup='';activeConditionType='';renderBrowseControls();clearTimeout(conditionSuggestionTimer);conditionSuggestionTimer=setTimeout(updateConditionSuggestions,160)});
  conditionInput.addEventListener('focus',()=>{if(conditionInput.value.trim())updateConditionSuggestions();else updatePopularConditionSuggestions()});
  document.querySelectorAll('[data-condition-query]').forEach(button=>button.addEventListener('click',()=>searchConditions(button.dataset.conditionQuery)));
  $('#medicineAlphabet').addEventListener('click',event=>{const button=event.target.closest('[data-medicine-letter]');if(!button)return;selectedMedicineLetter=button.dataset.medicineLetter;activeDrugPath=[];activeDrugGroup='';input.value='';activeSuggestion=-1;search()});
  $('#drugGroups').addEventListener('click',event=>{const root=event.target.closest('[data-taxonomy-group]'),child=event.target.closest('[data-taxonomy-child]');if(!root&&!child)return;activeDrugPath=root?[root.dataset.taxonomyGroup]:[...activeDrugPath,child.dataset.taxonomyChild];activeDrugGroup=activeDrugPath[0];selectedMedicineLetter=null;input.value='';activeSuggestion=-1;search()});
  $('#drugGroupTrail').addEventListener('click',event=>{const button=event.target.closest('[data-taxonomy-depth]');if(!button)return;activeDrugPath=activeDrugPath.slice(0,Number(button.dataset.taxonomyDepth));activeDrugGroup=activeDrugPath[0]||'';selectedMedicineLetter=null;input.value='';search()});
  $('#conditionAlphabet').addEventListener('click',event=>{const button=event.target.closest('[data-condition-letter]');if(!button)return;browseConditions({letter:button.dataset.conditionLetter,group:''})});
  $('#conditionGroups').addEventListener('click',event=>{const button=event.target.closest('[data-condition-group]');if(!button)return;const group=activeConditionGroup===button.dataset.conditionGroup?'':button.dataset.conditionGroup;browseConditions({letter:null,group})});
  $('#conditionGroupTrail').addEventListener('click',event=>{const button=event.target.closest('[data-condition-depth]');if(!button)return;const depth=Number(button.dataset.conditionDepth);if(depth===0)browseConditions({letter:null,group:''});else browseConditions({letter:null,group:activeConditionGroup,type:''})});
  $('#conditionTypes').addEventListener('click',event=>{const button=event.target.closest('[data-condition-type]');if(!button)return;const type=activeConditionType===button.dataset.conditionType?'':button.dataset.conditionType;browseConditions({letter:null,group:activeConditionGroup,type})});
  $('#searchButton').addEventListener('click',()=>{input.focus();updateUnifiedLabSearch();search();updateUnifiedConditionSearch();renderSuggestions(true)});
  $('#clearSearch').addEventListener('click',()=>{input.value='';activeSuggestion=-1;unifiedConditionItems=[];unifiedLabItems=[];document.body.classList.remove('searching');updateUnifiedConditionSearch();search();renderUnifiedConditionResults();renderUnifiedLabResults();renderSuggestions();input.focus()});
  /* Box codes and voice. The camera frame and the microphone audio are read
     on this device and never sent anywhere; the barcode table ships with the
     app so a scan works with no connection at all. */
  const captureStatus=$('#searchToolStatus'),scanOverlay=$('#scanOverlay'),scanVideo=$('#scanVideo'),scanStatus=$('#scanStatus'),scanManualForm=$('#scanManualForm'),scanManualInput=$('#scanManualInput'),scanClose=$('#scanClose'),scanButton=$('#scanButton'),voiceButton=$('#voiceButton');
  let barcodeCodes=null,barcodeRequest=null,scanStream=null,scanFrame=0,scanReturnFocus=null,scanBusy=false;
  let voiceSession=null,voiceActive=false,voiceTimer=0,captureStatusTimer=0;
  function captureLabel(key,tokens){let text=t(key);if(tokens)Object.keys(tokens).forEach(token=>{text=text.split(`{${token}}`).join(tokens[token])});return text}
  function captureStatusShow(message,state){
    if(!captureStatus)return;
    clearTimeout(captureStatusTimer);captureStatus.textContent=message||'';captureStatus.hidden=!message;captureStatus.dataset.state=state||'';
    if(message&&state!=='error')captureStatusTimer=window.setTimeout(()=>{captureStatus.hidden=true;captureStatus.textContent=''},6000);
  }
  function loadBarcodeCodes(){
    if(barcodeCodes)return Promise.resolve(barcodeCodes);
    if(!barcodeRequest){
      barcodeRequest=fetchWithTimeout('assets/barcode-index.json',{cache:'force-cache'},20000)
        .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()})
        .then(data=>{barcodeCodes=data&&data.codes?data.codes:{};return barcodeCodes})
        .catch(error=>{barcodeRequest=null;throw error});
    }
    return barcodeRequest;
  }
  function packNameKey(value){return clean(value).replace(/[^a-z0-9\u0600-\u06ff]+/g,'')}
  const barcodeTokenSynonyms={capsules:'cap',capsule:'cap',caps:'cap',tablets:'tab',tablet:'tab',tabs:'tab',syrup:'syr',suspension:'susp',susp:'susp',injection:'inj',inj:'inj'};
  let barcodeNameIndex=null;
  function barcodeTokens(value){return clean(value).toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/).filter(Boolean).map(token=>barcodeTokenSynonyms[token]||token)}
  function barcodeNumbers(tokens){const found=new Set();tokens.forEach(token=>{if(/\d/.test(token))found.add(token.replace(/\D/g,'')||'0')});return found}
  function barcodeBrandIndex(){
    if(barcodeNameIndex)return barcodeNameIndex;
    barcodeNameIndex=new Map();
    for(const drug of drugs){
      for(const name of [val(drug,'commercial_name_en'),val(drug,'commercial_name_ar')]){
        const brand=barcodeTokens(name)[0];if(!brand)continue;
        if(!barcodeNameIndex.has(brand))barcodeNameIndex.set(brand,[]);
        const bucket=barcodeNameIndex.get(brand);if(!bucket.includes(drug))bucket.push(drug);
      }
    }
    return barcodeNameIndex;
  }
  function findDrugByName(name){
    const tokens=barcodeTokens(name);if(!tokens.length)return null;
    const numbers=barcodeNumbers(tokens),pool=barcodeBrandIndex().get(tokens[0]);if(!pool)return null;
    let best=null,bestScore=0;
    for(const drug of pool){
      for(const candidate of [val(drug,'commercial_name_en'),val(drug,'commercial_name_ar')]){
        const other=barcodeTokens(candidate),otherNumbers=barcodeNumbers(other);
        if(numbers.size&&otherNumbers.size&&(numbers.size!==otherNumbers.size||[...numbers].some(number=>!otherNumbers.has(number))))continue;
        const set=new Set(other),sharedWords=tokens.filter(token=>!/\d/.test(token)&&set.has(token)).length;
        if(sharedWords<2)continue;
        const score=tokens.filter(token=>set.has(token)).length/new Set([...tokens,...other]).size;
        if(score>bestScore){bestScore=score;best=drug}
      }
    }
    return bestScore>=0.55?best:null;
  }
  function barcodeCandidates(code){
    const digits=String(code||'').replace(/\D/g,'');
    if(!digits)return[];
    const list=[digits];
    if(digits.length===13&&digits.charAt(0)==='0')list.push(digits.slice(1));
    if(digits.length===12)list.push(`0${digits}`);
    return list;
  }
  function resolveScannedCode(code){
    if(!barcodeCodes)return null;
    let names=null;
    for(const candidate of barcodeCandidates(code)){if(Array.isArray(barcodeCodes[candidate])&&barcodeCodes[candidate].length){names=barcodeCodes[candidate];break}}
    if(!names)return null;
    const byName=new Map();
    for(const drug of drugs){
      for(const name of [val(drug,'commercial_name_en'),val(drug,'commercial_name_ar')]){
        const key=packNameKey(name);if(key&&!byName.has(key))byName.set(key,drug);
      }
    }
    for(const name of names){const drug=byName.get(packNameKey(name));if(drug)return {drug,name}}
    for(const name of names){const drug=findDrugByName(name);if(drug)return {drug,name}}
    return {drug:null,name:names[0]||''};
  }
  function closeScanner(){
    scanFrame&&cancelAnimationFrame(scanFrame);scanFrame=0;
    if(scanStream){scanStream.getTracks().forEach(track=>{try{track.stop()}catch(_){}});scanStream=null}
    if(scanVideo){try{scanVideo.pause()}catch(_){}scanVideo.srcObject=null;scanVideo.hidden=false}
    if(scanStatus){scanStatus.textContent='';scanStatus.hidden=false}
    scanOverlay.hidden=true;document.body.style.overflow='';scanManualInput.value='';
    const target=scanReturnFocus&&scanReturnFocus.isConnected&&scanReturnFocus.getClientRects().length?scanReturnFocus:input;scanReturnFocus=null;
    if(target&&target.getClientRects().length)target.focus({preventScroll:true});
  }
  async function handleCapturedCode(raw){
    const code=String(raw==null?'':raw).trim();
    if(!code||scanBusy)return;
    scanBusy=true;if(scanStatus){scanStatus.hidden=false;scanStatus.textContent=t('scanLooking')}
    let indexMissing=false;
    try{await loadBarcodeCodes()}catch(_){indexMissing=true}
    scanBusy=false;
    if(/^https?:\/\//i.test(code)){closeScanner();openExternal(code);captureStatusShow(t('scanOpenedLink'),'');return}
    const hit=resolveScannedCode(code);
    closeScanner();switchPage('medicines','home');
    if(hit&&hit.drug){input.value='';openDrug(hit.drug);announce(captureLabel('scanFound',{name:brandEn(hit.drug)}));return}
    if(hit&&hit.name){input.value=hit.name;search();announce(captureLabel('scanFoundSearch',{name:hit.name}));return}
    /* A code that is on no box is a different answer from a code the app could
       not check at all, and both are different from a typo in a brand name. The
       scanned string stays in the field so the reader can see what was read. */
    input.value=code;search();
    captureStatusShow(indexMissing?t('scanIndexMissing'):captureLabel('scanNoMatch',{code}),'error');
  }
  async function startWebScanner(){
    const hasCamera=Boolean(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
    if(!hasCamera){scanVideo.hidden=true;scanStatus.textContent=t('scanUnavailable');scanManualInput.focus();return}
    scanStatus.hidden=false;scanStatus.textContent=t('scanStarting');
    try{
      scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    }catch(error){
      scanVideo.hidden=true;
      scanStatus.textContent=error&&(error.name==='NotAllowedError'||error.name==='SecurityError')?t('scanPermissionDenied'):t('scanCameraError');
      scanManualInput.focus();return;
    }
    scanVideo.hidden=false;scanVideo.srcObject=scanStream;
    try{await scanVideo.play()}catch(_){}
    if(!('BarcodeDetector' in window)){scanStatus.textContent=t('scanUnavailable');scanManualInput.focus();return}
    let detector;
    try{detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','code_93','codabar','itf','qr_code','data_matrix','pdf417']})}
    catch(_){try{detector=new BarcodeDetector()}catch(__){scanStatus.textContent=t('scanUnavailable');scanManualInput.focus();return}}
    scanStatus.textContent=t('scanLooking');
    const tick=async()=>{
      if(scanOverlay.hidden||!scanVideo.srcObject)return;
      try{
        const codes=await detector.detect(scanVideo);
        if(codes&&codes.length&&codes[0].rawValue){handleCapturedCode(codes[0].rawValue);return}
      }catch(_){}
      scanFrame=requestAnimationFrame(tick);
    };
    scanFrame=requestAnimationFrame(tick);
  }
  async function openScanner(){
    if(scanBusy||!scanOverlay.hidden)return;
    scanReturnFocus=document.activeElement;
    loadBarcodeCodes().catch(()=>{});
    if(document.body.dataset.view!=='home'&&document.body.dataset.view!=='medicine-list')switchPage('medicines','home');
    scanOverlay.hidden=false;document.body.style.overflow='hidden';scanManualInput.value='';
    const bridge=window.DawayaNative;
    if(bridge&&typeof bridge.scanCode==='function'){
      scanOverlay.hidden=true;document.body.style.overflow='';
      let result=null;
      try{result=await bridge.scanCode({language})}catch(_){result=null}
      if(result&&result.code){handleCapturedCode(result.code);return}
      if(result&&result.cancelled)return;
      scanOverlay.hidden=false;document.body.style.overflow='hidden';
      scanVideo.hidden=true;scanStatus.hidden=false;
      scanStatus.textContent=result&&result.error==='permission'?t('scanPermissionDenied'):t('scanUnavailable');
      scanManualInput.focus();return;
    }
    startWebScanner();
  }
  scanButton&&scanButton.addEventListener('click',openScanner);
  scanClose&&scanClose.addEventListener('click',closeScanner);
  scanOverlay&&scanOverlay.addEventListener('click',event=>{if(event.target===scanOverlay)closeScanner()});
  scanOverlay&&scanOverlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeScanner()}});
  scanManualForm&&scanManualForm.addEventListener('submit',event=>{event.preventDefault();const code=scanManualInput.value.trim();if(code)handleCapturedCode(code)});


  function setVoiceState(on){voiceActive=on;if(!voiceButton)return;voiceButton.classList.toggle('is-listening',on);voiceButton.setAttribute('aria-pressed',on?'true':'false')}
  function finishVoice(message,state){clearTimeout(voiceTimer);setVoiceState(false);captureStatusShow(message||'',state||'')}
  function applyVoiceText(text){
    const spoken=String(text||'').trim();
    if(!spoken){finishVoice(t('voiceNoSpeech'),'error');return}
    finishVoice('');
    if(document.body.dataset.view!=='home'&&document.body.dataset.view!=='medicine-list')switchPage('medicines','home');
    input.value=spoken;activeSuggestion=-1;suggestions.hidden=true;
    document.body.classList.add('searching');
    search();updateUnifiedLabSearch();updateUnifiedConditionSearch();announce(spoken);
  }
  function stopVoiceSearch(){
    const session=voiceSession;voiceSession=null;
    if(session){try{session.abort()}catch(_){}}
    const bridge=window.DawayaNative;
    if(bridge&&typeof bridge.stopVoiceSearch==='function'){try{bridge.stopVoiceSearch()}catch(_){}}
    finishVoice(t('voiceStopped'),'');
  }
  function startWebVoice(){
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition){captureStatusShow(t('voiceUnavailable'),'error');return}
    let recognition;
    try{recognition=new Recognition()}catch(_){captureStatusShow(t('voiceUnavailable'),'error');return}
    recognition.lang=language==='ar'?'ar-EG':'en-US';
    recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=3;
    voiceSession=recognition;setVoiceState(true);captureStatusShow(t('voiceListening'),'');
    voiceTimer=window.setTimeout(()=>{try{recognition.stop()}catch(_){}},12000);
    recognition.onresult=event=>{
      let text='';
      for(let i=event.resultIndex;i<event.results.length;i++){
        const result=event.results[i];
        for(let j=0;j<result.length;j++){const alt=result[j];if(alt&&alt.transcript){text=alt.transcript.trim();break}}
      }
      if(!text)return;
      if(event.results[event.results.length-1].isFinal){try{recognition.stop()}catch(_){}applyVoiceText(text)}
      else captureStatusShow(`${t('voiceListening')} ${text}`,'');
    };
    recognition.onerror=event=>{
      const reason=event&&event.error?event.error:'';
      voiceSession=null;
      if(reason==='not-allowed'||reason==='service-not-allowed')finishVoice(t('voicePermissionDenied'),'error');
      else if(reason==='no-speech')finishVoice(t('voiceNoSpeech'),'error');
      else if(reason==='aborted')finishVoice(t('voiceStopped'),'');
      else finishVoice(t('voiceError'),'error');
    };
    recognition.onend=()=>{
      if(voiceSession!==recognition)return;
      voiceSession=null;
      if(voiceActive)finishVoice(t('voiceNoSpeech'),'error');
    };
    try{recognition.start()}catch(_){voiceSession=null;finishVoice(t('voiceError'),'error')}
  }
  async function startVoiceSearch(){
    if(voiceActive){stopVoiceSearch();return}
    const bridge=window.DawayaNative;
    if(bridge&&typeof bridge.startVoiceSearch==='function'){
      setVoiceState(true);captureStatusShow(t('voiceListening'),'');
      let result=null;
      try{result=await bridge.startVoiceSearch({language:language==='ar'?'ar-EG':'en-US'})}catch(_){result=null}
      if(result&&result.text){applyVoiceText(result.text);return}
      finishVoice('');
      if(result&&result.error==='permission')captureStatusShow(t('voicePermissionDenied'),'error');
      else if(result&&result.cancelled)captureStatusShow(t('voiceStopped'),'');
      else captureStatusShow(t('voiceUnavailable'),'error');
      return;
    }
    startWebVoice();
  }
  voiceButton&&voiceButton.addEventListener('click',startVoiceSearch);
  window.DawayaVoice={event(payload){
    if(!payload)return;
    if(payload.type==='partial'){setVoiceState(true);captureStatusShow(`${t('voiceListening')} ${payload.text||''}`,'');return}
    if(payload.type==='result'){applyVoiceText(payload.text);return}
    if(payload.type==='error'){finishVoice(t(payload.error==='permission'?'voicePermissionDenied':'voiceError'),'error')}
  }};
  const searchModeLabelKeys={brand:'brandName',generic:'genericName',class:'drugGroupSearch',manufacturer:'manufacturer',price:'price'};
  const searchModeToggle=$('#searchModeToggle');
  /* Hoisted and self-looking-up so the view switch can close the menu before this wiring runs. */
  function setSearchModeMenu(open){
    const menu=$('#searchByChips'),toggle=$('#searchModeToggle');if(!menu||!toggle)return;
    menu.hidden=!open;toggle.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',open?'true':'false');
  }
  function syncSearchModeChips(){document.querySelectorAll('[data-search-mode]').forEach(chip=>{const on=chip.dataset.searchMode===mode;chip.classList.toggle('is-active',on);chip.setAttribute('aria-pressed',on?'true':'false')});const current=$('#searchModeCurrent');if(current)current.textContent=t(searchModeLabelKeys[mode]||'brandName')}
  $('#searchMode').addEventListener('change',event=>{mode=event.target.value;syncSearchModeChips();input.inputMode=mode==='price'?'decimal':'search';activeSuggestion=-1;search();if(document.activeElement===input)renderSuggestions(false)});
  searchModeToggle&&searchModeToggle.addEventListener('click',()=>{const menu=$('#searchByChips');setSearchModeMenu(Boolean(menu&&menu.hidden))});
  document.querySelectorAll('[data-search-mode]').forEach(chip=>chip.addEventListener('click',()=>{const select=$('#searchMode');setSearchModeMenu(false);if(searchModeToggle)searchModeToggle.focus({preventScroll:true});if(mode===chip.dataset.searchMode)return;select.value=chip.dataset.searchMode;select.dispatchEvent(new Event('change'))}));
  syncSearchModeChips();
  function currentThemePreference(){return core?.theme?core.theme.preference:themePreference}
  function setThemePreference(choice){
    if(core?.theme){core.theme.setPreference(choice);return}
    themePreference=choice;try{localStorage.setItem('dawaya-theme',choice)}catch(_){}applyTheme();
  }
  if(core?.theme)core.theme.subscribe(()=>applyTheme());
  else{const colorScheme=window.matchMedia('(prefers-color-scheme: dark)');if(colorScheme.addEventListener)colorScheme.addEventListener('change',()=>{if(themePreference==='system')applyTheme()});else if(colorScheme.addListener)colorScheme.addListener(()=>{if(themePreference==='system')applyTheme()})}
  const setLanguage=next=>{
    if(next!==language){language=next;try{localStorage.setItem('dawaya-language',language)}catch(_){}applyLanguage()}
  };
  $('#loadMore').addEventListener('click',()=>{shown+=responsivePageSize('medicine');render()});
  $('#labTestSearch').addEventListener('input',()=>{labSelectedTest='';labSelectedLetter='';renderLabCatalog();renderLabSuggestions(true)});
  $('#labTestSearch').addEventListener('focus',()=>renderLabSuggestions(true));
  $('#labTestSearch').addEventListener('keydown',event=>{if(event.key==='Escape')labSuggestions.hidden=true});
  $('#labTestSearchButton').addEventListener('click',()=>{$('#labTestSearch').focus();renderLabSuggestions(true)});
  $('#labTestSearchClear').addEventListener('click',()=>{$('#labTestSearch').value='';labSelectedSpecialty='';labSelectedGroup='';labSelectedTest='';labSelectedLetter='';labSelectedPurpose='';labSelectedSample='';renderLabCatalog();$('#labTestSearch').focus();renderLabSuggestions(true)});
  $('#labAlphabet').addEventListener('click',event=>{const button=event.target.closest('[data-lab-letter]');if(!button||button.disabled)return;labSelectedLetter=labSelectedLetter===button.dataset.labLetter?'':button.dataset.labLetter;labSelectedSpecialty='';labSelectedGroup='';labSelectedTest='';labSelectedPurpose='';labSelectedSample='';labVisible=responsivePageSize('lab');$('#labTestSearch').value='';renderLabCatalog()});
  const labSpecFlip=event=>{const h=event.target.closest('[data-lab-spec-toggle]');if(!h)return false;labSpecOpen=!labSpecOpen;h.classList.toggle('is-open',labSpecOpen);h.setAttribute('aria-expanded',labSpecOpen?'true':'false');const c=h.nextElementSibling;if(c)c.classList.toggle('fold-collapsed',!labSpecOpen);return true};
  $('#labSpecialties').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-lab-spec-toggle]')){event.preventDefault();labSpecFlip(event)}});
  $('#labSpecialties').addEventListener('click',event=>{if(labSpecFlip(event))return;const button=event.target.closest('[data-lab-specialty]');if(!button)return;labSelectedSpecialty=button.dataset.labSpecialty;labSelectedGroup='';labSelectedTest='';labSelectedLetter='';labSelectedPurpose='';labSelectedSample='';renderLabCatalog()});
  $('#labPurposes').addEventListener('click',event=>{const button=event.target.closest('[data-lab-purpose]');if(!button)return;labSelectedPurpose=labSelectedPurpose===button.dataset.labPurpose?'':button.dataset.labPurpose;labSelectedSample='';labSelectedSpecialty='';labSelectedGroup='';labSelectedTest='';labSelectedLetter='';labVisible=responsivePageSize('lab');$('#labTestSearch').value='';renderLabCatalog()});
  $('#labSamples').addEventListener('click',event=>{const button=event.target.closest('[data-lab-sample]');if(!button)return;labSelectedSample=labSelectedSample===button.dataset.labSample?'':button.dataset.labSample;labSelectedPurpose='';labSelectedSpecialty='';labSelectedGroup='';labSelectedTest='';labSelectedLetter='';labVisible=responsivePageSize('lab');$('#labTestSearch').value='';renderLabCatalog()});
  $('#labSubgroups').addEventListener('click',event=>{const button=event.target.closest('[data-lab-group]');if(!button)return;labSelectedGroup=button.dataset.labGroup;labSelectedTest='';renderLabCatalog()});
  const openLabTest=event=>{const more=event.target.closest('[data-lab-more]');if(more){labVisible+=responsivePageSize('lab');renderLabCatalog();return}const button=event.target.closest('[data-lab-test]');if(!button)return;labSelectedTest=button.dataset.labTest;$('#labTestSearch').value='';if(!labSelectedSpecialty&&!labSelectedLetter&&!labSelectedPurpose&&!labSelectedSample){const test=labCatalog.tests.find(item=>item[0]===labSelectedTest);labSelectedSpecialty=test?.[1]||'';labSelectedGroup=test?.[2]||''}renderLabCatalog()};
  $('#labTestList').addEventListener('click',openLabTest);
  $('#labBreadcrumb').addEventListener('click',event=>{const button=event.target.closest('[data-lab-level]');if(!button)return;if(button.dataset.labLevel==='root'){labSelectedSpecialty='';labSelectedGroup='';labSelectedTest='';labSelectedLetter='';labSelectedPurpose='';labSelectedSample=''}else if(button.dataset.labLevel==='purpose'){labSelectedPurpose='';labSelectedSample='';labSelectedTest=''}else if(button.dataset.labLevel==='specialty'){labSelectedGroup='';labSelectedTest=''}else if(button.dataset.labLevel==='letter'){labSelectedTest=''}else labSelectedTest='';renderLabCatalog()});
  const suggestionDraft={subject:'',body:''};
  $('#suggestionsForm').addEventListener('submit',event=>{event.preventDefault();const subjectGuard=sanitizeUserText($('#suggestionSubject').value.trim()),messageGuard=sanitizeUserText($('#suggestionMessage').value.trim()),subject=subjectGuard.text,message=messageGuard.text;if(!subject||!message){showPrivacyNotice(t('suggestionRequired'));return}if(subjectGuard.removed||messageGuard.removed)showPrivacyNotice();suggestionDraft.subject=subject;suggestionDraft.body=message;$('#suggestionFallbackSubject').textContent=subject;$('#suggestionFallbackBody').textContent=message;$('#suggestionCopyStatus').textContent='';$('#suggestionFallback').hidden=true;const compose=openEmailCompose(subject,message);compose.result.then(opened=>{$('#suggestionFallback').hidden=opened}).catch(()=>{$('#suggestionFallback').hidden=false})});
  $('#suggestionCopyButton').addEventListener('click',async()=>{const text=`To: ${SUGGESTION_EMAIL}\nSubject: ${suggestionDraft.subject}\n\n${suggestionDraft.body}`;try{await navigator.clipboard.writeText(text);$('#suggestionCopyStatus').textContent=t('suggestionCopied')}catch{$('#suggestionCopyStatus').textContent=t('suggestionCopyFailed')}});
  const newMedicineDraft={subject:'',body:''};
  $('#newMedicineButton').addEventListener('click',()=>switchPage('add-medicine','add-medicine'));
  const clearNewMedicineFeedback=()=>{$('#newMedicineStatus').hidden=true;$('#newMedicineFallback').hidden=true;$('#newMedicineCopyStatus').textContent=''};
  $('#newMedicineForm').addEventListener('input',clearNewMedicineFeedback);
  $('#newMedicineForm').addEventListener('invalid',clearNewMedicineFeedback,true);
  $('#newMedicineForm').addEventListener('submit',event=>{
    event.preventDefault();
    $('#newMedicineFallback').hidden=true;$('#newMedicineCopyStatus').textContent='';
    const cleanField=field=>sanitizeUserText(field.value.trim().replace(/\s+/g,' '));
    const nameGuard=cleanField($('#newMedicineName')),ingredientGuard=cleanField($('#newMedicineIngredient')),concentrationGuard=cleanField($('#newMedicineConcentration')),unitsGuard=cleanField($('#newMedicineUnits'));
    if(nameGuard.removed||ingredientGuard.removed||concentrationGuard.removed||unitsGuard.removed)showPrivacyNotice();
    const values={name:nameGuard.text,ingredient:ingredientGuard.text,concentration:concentrationGuard.text,units:unitsGuard.text,price:Number($('#newMedicinePrice').value)};
    const status=$('#newMedicineStatus');
    const valid=Boolean(values.name&&values.ingredient&&values.concentration&&values.units&&$('#newMedicinePrice').value.trim()!==''&&Number.isFinite(values.price)&&values.price>=0);
    if(!valid){
      status.hidden=false;status.className='new-medicine-status warning';status.textContent=t('addMedicineRequired');
      const focusTarget=[[$('#newMedicineName'),values.name],[$('#newMedicineIngredient'),values.ingredient],[$('#newMedicineConcentration'),values.concentration],[$('#newMedicinePrice'),$('#newMedicinePrice').value.trim()],[$('#newMedicineUnits'),values.units]].find(([,value])=>!value);
      (focusTarget?.[0]||$('#newMedicineName')).focus({preventScroll:true});
      return;
    }
    const candidate=normalizeCustomDrug({commercial_name_en:values.name,scientific_name:values.ingredient,custom_concentration:values.concentration,custom_units:values.units,price_egp:values.price});
    const replacing=candidate?customDrugs.some(item=>customMedicineKey(item)===customMedicineKey(candidate)):false;
    const evictsOldest=!replacing&&customDrugs.length>=200;
    const drug=addCustomDrug(values);
    if(!drug){status.hidden=false;status.className='new-medicine-status warning';status.textContent=t('addMedicineRequired');return}
    const saved=saveCustomDrugs();
    applyCustomDrugs();search();
    const subject=NEW_MEDICINE_SUBJECT;
    const body=[
      t('addMedicineEmailIntro'),'',
      `${t('addMedicineEmailName')}: ${customMedicineName(drug)}`,
      `${t('addMedicineEmailIngredient')}: ${val(drug,'scientific_name')}`,
      `${t('addMedicineEmailConcentration')}: ${val(drug,'custom_concentration')}`,
      `${t('addMedicineEmailPrice')}: ${priceText(drug)}`,
      `${t('addMedicineEmailUnits')}: ${val(drug,'custom_units')}`
    ].join('\n');
    newMedicineDraft.subject=subject;newMedicineDraft.body=body;
    $('#newMedicineFallbackSubject').textContent=subject;$('#newMedicineFallbackBody').textContent=body;$('#newMedicineCopyStatus').textContent='';
    const compose=openEmailCompose(subject,body);
    $('#newMedicineOpenGmail').href=compose.url;$('#newMedicineFallback').hidden=true;
    compose.result.then(opened=>{$('#newMedicineFallback').hidden=opened}).catch(()=>{$('#newMedicineFallback').hidden=false});
    status.hidden=false;status.className=`new-medicine-status ${saved?'success':'warning'}`;status.textContent=saved?`${t('addMedicineSaved').replace('{name}',customMedicineName(drug))}${evictsOldest?` ${t('addMedicineEvicted')}`:''}`:t('addMedicineSaveFailed');
    ['#newMedicineName','#newMedicineIngredient','#newMedicineConcentration','#newMedicinePrice','#newMedicineUnits'].forEach(selector=>{$(selector).value=''});
  });
  $('#newMedicineCopyButton').addEventListener('click',async()=>{const text=`To: ${SUGGESTION_EMAIL}\nSubject: ${newMedicineDraft.subject}\n\n${newMedicineDraft.body}`;try{await navigator.clipboard.writeText(text);$('#newMedicineCopyStatus').textContent=t('suggestionCopied')}catch{$('#newMedicineCopyStatus').textContent=t('suggestionCopyFailed')}});
  document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();switchPage('medicines','home')});
  $('#appBack').addEventListener('click',goBack);
  $('#modalClose').addEventListener('click',closeModal);modal.addEventListener('click',event=>{if(event.target===modal)closeModal()});
  $('#similarButton').addEventListener('click',()=>openRelated('similar'));$('#alternativesButton').addEventListener('click',()=>openRelated('alternatives'));
  $('#relatedClose').addEventListener('click',()=>closeRelated());$('#relatedBack').addEventListener('click',()=>closeRelated());relatedBackdrop.addEventListener('click',event=>{if(event.target===relatedBackdrop)closeRelated()});
  $('#relatedFilter').addEventListener('input',()=>{relatedShown=20;paintRelated()});$('#relatedPriceSort').addEventListener('change',event=>{relatedPriceSort=['high','low'].includes(event.target.value)?event.target.value:'default';relatedShown=20;paintRelated()});$('#relatedMore').addEventListener('click',()=>{relatedShown+=20;paintRelated()});
  $('#conditionDetailClose').addEventListener('click',closeConditionDetail);conditionDetailBackdrop.addEventListener('click',event=>{if(event.target===conditionDetailBackdrop)closeConditionDetail()});
  modal.addEventListener('keydown',event=>trapOverlayFocus(event,modal));
  relatedBackdrop.addEventListener('keydown',event=>trapOverlayFocus(event,relatedBackdrop));
  conditionDetailBackdrop.addEventListener('keydown',event=>trapOverlayFocus(event,conditionDetailBackdrop));
  $('#welcomeState').addEventListener('click',event=>{
    const popular=event.target.closest('[data-popular-search]');
    if(popular){input.value=popular.dataset.popularSearch;selectedMedicineLetter=null;activeSuggestion=-1;suggestions.hidden=true;search();input.focus();return}
    const button=event.target.closest('[data-retry-database]');if(!button)return;
    button.disabled=true;loadDatabase();
  });
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!$('#photoViewer').hidden){closePhotoViewer();return}if(!$('#drawerBackdrop').hidden){closeDrawer();return}if(!$('#readingBackdrop').hidden){closeReading();return}if(!relatedBackdrop.hidden){closeRelated();return}if(!modal.hidden)closeModal();if(!conditionDetailBackdrop.hidden)closeConditionDetail();{const menu=$('#searchByChips');if(menu&&!menu.hidden){setSearchModeMenu(false);if(searchModeToggle)searchModeToggle.focus({preventScroll:true})}}});
  document.addEventListener('click',event=>{if(!event.target.closest('.search-composer'))suggestions.hidden=true;if(!event.target.closest('.condition-search-wrap'))conditionSuggestions.hidden=true;if(!event.target.closest('.lab-tests-search'))labSuggestions.hidden=true;if(!event.target.closest('.search-by'))setSearchModeMenu(false)});
  document.querySelectorAll('.detail-tab').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.detail-tab').forEach(tab=>tab.classList.remove('active'));button.classList.add('active');['overview','use','caution'].forEach(panel=>{const node=$('#'+panel+'Panel');node.hidden=panel!==button.dataset.panel;if(!node.hidden)refreshReadMore(node)})}));
  /* Soft keyboards shrink the visual viewport without touching innerHeight. */
  const keyboardGate=()=>{
    const vv=window.visualViewport;
    const hidden=vv&&document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const up=Boolean(hidden&&window.innerHeight-vv.height>140);
    document.documentElement.toggleAttribute('data-keyboard',up);
    /* Hand CSS the height the keyboard covers so an open field can rise above it. */
    const inset=up?Math.max(0,Math.round(window.innerHeight-(vv.offsetTop+vv.height))):0;
    document.documentElement.style.setProperty('--keyboard-inset',`${inset}px`);
  };
  /* iOS 26+ can leave the layout viewport shorter than the screen after the
     keyboard closes, which paints the fixed bottom bar above the physical
     bottom. Anchor the bar to the visual viewport instead and re-measure on
     every viewport change so it can never stay out of place. */
  const bottomNav=document.querySelector('.bottom-nav');
  /* The same leftover pan strands the page itself: with the document locked and
     <body> as the only scroller the reader is left on a blank sheet no drag can
     move. Hand the pan back once the keyboard is gone. */
  let unstickTimer=0;
  const unstickStrandedPan=()=>{
    const vv=window.visualViewport;
    if(!vv||vv.scale!==1||vv.offsetTop<=2||unstickTimer)return;
    if(!bodyScrolls()||document.documentElement.hasAttribute('data-keyboard'))return;
    unstickTimer=setTimeout(()=>{unstickTimer=0;window.scrollTo(0,0)},80);
  };
  const pinBottomNav=()=>{
    const vv=window.visualViewport;
    if(!bottomNav||!vv)return;
    let gap=window.innerHeight-(vv.offsetTop+vv.height)+10;
    if(!Number.isFinite(gap)||Math.abs(gap-10)>160)return;
    /* With no zoom and no keyboard, a pan offset left behind by WebKit paints
       fixed layers that same distance above the screen bottom. */
    if(vv.scale===1&&vv.offsetTop>0&&!document.documentElement.hasAttribute('data-keyboard')&&Math.abs(gap-10)<1.5)gap-=vv.offsetTop;
    bottomNav.style.setProperty('--nav-gap',`${Math.round(gap*2)/2}px`);
  };
  pinBottomNav();
  window.addEventListener('resize',pinBottomNav);
  window.addEventListener('orientationchange',pinBottomNav);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',keyboardGate);
    window.visualViewport.addEventListener('scroll',keyboardGate);
    window.visualViewport.addEventListener('resize',pinBottomNav);
    window.visualViewport.addEventListener('scroll',pinBottomNav);
    window.visualViewport.addEventListener('resize',unstickStrandedPan);
    window.visualViewport.addEventListener('scroll',unstickStrandedPan);
  }
  document.addEventListener('focusin',keyboardGate);
  document.addEventListener('focusout',()=>setTimeout(()=>{keyboardGate();pinBottomNav();unstickStrandedPan();},120));
  let readMoreResizeTimer;window.addEventListener('resize',()=>{clearTimeout(readMoreResizeTimer);readMoreResizeTimer=setTimeout(()=>document.querySelectorAll('.read-more').forEach(node=>{if(node.offsetParent)refreshReadMore(node)}),140)});
  // Clinical references: pediatric weight-based dosing and selected drug interactions.
  const clinicalData=window.DAWAYA_CLINICAL||{};
  const doseMedicines=Array.isArray(clinicalData.doseMedicines)?clinicalData.doseMedicines:[];
  const interactionGroups=Array.isArray(clinicalData.interactionGroups)?clinicalData.interactionGroups:[];
  const interactionAgents=Array.isArray(clinicalData.interactionAgents)?clinicalData.interactionAgents:[];
  const interactionLibrary=Array.isArray(clinicalData.interactions)?clinicalData.interactions:[];
  const prescriptionDoses=new Set(['amoxicillin','amoxicillin_clavulanate','azithromycin']);
  const interactionExamples=[['warfarin','nsaids'],['ssri_snri','tramadol'],['nitrate','pde5'],['simvastatin','strong_cyp3a4'],['lithium','nsaids'],['methotrexate','tmp_smx']];
  const interactionPrimarySources=[
    {en:'DailyMed · official US product labels',ar:'DailyMed · النشرات الرسمية',url:'https://dailymed.nlm.nih.gov/dailymed/'},
    {en:'FDA · drug interaction enzyme table',ar:'FDA · جدول تداخلات الإنزيمات',url:'https://www.fda.gov/drugs/drug-interactions-labeling/drug-development-and-drug-interactions-table-substrates-inhibitors-and-inducers'}
  ];
  let doseResultActive=false;
  let interactionResultActive=false;
  let interactionBrowseShown=8;
  const reminderStore=core?.reminders?core.reminders.createStore():null;
  let reminderCurrentEntries=[],reminderRenderDate='';
  const clinicalLocale=value=>typeof value==='string'?value:(language==='ar'?(value?.ar||value?.en||''):(value?.en||value?.ar||''));
  function clinicalNumber(value,digits=0){
    const number=Number(value);if(!Number.isFinite(number))return '—';
    const factor=10**digits,rounded=Math.round(number*factor)/factor;
    return rounded.toLocaleString(language==='ar'?'ar-EG':'en-US',{maximumFractionDigits:digits});
  }
  function doseNumber(value){
    const number=Number(value);if(!Number.isFinite(number))return '—';
    return clinicalNumber(number>=10?Math.round(number):Math.round(number*10)/10,number>=10?0:1);
  }
  const volumeNumber=value=>{
    const number=Number(value);if(!Number.isFinite(number))return '—';
    return clinicalNumber(number,number<0.1?3:number<1?2:1);
  };
  const interactionAgentName=agent=>clinicalLocale(agent);
  const interactionPairLabel=(a,b)=>`${interactionAgentName(a)} + ${interactionAgentName(b)}`;
  const interactionAgentById=id=>interactionAgents.find(agent=>agent.id===id);
  function findInteractionPair(a,b){
    if(!a||!b||a===b)return null;
    if(core?.interactions)return core.interactions.findPair(a,b,interactionLibrary);
    return interactionLibrary.find(item=>(item.a===a&&item.b===b)||(item.a===b&&item.b===a))||null;
  }
  const interactionSeverityLabel=severity=>t(severity==='avoid'?'interactionSeverityAvoid':severity==='major'?'interactionSeverityMajor':'interactionSeverityModerate');
  const interactionSeverityRank=severity=>core?.interactions?core.interactions.rank(severity):severity==='avoid'?0:severity==='major'?1:2;
  function flagInteractionPairs(a,b){
    if(core?.interactions)return core.interactions.flagPairs(a.agentIds,b.agentIds,interactionLibrary);
    const found=[],seen=new Set();
    for(const aId of a.agentIds)for(const bId of b.agentIds){
      if(aId===bId)continue;
      const key=[aId,bId].sort().join('|');if(seen.has(key))continue;
      const pair=findInteractionPair(aId,bId);if(!pair)continue;
      seen.add(key);found.push({pair,aId,bId});
    }
    return found.sort((first,second)=>interactionSeverityRank(first.pair.severity)-interactionSeverityRank(second.pair.severity));
  }
  function renderClinicalSourceLinks(container,sources){
    if(!container)return;
    const seen=new Set();container.innerHTML='';
    (sources||[]).forEach(source=>{
      if(!source||!source.url||seen.has(source.url))return;
      seen.add(source.url);
      const link=document.createElement('a');
      link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
      link.textContent=`${clinicalLocale(source)} ↗`;
      container.append(link);
    });
  }
  const clinicalDoseRules={
    paracetamol:[['paracetamol','acetaminophen','باراسيتامول','اسيتامينوفين']],
    ibuprofen:[['ibuprofen','ايبوبروفين']],
    amoxicillin:[['amoxicillin','اموكسيسيلين']],
    amoxicillin_clavulanate:[['amoxicillin','اموكسيسيلين'],['clavulanic acid','clavulanate','كلافولانيك','كلافولانات']],
    azithromycin:[['azithromycin','ازيثرومايسين','زيثرومايسين']]
  };
  const clinicalAgentAliases={
    warfarin:['warfarin','marevan','coumadin','وارفارين','ماريفان'],
    clopidogrel:['clopidogrel','plavix','كلوبيدوجريل','بلافيكس'],
    doac:['apixaban','rivaroxaban','edoxaban','dabigatran','eliquis','xarelto','lixiana','pradaxa','ابيكسابان','ريفاروكسابان','ايدوكسابان','دابيغاتران'],
    nsaids:['ibuprofen','diclofenac','naproxen','indomethacin','indometacin','ketorolac','ketoprofen','piroxicam','mefenamic acid','mefenamic','meloxicam','celecoxib','etoricoxib','lornoxicam','tenoxicam','aceclofenac','nimesulide','dexketoprofen','flurbiprofen','sulindac','etodolac','nabumetone','diflunisal','dexibuprofen','ايبوبروفين','ديكلوفيناك','نابروكسين','اندوميثاسين','كيتورولاك','كيتوبروفين','بيروكسيكام','ميفيناميك','ميلوكسيكام','سيلكوكسيب','ايتوريكوكسيب','لورنوكسيكام','تينوكسيكام','اسيكلوفيناك','نيميسوليد','ديكسكيتوبروفين','فلوربيبروفين','سولينداك','ايتودولاك','نابوميتون','ديفلونيزال'],
    tramadol:['tramadol','tramal','ultram','contramal','ترامادول','ترامال'],
    triptan:['sumatriptan','rizatriptan','zolmitriptan','eletriptan','almotriptan','naratriptan','frovatriptan','سوماتريبتان','ريزاتريبتان','زولميتريبتان','اليتريبتان','المتريبتان','ناراتريبتان','فروفاتريبتان'],
    methotrexate:['methotrexate','methotrexat','trexall','rheumatrex','ميثوتريكسات'],
    corticosteroid:['prednisolone','prednisone','dexamethasone','hydrocortisone','methylprednisolone','methyl prednisolone','betamethasone','triamcinolone','cortisone','deflazacort','budesonide','بريدنيزولون','بريدنيزون','ديكساميثازون','هيدروكورتيزون','ميثيل بريدنيزولون','بيتاميثازون','تريامسينولون','كورتيزون','ديفلازاكورت','بوديزونيد'],
    allopurinol:['allopurinol','zyloric','الوبيورينول'],
    azathioprine:['azathioprine','azathioprin','imuran','ازاثيوبرين','ايموران'],
    amiodarone:['amiodarone','cordarone','اميودارون','كوردارون'],
    digoxin:['digoxin','digoxine','lanoxin','ديجوكسين','لانوكسين'],
    verapamil:['verapamil','isoptin','فيراباميل','ايزوبتين'],
    acei_arb:['enalapril','lisinopril','ramipril','captopril','perindopril','quinapril','benazepril','fosinopril','trandolapril','imidapril','moexipril','losartan','valsartan','irbesartan','candesartan','olmesartan','telmisartan','azilsartan','eprosartan','اينالابريل','ليزينوبريل','راميبريل','كابتوبريل','بيريندوبريل','كينابريل','بينازيبريل','فوسينوبريل','تراندولابريل','لوسارتان','فالسارتان','ايربيسارتان','كانديسارتان','اولميسارتان','تلميسارتان'],
    spironolactone:['spironolactone','aldactone','سبيرونولاكتون','الداكتون'],
    thiazide:['hydrochlorothiazide','hydrochlorothiazid','chlorthalidone','indapamide','metolazone','bendroflumethiazide','benzthiazide','hydroflumethiazide','trichlormethiazide','chlorothiazide','هيدروكلوروثيازيد','كلورثاليدون','انداباميد','ميتولازون','بيندروفلوميثيازيد','كلوروثيازيد'],
    simvastatin:['simvastatin','zocor','سيمفاستاتين','زوكور'],
    nitrate:['nitroglycerin','nitroglycerine','glyceryl trinitrate','nitrostat','isosorbide','isosorbide dinitrate','isosorbide mononitrate','isosorbide 5 mononitrate','isoket','imdur','monoket','نيتروغليسرين','جليسيريل ترينيترات','ايزوسوربيد','ايزوسوربيد دينيترات','ايزوسوربيد مونونيترات','ايزوكيت','ايمدور'],
    ssri_snri:['sertraline','fluoxetine','paroxetine','citalopram','escitalopram','fluvoxamine','venlafaxine','desvenlafaxine','duloxetine','milnacipran','levomilnacipran','vilazodone','vortioxetine','سيرترالين','فلوكستين','باروكستين','سيتالوبرام','ايسيتالوبرام','فلوفوكسامين','فينلافاكسين','ديسفينلافاكسين','دولوكستين','ميلناسيبران','فيلازودون','فورتوكستين'],
    maoi:['phenelzine','tranylcypromine','isocarboxazid','moclobemide','selegiline','rasagiline','فينيلزين','ترانيلسيبرومين','ايزوكاربوكسازيد','موكلوبيميد','سيلجیلين','سيلجيلين','راساجيلين'],
    opioid:['morphine','codeine','oxycodone','hydrocodone','hydromorphone','fentanyl','methadone','buprenorphine','tramadol','tapentadol','dihydrocodeine','pethidine','meperidine','nalbuphine','pentazocine','مورفين','كودايين','اوكسيكودون','هيدروكودون','هيدرومورفون','فينتانيل','ميثادون','بوبرينورفين','ترامادول','تابنتادول','دايهيدروكودايين','بيثيدين','نالبوفين','بنتازوسين'],
    benzodiazepine:['diazepam','alprazolam','clonazepam','lorazepam','temazepam','oxazepam','chlordiazepoxide','clobazam','bromazepam','midazolam','triazolam','flurazepam','nitrazepam','estazolam','quazepam','clorazepate','ketazolam','prazepam','brotizolam','loprazolam','lormetazepam','flunitrazepam','delorazepam','clotiazepam','etizolam','ديازيبام','البرازولام','كلونازيبام','لورازيبام','تيمازيبام','اوكسازيبام','كلورديازيبوكسيد','كلوبازام','برومازيبام','ميدازولام','تريازولام','فلورازيبام','نيترازيبام','ايتيزولام'],
    lithium:['lithium','lithium carbonate','lithium citrate','ليثيوم','كربونات الليثيوم','سترات الليثيوم'],
    carbamazepine:['carbamazepine','tegretol','carbatrol','كاربامازيبين','تيجريتول'],
    tizanidine:['tizanidine','sirdalud','zanaflex','تيزانيدين','سيردالود'],
    metronidazole:['metronidazole','metronidazol','flagyl','ميترونيدازول','فلاجيل'],
    macrolide_cyp:['clarithromycin','erythromycin','klacid','erythrocin','كلاريثروميسين','اريثروميسين','كلاسيد','اريثروسين'],
    fluconazole:['fluconazole','diflucan','فلوكونازول','ديفلوكان'],
    tmp_smx:['trimethoprim','sulfamethoxazole','sulphamethoxazole','cotrimoxazole','co trimoxazole','septrin','bactrim','تريميثوبريم','سلفاميثوكسازول','كوتريموكسازول','سيبتريم','باكتريم'],
    rifampin:['rifampicin','rifampin','rifadin','rimactane','ريفامبيسين','ريفامبين'],
    ciprofloxacin:['ciprofloxacin','cipro','ciproxin','سيبروفلوكساسين','سيبرو','سيبروكسين'],
    tetracycline:['tetracycline','doxycycline','minocycline','oxytetracycline','demeclocycline','tigecycline','eravacycline','sarecycline','lymecycline','chlortetracycline','تتراسيكلين','دوكسيسيكلين','مينوسيكلين','اوكسيتتراسيكلين','ديميكلوسيكلين','تيجيسيكلين','لايميسيكلين'],
    azithromycin:['azithromycin','zithromax','azithrocin','ازيثرومايسين','زيثرومايسين','زيثروماكس'],
    strong_cyp3a4:['clarithromycin','erythromycin','itraconazole','ketoconazole','ritonavir','cobicistat','indinavir','nelfinavir','saquinavir','posaconazole','voriconazole','telithromycin','nefazodone','كلاريثروميسين','اريثروميسين','ايتراكونازول','كيتوكونازول','ريتونافير','كوبيسيستات','اندينافير','نيلفينافير','ساكوينافير','بوساكونازول','فوريكونازول','تليثرومايسين','نيفازودون'],
    levothyroxine:['levothyroxine','levothyroxin','thyroxine','euthyrox','eltroxin','eltroxine','synthroid','levoxyl','thyronorm','ليفوثيروكسين','ثيروكسين','يوثيروكس','التروكسين'],
    ppis_omeprazole:['omeprazole','esomeprazole','losec','nexium','prilosec','omeprazol','esomeprazol','اوميبرازول','ايسوميبرازول','لوزيك','نيكسيوم'],
    pde5:['sildenafil','tadalafil','vardenafil','avanafil','viagra','cialis','levitra','stendra','سيلدينافيل','تادالافيل','فاردينافيل','افانافيل','فياجرا','سياليس']
  };
  const clinicalProgestins=['levonorgestrel','gestodene','drospirenone','norgestimate','desogestrel','cyproterone','etonogestrel','dienogest','norethisterone','norethindrone','norgestrel','medroxyprogesterone','nestorone','nomegestrol','trimegestone','ليفونورجيستريل','جيستودين','دروسپيرينون','دروسيبيرينون','نورجستيميت','ديسوجيستريل','سيبروتيرون','ايتونوجيستريل','داينوجيست','نوريثيستيرون','نورجستريل','ميدروكسي بروجستيرون','نيستورون','نوميجيسترول'];
  const clinicalAbsorptionPairs=new Set(['ciprofloxacin|antacids_minerals','tetracycline|antacids_minerals','levothyroxine|antacids_minerals','levothyroxine|ppis_omeprazole'].map(value=>value.split('|').sort().join('|')));
  const clinicalDrugMatchCache=new WeakMap();
  function clinicalRouteClass(drug){
    const route=normalizeDrugClass(val(drug,'route'));
    if(!route||route==='UNKNOWN')return 'unknown';
    if(route.startsWith('ORAL')||route==='EFF')return 'oral';
    if(route.startsWith('INJECTION'))return 'systemic';
    if(/^(?:TOPICAL|EYE|OPHTHALMIC|EAR|OTIC|SOAP|MOUTH|NASAL|INHALATION)/.test(route))return 'local';
    return 'unknown';
  }
  function clinicalIngredients(drug){
    const raw=val(drug,'scientific_name');
    if(!raw)return [];
    const text=String(raw).normalize('NFKC')
      .replace(/\([^)]*\)/g,' ')
      .replace(/\d+(?:[.,]\d+)?\s*(?:mgs?|mcg|µg|ug|gms?|gm|g|mls?|ml|iu|units?|%)(?![a-z])/gi,' ')
      .replace(/\b(?:and|with|plus)\b/gi,'+')
      .replace(/\s+و\s+/g,'+');
    const seen=new Set(),parts=[];
    text.split(/[+&\n;,\/]+/).forEach(chunk=>{
      const part=clean(chunk).replace(/^\d+\s+|\s+\d+$/g,'');
      if(part.length<2||seen.has(part))return;
      seen.add(part);parts.push(part);
    });
    return parts;
  }
  function clinicalPartHasToken(part,token){
    if(!part||!token)return false;
    if(/[\u0600-\u06FF]/.test(token))return part===token||part.includes(token);
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(token)}(?:$|[^a-z0-9])`).test(part);
  }
  const clinicalPartIsAspirin=part=>['aspirin','acetylsalicylic acid','acetylsalicylic','asa','اسبرين','حمض اسيتيل ساليسيليك'].some(token=>clinicalPartHasToken(part,token));
  const clinicalPartIsEthinyl=part=>['ethinyl estradiol','ethinylestradiol','ethinyloestradiol','ايثينيل استراديول'].some(token=>clinicalPartHasToken(part,token)||part.includes('ethinyl'));
  const clinicalPartIsProgestin=part=>clinicalProgestins.some(token=>clinicalPartHasToken(part,token));
  function clinicalPartMatchesMinerals(part){
    if(!part)return false;
    if(['calcium','magnesium','iron','aluminium','aluminum','كالسيوم','مغنيسيوم','حديد','الومنيوم'].includes(part))return true;
    if(/^(?:calcium (?:carbonate|citrate|gluconate|lactate|phosphate)|magnesium (?:hydroxide|oxide|carbonate|trisilicate)|aluminium hydroxide|aluminum hydroxide|sodium bicarbonate|potassium bicarbonate|dihydroxyaluminum sodium carbonate)\b/.test(part))return true;
    if(/^ferrous\b/.test(part))return true;
    if(/^iron\b/.test(part)&&!/(?:sucrose|carboxymaltose|dextran|isomaltoside)/.test(part))return true;
    if(/^ferric\b/.test(part)&&/citrate/.test(part))return true;
    if(/حديد/.test(part))return true;
    if(/كالسيوم/.test(part)&&/(كربونات|سترات|جلوكونات|لاكتات|فوسفات|هيدروكسيد|اكسيد|بيكربونات)/.test(part))return true;
    if(/مغنيسيوم/.test(part)&&/(هيدروكسيد|اكسيد|كربونات|تريسيلكات|سيليكات)/.test(part))return true;
    if(/الومنيوم/.test(part)&&/(هيدروكسيد|كربونات)/.test(part))return true;
    return /بيكربونات الصوديوم/.test(part);
  }
  function clinicalGroupsMatch(parts,groups){
    if(parts.length!==groups.length)return false;
    const used=new Set();
    const assign=index=>{
      if(index===groups.length)return true;
      for(let partIndex=0;partIndex<parts.length;partIndex++){
        if(used.has(partIndex))continue;
        if(groups[index].some(token=>clinicalPartHasToken(parts[partIndex],token))){
          used.add(partIndex);
          if(assign(index+1))return true;
          used.delete(partIndex);
        }
      }
      return false;
    };
    return assign(0);
  }
  function clinicalDoseMatch(parts,routeClass){
    if(!parts.length)return {profile:null,issue:'noingredient'};
    let profile=null;
    if(parts.length===1){
      profile=doseMedicines.find(medicine=>{
        const groups=clinicalDoseRules[medicine.id];
        return groups&&groups.length===1&&groups[0].some(token=>clinicalPartHasToken(parts[0],token));
      })||null;
    }else{
      const combo=doseMedicines.find(medicine=>medicine.id==='amoxicillin_clavulanate');
      if(combo&&clinicalGroupsMatch(parts,clinicalDoseRules[combo.id]))profile=combo;
    }
    if(profile&&routeClass!=='oral')return {profile:null,issue:'nonoral'};
    if(profile)return {profile,issue:null};
    if(routeClass!=='oral')return {profile:null,issue:'nonoral'};
    return {profile:null,issue:parts.length>1?'combo':'unsupported'};
  }
  function clinicalSortAgentIds(ids){
    const order=new Map(interactionAgents.map((agent,index)=>[agent.id,index]));
    return [...new Set(ids)].sort((a,b)=>(order.get(a)??99)-(order.get(b)??99));
  }
  function clinicalAgentsForParts(parts){
    const found=[];
    Object.keys(clinicalAgentAliases).forEach(id=>{
      if(parts.some(part=>clinicalAgentAliases[id].some(token=>clinicalPartHasToken(part,token))))found.push(id);
    });
    if(parts.some(clinicalPartMatchesMinerals))found.push('antacids_minerals');
    if(parts.some(clinicalPartIsEthinyl)&&parts.some(clinicalPartIsProgestin))found.push('ocp');
    return clinicalSortAgentIds(found);
  }
  function clinicalAspirinLowDose(drug){
    const hay=[val(drug,'scientific_name'),val(drug,'commercial_name_en'),val(drug,'commercial_name_ar'),val(drug,'custom_concentration')].join(' ')
      .normalize('NFKC').replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776));
    const values=[];
    const pattern=/(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*)\s*(?:mgs?|مجم|ملجم|مليجرام|gm|g)(?![a-z])/gi;
    let match;
    while((match=pattern.exec(hay))){
      match[1].split('/').forEach(value=>{
        const number=Number(value.trim().replace(',','.'));
        if(Number.isFinite(number)&&number>0)values.push(number);
      });
    }
    if(!values.length)return false;
    return Math.max(...values)<=100&&values.some(value=>value===75||value===81||value===100);
  }
  function clinicalDrugMatch(drug){
    const cached=clinicalDrugMatchCache.get(drug);
    if(cached)return cached;
    const parts=clinicalIngredients(drug),route=clinicalRouteClass(drug);
    const aspirin=parts.some(part=>clinicalPartIsAspirin(part));
    const aspirinLow=aspirin&&clinicalAspirinLowDose(drug);
    const agents=clinicalAgentsForParts(parts);
    if(aspirinLow)agents.push('aspirin_low');
    const dose=clinicalDoseMatch(parts,route);
    const match={parts,route,agents:clinicalSortAgentIds(agents),aspirin,aspirinWarning:aspirin&&!aspirinLow,doseProfile:dose.profile,doseIssue:dose.issue};
    clinicalDrugMatchCache.set(drug,match);
    return match;
  }
  const clinicalSearchAliases=new Map();
  function addClinicalSearchAlias(arabic,tokens){
    const key=clean(arabic);
    if(!key||!Array.isArray(tokens)||!tokens.length)return;
    const english=tokens.map(token=>clean(token)).filter(token=>token&&/[a-z]/i.test(token));
    if(!english.length)return;
    const set=clinicalSearchAliases.get(key)||new Set();
    english.forEach(token=>set.add(token));
    clinicalSearchAliases.set(key,set);
  }
  doseMedicines.forEach(medicine=>{
    const groups=clinicalDoseRules[medicine.id]||[];
    addClinicalSearchAlias(medicine.ar,groups.flat());
    addClinicalSearchAlias(String(medicine.ar).replace(/\([^)]*\)/g,' '),groups.flat());
  });
  Object.keys(clinicalAgentAliases).forEach(id=>{
    const agent=interactionAgentById(id);
    if(!agent)return;
    addClinicalSearchAlias(agent.ar,clinicalAgentAliases[id]);
    const english=String(agent.examples?.en||'').split(/[,;]+/).map(value=>value.trim());
    const arabic=String(agent.examples?.ar||'').split(/[،,;]+/).map(value=>value.trim());
    if(english.length===arabic.length&&english.length>1)english.forEach((token,index)=>addClinicalSearchAlias(arabic[index],[token]));
  });
  addClinicalSearchAlias('حديد',['ferrous','iron']);
  addClinicalSearchAlias('كالسيوم',['calcium']);
  addClinicalSearchAlias('مغنيسيوم',['magnesium']);
  addClinicalSearchAlias('مضاد حموضة',['aluminium','magnesium','calcium carbonate','sodium bicarbonate']);
  addClinicalSearchAlias('مضادات الحموضة',['aluminium','magnesium','calcium carbonate','sodium bicarbonate']);
  addClinicalSearchAlias('بروجستين',clinicalProgestins);
  addClinicalSearchAlias('ايثينيل استراديول',['ethinyl estradiol','ethinylestradiol']);
  addClinicalSearchAlias('اسبرين',['aspirin','acetylsalicylic acid']);
  addClinicalSearchAlias('حمض اسيتيل ساليسيليك',['acetylsalicylic acid']);
  function clinicalArabicExpansions(query){
    const normalized=clean(query);
    if(!normalized||!/[\u0600-\u06FF]/.test(normalized))return [];
    const expansions=new Set();
    for(const [arabic,english] of clinicalSearchAliases){
      if(arabic.length<3)continue;
      if(normalized.includes(arabic)||(normalized.length>=3&&arabic.includes(normalized))){
        english.forEach(token=>expansions.add(token));
      }
      if(expansions.size>80)break;
    }
    return [...expansions];
  }
  let clinicalDbIndex=null,clinicalDbQueryCache=new Map();
  function clinicalDbEntries(){
    if(clinicalDbIndex)return clinicalDbIndex;
    clinicalDbIndex=drugs.map(drug=>({drug,brand:fieldText(drug,'brand'),generic:fieldText(drug,'generic')}));
    return clinicalDbIndex;
  }
  function searchClinicalDatabase(query){
    const normalized=clean(query),cacheKey=normalized;
    if(clinicalDbQueryCache.has(cacheKey))return clinicalDbQueryCache.get(cacheKey);
    if(!drugs.length)return {items:[],total:0,unavailable:loadFailed?'failed':'loading'};
    const parsed=buildWildcardQuery(query),expansions=clinicalArabicExpansions(query),found=[];
    if(parsed){
      for(const entry of clinicalDbEntries()){
        const brandScore=wildcardScore(parsed,entry.brand),genericScore=wildcardScore(parsed,entry.generic);
        let score=Math.max(brandScore>=0?brandScore+20:-1,genericScore>=0?genericScore+8:-1);
        if(score<0&&expansions.length){
          const token=expansions.find(value=>clinicalPartHasToken(entry.generic,value));
          if(token)score=62+Math.max(0,24-Math.abs(entry.generic.length-normalized.length));
        }
        if(score>=0)found.push({drug:entry.drug,score});
      }
    }
    found.sort((a,b)=>b.score-a.score||medicineDisplayName(a.drug).localeCompare(medicineDisplayName(b.drug),language==='ar'?'ar-EG':'en'));
    const result={items:found.slice(0,50),total:found.length,unavailable:''};
    if(clinicalDbQueryCache.size>80)clinicalDbQueryCache.clear();
    clinicalDbQueryCache.set(cacheKey,result);
    return result;
  }
  function clinicalDoseSupportedNames(){
    return doseMedicines.map(medicine=>clinicalLocale(medicine).replace(/\s*\([^)]*\)\s*/g,' ').trim()).join(language==='ar'?'، ':', ');
  }
  function clinicalDrugLabel(drug){
    const name=medicineDisplayName(drug),concentration=val(drug,'custom_concentration');
    return concentration&&!String(name).toLowerCase().includes(String(concentration).toLowerCase())?`${name} · ${concentration}`:name;
  }
  function clinicalDrugSubtitle(drug,match){
    const parts=match?match.parts:clinicalIngredients(drug);
    const ingredient=parts.length?parts.join(' + ').slice(0,110):t('clinicalPickerNoIngredient');
    const route=val(drug,'route')?routeLabel(val(drug,'route')):'';
    const english=clean(val(drug,'commercial_name_en'));
    let detail='';
    if(language==='ar'&&english&&english!==clean(medicineDisplayName(drug)))detail=english.slice(0,90);
    else{
      const maker=clean(val(drug,'manufacturer')),price=priceText(drug);
      detail=[maker,price?`${price} EGP`:''].filter(Boolean).join(' · ');
    }
    return [ingredient,route,detail].filter(Boolean).join(' · ');
  }
  function clinicalAgentExamples(agent){
    return agent&&agent.examples?tf('interactionBrandExamples',{examples:clinicalLocale(agent.examples)}):'';
  }
  function clinicalDoseOptionItems(){
    return doseMedicines.map(medicine=>({
      kind:'dose',
      id:medicine.id,
      label:clinicalLocale(medicine),
      subtitle:t('clinicalPickerDoseSub'),
      badges:[{text:t('clinicalPickerBadgeDose'),tone:'ok'}],
      aliases:(clinicalDoseRules[medicine.id]||[]).flat(),
      search:clean([medicine.en,medicine.ar,...(clinicalDoseRules[medicine.id]||[]).flat(),medicine.id].join(' '))
    }));
  }
  function clinicalAgentOptionItems(mode){
    return interactionAgents.filter(agent=>!(mode==='dose'&&doseMedicines.some(medicine=>medicine.id===agent.id))).map(agent=>({
      kind:'agent',
      id:agent.id,
      label:interactionAgentName(agent),
      subtitle:clinicalAgentExamples(agent),
      badges:mode==='dose'?[{text:t('clinicalPickerBadgeNoDose'),tone:'muted'}]:[],
      aliases:clinicalAgentAliases[agent.id]||[],
      search:clean([agent.en,agent.ar,agent.examples?.en,agent.examples?.ar,...(clinicalAgentAliases[agent.id]||[]),agent.id].join(' '))
    }));
  }
  function clinicalStaticGroups(mode,query){
    const parsed=buildWildcardQuery(query),groups=[];
    if(mode==='dose'){
      const items=clinicalDoseOptionItems().filter(item=>!parsed||wildcardScore(parsed,item.search)>=0);
      if(items.length)groups.push({label:t('clinicalPickerDoseGroup'),items});
    }
    const agents=clinicalAgentOptionItems(mode);
    interactionGroups.forEach(group=>{
      const items=agents.filter(item=>interactionAgentById(item.id)?.group===group.id&&(!parsed||wildcardScore(parsed,item.search)>=0));
      if(items.length)groups.push({label:clinicalLocale(group),items});
    });
    return groups;
  }
  const clinicalPickers=[];
  function createClinicalPicker(config){
    const pickerEl=typeof config.picker==='string'?$(config.picker):config.picker,inputEl=$(config.input),toggleEl=$(config.toggle),listEl=$(config.list),hintEl=$(config.hint);
    if(!pickerEl||!inputEl||!listEl)return null;
    const state={selected:null,options:[],active:-1,open:false,query:'',timer:0,dbLoading:false,dbResult:null,dbQuery:''};
    const optionId=index=>`${config.list.slice(1)}-option-${index}`;
    function selectionLabel(selection){
      if(!selection)return '';
      if(selection.kind==='drug')return clinicalDrugLabel(selection.drug);
      if(selection.kind==='dose'){
        const medicine=doseMedicines.find(item=>item.id===selection.id);
        return medicine?clinicalLocale(medicine):'';
      }
      const agent=interactionAgentById(selection.id);
      return agent?interactionAgentName(agent):'';
    }
    function isSelected(item){
      const selection=state.selected;
      if(!selection)return false;
      if(item.kind==='drug')return selection.kind==='drug'&&selection.drug===item.drug;
      return selection.kind===item.kind&&selection.id===item.id;
    }
    function doseHint(selection){
      if(selection.kind==='dose')return t('dosePickerSelected');
      if(selection.kind==='agent')return tf('doseUnsupportedNamed',{name:selectionLabel(selection),supported:clinicalDoseSupportedNames()});
      const match=clinicalDrugMatch(selection.drug),label=selectionLabel(selection);
      if(match.doseProfile)return tf('doseMatchedProfile',{ingredient:match.parts.join(' + ')||clinicalLocale(match.doseProfile),name:clinicalLocale(match.doseProfile)});
      if(match.doseIssue==='noingredient')return t('clinicalPickerNoIngredient');
      if(match.doseIssue==='nonoral')return tf('doseNonOralNamed',{name:label});
      if(match.doseIssue==='combo')return tf('doseCombinationNamed',{name:label});
      return tf('doseUnsupportedNamed',{name:label,supported:clinicalDoseSupportedNames()});
    }
    function interactionHint(selection){
      if(selection.kind==='drug'){
        const match=clinicalDrugMatch(selection.drug),label=selectionLabel(selection);
        if(match.agents.length){
          const names=match.agents.map(id=>interactionAgentName(interactionAgentById(id))).filter(Boolean);
          return tf('interactionMatchedIngredients',{ingredients:names.join(' · ')});
        }
        if(match.aspirinWarning)return tf('interactionAspirinDoseNamed',{name:label});
        if(!match.parts.length)return t('clinicalPickerNoIngredient');
        return tf('interactionUnsupportedNamed',{name:label});
      }
      if(selection.kind==='agent')return clinicalAgentExamples(interactionAgentById(selection.id))||t('clinicalPickerGuideHint');
      return t('clinicalPickerGuideHint');
    }
    function renderHint(){
      if(!hintEl)return;
      if(!state.selected){hintEl.textContent='';return}
      hintEl.textContent=config.mode==='dose'?doseHint(state.selected):interactionHint(state.selected);
    }
    function dbOption(drug){
      const match=clinicalDrugMatch(drug),badges=[];
      if(config.mode==='dose'){
        if(match.doseProfile)badges.push({text:t('clinicalPickerBadgeDose'),tone:'ok'});
        else if(match.doseIssue==='nonoral')badges.push({text:t('clinicalPickerBadgeNonOral'),tone:'muted'});
        else if(match.doseIssue==='combo')badges.push({text:t('clinicalPickerBadgeCombo'),tone:'warn'});
        else if(match.doseIssue==='noingredient')badges.push({text:t('clinicalPickerBadgeNoIngredient'),tone:'warn'});
        else badges.push({text:t('clinicalPickerBadgeNoDose'),tone:'muted'});
      }else{
        if(match.agents.length)badges.push({text:t('clinicalPickerBadgeGuide'),tone:'ok'});
        else badges.push({text:t('clinicalPickerBadgeNoGuide'),tone:'muted'});
        if(match.route==='local')badges.push({text:t('clinicalPickerBadgeNonSystemic'),tone:'warn'});
        else if(match.route==='unknown')badges.push({text:t('clinicalPickerBadgeRouteUnknown'),tone:'muted'});
        if(match.agents.includes('aspirin_low'))badges.push({text:t('clinicalPickerBadgeAspirin'),tone:'ok'});
        if(match.aspirinWarning)badges.push({text:t('clinicalPickerBadgeAspirinDose'),tone:'danger'});
      }
      return {kind:'drug',drug,label:clinicalDrugLabel(drug),subtitle:clinicalDrugSubtitle(drug,match),badges};
    }
    function databaseAvailabilityNote(){
      if(loadFailed)return t('clinicalPickerDbUnavailable');
      if(!drugs.length)return t('clinicalPickerDbLoading');
      if(!state.query)return tf('clinicalPickerTypeHintAll',{count:clinicalNumber(drugs.length)});
      return t('clinicalPickerTypeHint');
    }
    function buildDatabaseSection(){
      if(state.query.length<2)return {group:null,note:'',noResults:false};
      if(loadFailed)return {group:null,note:t('clinicalPickerDbUnavailable'),noResults:false};
      if(!drugs.length)return {group:null,note:t('clinicalPickerDbLoading'),noResults:false};
      if(state.dbLoading||!state.dbResult)return {group:null,note:t('clinicalPickerSearching'),noResults:false};
      const result=state.dbResult;
      if(!result.items.length)return {group:null,note:t('clinicalPickerNoDbResults'),noResults:true};
      const items=result.items.map(entry=>dbOption(entry.drug));
      const note=result.total>result.items.length?tf('clinicalPickerMoreResults',{shown:clinicalNumber(result.items.length),total:clinicalNumber(result.total)}):'';
      return {group:{label:t('clinicalPickerDatabaseGroup'),items,note},note:'',noResults:false};
    }
    function scheduleDatabaseSearch(){
      clearTimeout(state.timer);
      const query=state.query.trim();
      if(query.length<2){state.dbLoading=false;state.dbResult=null;state.dbQuery='';return}
      if(!drugs.length||loadFailed){state.dbLoading=false;state.dbResult=null;state.dbQuery='';if(state.open)renderList();return}
      const cached=clinicalDbQueryCache.get(clean(query));
      if(cached){
        state.dbResult=cached;state.dbQuery=query;state.dbLoading=false;
        if(state.open)renderList();
        return;
      }
      state.dbLoading=true;
      if(state.open)renderList();
      state.timer=setTimeout(()=>{
        if(state.query.trim()!==query)return;
        state.dbResult=searchClinicalDatabase(query);
        state.dbQuery=query;state.dbLoading=false;
        if(state.open)renderList();
      },170);
    }
    function setActive(index){
      state.active=index;
      listEl.querySelectorAll('.clinical-picker-option.is-active').forEach(option=>option.classList.remove('is-active'));
      if(index<0||!state.options[index]){
        inputEl.removeAttribute('aria-activedescendant');
        return;
      }
      const option=document.getElementById(optionId(index));
      if(option){
        option.classList.add('is-active');
        inputEl.setAttribute('aria-activedescendant',option.id);
        option.scrollIntoView({block:'nearest'});
      }
    }
    function renderList(){
      const groups=clinicalStaticGroups(config.mode,state.query);
      const db=buildDatabaseSection();
      if(db.group)groups.push(db.group);
      const notes=[],query=state.query.trim();
      let emptyText='';
      if(query.length<2){
        const note=databaseAvailabilityNote();
        if(groups.length)notes.push(note);else emptyText=note;
      }else if(!db.group){
        if(db.noResults){
          if(groups.length)notes.push(t('clinicalPickerNoDbResults'));
          else emptyText=t('clinicalPickerNoResults');
        }else{
          if(groups.length)notes.push(db.note);
          else emptyText=db.note||t('clinicalPickerNoResults');
        }
      }
      let index=0;
      groups.forEach(group=>group.items.forEach(item=>{item.index=index++}));
      state.options=groups.flatMap(group=>group.items);
      listEl.innerHTML='';
      groups.forEach(group=>{
        const section=document.createElement('div');
        section.className='clinical-picker-group';
        section.setAttribute('role','group');
        section.setAttribute('aria-label',group.label);
        const heading=document.createElement('div');
        heading.className='clinical-picker-group-label';
        heading.textContent=group.label;
        section.append(heading);
        group.items.forEach(item=>{
          const button=document.createElement('button');
          button.type='button';button.className='clinical-picker-option';button.id=optionId(item.index);
          button.setAttribute('role','option');
          button.setAttribute('aria-selected',isSelected(item)?'true':'false');
          if(isSelected(item))button.classList.add('is-selected');
          const copy=document.createElement('span');
          copy.className='clinical-picker-option-copy';
          const name=document.createElement('span');
          name.className='clinical-picker-option-name';name.dir='auto';name.textContent=item.label;
          copy.append(name);
          if(item.subtitle){
            const subtitle=document.createElement('span');
            subtitle.className='clinical-picker-option-sub';subtitle.dir='auto';subtitle.textContent=item.subtitle;
            copy.append(subtitle);
          }
          const badges=document.createElement('span');
          badges.className='clinical-picker-option-badges';
          (item.badges||[]).forEach(badge=>{
            const chip=document.createElement('span');
            chip.className='clinical-picker-badge';chip.dataset.tone=badge.tone||'muted';chip.textContent=badge.text;
            badges.append(chip);
          });
          button.append(copy,badges);
          button.addEventListener('mousedown',event=>event.preventDefault());
          button.addEventListener('click',()=>choose(item));
          section.append(button);
        });
        if(group.note){
          const note=document.createElement('p');
          note.className='clinical-picker-note';
          note.textContent=group.note;
          section.append(note);
        }
        listEl.append(section);
      });
      if(!state.options.length){
        const empty=document.createElement('p');
        empty.className='clinical-picker-empty';
        empty.textContent=emptyText||t('clinicalPickerNoResults');
        listEl.append(empty);
      }
      notes.filter(Boolean).forEach(text=>{
        const note=document.createElement('p');
        note.className='clinical-picker-note clinical-picker-note-foot';
        note.textContent=text;
        listEl.append(note);
      });
      if(state.active>=state.options.length)state.active=-1;
      setActive(state.active);
    }
    function openList(){
      if(state.open)return;
      state.open=true;state.active=-1;
      listEl.hidden=false;
      inputEl.setAttribute('aria-expanded','true');
      toggleEl?.setAttribute('aria-expanded','true');
      state.query=state.selected?'':inputEl.value.trim();
      state.dbResult=null;state.dbQuery='';state.dbLoading=false;
      renderList();
      scheduleDatabaseSearch();
    }
    function closeList(){
      clearTimeout(state.timer);
      state.open=false;state.active=-1;
      listEl.hidden=true;
      inputEl.setAttribute('aria-expanded','false');
      inputEl.removeAttribute('aria-activedescendant');
      toggleEl?.setAttribute('aria-expanded','false');
    }
    function choose(item){
      const selection=item.kind==='drug'?{kind:'drug',drug:item.drug}:{kind:item.kind,id:item.id};
      setSelected(selection);
    }
    function setSelected(selection,options={}){
      state.selected=selection||null;
      clearTimeout(state.timer);
      state.dbLoading=false;state.dbResult=null;state.dbQuery='';
      inputEl.value=state.selected?selectionLabel(state.selected):'';
      inputEl.removeAttribute('aria-invalid');
      closeList();
      renderHint();
      if(options.silent)return;
      if(state.selected)config.onSelect?.(state.selected);
      else config.onClear?.();
    }
    function resolveTyped(options={}){
      const raw=inputEl.value.trim();
      if(!raw)return false;
      const normalized=clean(raw);
      if(config.mode==='dose'){
        const doseItems=clinicalDoseOptionItems();
        const exactLabel=doseItems.filter(item=>clean(item.label)===normalized);
        if(exactLabel.length===1){choose(exactLabel[0]);return true}
        const exactAlias=doseItems.filter(item=>(item.aliases||[]).some(alias=>clean(alias)===normalized));
        if(exactAlias.length===1){choose(exactAlias[0]);return true}
      }
      const agentItems=clinicalAgentOptionItems(config.mode);
      const exactAgent=agentItems.filter(item=>clean(item.label)===normalized);
      if(exactAgent.length===1){choose(exactAgent[0]);return true}
      const exactAgentAlias=agentItems.filter(item=>(item.aliases||[]).some(alias=>clean(alias)===normalized));
      if(exactAgentAlias.length===1){choose(exactAgentAlias[0]);return true}
      if(raw.length>=2&&drugs.length){
        const result=searchClinicalDatabase(raw);
        if(result.total===1&&result.items.length===1){
          choose({kind:'drug',drug:result.items[0].drug,label:clinicalDrugLabel(result.items[0].drug)});
          return true;
        }
      }
      if(options.openOnFail!==false&&!state.open)openList();
      return false;
    }
    function moveActive(delta){
      if(!state.open){openList();if(!state.options.length)return}
      if(!state.options.length)return;
      const next=state.active<0?(delta>0?0:state.options.length-1):(state.active+delta+state.options.length)%state.options.length;
      setActive(next);
    }
    inputEl.addEventListener('focus',()=>{if(!state.open)openList()});
    inputEl.addEventListener('click',()=>{if(!state.open)openList()});
    inputEl.addEventListener('input',()=>{
      inputEl.removeAttribute('aria-invalid');
      if(state.selected){
        state.selected=null;
        renderHint();
        config.onClear?.();
      }
      state.dbResult=null;state.dbQuery='';state.dbLoading=false;
      state.query=inputEl.value.trim();
      if(!state.open){
        state.open=true;state.active=-1;
        listEl.hidden=false;
        inputEl.setAttribute('aria-expanded','true');
        toggleEl?.setAttribute('aria-expanded','true');
      }
      state.active=-1;
      renderList();
      scheduleDatabaseSearch();
    });
    inputEl.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'){event.preventDefault();if(state.open)moveActive(1);else openList();return}
      if(event.key==='ArrowUp'){event.preventDefault();if(state.open)moveActive(-1);else openList();return}
      if(event.key==='Home'&&state.open){event.preventDefault();setActive(0);return}
      if(event.key==='End'&&state.open){event.preventDefault();setActive(state.options.length-1);return}
      if(event.key==='Enter'){
        event.preventDefault();
        if(state.open&&state.active>=0&&state.options[state.active])choose(state.options[state.active]);
        else resolveTyped();
        return;
      }
      if(event.key==='Escape'&&state.open){event.preventDefault();closeList();return}
      if(event.key==='Tab')closeList();
    });
    inputEl.addEventListener('blur',()=>{
      setTimeout(()=>{
        if(!state.open||pickerEl.contains(document.activeElement))return;
        closeList();
        if(!state.selected&&inputEl.value.trim())resolveTyped({openOnFail:false});
      },120);
    });
    toggleEl?.addEventListener('mousedown',event=>event.preventDefault());
    toggleEl?.addEventListener('click',()=>{
      if(state.open)closeList();
      else{inputEl.focus();openList()}
    });
    document.addEventListener('click',event=>{if(!pickerEl.contains(event.target))closeList()});
    const picker={
      input:inputEl,
      selected:()=>state.selected,
      value:()=>inputEl.value,
      refresh(){
        if(state.selected)inputEl.value=selectionLabel(state.selected);
        renderHint();
        if(state.open){
          state.query=state.selected?'':inputEl.value.trim();
          state.dbResult=null;state.dbQuery='';state.dbLoading=false;
          renderList();
          scheduleDatabaseSearch();
        }
      },
      setSelected,
      resolveTyped,
      reset(options={}){
        setSelected(null,{silent:true});
        inputEl.value='';
        renderHint();
        if(!options.silent)config.onClear?.();
      },
      close:closeList,
      open:openList,
      focus:()=>inputEl.focus()
    };
    clinicalPickers.push(picker);
    renderHint();
    return picker;
  }
  let dosePicker=null,interactionPickerA=null,interactionPickerB=null;
  function renderDoseSources(){
    renderClinicalSourceLinks($('#doseSources'),doseMedicines.flatMap(medicine=>medicine.sources||[]));
  }
  function renderInteractionSources(){
    renderClinicalSourceLinks($('#interactionSources'),interactionPrimarySources);
  }
  function clearDoseStatus(){
    const status=$('#doseStatus');
    if(status){status.hidden=true;status.textContent='';delete status.dataset.state}
  }
  function doseError(message,field=null){
    const status=$('#doseStatus'),box=$('#doseResult');
    if(status){status.textContent=message;status.hidden=false;status.dataset.state='error'}
    if(box){box.hidden=true;box.innerHTML=''}
    doseResultActive=false;
    if(field){field.setAttribute('aria-invalid','true');field.focus()}
  }
  const doseMetric=(label,value,unit,detail='')=>`<div class="dose-metric"><span class="dose-metric-label">${esc(label)}</span><strong>${esc(value)}${unit?` <small>${esc(unit)}</small>`:''}</strong>${detail?`<span class="dose-metric-detail">${esc(detail)}</span>`:''}</div>`;
  function resolveDoseSelection(){
    if(!dosePicker)return null;
    if(!dosePicker.selected()&&dosePicker.value().trim())dosePicker.resolveTyped({openOnFail:false,silent:true});
    const selection=dosePicker.selected();
    if(!selection)return null;
    if(selection.kind==='dose'){
      const medicine=doseMedicines.find(item=>item.id===selection.id);
      return medicine?{medicine,drug:null,label:clinicalLocale(medicine)}:null;
    }
    if(selection.kind==='drug'){
      const match=clinicalDrugMatch(selection.drug);
      return {medicine:match.doseProfile,drug:selection.drug,label:clinicalDrugLabel(selection.drug),issue:match.doseIssue,parts:match.parts};
    }
    return {medicine:null,drug:null,agent:interactionAgentById(selection.id),label:selection.kind==='agent'?interactionAgentName(interactionAgentById(selection.id)):''};
  }
  function calculateDose(silent=false){
    const medicineInput=$('#doseMedicine'),weightInput=$('#doseWeight'),ageInput=$('#doseAge'),ageUnitInput=$('#doseAgeUnit'),concentrationInput=$('#doseConcentration'),status=$('#doseStatus'),box=$('#doseResult');
    if(!medicineInput||!weightInput||!box)return;
    [medicineInput,weightInput,ageInput,concentrationInput].forEach(field=>field?.removeAttribute('aria-invalid'));
    const selection=resolveDoseSelection();
    if(!selection){doseError(medicineInput.value.trim()?t('clinicalPickerChooseOne'):t('doseNoResult'),medicineInput);return}
    if(!selection.medicine){
      if(selection.agent)doseError(tf('doseUnsupportedNamed',{name:selection.label,supported:clinicalDoseSupportedNames()}),medicineInput);
      else if(selection.issue==='nonoral')doseError(tf('doseNonOralNamed',{name:selection.label}),medicineInput);
      else if(selection.issue==='combo')doseError(tf('doseCombinationNamed',{name:selection.label}),medicineInput);
      else if(selection.issue==='noingredient')doseError(t('clinicalPickerNoIngredient'),medicineInput);
      else doseError(tf('doseUnsupportedNamed',{name:selection.label,supported:clinicalDoseSupportedNames()}),medicineInput);
      return;
    }
    const medicine=selection.medicine;
    const weight=Number(weightInput.value);
    if(!weightInput.value.trim()||!Number.isFinite(weight)||weight<2||weight>50){doseError(t('doseInvalidWeight'),weightInput);return}
    const ageRaw=ageInput.value.trim();
    let age=null,ageMonths=null;
    if(ageRaw){
      age=Number(ageRaw);
      if(!Number.isFinite(age)||age<0){doseError(t('doseInvalidAge'),ageInput);return}
      ageMonths=ageUnitInput.value==='months'?age:age*12;
      if(ageMonths>=216){doseError(t('doseInvalidAgeMax'),ageInput);return}
    }
    const concentrationRaw=concentrationInput.value.trim();
    let concentration=null;
    if(concentrationRaw){
      concentration=Number(concentrationRaw);
      if(!Number.isFinite(concentration)||concentration<1||concentration>1000){doseError(t('doseInvalidConcentration'),concentrationInput);return}
    }
    const dosesPerDay=medicine.dosesPerDay||medicine.maxDoses||1;
    let perDose=null,daily=null,phases=[];
    if(medicine.type==='perDose'){
      perDose=[Math.min(weight*medicine.perDose[0],medicine.maxPerDose),Math.min(weight*medicine.perDose[1],medicine.maxPerDose)];
      daily={max:Math.min(weight*medicine.maxDailyPerKg,medicine.maxDaily,perDose[1]*dosesPerDay)};
    }else if(medicine.type==='perDay'){
      const rawLow=weight*medicine.perDay[0],rawHigh=weight*medicine.perDay[1];
      const perDoseLow=Math.min(rawLow/dosesPerDay,medicine.maxPerDose),perDoseHigh=Math.min(rawHigh/dosesPerDay,medicine.maxPerDose);
      perDose=[perDoseLow,perDoseHigh];
      daily={low:Math.min(rawLow,perDoseLow*dosesPerDay,medicine.maxDaily),high:Math.min(rawHigh,perDoseHigh*dosesPerDay,medicine.maxDaily)};
    }else if(medicine.type==='phases'){
      phases=medicine.phases.map(phase=>({label:clinicalLocale(phase),mg:Math.min(weight*phase.mgPerKg,phase.maxMg)}));
    }
    const factor=concentration?5/concentration:0;
    const metrics=[];
    if(perDose)metrics.push(doseMetric(t('dosePerDose'),`${doseNumber(perDose[0])}–${doseNumber(perDose[1])}`,t('doseMg'),concentration?tf('doseVolume',{low:volumeNumber(perDose[0]*factor),high:volumeNumber(perDose[1]*factor)}):''));
    if(daily){
      if(daily.high!==undefined)metrics.push(doseMetric(t('dosePerDay'),`${doseNumber(daily.low)}–${doseNumber(daily.high)}`,t('doseMg')));
      else metrics.push(doseMetric(t('doseMaxPerDay'),doseNumber(daily.max),t('doseMg')));
    }
    phases.forEach(phase=>metrics.push(doseMetric(phase.label,doseNumber(phase.mg),t('doseMg'),concentration?tf('doseVolumeSingle',{value:volumeNumber(phase.mg*factor)}):'')));
    const meta=[];
    if(medicine.interval)meta.push(tf('doseInterval',{interval:clinicalLocale(medicine.interval)}));
    if(medicine.type==='perDose'||medicine.type==='perDay')meta.push(tf('doseDosesPerDay',{count:clinicalNumber(dosesPerDay)}));
    if(perDose&&medicine.maxPerDose)meta.push(tf('doseMaxPerDose',{max:clinicalNumber(medicine.maxPerDose)}));
    const ageText=age===null?'':`${clinicalNumber(age,age%1?1:0)} ${ageUnitInput.value==='months'?t('doseMonths'):t('doseYears')}`;
    const ageNote=age===null?t('doseAgeNotEntered'):tf('doseAgeNote',{age:ageText});
    const ageCaveat=clinicalLocale(medicine.ageWarning);
    const ageBelow=ageMonths!==null&&Number.isFinite(medicine.minAgeMonths)&&ageMonths<medicine.minAgeMonths;
    const rule=medicine.type==='perDose'?tf('doseRulePerDose',{low:medicine.perDose[0],high:medicine.perDose[1],max:clinicalNumber(medicine.maxPerDose)}):medicine.type==='perDay'?tf('doseRulePerDay',{low:medicine.perDay[0],high:medicine.perDay[1],count:clinicalNumber(dosesPerDay)}):'';
    const phaseRules=medicine.type==='phases'?medicine.phases.map(phase=>tf('doseRulePhase',{phase:clinicalLocale(phase),mgPerKg:clinicalNumber(phase.mgPerKg),max:clinicalNumber(phase.maxMg)})).map(line=>`<p class="dose-rule">${esc(line)}</p>`).join(''):'';
    const productLine=selection.drug?`<p class="dose-product">${esc(tf('doseResultProduct',{name:selection.label}))}</p>`:'';
    const html=`<article class="dose-result-card clinical-card">
      <header class="dose-result-head"><div><span class="clinical-kicker">${esc(t('doseResultHeading'))}</span><h2>${esc(clinicalLocale(medicine))}</h2><p>${esc(tf('doseResultFor',{weight:clinicalNumber(weight,weight%1?1:0)}))} · ${esc(ageNote)}</p></div></header>
      ${productLine}
      <div class="dose-metrics">${metrics.join('')}</div>
      ${concentration?`<p class="dose-concentration">${esc(tf('doseConcentrationUsed',{conc:clinicalNumber(concentration,concentration%1?1:0)}))}</p>`:''}
      ${meta.length?`<div class="dose-meta">${meta.map(item=>`<span>${esc(item)}</span>`).join('')}</div>`:''}
      ${rule?`<p class="dose-rule">${esc(rule)}</p>`:''}${phaseRules}
      ${ageCaveat&&ageBelow?`<section class="dose-age-caveat"><strong>${esc(t('doseAgeWarningTitle'))}</strong><p>${esc(`${t('doseAgeBelow')} ${ageCaveat}`)}</p></section>`:''}
      <section class="dose-safety"><h3>${esc(t('doseSafetyTitle'))}</h3><ul>${medicine.warnings.map(warning=>`<li>${esc(clinicalLocale(warning))}</li>`).join('')}</ul></section>
      ${medicine.note?`<p class="dose-medicine-note">${esc(clinicalLocale(medicine.note))}</p>`:''}
      ${medicine.alternative?`<p class="dose-alternative">${esc(clinicalLocale(medicine.alternative))}</p>`:''}
      ${medicine.highDosePerDay?`<p class="dose-high-dose">${esc(t('doseHighDose'))}</p>`:''}
      ${prescriptionDoses.has(medicine.id)?`<p class="dose-rx-note">${esc(t('dosePrescription'))}</p>`:''}
      <div class="dose-result-sources"><strong>${esc(t('doseSourcesTitle'))}</strong><div class="clinical-source-links" data-dose-result-sources></div></div>
      <p class="dose-approx">${esc(t('doseApprox'))}</p>
      <p class="dose-result-note">${esc(t('doseResultNote'))}</p>
    </article>`;
    box.innerHTML=html;
    renderClinicalSourceLinks(box.querySelector('[data-dose-result-sources]'),medicine.sources||[]);
    box.hidden=false;
    if(status){status.hidden=true;status.textContent=''}
    doseResultActive=true;
    if(!silent)revealResult(box);
  }
  function resetDoseForm(){
    const form=$('#doseForm');if(form)form.reset();
    const box=$('#doseResult');
    clearDoseStatus();
    if(box){box.hidden=true;box.innerHTML=''}
    ['#doseMedicine','#doseWeight','#doseAge','#doseConcentration'].forEach(selector=>$(selector)?.removeAttribute('aria-invalid'));
    doseResultActive=false;
    dosePicker?.reset({silent:true});
    dosePicker?.focus();
  }
  function invalidateDoseResult(){
    const status=$('#doseStatus'),box=$('#doseResult');
    if(!doseResultActive){
      if(status?.dataset.state==='error')clearDoseStatus();
      return;
    }
    if(box){box.hidden=true;box.innerHTML=''}
    doseResultActive=false;
    if(status){status.textContent=t('doseInputsChanged');status.hidden=false;status.dataset.state='notice'}
  }
  function clearInteractionResult(){
    const box=$('#interactionResult'),alertBox=$('#interactionAlert');
    if(box){box.hidden=true;box.innerHTML=''}
    if(alertBox){alertBox.hidden=true;alertBox.innerHTML='';alertBox.className='interaction-alert-slot'}
    if(core?.speech?.speaking)core.speech.stop(true);
    interactionResultActive=false;
  }
  function setInteractionStatus(message='',state='error'){
    const status=$('#interactionStatus');if(!status)return;
    if(!message){status.hidden=true;status.textContent='';return}
    status.textContent=message;status.dataset.state=state;status.hidden=false;
  }
  function interactionSideFromPicker(picker){
    if(!picker)return null;
    if(!picker.selected()&&picker.value().trim())picker.resolveTyped({openOnFail:false,silent:true});
    const selection=picker.selected();
    if(!selection)return null;
    if(selection.kind==='drug'){
      const match=clinicalDrugMatch(selection.drug);
      return {kind:'drug',label:clinicalDrugLabel(selection.drug),drug:selection.drug,match,route:match.route,agentIds:match.agents.slice()};
    }
    const agent=interactionAgentById(selection.id);
    if(selection.kind==='agent'){
      return {kind:'agent',label:agent?interactionAgentName(agent):selection.id,drug:null,match:null,route:null,agentIds:agent?[agent.id]:[]};
    }
    const medicine=doseMedicines.find(item=>item.id===selection.id);
    return {kind:'dose',label:medicine?clinicalLocale(medicine):selection.id,drug:null,match:null,route:null,agentIds:agent?[agent.id]:[]};
  }
  function interactionAgentNames(ids){
    return (ids||[]).map(id=>interactionAgentById(id)).filter(Boolean).map(interactionAgentName);
  }
  function interactionSideAgentLabel(side){
    const names=interactionAgentNames(side.agentIds);
    return names.length?names.join(' · '):side.label;
  }
  function interactionCautionMessages(sides){
    const messages=[];
    sides.forEach(side=>{
      if(!side.drug)return;
      if(side.route==='local')messages.push(tf('interactionNonSystemicNamed',{name:side.label}));
      else if(side.route==='unknown')messages.push(tf('interactionUnknownRouteNamed',{name:side.label}));
      if(side.match?.aspirinWarning&&side.agentIds.length)messages.push(tf('interactionAspirinDoseNamed',{name:side.label}));
    });
    return [...new Set(messages)];
  }
  function interactionUnsupportedMessages(sides){
    const messages=[];
    sides.forEach(side=>{
      if(side.agentIds.length)return;
      if(side.drug&&side.match?.aspirinWarning)messages.push(tf('interactionAspirinDoseNamed',{name:side.label}));
      else if(side.drug&&!side.match?.parts.length)messages.push(`${side.label}: ${t('clinicalPickerNoIngredient')}`);
      else messages.push(tf('interactionUnsupportedNamed',{name:side.label}));
    });
    return [...new Set(messages)];
  }
  function interactionContextHtml(sides){
    const rows=sides.filter(side=>side.drug).map(side=>{
      const names=interactionAgentNames(side.agentIds);
      return names.length?tf('interactionSelectionContextItem',{medicine:side.label,ingredients:names.join(' · ')}):tf('interactionSelectionContextNoMatch',{medicine:side.label});
    });
    if(!rows.length)return '';
    return `<section class="interaction-context clinical-card"><h2>${esc(t('interactionSelectionContextTitle'))}</h2><ul>${rows.map(row=>`<li>${esc(row)}</li>`).join('')}</ul></section>`;
  }
  function interactionCautionsHtml(messages){
    if(!messages.length)return '';
    return `<section class="interaction-caution clinical-card"><h2>${esc(t('interactionCautionTitle'))}</h2><ul>${messages.map(message=>`<li>${esc(message)}</li>`).join('')}</ul></section>`;
  }
  function interactionPairCardHtml(entry,index){
    const firstAgent=interactionAgentById(entry.aId),secondAgent=interactionAgentById(entry.bId);
    if(!firstAgent||!secondAgent)return '';
    const pair=entry.pair;
    return `<article class="interaction-answer severity-${esc(pair.severity)} clinical-card">
      <header class="interaction-answer-head">
        <span class="severity-badge">${esc(interactionSeverityLabel(pair.severity))}</span>
        <h2>${esc(interactionPairLabel(firstAgent,secondAgent))}</h2>
        <p class="interaction-answer-examples">${esc(clinicalLocale(firstAgent.examples))} · ${esc(clinicalLocale(secondAgent.examples))}</p>
      </header>
      <div class="interaction-answer-grid">
        <section><h3>${esc(t('interactionEffectLabel'))}</h3><p>${esc(clinicalLocale(pair.effect))}</p></section>
        <section><h3>${esc(t('interactionMechanismLabel'))}</h3><p>${esc(clinicalLocale(pair.mechanism))}</p></section>
        <section class="interaction-management"><h3>${esc(t('interactionManagementLabel'))}</h3><p>${esc(clinicalLocale(pair.management))}</p></section>
      </div>
      <div class="interaction-answer-sources"><h3>${esc(t('interactionSourcesLabel'))}</h3><div class="clinical-source-links" data-interaction-sources="${index}"></div></div>
      <p class="interaction-answer-note">${esc(t('interactionResultNote'))}</p>
    </article>`;
  }
  function interactionNoPairHtml(a,b){
    const examples=[...a.agentIds,...b.agentIds].map(id=>interactionAgentById(id)).filter(Boolean).map(agent=>clinicalLocale(agent.examples)).filter(Boolean);
    return `<article class="interaction-answer interaction-answer-none clinical-card">
      <header class="interaction-answer-head"><span class="clinical-kicker">${esc(t('interactionNoPairTitle'))}</span><h2>${esc(`${interactionSideAgentLabel(a)} + ${interactionSideAgentLabel(b)}`)}</h2>${examples.length?`<p class="interaction-answer-examples">${esc([...new Set(examples)].join(' · '))}</p>`:''}</header>
      <p>${esc(t('interactionNoPairBody'))}</p>
      <p class="interaction-answer-note">${esc(t('interactionDisclaimer'))}</p>
    </article>`;
  }
  function interactionUnsupportedHtml(a,b,messages){
    return `<article class="interaction-answer interaction-answer-none clinical-card">
      <header class="interaction-answer-head"><span class="clinical-kicker">${esc(t('interactionNoPairTitle'))}</span><h2>${esc(`${a.label} + ${b.label}`)}</h2></header>
      ${messages.map(message=>`<p>${esc(message)}</p>`).join('')}
      <p class="interaction-answer-note">${esc(t('interactionDisclaimer'))}</p>
    </article>`;
  }
  function interactionNotApplicableHtml(skipped){
    if(!skipped.length)return '';
    const pairLabels=[...new Set(skipped.map(entry=>{
      const firstAgent=interactionAgentById(entry.aId),secondAgent=interactionAgentById(entry.bId);
      return firstAgent&&secondAgent?interactionPairLabel(firstAgent,secondAgent):'';
    }).filter(Boolean))];
    const messages=new Set();
    skipped.forEach(entry=>entry.blocked.forEach(side=>messages.add(tf('interactionOralOnlyNamed',{name:side.label}))));
    return `<article class="interaction-not-applicable clinical-card">
      <span class="clinical-kicker">${esc(t('interactionNotApplicableTitle'))}</span>
      <h2>${esc(pairLabels.join(' · '))}</h2>
      <ul>${[...messages].map(message=>`<li>${esc(message)}</li>`).join('')}</ul>
      <p class="interaction-answer-note">${esc(t('interactionDisclaimer'))}</p>
    </article>`;
  }
  function renderInteractionAlert(entries,silent=false){
    const slot=$('#interactionAlert');if(!slot)return;
    if(core?.speech?.speaking)core.speech.stop(true);
    if(!entries||!entries.length){slot.hidden=true;slot.innerHTML='';slot.className='interaction-alert-slot';return}
    const worst=core?.interactions?core.interactions.worst(entries):entries[0].pair.severity;
    const primary=entries[0],first=interactionAgentById(primary.aId),second=interactionAgentById(primary.bId);
    if(!first||!second){slot.hidden=true;slot.innerHTML='';return}
    const titleKey=worst==='avoid'?'interactionAlertAvoid':worst==='major'?'interactionAlertMajor':'interactionAlertModerate';
    const extra=entries.length>1?`<p class="interaction-alert-more">${esc(tf('interactionAlertMore',{count:clinicalNumber(entries.length)}))}</p>`:'';
    slot.className=`interaction-alert-slot severity-${worst}`;
    slot.innerHTML=`<section class="interaction-alert" role="${silent?'region':'alert'}" aria-labelledby="interactionAlertHeading">
      <span class="interaction-alert-icon" aria-hidden="true">!</span>
      <div class="interaction-alert-content">
        <div class="interaction-alert-topline"><span class="interaction-alert-kicker">${esc(t('interactionAlertKicker'))}</span><span class="severity-badge">${esc(interactionSeverityLabel(worst))}</span></div>
        <h2 id="interactionAlertHeading">${esc(t(titleKey))}</h2>
        <p class="interaction-alert-pair">${esc(interactionPairLabel(first,second))}</p>
        <p class="interaction-alert-effect">${esc(clinicalLocale(primary.pair.effect))}</p>
        <p class="interaction-alert-advice"><strong>${esc(t('interactionAlertAdvice'))}:</strong> ${esc(clinicalLocale(primary.pair.management))}</p>
        ${extra}
        <div class="interaction-alert-actions">
          <a class="interaction-alert-details" href="#interactionResult">${esc(t('interactionAlertDetails'))} <span aria-hidden="true">↓</span></a>
        </div>
        <p class="interaction-alert-note">${esc(t('interactionAlertDisclaimer'))}</p>
      </div>
    </section>`;
    slot.hidden=false;
  }
  function selectInteractionPair(a,b){
    if(interactionAgentById(a))interactionPickerA?.setSelected({kind:'agent',id:a},{silent:true});
    if(interactionAgentById(b))interactionPickerB?.setSelected({kind:'agent',id:b},{silent:true});
  }
  function checkInteraction(silent=false){
    const box=$('#interactionResult');
    if(!box||!interactionPickerA||!interactionPickerB)return;
    [interactionPickerA.input,interactionPickerB.input].forEach(input=>input?.removeAttribute('aria-invalid'));
    const a=interactionSideFromPicker(interactionPickerA),b=interactionSideFromPicker(interactionPickerB);
    if(!a||!b){
      const missing=!a?interactionPickerA:interactionPickerB,typed=Boolean(missing.value().trim());
      setInteractionStatus(typed?t('clinicalPickerChooseOne'):t('interactionChooseTwo'),'error');
      clearInteractionResult();
      if(typed){missing.input.setAttribute('aria-invalid','true');missing.focus();missing.open()}
      return;
    }
    const setA=new Set(a.agentIds),setB=new Set(b.agentIds);
    if(setA.size&&setA.size===setB.size&&[...setA].every(id=>setB.has(id))){
      setInteractionStatus(t('interactionSame'),'error');
      clearInteractionResult();
      return;
    }
    const pairs=[],skipped=[];
    for(const entry of flagInteractionPairs(a,b)){
      const key=[entry.aId,entry.bId].sort().join('|');
      if(clinicalAbsorptionPairs.has(key)){
        const blocked=[a,b].filter(side=>side.drug&&side.route!=='oral');
        if(blocked.length){skipped.push({...entry,blocked});continue}
      }
      pairs.push(entry);
    }
    const unsupported=interactionUnsupportedMessages([a,b]),cautions=interactionCautionMessages([a,b]),cards=[];
    const context=interactionContextHtml([a,b]);if(context)cards.push(context);
    const caution=interactionCautionsHtml(cautions);if(caution)cards.push(caution);
    pairs.forEach((entry,index)=>{const html=interactionPairCardHtml(entry,index);if(html)cards.push(html)});
    const notApplicable=interactionNotApplicableHtml(skipped);if(notApplicable)cards.push(notApplicable);
    if(unsupported.length)cards.push(interactionUnsupportedHtml(a,b,unsupported));
    if(!pairs.length&&!skipped.length&&!unsupported.length)cards.push(interactionNoPairHtml(a,b));
    setInteractionStatus('');
    box.innerHTML=cards.join('');
    box.querySelectorAll('[data-interaction-sources]').forEach(container=>{
      const entry=pairs[Number(container.dataset.interactionSources)];
      if(entry)renderClinicalSourceLinks(container,entry.pair.sources||[]);
    });
    box.hidden=false;interactionResultActive=true;
    renderInteractionAlert(pairs,silent);
    if(!silent&&window.innerWidth<=980)revealResult(pairs.length?$('#interactionAlert'):box);
  }
  function resetInteractionChecker(){
    interactionPickerA?.reset({silent:true});
    interactionPickerB?.reset({silent:true});
    setInteractionStatus('');
    clearInteractionResult();
    interactionPickerA?.focus();
  }
  function renderInteractionExamples(){
    const box=$('#interactionExamples');if(!box)return;
    box.innerHTML='';
    interactionExamples.forEach(([aId,bId])=>{
      const pair=findInteractionPair(aId,bId),first=interactionAgentById(aId),second=interactionAgentById(bId);
      if(!pair||!first||!second)return;
      const button=document.createElement('button');
      button.type='button';button.className=`interaction-chip severity-${pair.severity}`;
      button.innerHTML=`<span class="interaction-chip-severity">${esc(interactionSeverityLabel(pair.severity))}</span><span>${esc(interactionPairLabel(first,second))}</span>`;
      button.addEventListener('click',()=>{selectInteractionPair(aId,bId);checkInteraction()});
      box.append(button);
    });
  }
  function interactionSearchHay(pair){
    const first=interactionAgentById(pair.a),second=interactionAgentById(pair.b),bilingual=value=>value==null?'':typeof value==='string'?value:[value.en,value.ar].filter(Boolean).join(' ');
    return clean([first,second,first?.examples,second?.examples,pair.effect,pair.mechanism,pair.management].map(bilingual).join(' '));
  }
  function filteredInteractionList(){
    const query=clean($('#interactionSearch')?.value||''),severity=$('#interactionSeverity')?.value||'all';
    return interactionLibrary.filter(pair=>(severity==='all'||pair.severity===severity)&&(!query||interactionSearchHay(pair).includes(query))).sort((a,b)=>interactionSeverityRank(a.severity)-interactionSeverityRank(b.severity));
  }
  function renderInteractionList(reset=false){
    if(reset)interactionBrowseShown=8;
    const list=$('#interactionList'),more=$('#interactionMore'),count=$('#interactionBrowseCount');
    if(!list)return;
    const items=filteredInteractionList(),filtered=Boolean(($('#interactionSearch')?.value||'').trim()||($('#interactionSeverity')?.value||'all')!=='all');
    list.innerHTML='';
    if(!items.length){
      const empty=document.createElement('p');empty.className='interaction-empty';empty.textContent=t('interactionBrowseEmpty');list.append(empty);
      if(count)count.textContent='';if(more)more.hidden=true;return;
    }
    items.slice(0,interactionBrowseShown).forEach(pair=>{
      const first=interactionAgentById(pair.a),second=interactionAgentById(pair.b);
      const button=document.createElement('button');
      button.type='button';button.className=`interaction-item severity-${pair.severity}`;
      button.innerHTML=`<span class="severity-badge">${esc(interactionSeverityLabel(pair.severity))}</span><span class="interaction-item-copy"><strong>${esc(interactionPairLabel(first,second))}</strong><span>${esc(clinicalLocale(pair.effect))}</span></span><span class="interaction-item-arrow" aria-hidden="true">→</span>`;
      button.addEventListener('click',()=>{selectInteractionPair(pair.a,pair.b);checkInteraction()});
      list.append(button);
    });
    if(count)count.textContent=filtered?tf('interactionBrowseShowing',{shown:clinicalNumber(Math.min(interactionBrowseShown,items.length)),total:clinicalNumber(items.length)}):`${clinicalNumber(items.length)} ${t('interactionBrowseCount')}`;
    if(more){
      const remaining=items.length-Math.min(interactionBrowseShown,items.length);
      more.hidden=remaining<=0;
      more.textContent=`${t('showMore')} (${clinicalNumber(remaining)}) ↓`;
    }
  }
  function initDosePage(){
    if(!dosePicker){
      dosePicker=createClinicalPicker({
        picker:$('#doseMedicine')?.closest('.clinical-picker'),
        input:'#doseMedicine',toggle:'#doseMedicineToggle',list:'#doseMedicineList',hint:'#doseMedicineHint',mode:'dose',
        onSelect:()=>{if(doseResultActive)calculateDose(true);else clearDoseStatus()},
        onClear:()=>invalidateDoseResult()
      });
    }
    renderDoseSources();
  }

  let privacyBound=false;
  const PRIVACY_HOST_LABELS={'www.who.int':'privacyHostWho','api.fda.gov':'privacyHostFda','eutils.ncbi.nlm.nih.gov':'privacyHostNlm','commons.wikimedia.org':'privacyHostCommons','thumb.wikimedia.org':'privacyHostCommonsImage','upload.wikimedia.org':'privacyHostCommonsFull'};
  function privacyKeys(){
    const cfg=window.DAWAYA_PRIVACY_CONFIG,store=cfg&&cfg.storage;
    const keys=[...(store&&Array.isArray(store.localUserDataKeys)?store.localUserDataKeys:['dawaya-reminders-v1','dawaya-reminder-taken-v1','dawaya-custom-drugs-v1','dawaya-ai-chat-v1','dawaya-ai-model-state-v1','dawaya-ai-settings-v1','dawaya-calc-history','dawaya-study-stats']),'dawaya-news-v1'];
    return [...new Set(keys)];
  }
  /* The Google photograph card was retired in 1.7.7, and a key pasted into it has no
     reader left: no screen shows it, and the list above no longer names it, so delete-all
     would leave a live third-party credential on the device. Erase it on load instead. */
  (function eraseRetiredPhotoKeys(){
    for (let i=localStorage.length-1;i>=0;i-=1){
      const key=localStorage.key(i);
      if(key&&/^dawaya-photo-/i.test(key)){try{localStorage.removeItem(key)}catch(_){}}
    }
  })();
  function renderPrivacyHosts(){
    const list=$('#privacyHostList');if(!list)return;
    const net=window.DawayaNet;
    const rows=net&&typeof net.summary==='function'?net.summary().filter(entry=>entry&&entry.host&&!/^(127\.0\.0\.1|localhost)$/i.test(entry.host)):[];
    list.innerHTML='';
    rows.forEach(entry=>{
      const item=document.createElement('li'),host=document.createElement('strong'),purpose=document.createElement('span');
      host.textContent=entry.host;
      const key=PRIVACY_HOST_LABELS[entry.host];
      purpose.textContent=key?t(key):(entry.purpose||'');
      item.append(host,purpose);list.append(item);
    });
    list.hidden=!rows.length;
  }
  function renderPrivacyPage(){
    renderPrivacyHosts();
    renderPrivacyHistory();
  }
  function bindWipeButton(button,status){
    if(!button)return;
    let timer=0;
    const disarm=()=>{clearTimeout(timer);timer=0;button.dataset.armed='false';button.textContent=t('privacyWipe')};
    button.addEventListener('click',()=>{
      if(button.dataset.armed!=='true'){
        disarm();
        button.dataset.armed='true';button.textContent=t('privacyWipeConfirm');
        if(status)status.textContent='';
        timer=window.setTimeout(disarm,6000);
        return;
      }
      disarm();
      let ok=true;
      privacyKeys().forEach(key=>{try{localStorage.removeItem(key)}catch(_){ok=false}});
      customDrugs=[];
      if(status)status.textContent=t(ok?'privacyWipeDone':'privacyWipeFail');
      if(ok)window.setTimeout(()=>location.reload(),350);
    });
  }
  /* ---------- saved conversations ---------- */

  function historyApi(){return window.DawayaPrivacy||null}
  function historySavingOn(){const api=historyApi();return Boolean(api&&typeof api.historyEnabled==='function'&&api.historyEnabled())}
  function historyDate(stamp){
    const value=Number(stamp)||0;
    if(!value)return '';
    const format={day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'};
    try{return new Intl.DateTimeFormat(language==='ar'?'ar-EG':'en-GB',format).format(new Date(value))}
    catch(_){return new Date(value).toLocaleString()}
  }
  let privacyHistoryToken=0;
  function renderPrivacyHistory(){
    const toggle=$('#privacyHistory'),label=$('#privacyHistoryLabel'),list=$('#privacyHistoryList'),panel=$('#privacyHistoryPanel');
    const settingsToggle=$('#settingsHistory'),settingsLabel=$('#settingsHistoryState');
    if(!toggle&&!list&&!settingsToggle)return;
    const on=historySavingOn();
    if(toggle)toggle.checked=on;
    if(label)label.textContent=t(on?'privacyHistoryOn':'privacyHistoryOff');
    if(settingsToggle)settingsToggle.checked=on;
    if(settingsLabel)settingsLabel.textContent=t(on?'privacyHistoryOn':'privacyHistoryOff');
    if(!list)return;
    if(panel)panel.hidden=!on;
    const token=++privacyHistoryToken;
    const api=historyApi();
    const pending=api&&typeof api.listSessions==='function'?api.listSessions().catch(()=>[]):Promise.resolve([]);
    pending.then(rows=>{
      if(token!==privacyHistoryToken||!list.isConnected)return;
      list.textContent='';
      rows.forEach(row=>list.append(historyRow(row)));
      const empty=$('#privacyHistoryEmpty');
      if(empty)empty.hidden=rows.length>0||!on;
      const clear=$('#privacyHistoryClear');
      if(clear)clear.disabled=!rows.length;
    });
  }
  function historyRow(row){
    const item=document.createElement('li');
    const open=document.createElement('button');
    open.type='button';open.className='privacy-history-open';open.dataset.historyOpen=row.id;
    const title=document.createElement('strong');
    title.textContent=row.title||t('privacyHistoryUntitled');
    const meta=document.createElement('span');
    meta.textContent=`${historyDate(row.updatedAt)} · ${row.messages} ${t('privacyHistoryMessages')}`;
    open.append(title,meta);
    const remove=document.createElement('button');
    remove.type='button';remove.className='privacy-history-remove';remove.dataset.historyDelete=row.id;
    remove.textContent=t('privacyHistoryDelete');
    remove.setAttribute('aria-label',`${t('privacyHistoryDelete')}: ${title.textContent}`);
    item.append(open,remove);
    return item;
  }
  let historyDeleteArmId='',historyDeleteArmTimer=0;
  function resetHistoryDeleteArm(){
    if(historyDeleteArmTimer){clearTimeout(historyDeleteArmTimer);historyDeleteArmTimer=0}
    historyDeleteArmId='';
    document.querySelectorAll('#privacyHistoryList [data-history-delete]').forEach(button=>{button.dataset.armed='false';button.textContent=t('privacyHistoryDelete')});
  }
  function armHistoryDelete(button){
    resetHistoryDeleteArm();
    historyDeleteArmId=button.dataset.historyDelete||'';
    button.dataset.armed='true';
    button.textContent=t('privacyHistoryDeleteConfirm');
    historyDeleteArmTimer=window.setTimeout(resetHistoryDeleteArm,6000);
  }
  function historyStatus(message){const node=$('#privacyHistoryStatus');if(node)node.textContent=message}
  async function deleteSavedConversation(id){
    const api=historyApi();
    if(!api||typeof api.deleteSession!=='function')return;
    const result=await api.deleteSession(id).catch(()=>null);
    historyStatus(t(result&&result.deleted?'privacyHistoryDeleted':'privacyHistoryDeleteFail'));
    if(window.DawayaAIChat&&typeof window.DawayaAIChat.afterHistoryChange==='function')window.DawayaAIChat.afterHistoryChange();
    renderPrivacyHistory();
  }
  async function openSavedConversation(id){
    if(!id||!window.DawayaAIChat)return;
    if(typeof window.DawayaAIChat.openSession==='function')await window.DawayaAIChat.openSession(id);
    switchPage('assistant');
    announce(t('privacyHistoryOpened'));
  }
  async function handleHistoryListClick(event){
    const remove=event.target.closest('[data-history-delete]');
    if(remove){
      if(historyDeleteArmId!==remove.dataset.historyDelete){armHistoryDelete(remove);return}
      const id=remove.dataset.historyDelete;
      resetHistoryDeleteArm();
      await deleteSavedConversation(id);
      return;
    }
    const open=event.target.closest('[data-history-open]');
    if(open)await openSavedConversation(open.dataset.historyOpen);
  }
  let historyClearTimer=0;
  function disarmHistoryClear(){
    if(historyClearTimer){clearTimeout(historyClearTimer);historyClearTimer=0}
    const button=$('#privacyHistoryClear');
    if(button){button.dataset.armed='false';button.textContent=t('privacyHistoryClear')}
  }
  function bindHistoryControls(){
    const toggle=$('#privacyHistory');
    toggle?.addEventListener('change',()=>setHistorySaving(Boolean(toggle.checked)));
    const settingsToggle=$('#settingsHistory');
    settingsToggle?.addEventListener('change',()=>setHistorySaving(Boolean(settingsToggle.checked)));
    const list=$('#privacyHistoryList');
    list?.addEventListener('click',handleHistoryListClick);
    const clear=$('#privacyHistoryClear');
    clear?.addEventListener('click',async()=>{
      if(clear.dataset.armed!=='true'){
        disarmHistoryClear();
        clear.dataset.armed='true';clear.textContent=t('privacyHistoryClearConfirm');
        historyClearTimer=window.setTimeout(disarmHistoryClear,6000);
        return;
      }
      disarmHistoryClear();
      const api=historyApi();
      if(!api||typeof api.clearHistory!=='function')return;
      await api.clearHistory().catch(()=>{});
      historyStatus(t('privacyHistoryCleared'));
      if(window.DawayaAIChat&&typeof window.DawayaAIChat.afterHistoryChange==='function')window.DawayaAIChat.afterHistoryChange();
      renderPrivacyHistory();
    });
  }
  function setHistorySaving(enabled){
    const api=historyApi();
    if(!api||typeof api.setHistoryEnabled!=='function')return false;
    const on=api.setHistoryEnabled(Boolean(enabled));
    renderPrivacyHistory();
    renderSettingsPage();
    if(window.DawayaAIChat&&typeof window.DawayaAIChat.afterHistoryChange==='function')window.DawayaAIChat.afterHistoryChange();
    historyStatus(t(on?'privacyHistoryKept':'privacyHistoryErased'));
    announce(t(on?'privacyHistoryOn':'privacyHistoryOff'));
    return on;
  }
  function initPrivacyPage(){
    renderPrivacyPage();
    if(privacyBound)return;
    privacyBound=true;
    bindWipeButton($('#privacyWipe'),$('#privacyWipeStatus'));
    bindHistoryControls();
  }

  let settingsBound=false;
  function renderSettingsSummary(){
    const preference=currentThemePreference();
    const label=t(preference==='system'?'themeSystem':(preference==='dark'?'themeDark':'themeLight'));
    const percent=core?.typeScale?core.typeScale.percent():Math.round(Number(document.documentElement.dataset.typeScalePercent||100));
    document.querySelectorAll('[data-settings-summary]').forEach(node=>{node.textContent=`${label} · ${percent}%`});
  }
  function renderSettingsPage(){
    const preference=currentThemePreference();
    document.querySelectorAll('[data-settings-theme]').forEach(button=>{const active=button.dataset.settingsTheme===preference;button.setAttribute('aria-checked',String(active));button.classList.toggle('is-active',active)});
    document.querySelectorAll('[data-settings-language]').forEach(button=>{const active=button.dataset.settingsLanguage===language;button.setAttribute('aria-checked',String(active));button.classList.toggle('is-active',active)});
    const version=$('#settingsVersion'),about=document.querySelector('.app-version strong');
    if(version)version.textContent=about?`Drugcopeia ${about.textContent.trim()}`:'Drugcopeia';
    const historyToggle=$('#settingsHistory'),historyLabel=$('#settingsHistoryState');
    if(historyToggle)historyToggle.checked=historySavingOn();
    if(historyLabel)historyLabel.textContent=t(historySavingOn()?'privacyHistoryOn':'privacyHistoryOff');
    renderSettingsSummary();
  }
  function initSettingsPage(){
    renderSettingsPage();
    if(settingsBound)return;
    settingsBound=true;
    const theme=$('#settingsTheme');
    theme?.addEventListener('click',event=>{
      const button=event.target.closest('[data-settings-theme]');if(!button)return;
      const choice=button.dataset.settingsTheme;
      setThemePreference(choice);
      announce(t(choice==='system'?'themeSystem':(choice==='dark'?'themeDark':'themeLight')));
    });
    const languageGroup=$('#settingsLanguage');
    languageGroup?.addEventListener('click',event=>{
      const button=event.target.closest('[data-settings-language]');if(!button)return;
      setLanguage(button.dataset.settingsLanguage);
    });
    bindWipeButton($('#settingsWipe'),$('#settingsWipeStatus'));
  }

  function initInteractionsPage(){
    if(!interactionPickerA)interactionPickerA=createClinicalPicker({
      picker:$('#interactionA')?.closest('.clinical-picker'),
      input:'#interactionA',toggle:'#interactionAToggle',list:'#interactionAList',hint:'#interactionAExamples',mode:'interactions',
      onSelect:()=>{setInteractionStatus('');clearInteractionResult()},
      onClear:()=>{setInteractionStatus('');clearInteractionResult()}
    });
    if(!interactionPickerB)interactionPickerB=createClinicalPicker({
      picker:$('#interactionB')?.closest('.clinical-picker'),
      input:'#interactionB',toggle:'#interactionBToggle',list:'#interactionBList',hint:'#interactionBExamples',mode:'interactions',
      onSelect:()=>{setInteractionStatus('');clearInteractionResult()},
      onClear:()=>{setInteractionStatus('');clearInteractionResult()}
    });
    renderInteractionSources();
    renderInteractionExamples();
    renderInteractionList();
  }
  function refreshClinicalLanguage(){
    if(!$('#dosePage')||!$('#interactionsPage'))return;
    clinicalPickers.forEach(picker=>picker.refresh());
    renderDoseSources();
    renderInteractionSources();
    renderInteractionExamples();
    renderInteractionList();
    if(doseResultActive)calculateDose(true);
    if(interactionResultActive)checkInteraction(true);
  }
  function reminderStatusLabel(state){
    return state==='taken'?t('reminderStatusTaken'):state==='due'?t('reminderStatusDue'):state==='overdue'?t('reminderStatusOverdue'):t('reminderStatusUpcoming');
  }
  function reminderIcon(name){
    return `<svg class="reminder-icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-${name}"></use></svg>`;
  }
  let reminderRemoveArmTimer=0;
  function clearReminderRemovalArm(){if(reminderRemoveArmTimer){clearTimeout(reminderRemoveArmTimer);reminderRemoveArmTimer=0}}
  /* Native dialogs freeze the packaged WebViews, so removal confirms inline:
     the first tap re-labels the button and a second tap within the window deletes. */
  function armReminderRemoval(button,entry){
    clearReminderRemovalArm();
    const name=esc(entry.name);
    button.classList.add('is-armed');
    button.innerHTML=`<span>${esc(t('reminderRemoveConfirm'))}</span>`;
    button.setAttribute('aria-label',`${esc(t('reminderRemoveConfirm'))}: ${name}`);
    reminderRemoveArmTimer=window.setTimeout(()=>{
      reminderRemoveArmTimer=0;
      if(!button.isConnected)return;
      button.classList.remove('is-armed');
      button.innerHTML=reminderIcon('trash');
      button.setAttribute('aria-label',`${esc(t('reminderRemove'))}: ${name}`);
    },6000);
  }
  function reminderActionsHtml(entry,index){
    const name=esc(entry.name);
    return `<div class="reminder-actions">
      <button type="button" class="reminder-taken-button${entry.taken?' is-taken':''}" data-reminder-taken="${index}" aria-pressed="${entry.taken}" aria-label="${esc(entry.taken?t('reminderTakenUndo'):t('reminderTakenAction'))}: ${name}">${reminderIcon('check')}<span>${esc(entry.taken?t('reminderStatusTaken'):t('reminderTakenAction'))}</span></button>
      <button type="button" class="reminder-icon-button reminder-remove" data-reminder-remove="${index}" aria-label="${esc(t('reminderRemove'))}: ${name}">${reminderIcon('trash')}</button>
    </div>`;
  }
  function updateReminderSummary(schedule){
    const nextNode=$('#reminderNext'),progress=$('#reminderProgress'),bar=$('#reminderProgressBar'),progressText=$('#reminderProgressText');
    if(!nextNode||!progress||!bar||!progressText)return;
    const dueEntry=schedule.entries.find(entry=>entry.state==='due');
    const next=dueEntry?{reminder:dueEntry,minutesUntil:dueEntry.minutesUntil,dayOffset:0}:reminderStore?.next(new Date());
    let message=t('reminderNoNext');
    if(!schedule.total)message=t('reminderNoReminders');
    else if(schedule.takenCount===schedule.total)message=t('reminderAllTaken');
    else if(dueEntry)message=tf('reminderNextDue',{name:dueEntry.name,time:dueEntry.time});
    else if(next)message=tf(next.dayOffset?'reminderNextTomorrow':'reminderNextDose',{name:next.reminder.name,time:next.reminder.time});
    nextNode.textContent=message;
    const percent=Math.round(schedule.progress*100);
    progress.setAttribute('aria-valuenow',String(percent));
    progress.setAttribute('aria-valuetext',schedule.total?tf('reminderProgressAria',{taken:schedule.takenCount,total:schedule.total}):'');
    bar.style.width=`${percent}%`;
    progressText.textContent=schedule.total?tf('reminderProgressText',{taken:schedule.takenCount,total:schedule.total}):'';
    const limit=core?.reminders?.LIMIT||20;
    const limitNode=$('#reminderLimit');if(limitNode)limitNode.textContent=tf('reminderLimitCount',{count:schedule.total,limit});
    const submit=$('#reminderForm')?.querySelector('button[type="submit"]');
    if(submit){const disabled=schedule.total>=limit;submit.disabled=disabled;submit.setAttribute('aria-disabled',String(disabled))}
  }
  function reminderStateSignature(schedule){
    return schedule.entries.map(entry=>`${entry.id}:${entry.state}`).join('|');
  }
  const reminderNotifications=(()=>{
    const nativeShell=document.documentElement.hasAttribute('data-native-shell');
    const supported=!nativeShell&&typeof window.Notification==='function';
    const DAY=86400000;
    let timer=0,target=null,audio=null;
    const permission=()=>{try{return window.Notification.permission}catch(_){return 'denied'}};
    const ready=()=>supported&&permission()==='granted';
    const reminders=()=>reminderStore?reminderStore.list().filter(item=>core.reminders.parseTime(item.time)!==null):[];
    const clearTimer=()=>{if(timer)clearTimeout(timer);timer=0;target=null};
    function requestPermission(){
      if(!supported||permission()!=='default')return Promise.resolve(permission());
      try{
        const result=window.Notification.requestPermission();
        if(result&&typeof result.then==='function')return result.catch(()=>permission());
        return new Promise(resolve=>window.Notification.requestPermission(resolve));
      }catch(_){return Promise.resolve(permission())}
    }
    /* A browser notification is silent, so the long dose chime is synthesised
       here. Every note is scheduled once and the whole run lasts ~10 seconds. */
    function playAlertTone(){
      try{
        const Ctor=window.AudioContext||window.webkitAudioContext;
        if(!Ctor)return;
        if(!audio)audio=new Ctor();
        if(audio.state!=='running'){audio.resume().catch(()=>{});if(audio.state!=='running')return}
        const onset=0.62,phrase=onset*3+0.55,at=audio.currentTime+0.05;
        [784,988,1175].forEach((frequency,note)=>{
          for(let pass=0;pass<4;pass++){
            const start=at+pass*phrase+note*onset;
            const oscillator=audio.createOscillator(),gain=audio.createGain();
            oscillator.type='sine';
            oscillator.frequency.value=frequency;
            gain.gain.setValueAtTime(0.0001,start);
            gain.gain.exponentialRampToValueAtTime(0.3,start+0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001,start+0.5);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start(start);
            oscillator.stop(start+0.52);
          }
        });
      }catch(_){}
    }
    // A dose confirmed for today keeps its daily alert but drops the follow-ups.
    function slots(){
      const offsets=core.reminders.ESCALATION_MINUTES||[0];
      const out=[];
      reminders().forEach(item=>{
        const base=core.reminders.parseTime(item.time);
        (reminderStore.isTaken(item.id)?[0]:offsets).forEach(offset=>{
          out.push({minutes:(base+offset)%1440,item,offset});
        });
      });
      return out;
    }
    function show(slot){
      try{
        const prefix=slot.offset>0?(language==='ar'?'لم يُؤخذ بعد — ':'Still pending — '):'';
        const detail=slot.item.dose?`${slot.item.dose} · ${slot.item.time}`:slot.item.time;
        playAlertTone();
        const notification=new window.Notification(prefix+slot.item.name,{body:prefix+detail,icon:'assets/red-crescent-rx-192.png',tag:`dawaya-reminder-${slot.item.id}-${slot.offset}`,dir:language==='ar'?'rtl':'ltr',lang:language,requireInteraction:true});
        notification.onclick=()=>{try{window.focus();notification.close()}catch(_){}};
      }catch(_){}
    }
    function fire(){
      const due=target;
      timer=0;target=null;
      if(ready()&&due!==null)slots().forEach(slot=>{if(slot.minutes===due)show(slot)});
      schedule();
    }
    function schedule(){
      clearTimer();
      if(!ready())return;
      const now=new Date(),current=now.getHours()*60+now.getMinutes();
      let best=null;
      slots().forEach(slot=>{
        let delay=(slot.minutes-current)*60000-now.getSeconds()*1000-now.getMilliseconds();
        if(delay<1000)delay+=DAY;
        if(delay>DAY)delay=DAY;
        if(best===null||delay<best.delay)best={delay,minutes:slot.minutes};
      });
      if(!best)return;
      target=best.minutes;
      timer=window.setTimeout(fire,Math.max(1000,best.delay));
    }
    if(supported){
      /* Browsers refuse to start an AudioContext outside a gesture, so the very
         first tap opens the one the alert chime needs later on. */
      const unlockAudio=()=>{
        try{
          const Ctor=window.AudioContext||window.webkitAudioContext;
          if(!Ctor)return;
          if(!audio)audio=new Ctor();
          if(audio.state!=='running')audio.resume().catch(()=>{});
        }catch(_){}
      };
      window.addEventListener('pointerdown',unlockAudio,{once:true});
      window.addEventListener('pageshow',()=>schedule());
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});
      schedule();
    }
    return {supported,schedule,requestPermission:()=>requestPermission().then(()=>{schedule();return permission()})};
  })();
  function renderReminders(){
    if(!reminderStore)return;
    const schedule=reminderStore.schedule(new Date());
    reminderCurrentEntries=schedule.entries;
    reminderRenderDate=schedule.date;
    reminderScheduleSignature=reminderStateSignature(schedule);
    updateReminderSummary(schedule);
    const count=$('#remindersTimelineCount');
    if(count)count.textContent=schedule.total?tf('reminderTimelineCount',{count:schedule.total}):'';
    const empty=$('#reminderEmpty'),feed=$('#reminderFeed'),tableWrap=$('#reminderTableWrap');
    if(empty)empty.hidden=schedule.total>0;
    if(feed){feed.hidden=schedule.total===0;feed.innerHTML=schedule.entries.map((entry,index)=>`<article class="reminder-feed-item" data-state="${entry.state}" data-reminder-index="${index}">
      <div class="reminder-feed-time"><time datetime="${entry.time}" dir="ltr">${esc(entry.time)}</time><span class="reminder-state-chip" data-state="${entry.state}">${esc(reminderStatusLabel(entry.state))}</span></div>
      <div class="reminder-feed-copy"><h3>${esc(entry.name)}</h3>${entry.dose?`<p>${esc(entry.dose)}</p>`:''}</div>
      ${reminderActionsHtml(entry,index)}
    </article>`).join('')}
    const tableBody=$('#reminderTableBody');
    if(tableWrap)tableWrap.hidden=schedule.total===0;
    if(tableBody)tableBody.innerHTML=schedule.entries.map((entry,index)=>`<tr data-state="${entry.state}" data-reminder-index="${index}">
      <th scope="row"><time datetime="${entry.time}" dir="ltr">${esc(entry.time)}</time></th>
      <td><strong>${esc(entry.name)}</strong></td>
      <td>${entry.dose?esc(entry.dose):'<span class="reminder-muted">—</span>'}</td>
      <td><span class="reminder-state-chip" data-state="${entry.state}">${esc(reminderStatusLabel(entry.state))}</span></td>
      <td class="reminder-table-actions">${reminderActionsHtml(entry,index)}</td>
    </tr>`).join('');
    reminderNotifications.schedule();
  }
  function syncReminderStates(){
    if(!reminderStore||!$('#remindersPage')||$('#remindersPage').hidden)return;
    const schedule=reminderStore.schedule(new Date());
    if(schedule.date!==reminderRenderDate){renderReminders();return}
    const signature=reminderStateSignature(schedule);
    if(signature===reminderScheduleSignature)return;
    reminderScheduleSignature=signature;
    reminderCurrentEntries=schedule.entries;
    schedule.entries.forEach((entry,index)=>{
      document.querySelectorAll(`.reminder-feed-item[data-reminder-index="${index}"], #reminderTableBody tr[data-reminder-index="${index}"]`).forEach(row=>{
        row.dataset.state=entry.state;
        const chip=row.querySelector('.reminder-state-chip');
        if(chip){chip.dataset.state=entry.state;chip.textContent=reminderStatusLabel(entry.state)}
      });
    });
    updateReminderSummary(schedule);
  }
  function focusReminderControl(index,kind){
    const target=[...document.querySelectorAll(`[data-reminder-${kind}="${index}"]`)].find(control=>control.getClientRects().length);
    if(target)target.focus({preventScroll:true});
  }
  function showReminderStatus(message,state){
    const node=$('#remindersStatus');if(!node)return;
    if(!message){node.hidden=true;node.textContent='';return}
    node.hidden=false;node.dataset.state=state||'notice';node.textContent=message;
  }
  function initRemindersPage(){
    if(!reminderStore)return;
    const time=$('#reminderTime');
    if(time&&!time.value)time.value=core.reminders.defaultTime();
    renderReminders();
    if(!reminderTimer)reminderTimer=window.setInterval(syncReminderStates,30000);
  }
  $('#reminderForm')?.addEventListener('submit',event=>{
    event.preventDefault();
    if(!reminderStore)return;
    const status=$('#reminderFormStatus'),nameField=$('#reminderName'),doseField=$('#reminderDose'),timeField=$('#reminderTime');
    const nameGuard=sanitizeUserText(nameField.value.trim().replace(/\s+/g,' ')),doseGuard=sanitizeUserText(doseField.value.trim().replace(/\s+/g,' '));
    if(nameGuard.removed||doseGuard.removed){showPrivacyNotice();nameField.value=nameGuard.text;doseField.value=doseGuard.text}
    const name=nameGuard.text,dose=doseGuard.text,time=timeField.value;
    const fail=(message,state,target)=>{status.hidden=false;status.dataset.state=state||'error';status.textContent=message;target?.focus();announce(message)};
    if(!name||core.reminders.parseTime(time)===null){fail(t('reminderInvalid'),'error',name?timeField:nameField);return}
    if(reminderStore.list().some(item=>item.time===time&&item.name.toLocaleLowerCase()===name.toLocaleLowerCase())){fail(t('reminderDuplicate'),'warning',nameField);return}
    const result=reminderStore.add({name,dose,time});
    if(!result.ok){fail(result.reason==='limit'?tf('reminderLimitReached',{limit:core.reminders.LIMIT}):t('reminderInvalid'),'warning');return}
    status.hidden=false;status.dataset.state='success';status.textContent=tf('reminderAdded',{name,time});
    nameField.value='';doseField.value='';timeField.value=core.reminders.defaultTime();
    reminderNotifications.requestPermission().then(()=>renderReminders());
    renderReminders();nameField.focus();announce(tf('reminderAdded',{name,time}));
  });
  $('#reminderForm')?.addEventListener('input',()=>{const status=$('#reminderFormStatus');if(status&&status.dataset.state!=='success')status.hidden=true});
  /* The reminder form offers the same medicine index the search box uses, so the
     reader picks a registered pack instead of typing a name from memory. Choosing a
     suggestion fills the name and writes a note from the database record — active
     substance, dosage form and company — because the directory holds no posology,
     and those are the parts of a dose a reminder can honestly carry. The time stays
     the reader's own choice. */
  const reminderNameField=$('#reminderName'),reminderSuggestionBox=$('#reminderSuggestions');
  let reminderSuggestionItems=[],reminderSuggestionActive=-1;
  function hideReminderSuggestions(){
    if(!reminderSuggestionBox)return;
    reminderSuggestionBox.hidden=true;reminderSuggestionBox.innerHTML='';
    reminderSuggestionItems=[];reminderSuggestionActive=-1;
    reminderNameField?.setAttribute('aria-expanded','false');
  }
  function highlightReminderSuggestion(){
    if(!reminderSuggestionBox)return;
    const options=[...reminderSuggestionBox.querySelectorAll('.suggestion')];
    options.forEach((option,index)=>{
      const active=index===reminderSuggestionActive;
      option.classList.toggle('active',active);
      option.setAttribute('aria-selected',String(active));
    });
    /* Arrow keys must not leave the marked row outside a list the keyboard had to
       shorten: the panel scrolls itself, and the page under it stays where it was. */
    const current=options[reminderSuggestionActive];
    if(current){
      const panel=reminderSuggestionBox.getBoundingClientRect(),row=current.getBoundingClientRect();
      if(row.top<panel.top)reminderSuggestionBox.scrollTop-=panel.top-row.top+6;
      else if(row.bottom>panel.bottom)reminderSuggestionBox.scrollTop+=row.bottom-panel.bottom+6;
    }
  }
  /* The directory keeps ingredients in capitals with plus signs and brackets, and the
     note is read back to the reader inside an alert, so it is written as words. Text
     the reader typed themselves already reads as words and stays untouched. */
  function readableIngredient(raw){
    const text=String(raw ?? '').replace(/\s+/g,' ').trim();
    if(!/[a-z]/i.test(text))return text;
    if(text.toLowerCase()!==text&&text.toUpperCase()!==text)return text;
    return text.toLowerCase().replace(/\+/g,' + ').replace(/\(/g,' (')
      .replace(/(^|[ (\-])([a-zA-Z])/g,(match,separator,letter)=>separator+letter.toUpperCase()).trim();
  }
  /* The dose note carries what a reminder can honestly repeat: the active substance,
     the form and the company, in that order. A part is left out when the line would
     run past the field instead of being cut mid-word. */
  function reminderDoseNote(drug){
    const parts=[readableIngredient(val(drug,'scientific_name')||val(drug,'custom_concentration')),
      val(drug,'route')?routeLabel(val(drug,'route')):'',val(drug,'manufacturer')].filter(Boolean);
    let note='';
    for(const part of parts){
      const next=note?`${note} · ${part}`:part;
      if(next.length>80)break;
      note=next;
    }
    return note;
  }
  function applyReminderSuggestion(drug){
    const doseField=$('#reminderDose'),timeField=$('#reminderTime');
    reminderNameField.value=brandEn(drug)||val(drug,'commercial_name_ar')||'';
    if(doseField)doseField.value=reminderDoseNote(drug);
    if(timeField&&!timeField.value)timeField.value=core.reminders.defaultTime();
    hideReminderSuggestions();
    (timeField||reminderNameField).focus();
  }
  /* A soft keyboard shrinks the visible area from the bottom, and on a phone the
     reminder form sits below the day's timeline, so a list that always opened
     downwards can end up wholly behind the keyboard — which reads as “no medicines
     appeared”. The panel is measured against the visible viewport, the field is
     brought into it first, and the list opens on the side with the room. */
  let placingReminderList=false;
  function placeReminderSuggestions(){
    if(!reminderSuggestionBox||reminderSuggestionBox.hidden||placingReminderList)return;
    const box=reminderSuggestionBox,safe=8;
    const viewport=window.visualViewport;
    const visibleTop=viewport?viewport.offsetTop:0;
    const visibleBottom=visibleTop+(viewport?viewport.height:window.innerHeight);
    let field=reminderNameField.getBoundingClientRect();
    if(field.bottom>visibleBottom-safe||field.top<visibleTop+safe){
      placingReminderList=true;
      reminderNameField.scrollIntoView({block:'center'});
      field=reminderNameField.getBoundingClientRect();
      placingReminderList=false;
    }
    box.classList.remove('reminder-suggestions-up');box.style.maxHeight='';
    const height=box.getBoundingClientRect().height;
    const roomBelow=visibleBottom-safe-(field.bottom+14),roomAbove=field.top-14-(visibleTop+safe);
    if(height>roomBelow&&roomAbove>roomBelow)box.classList.add('reminder-suggestions-up');
    const room=box.classList.contains('reminder-suggestions-up')?roomAbove:roomBelow;
    if(room<height)box.style.maxHeight=`${Math.max(96,Math.round(room))}px`;
  }
  /* The field is free text, so an unknown name is not an error: the list says it
     found nothing and lets the reader keep typing. While the database is still
     opening it says so instead of staying silent. */
  function showReminderSuggestionNote(message){
    reminderSuggestionItems=[];reminderSuggestionActive=-1;
    reminderSuggestionBox.innerHTML=`<p class="reminder-suggestion-note" aria-hidden="true">${esc(message)}</p>`;
    reminderSuggestionBox.hidden=false;
    reminderNameField.setAttribute('aria-expanded','true');
    placeReminderSuggestions();
  }
  function renderReminderSuggestions(){
    if(!reminderNameField||!reminderSuggestionBox)return;
    const query=reminderNameField.value.trim();
    if(!query){hideReminderSuggestions();return}
    if(!drugs.length){showReminderSuggestionNote(loadFailed?t('databaseError'):t('builtInLoading'));return}
    reminderSuggestionItems=suggestionCandidates(query);
    reminderSuggestionActive=-1;
    if(!reminderSuggestionItems.length){showReminderSuggestionNote(t('noResults'));return}
    reminderSuggestionBox.innerHTML=`<div class="suggestion-label">${esc(t('medicineMatches'))}</div>`+reminderSuggestionItems.map((drug,i)=>{
      const price=priceText(drug),en=brandEn(drug),ar=val(drug,'commercial_name_ar');
      const arabicName=ar&&clean(ar)!==clean(en||'')?ar:'';
      const meta=[val(drug,'scientific_name'),val(drug,'manufacturer')].filter(Boolean).join(' · ');
      return `<button type="button" class="suggestion" role="option" aria-selected="false" data-reminder-suggestion="${i}"><span class="suggestion-icon">⌕</span><span class="suggestion-copy"><span class="suggestion-name">${esc(en||arabicName||t('medicine'))}</span>${arabicName?`<span class="suggestion-name-ar" lang="ar" dir="rtl">${esc(arabicName)}</span>`:''}<span class="suggestion-meta">${esc(meta)}</span></span>${price?`<span class="suggestion-price">${esc(price)} EGP</span>`:''}</button>`;
    }).join('');
    reminderSuggestionBox.querySelectorAll('[data-reminder-suggestion]').forEach(button=>{
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',()=>applyReminderSuggestion(reminderSuggestionItems[Number(button.dataset.reminderSuggestion)]));
    });
    reminderSuggestionBox.hidden=false;
    reminderNameField.setAttribute('aria-expanded','true');
    placeReminderSuggestions();
  }
  reminderNameField?.addEventListener('input',renderReminderSuggestions);
  reminderNameField?.addEventListener('focus',renderReminderSuggestions);
  reminderNameField?.addEventListener('blur',()=>window.setTimeout(hideReminderSuggestions,120));
  reminderNameField?.addEventListener('keyup',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp')placeReminderSuggestions()});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',placeReminderSuggestions);
    window.visualViewport.addEventListener('scroll',placeReminderSuggestions);
  }
  window.addEventListener('resize',placeReminderSuggestions,{passive:true});
  window.addEventListener('scroll',placeReminderSuggestions,{passive:true});
  reminderNameField?.addEventListener('keydown',event=>{
    if(reminderSuggestionBox?.hidden)return;
    const count=reminderSuggestionItems.length;
    if(!count)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      reminderSuggestionActive=(reminderSuggestionActive+(event.key==='ArrowDown'?1:-1)+count)%count;
      highlightReminderSuggestion();
      return;
    }
    if(event.key==='Enter'&&reminderSuggestionActive>=0){event.preventDefault();applyReminderSuggestion(reminderSuggestionItems[reminderSuggestionActive]);return}
    if(event.key==='Escape'){event.preventDefault();hideReminderSuggestions()}
  });
  $('#remindersPage')?.addEventListener('click',event=>{
    if(!reminderStore)return;
    const schedule=reminderStore.schedule(new Date());
    const takenButton=event.target.closest('[data-reminder-taken]');
    if(takenButton){
      const index=Number(takenButton.dataset.reminderTaken),entry=schedule.entries[index];if(!entry)return;
      const isTaken=reminderStore.toggleTaken(entry.id);
      renderReminders();
      const message=tf(isTaken?'reminderTakenAnnounce':'reminderUntakenAnnounce',{name:entry.name});
      showReminderStatus(message,'success');announce(message);focusReminderControl(index,'taken');
      return;
    }
    const removeButton=event.target.closest('[data-reminder-remove]');
    if(removeButton){
      const index=Number(removeButton.dataset.reminderRemove),entry=schedule.entries[index];if(!entry)return;
      if(!removeButton.classList.contains('is-armed')){armReminderRemoval(removeButton,entry);return}
      clearReminderRemovalArm();
      if(reminderStore.remove(entry.id)){
        renderReminders();
        const message=tf('reminderRemoved',{name:entry.name});
        showReminderStatus(message,'notice');announce(message);
        const remaining=reminderStore.list().length;
        if(remaining)focusReminderControl(Math.min(index,remaining-1),'remove');
        else $('#reminderName')?.focus();
      }
    }
  });
  document.addEventListener('dawaya:dataset-updated',()=>{
    clinicalDbIndex=null;clinicalDbQueryCache.clear();
    clinicalPickers.forEach(picker=>picker.refresh());
    if(doseResultActive)calculateDose(true);
    if(interactionResultActive)checkInteraction(true);
  });
  $('#doseForm')?.addEventListener('submit',event=>{event.preventDefault();calculateDose()});
  $('#doseReset')?.addEventListener('click',resetDoseForm);
  $('#doseMedicine')?.addEventListener('input',()=>{
    const status=$('#doseStatus');
    if(status?.dataset.state==='error')clearDoseStatus();
  });
  ['#doseWeight','#doseAge','#doseConcentration','#doseAgeUnit'].forEach(selector=>{
    const field=$(selector);if(!field)return;
    field.addEventListener('input',invalidateDoseResult);
    field.addEventListener('change',invalidateDoseResult);
  });
  $('#interactionCheck')?.addEventListener('click',()=>checkInteraction());
  $('#interactionReset')?.addEventListener('click',resetInteractionChecker);
  function swapInteractionSides(){
    if(!interactionPickerA||!interactionPickerB)return;
    const aSelection=interactionPickerA.selected(),bSelection=interactionPickerB.selected();
    const aText=interactionPickerA.value(),bText=interactionPickerB.value();
    interactionPickerA.setSelected(bSelection,{silent:true});
    interactionPickerB.setSelected(aSelection,{silent:true});
    if(!bSelection&&bText)interactionPickerA.input.value=bText;
    if(!aSelection&&aText)interactionPickerB.input.value=aText;
    interactionPickerA.input.removeAttribute('aria-invalid');interactionPickerB.input.removeAttribute('aria-invalid');
    setInteractionStatus('');
    if(interactionResultActive)checkInteraction(true);else clearInteractionResult();
  }
  $('#interactionSwap')?.addEventListener('click',swapInteractionSides);
  ['#interactionA','#interactionB'].forEach(selector=>$(selector)?.addEventListener('input',()=>setInteractionStatus('')));
  $('#interactionSearch')?.addEventListener('input',()=>renderInteractionList(true));
  $('#interactionSeverity')?.addEventListener('change',()=>renderInteractionList(true));
  $('#interactionMore')?.addEventListener('click',()=>{interactionBrowseShown+=8;renderInteractionList()});
  const drawer=$('#drawerBackdrop');
  let drawerReturnFocus=null,drawerPreviousOverflow='';
  function updateMenuToggleLabel(){
    const expanded=$('#menuToggle').getAttribute('aria-expanded')==='true';
    $('#menuToggle').setAttribute('aria-label',language==='ar'?(expanded?'إغلاق القائمة':'فتح القائمة'):(expanded?'Close navigation':'Open navigation'));
  }
  function overlayFocusable(container){
    return [...container.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length);
  }
  function trapOverlayFocus(event,container){
    if(event.key!=='Tab')return;
    const items=overlayFocusable(container);if(!items.length)return;
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  function restoreOverlayFocus(preferred,fallback){
    const usable=element=>element&&element!==document.body&&element.isConnected&&element.getClientRects().length;
    const target=usable(preferred)?preferred:(usable(fallback)?fallback:null);
    if(target)target.focus({preventScroll:true});
  }
  function openDrawer(){
    if(!drawer.hidden)return;
    drawerReturnFocus=document.activeElement&&document.activeElement!==document.body?document.activeElement:null;
    drawerPreviousOverflow=document.body.style.overflow;
    drawer.hidden=false;document.body.style.overflow='hidden';
    $('#menuToggle').setAttribute('aria-expanded','true');updateMenuToggleLabel();
    $('#menuClose')?.focus({preventScroll:true});
  }
  function closeDrawer(){
    if(drawer.hidden)return;
    drawer.hidden=true;
    $('#menuToggle').setAttribute('aria-expanded','false');updateMenuToggleLabel();
    document.body.style.overflow=drawerPreviousOverflow;
    const preferred=drawerReturnFocus;drawerReturnFocus=null;
    restoreOverlayFocus(preferred,$('#menuToggle'));
  }
  $('#menuToggle').addEventListener('click',openDrawer);
  $('#menuClose').addEventListener('click',closeDrawer);
  drawer.addEventListener('click',event=>{if(event.target===drawer)closeDrawer()});
  drawer.addEventListener('keydown',event=>trapOverlayFocus(event,drawer));
  function runAppNavigation(action,fromDrawer=false){
    if(!action)return;
    if(action==='unified-search'){switchPage('medicines','home');if(fromDrawer)input.focus()}
    else if(action==='medicine-list')switchPage('medicines','medicine-list');
    else if(action==='condition-list')switchPage('conditions','condition-list');
    else if(action==='lab-tests')switchPage('lab-tests','lab-tests');
    else if(action==='dose-calculator')switchPage('dose-calculator','dose-calculator');
    else if(action==='interactions')switchPage('interactions','interactions');
    else if(action==='reminders')switchPage('reminders','reminders');
    else if(action==='pregnancy')switchPage('pregnancy','pregnancy');
    else if(action==='calculators')switchPage('calculators','calculators');
    else if(action==='study')switchPage('study','study');
    else if(action==='about')switchPage('about','about');
    else if(action==='privacy')switchPage('privacy','privacy');
    else if(action==='settings')switchPage('settings','settings');
    else if(action==='assistant')switchPage('assistant','assistant');
    else if(action==='suggestions'){switchPage('suggestions','suggestions');$('#suggestionSubject').focus()}
  }
  document.querySelectorAll('[data-drawer-action],[data-app-nav]').forEach(button=>button.addEventListener('click',event=>{
    if(button.tagName==='A')event.preventDefault();
    const fromDrawer=Boolean(button.closest('.app-drawer'));
    if(fromDrawer)closeDrawer();
    runAppNavigation(button.dataset.drawerAction||button.dataset.appNav,fromDrawer);
  }));
  /* Every remote page — a news headline, a reference link, a source citation, a
     scanned code, a pack photograph — opens in the device's own browser component
     presented over Drugcopeia: SFSafariViewController on iPhone, a Custom Tab on
     Android, an ephemeral window on macOS, a separate browser window on Windows.
     The reader keeps the page they came from, and that view carries a visible
     control that hands the same address to the device's default browser. Drugcopeia
     reads nothing from the view: no cookies, no history, no page content.
     Offline mode is checked here, in the page, because that is the one place all
     four shells — including the plain web build, which has no native layer at all —
     answer the same way. A view the shell refused is never retried elsewhere. */
  function openExternal(url){
    let parsed;try{parsed=new URL(url)}catch(_){return}
    if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')return;
    if(window.DawayaNet?.isOffline?.()){showPrivacyNotice(t('offlineBrowserBlocked'));return}
    const nativeBridge=window.DawayaNative;
    if(nativeBridge&&typeof nativeBridge.openInAppBrowser==='function'){
      Promise.resolve(nativeBridge.openInAppBrowser(parsed.href,language)).then(result=>{
        if(result&&result.target==='blocked')return;
        if(!result||!result.presented)openSystemBrowser(parsed.href);
      }).catch(()=>openSystemBrowser(parsed.href));
      return;
    }
    openSystemBrowser(parsed.href);
  }
  /* A shell that presents no browser view — the plain web build in a desktop
     browser, or an older install — sends the address to the system browser
     instead, which is what it always did. */
  function openSystemBrowser(href){
    const nativeBridge=window.DawayaNative;
    if(nativeBridge&&typeof nativeBridge.openWebPage==='function'){nativeBridge.openWebPage(href);return}
    const tab=window.open(href,'_blank','noopener');
    if(tab){try{tab.opener=null}catch(_){}return}
    if(typeof location!=='undefined')location.href=href;
  }
  document.addEventListener('click',event=>{
    if(event.defaultPrevented)return;
    const anchor=event.target.closest('a[href]');
    if(!anchor)return;
    let target;try{target=new URL(anchor.href)}catch(_){event.preventDefault();return}
    if(target.protocol!=='http:'&&target.protocol!=='https:'){event.preventDefault();return}
    if(target.origin!==location.origin){
      event.preventDefault();openExternal(target.href);
    }
  });
  /* Home reading list: official drug news plus curated articles. Live items
     come from DawayaNews (WHO, FDA, PubMed); a live card always carries the
     publisher's URL and opens there, while curated Drugcopeia articles keep their
     in-app reader. */
  const curatedReading=Array.isArray(window.DAWAYA_READING?.items)?window.DAWAYA_READING.items:[];
  let readingFilter='all';
  const readingText=value=>typeof value==='string'?value:String(value?.[language]??value?.en??'');
  const readingSourceKey={eda:'readingSourceEda',mohp:'readingSourceMohp',dawaya:'readingSourceDawaya',who:'readingSourceWho',whofeature:'readingSourceWhoFeature',whoar:'readingSourceWhoAr',fda:'readingSourceFda',pubmed:'readingSourcePubmed'};
  const readingKindKey={news:'readingKindNews',article:'readingKindArticle'};
  const readingSourceLabel=source=>t(readingSourceKey[source]||'readingSourceDawaya');
  const readingKindLabel=item=>t(item.source==='fda'?'readingKindRecall':item.source==='pubmed'?'readingKindResearch':readingKindKey[item.kind]||'readingKindNews');
  function readingDate(value){
    if(!value)return '';
    const stamp=new Date(`${value}T00:00:00`);
    if(Number.isNaN(stamp.getTime()))return value;
    return new Intl.DateTimeFormat(language==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short',year:'numeric'}).format(stamp);
  }
  function liveReadingItems(){
    const news=window.DawayaNews;
    if(!news||typeof news.items!=='function')return [];
    const rows=news.items()
      .filter(item=>item&&item.title&&item.summary)
      .filter(item=>language==='ar'||item.lang!=='ar');
    // Arabic readers get the Arabic service first; English publishers follow in
    // their own date order.
    if(language==='ar')rows.sort((left,right)=>Number(right.lang==='ar')-Number(left.lang==='ar'));
    return rows.map(item=>({...item,kind:item.kind==='article'?'article':'news'}));
  }
  function readingPool(){return liveReadingItems().concat(curatedReading)}
  function renderReadingList(){
    const box=$('#readingList');if(!box)return;
    box.innerHTML='';
    const items=readingPool().filter(item=>readingFilter==='all'||item.kind===readingFilter);
    if(!items.length){const empty=document.createElement('p');empty.className='reading-empty';empty.textContent=t('readingEmpty');box.append(empty);return}
    items.forEach(item=>{
      const meta=[readingSourceLabel(item.source),readingDate(item.date),item.journal&&item.source==='pubmed'?item.journal:'',item.kind==='article'&&item.minutes?tf('readingMinutes',{minutes:item.minutes}):''].filter(Boolean).join(' · ');
      const action=item.url?t('readingOpenSource'):t('readingSectionHint');
      const inner=`<span class="reading-card-top"><span class="reading-badge${item.source==='fda'?' reading-badge-alert':''}">${esc(readingKindLabel(item))}</span><span class="reading-meta">${esc(meta)}</span></span><span class="reading-card-title">${esc(readingText(item.title))}</span><span class="reading-card-summary">${esc(readingText(item.summary))}</span><span class="reading-card-action">${esc(action)} ↗</span>`;
      let card;
      if(item.url){
        card=document.createElement('a');card.className='reading-card reading-card-news';card.href=item.url;card.rel='noopener noreferrer';
        card.addEventListener('click',event=>{event.preventDefault();openExternal(item.url)});
      }else{
        card=document.createElement('button');card.type='button';card.className='reading-card reading-card-article';
        card.addEventListener('click',()=>openReadingItem(item));
      }
      card.innerHTML=inner;
      box.append(card);
    });
  }
  function renderReadingStatus(state){
    const status=$('#readingStatus');if(!status)return;
    const stamp=window.DawayaNews?.fetchedAt?.();
    const when=stamp?readingDate(String(stamp).slice(0,10)):'';
    status.hidden=false;
    if(state==='refreshing'){status.textContent=t('readingRefreshing');status.dataset.state='busy';return}
    if(state==='failed'){status.textContent=t('readingRefreshFailed');status.dataset.state='error';return}
    if(state==='offline'){status.textContent=t('readingUpdateOffline');status.dataset.state='error';return}
    status.dataset.state='';
    status.textContent=when?tf('readingUpdated',{date:when}):'';
    status.hidden=!status.textContent;
  }
  /* The home page updates its own headlines. The snapshot bundled with the app
     shows first so there is never an empty list, then the publishers are
     fetched when what is saved is older than their six-hour window - on opening
     the page, on the same clock while the app stays in the foreground, and when
     the reader comes back to it. Offline mode stops the fetch here rather than
     letting the privacy gate refuse it, because the reader then needs to know
     why nothing arrived. */
  let readingFetching=false;
  function refreshReading(force){
    const news=window.DawayaNews;
    if(!news||typeof news.refresh!=='function'||readingFetching)return;
    if(window.DawayaNet?.isOffline?.()){renderReadingStatus('offline');return}
    if(navigator.onLine===false)return;
    if(!force&&!news.isStale())return;
    readingFetching=true;
    renderReadingStatus('refreshing');
    news.refresh(true).then(result=>{
      if(result&&result.ok){renderReadingList();renderReadingStatus('ok')}
      else renderReadingStatus('failed');
    }).catch(()=>{
      renderReadingStatus('failed');
    }).finally(()=>{
      readingFetching=false;
    });
  }
  /* One check every fifteen minutes: the six-hour window lives in DawayaNews,
     so the extra checks cost nothing, and a timer that only ever fires while the
     page is visible cannot fetch in the background. */
  const READING_TICK_MS=15*60*1000;
  let readingTimer=0;
  function startReadingTimer(){
    if(readingTimer)return;
    readingTimer=setInterval(()=>refreshReading(false),READING_TICK_MS);
  }
  function stopReadingTimer(){
    if(!readingTimer)return;
    clearInterval(readingTimer);
    readingTimer=0;
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopReadingTimer();return}
    startReadingTimer();
    refreshReading(false);
  });
  window.DawayaNews?.subscribe?.(()=>{renderReadingList();renderReadingStatus('ok')});
  window.DawayaNews?.loadSnapshot?.().then(()=>{
    renderReadingList();
    renderReadingStatus('ok');
    /* Opening the page is the trigger, so it is not conditioned on visibility:
       a web view can report itself hidden while it is still being put on screen,
       and the first headlines would then wait for a tab switch that never comes.
       The timer is what pauses, because that is the part that must not run in
       the background. */
    startReadingTimer();
    refreshReading(false);
  });
  function openReadingItem(item){
    const modal=$('#readingBackdrop');if(!modal)return;
    $('#readingKind').textContent=t('readingKindArticle');
    $('#readingSourceName').textContent=[readingSourceLabel(item.source),item.date||''].filter(Boolean).join(' · ');
    $('#readingModalTitle').textContent=readingText(item.title);
    const summary=$('#readingModalSummary'),summaryText=readingText(item.summary);
    summary.textContent=summaryText;summary.hidden=!summaryText;
    const sections=Array.isArray(item.sections)?item.sections:[];
    const body=$('#readingBody');
    body.innerHTML=sections.map(section=>`<section class="detail-block"><h3>${esc(readingText(section.heading))}</h3><p>${esc(readingText(section.body))}</p></section>`).join('');
    observeCollapsibleSections(body);markCollapsibleSections(body);
    $('#readingHint').hidden=!sections.length;
    const sources=(Array.isArray(item.sources)?item.sources:[]).filter(source=>readingText(source.url));
    $('#readingSources').innerHTML=sources.length?`<h3>${esc(t('readingSourcesHeading'))}</h3><div class="detail-links">${sources.map(source=>`<a href="${esc(readingText(source.url))}" target="_blank" rel="noopener noreferrer">${esc(readingText(source))} ↗</a>`).join('')}</div>`:'';
    modal.hidden=false;document.body.style.overflow='hidden';
    modal.querySelector('.reading-modal')?.scrollTo(0,0);
    $('#readingClose').focus({preventScroll:true});
  }
  function closeReading(){
    const modal=$('#readingBackdrop');if(!modal||modal.hidden)return;
    modal.hidden=true;document.body.style.overflow='';
    const preferred=$('#readingList .reading-card-article');
    if(preferred&&preferred.getClientRects().length)preferred.focus({preventScroll:true});
  }
  $('#readingClose')?.addEventListener('click',closeReading);
  $('#readingBackdrop')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closeReading()});
  $('#readingBackdrop')?.addEventListener('keydown',event=>trapOverlayFocus(event,$('#readingBackdrop')));
  document.querySelectorAll('[data-reading-filter]').forEach(chip=>chip.addEventListener('click',()=>{
    readingFilter=chip.dataset.readingFilter||'all';
    document.querySelectorAll('[data-reading-filter]').forEach(other=>{const on=other===chip;other.classList.toggle('is-active',on);other.setAttribute('aria-pressed',String(on))});
    renderReadingList();
  }));
  ['#overviewPanel','#usePanel','#cautionPanel','#conditionOverviewSummary','#conditionDetailBody','#labTestDetail','#drugGroupInfo'].forEach(selector=>observeCollapsibleSections($(selector)));
  document.addEventListener('toggle',event=>{const panel=event.target?.closest?.('.read-more');if(panel)refreshReadMore(panel)},true);
  renderReadingList();
  const overlayIds=['modalBackdrop','relatedBackdrop','conditionDetailBackdrop','drawerBackdrop','readingBackdrop','scanOverlay'];
  const anyOverlayOpen=()=>overlayIds.some(id=>{const el=document.getElementById(id);return el&&!el.hidden});
  /* A layer dismissed by a route change rather than its own close button can
     leave the body scroll lock behind, and the page then refuses to move. */
  function releaseStaleScrollLock(){if(!anyOverlayOpen()&&document.body.style.overflow==='hidden')document.body.style.overflow=''}
  const syncOverlayState=()=>{document.body.classList.toggle('overlay-open',anyOverlayOpen());releaseStaleScrollLock()};
  if('MutationObserver' in window){const overlayObserver=new MutationObserver(syncOverlayState);overlayIds.forEach(id=>{const el=document.getElementById(id);if(el)overlayObserver.observe(el,{attributes:true,attributeFilter:['hidden']})})}
  syncOverlayState();
  /* ---------- Pregnancy & breastfeeding safety page ---------- */
  const PREGNANCY_DATA_URL='assets/data/pregnancy-safety.json';
  const pregnancyUi={
    en:{
      navPregnancy:'Pregnancy',navPregnancyShort:'Pregnancy',
      pregCatsTitle:'Pregnancy drug categories',pregCatTitleA:'Category A: no risk shown',pregCatTitleB:'Category B: no risk in animals',pregCatTitleC:'Category C: risk cannot be ruled out',pregCatTitleD:'Category D: evidence of risk',pregCatTitleX:'Category X: contraindicated',
      pregEyebrow:'PREGNANCY & BREASTFEEDING SAFETY',
      pregTitle:'Pregnancy & breastfeeding',
      pregIntro:'Search a medicine to see pregnancy and breastfeeding information.',
      pregSourcesTitle:'Official references',
      pregSourcesIntro:'This page summarizes public information from these official sources:',
      pregSourceDailyMedNote:'current official product labeling, including the pregnancy and lactation sections',
      pregSourceLactMedNote:'drug levels in milk and infant exposure during breastfeeding',
      pregSourceFdaNote:'the modern narrative labeling system that replaced the letter categories',
      pregSourceWhoNote:'guidance on essential medicines, tuberculosis, malaria, and breastfeeding',
      pregSourcesNote:'Educational summaries from these public sources. Not clinically reviewed and not a basis to start, stop or change a medicine.',
      pregExplainTitle:'How pregnancy and lactation safety is described',
      pregLegacyTitle:'The old FDA letter categories (A · B · C · D · X)',
      pregLegacyIntro:'From 1979, U.S. labels used a single letter to summarize pregnancy risk. The FDA phased the letters out on 30 June 2015 because they were oversimplified and often misread as a grading scale.',
      pregCatA:'Controlled studies in pregnant women showed no risk to the fetus. The most reassuring letter, rarely assigned.',
      pregCatB:'Animal studies showed no risk and human data are lacking, or animal risk was not confirmed in human studies.',
      pregCatC:'Animal studies showed a risk, or no studies exist; human data are lacking. Use only if the benefit justifies the potential risk.',
      pregCatD:'Positive evidence of human fetal risk, but benefits may still justify use in serious situations (for example life-threatening disease).',
      pregCatX:'Proven fetal abnormalities; the risk clearly outweighs any benefit. Contraindicated in pregnancy.',
      pregLegacyNote:'A letter is historical context only. It reflects data available decades ago, never the current label.',
      pregPllrTitle:'The modern system: PLLR narrative sections',
      pregPllrIntro:'Since 30 June 2015, the FDA\'s Pregnancy and Lactation Labeling Rule replaces letters with plain-language narratives in three label subsections:',
      pregPllr81Title:'Pregnancy',
      pregPllr81Text:'Risk summary, clinical considerations, and human/animal data about exposure during pregnancy, including any pregnancy exposure registry.',
      pregPllr82Title:'Lactation',
      pregPllr82Text:'How much drug reaches milk, what is known about effects on the breastfed infant and on milk production, and how to minimize exposure.',
      pregPllr83Title:'Females and males of reproductive potential',
      pregPllr83Text:'When pregnancy testing, contraception, or infertility considerations apply before or during treatment.',
      pregPllrNote:'Current labels use this narrative format. When a letter and a current label disagree, the current label wins.',
      pregDisclaimerTitle:'Educational preview, not a treatment guide',
      pregDisclaimer:'Educational summary from public references, not clinically reviewed; never start, stop, or switch a medicine based on it. Decisions belong with your doctor or pharmacist and the current label.',
      pregMenu:'Pregnancy & breastfeeding',pregMenuHint:'Medicine safety and FDA categories',
      pregSearchTitle:'Search a medicine',pregSearchLabel:'Medicine or active ingredient',
      pregSearchPlaceholder:'e.g. Panadol, warfarin, بنادول',pregSearchClear:'Clear',
      pregSearchHintText:'Type a brand name or active ingredient, in English or Arabic.',
      pregLoading:'Loading the pregnancy safety dataset…',
      pregDataUnavailable:'The pregnancy safety dataset could not be loaded on this device right now.',
      pregDbLoading:'The medicine directory is still loading. The search will run as soon as it is ready…',
      pregEmptyPrompt:'Start typing a medicine or ingredient name to see pregnancy and breastfeeding information.',
      pregNoMatch:'No product or curated ingredient matched that name. Check the spelling, or search the official sources below.',
      pregProductPick:'Several products match this name. Pick the exact product to see its ingredients:',
      pregProductOne:'1 matching product',
      pregProductsCount:'{count} matching products',
      pregIngredientTitle:'Active ingredient',
      pregCatLabel:'Historical FDA category',
      pregCatNone:'No historical FDA letter category',
      pregCatPhasedOut:'Letter categories were phased out by the FDA on 30 June 2015.',
      pregEducationalBadge:'Educational summary · not verified against the current label',
      pregLabelWins:'Current product labels may differ from this summary. The current label and your doctor or pharmacist always take priority.',
      pregPregnancyHeading:'Pregnancy',
      pregLactationHeading:'Breastfeeding',
      pregNoCurated:'No curated safety data for this ingredient in this preview.',
      pregNoCuratedHint:'This does not mean the ingredient is safe or unsafe. Look it up in the official sources and ask a doctor or pharmacist.',
      pregProductIngredients:'Ingredients of the selected product',
      pregSelectedProduct:'Selected product',
      pregChangeProduct:'Choose another product',
      pregSourceDailyMed:'DailyMed',
      pregSourceLactMed:'LactMed (NIH)',
      pregSourceSearchPrefix:'Search official sources for'
    },
    ar:{
      navPregnancy:'الحمل والرضاعة',navPregnancyShort:'الحمل',
      pregCatsTitle:'تصنيفات أدوية الحمل',pregCatTitleA:'التصنيف A: لا يوجد خطر',pregCatTitleB:'التصنيف B: لا خطر في الحيوان',pregCatTitleC:'التصنيف C: الخطر غير مستبعد',pregCatTitleD:'التصنيف D: دليل على الخطر',pregCatTitleX:'التصنيف X: ممنوع',
      pregEyebrow:'أمان الحمل والرضاعة',
      pregTitle:'الحمل والرضاعة',
      pregIntro:'ابحث عن دواء لعرض معلومات الحمل والرضاعة.',
      pregSourcesTitle:'المراجع الرسمية',
      pregSourcesIntro:'تلخص هذه الصفحة معلومات عامة من هذه المصادر الرسمية:',
      pregSourceDailyMedNote:'النشرات الرسمية الحالية للمنتجات بما فيها أقسام الحمل والرضاعة',
      pregSourceLactMedNote:'مستويات الدواء في الحليب وتعرض الرضيع أثناء الرضاعة الطبيعية',
      pregSourceFdaNote:'نظام النشرات السردي الحديث الذي حل محل التصنيفات الحرفية',
      pregSourceWhoNote:'إرشادات الأدوية الأساسية والسل والملاريا والرضاعة الطبيعية',
      pregSourcesNote:'ملخصات تعليمية من هذه المصادر. غير مراجعة إكلينيكيًا وليست أساسًا لبدء دواء أو إيقافه أو تغييره.',
      pregExplainTitle:'كيف يُوصف أمان الحمل والرضاعة',
      pregLegacyTitle:'تصنيفات FDA الحرفية القديمة (A · B · C · D · X)',
      pregLegacyIntro:'منذ 1979 استخدمت النشرات الأمريكية حرفًا واحدًا لتلخيص خطر الحمل. ألغت FDA هذه الحروف في 30 يونيو 2015 لأنها كانت مبسطة أكثر من اللازم وكثيرًا ما فُسرت خطأً كمقياس تدريجي.',
      pregCatA:'دراسات محكومة في الحوامل لم تُظهر خطرًا على الجنين. أكثر الحروف طمأنينة ونادرًا ما يُسند.',
      pregCatB:'دراسات الحيوانات لم تُظهر خطرًا والبيانات البشرية غائبة، أو خطر حيواني لم يتأكد في دراسات بشرية.',
      pregCatC:'دراسات الحيوانات أظهرت خطرًا أو لا توجد دراسات؛ والبيانات البشرية غائبة. يُستخدم فقط إذا بررت الفائدة الخطر المحتمل.',
      pregCatD:'دليل إيجابي على خطر بشري على الجنين، لكن الفوائد قد تبرر الاستخدام في حالات خطيرة (مثل الأمراض المهددة للحياة).',
      pregCatX:'تشوهات جنينية مثبتة؛ الخطر يفوق أي فائدة بوضوح. ممنوع في الحمل.',
      pregLegacyNote:'الحرف سياق تاريخي فقط. إنه يعكس بيانات متاحة منذ عقود وليس النشرة الحالية أبدًا.',
      pregPllrTitle:'النظام الحديث: أقسام PLLR السردية',
      pregPllrIntro:'منذ 30 يونيو 2015 تحل قاعدة وسم الحمل والرضاعة الأمريكية (PLLR) محل الحروف بسرديات بلغة واضحة في ثلاثة أقسام فرعية من النشرة:',
      pregPllr81Title:'الحمل',
      pregPllr81Text:'ملخص المخاطر والاعتبارات الإكلينيكية والبيانات البشرية والحيوانية عن التعرض أثناء الحمل بما فيها أي سجل لتعرض الحمل.',
      pregPllr82Title:'الرضاعة',
      pregPllr82Text:'كمية الدواء الواصلة إلى الحليب وما هو معروف عن تأثيراته على الرضيع وعلى إنتاج الحليب وكيفية تقليل التعرض.',
      pregPllr83Title:'الإناث والذكور في سن الإنجاب',
      pregPllr83Text:'متى تنطبق اختبارات الحمل أو منع الحمل أو اعتبارات الخصوبة قبل العلاج أو أثناءه.',
      pregPllrNote:'النشرات الحالية تستخدم هذا الشكل السردي. عند اختلاف حرف قديم مع نشرة حالية، النشرة الحالية هي المعتمدة.',
      pregDisclaimerTitle:'معاينة تعليمية وليست دليلًا علاجيًا',
      pregDisclaimer:'ملخص تعليمي من مراجع عامة وغير مُراجع إكلينيكيًا؛ لا تبدأ دواءً أو توقفه أو تبدّله بناءً عليه، والقرار للطبيب أو الصيدلي وفق النشرة الحالية.',
      pregMenu:'الحمل والرضاعة',pregMenuHint:'أمان الأدوية وتصنيفات FDA',
      pregSearchTitle:'ابحث عن دواء',pregSearchLabel:'الدواء أو المادة الفعالة',
      pregSearchPlaceholder:'مثال: بنادول، وارفارين، Panadol',pregSearchClear:'مسح',
      pregSearchHintText:'اكتب الاسم التجاري أو المادة الفعالة بالإنجليزية أو العربية.',
      pregLoading:'جارٍ تحميل قاعدة بيانات أمان الحمل…',
      pregDataUnavailable:'تعذر تحميل قاعدة بيانات أمان الحمل على هذا الجهاز الآن.',
      pregDbLoading:'دليل الأدوية ما زال يُحمَّل. سيبدأ البحث فور جاهزيته…',
      pregEmptyPrompt:'ابدأ بكتابة اسم دواء أو مادة فعالة لعرض معلومات الحمل والرضاعة.',
      pregNoMatch:'لا يوجد منتج أو مادة فعالة منتقاة تطابق هذا الاسم. تحقق من الإملاء أو ابحث في المصادر الرسمية أدناه.',
      pregProductPick:'عدة منتجات تطابق هذا الاسم. اختر المنتج المحدد لعرض مكوناته:',
      pregProductOne:'منتج واحد مطابق',
      pregProductsCount:'{count} منتجات مطابقة',
      pregIngredientTitle:'المادة الفعالة',
      pregCatLabel:'تصنيف FDA التاريخي',
      pregCatNone:'لا يوجد تصنيف حرفي تاريخي من FDA',
      pregCatPhasedOut:'ألغت FDA التصنيفات الحرفية في 30 يونيو 2015.',
      pregEducationalBadge:'ملخص تعليمي · غير متحقق منه مقابل النشرة الحالية',
      pregLabelWins:'قد تختلف النشرات الحالية للمنتجات عن هذا الملخص. النشرة الحالية والطبيب أو الصيدلي لهما الأولوية دائمًا.',
      pregPregnancyHeading:'الحمل',
      pregLactationHeading:'الرضاعة الطبيعية',
      pregNoCurated:'لا توجد بيانات أمان منتقاة لهذه المادة في هذه المعاينة.',
      pregNoCuratedHint:'هذا لا يعني أن المادة آمنة أو غير آمنة. ابحث عنها في المصادر الرسمية واسأل الطبيب أو الصيدلي.',
      pregProductIngredients:'مكونات المنتج المختار',
      pregSelectedProduct:'المنتج المختار',
      pregChangeProduct:'اختيار منتج آخر',
      pregSourceDailyMed:'DailyMed',
      pregSourceLactMed:'LactMed (NIH)',
      pregSourceSearchPrefix:'ابحث في المصادر الرسمية عن'
    }
  };
  Object.assign(translations.en,pregnancyUi.en);Object.assign(translations.ar,pregnancyUi.ar);
  Object.assign(translations.en,{navToolsLabel:'TOOLS'});Object.assign(translations.ar,{navToolsLabel:'أدوات'});Object.assign(translations.en,{navCalculators:'Clinical calculators',navStudy:'Study mode'});Object.assign(translations.ar,{navCalculators:'حاسبات طبية',navStudy:'وضع المذاكرة'});

  let pregnancyData=null,pregnancyLoadFailed=false,pregnancyLoadPromise=null,pregnancyLookup=null;
  let pregnancySelectedProduct=null,pregnancyLastQuery='',pregnancyDbWaitTimer=0;
  const pregInput=()=>$('#pregSearch'),pregResults=()=>$('#pregResults'),pregStatus=()=>$('#pregStatus'),pregProductList=()=>$('#pregProductList');

  function normalizePregnancyName(name){
    return String(name||'').toUpperCase().replace(/\(.*?\)/g,' ').replace(/[^A-Z0-9+\s.-]/g,' ').replace(/\s+/g,' ').trim();
  }
  const PREG_SALT_WORDS=['HYDROCHLORIDE','HCL','SODIUM','POTASSIUM','CALCIUM','MAGNESIUM','SULFATE','SULPHATE','PHOSPHATE','MALEATE','FUMARATE','TARTRATE','MESYLATE','BESYLATE','ACETATE','SUCCINATE','NITRATE','DIHYDRATE','MONOHYDRATE','TRIHYDRATE','HYDRATE','BASE','SALT'];
  function stripSaltSuffix(name){
    let current=name;
    for(let i=0;i<3;i++){
      const words=current.split(' ');
      if(words.length>1&&PREG_SALT_WORDS.includes(words[words.length-1])){current=words.slice(0,-1).join(' ');continue}
      break;
    }
    return current;
  }
  function buildPregnancyLookup(){
    if(pregnancyLookup)return pregnancyLookup;
    const map=new Map();
    const add=(key,entry)=>{const norm=normalizePregnancyName(key);if(norm&&!map.has(norm))map.set(norm,entry);};
    Object.entries(pregnancyData.entries).forEach(([ingredient,entry])=>{
      add(ingredient,entry);
      (entry.aliases||[]).forEach(alias=>add(alias,entry));
    });
    pregnancyLookup=map;return map;
  }
  function findPregnancyEntry(rawToken){
    const map=buildPregnancyLookup();
    const direct=normalizePregnancyName(rawToken);
    if(!direct)return null;
    if(map.has(direct))return map.get(direct);
    const stripped=stripSaltSuffix(direct);
    if(stripped!==direct&&map.has(stripped))return map.get(stripped);
    // try progressive trimming of trailing words (e.g. "X HYDROCHLORIDE SALT")
    const words=stripped.split(' ');
    for(let cut=words.length-1;cut>0;cut--){
      const piece=words.slice(0,cut).join(' ');
      if(map.has(piece))return map.get(piece);
    }
    return null;
  }
  function pregnancyTokens(drug){
    const sci=val(drug,'scientific_name');if(!sci)return [];
    return sci.split('+').map(part=>part.trim()).filter(Boolean).map(part=>{
      const match=part.match(/^([^()]+)\(([^()]*)\)$/);
      const base=(match?match[1]:part).trim();
      const alias=match?match[2].trim():'';
      const entry=findPregnancyEntry(base)||(alias?findPregnancyEntry(alias):null);
      return {raw:part,base,alias,entry};
    });
  }
  function loadPregnancyData(){
    if(pregnancyLoadPromise)return pregnancyLoadPromise;
    pregnancyLoadPromise=DawayaNet.request(PREGNANCY_DATA_URL).then(response=>{
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).then(data=>{
      if(!data||typeof data!=='object'||!data.entries)throw new Error('Invalid dataset');
      pregnancyData=data;pregnancyLoadFailed=false;
    }).catch(error=>{
      console.warn('Pregnancy safety dataset failed to load:',error);
      pregnancyLoadFailed=true;
    });
    return pregnancyLoadPromise;
  }
  function setPregStatus(message){const node=pregStatus();if(!node)return;node.textContent=message||'';node.hidden=!message;}
  function pregSourceLinks(term){
    const wrap=document.createElement('p');wrap.className='preg-source-links';
    const label=document.createElement('span');label.textContent=`${t('pregSourceSearchPrefix')} "${term}":`;wrap.append(label);
    const daily=document.createElement('a');daily.href=`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(term)}`;daily.target='_blank';daily.rel='noopener noreferrer';daily.textContent=t('pregSourceDailyMed')+' ↗';wrap.append(daily);
    const lact=document.createElement('a');lact.href=`https://www.google.com/search?q=${encodeURIComponent(`site:ncbi.nlm.nih.gov/books/NBK501922 ${term}`)}`;lact.target='_blank';lact.rel='noopener noreferrer';lact.textContent=t('pregSourceLactMed')+' ↗';wrap.append(lact);
    return wrap;
  }
  function pregnancyEntryCard(token){
    const card=document.createElement('article');card.className='preg-card';
    const head=document.createElement('div');head.className='preg-card-head';
    const title=document.createElement('h3');title.textContent=token.base;head.append(title);
    const entry=token.entry;
    const cat=entry?entry.cat:null;
    if(cat){const chip=document.createElement('span');chip.className=`preg-cat preg-cat-${cat.toLowerCase()}`;chip.textContent=cat;chip.title=`${t('pregCatLabel')} ${cat} · ${t('pregCatPhasedOut')}`;head.append(chip)}
    card.append(head);
    if(token.alias){const aliasLine=document.createElement('p');aliasLine.className='preg-alias';aliasLine.textContent=token.alias;card.append(aliasLine)}
    const catLine=document.createElement('p');catLine.className='preg-catline';
    catLine.textContent=cat?`${t('pregCatLabel')}: ${cat} — ${t('pregCatPhasedOut')}`:`${t('pregCatNone')}.`;
    card.append(catLine);
    if(entry){
      const badge=document.createElement('p');badge.className='preg-badge';badge.textContent=t('pregEducationalBadge');card.append(badge);
      const preg=document.createElement('div');preg.className='preg-block';
      const pregH=document.createElement('h4');pregH.textContent=t('pregPregnancyHeading');
      const pregP=document.createElement('p');pregP.textContent=language==='ar'?entry.preg_ar:entry.preg_en;
      preg.append(pregH,pregP);
      const lact=document.createElement('div');lact.className='preg-block';
      const lactH=document.createElement('h4');lactH.textContent=t('pregLactationHeading');
      const lactP=document.createElement('p');lactP.textContent=language==='ar'?entry.lact_ar:entry.lact_en;
      lact.append(lactH,lactP);
      card.append(preg,lact);
      const wins=document.createElement('p');wins.className='preg-labelwins';wins.textContent=t('pregLabelWins');card.append(wins);
    }else{
      card.classList.add('preg-card-missing');
      const none=document.createElement('p');none.className='preg-nodata';none.textContent=t('pregNoCurated');card.append(none);
      const hint=document.createElement('p');hint.className='preg-nodata-hint';hint.textContent=t('pregNoCuratedHint');card.append(hint);
    }
    card.append(pregSourceLinks(token.base));
    return card;
  }
  function renderPregnancyResults(){
    const box=pregResults();if(!box)return;
    box.innerHTML='';
    if(!pregnancySelectedProduct){box.hidden=true;return}
    const drug=pregnancySelectedProduct;
    const head=document.createElement('div');head.className='preg-selected';
    const selectedLabel=document.createElement('p');selectedLabel.className='preg-selected-label';selectedLabel.textContent=t('pregSelectedProduct');
    const selectedName=document.createElement('p');selectedName.className='preg-selected-name';
    selectedName.textContent=val(drug,'commercial_name_en')||val(drug,'commercial_name_ar');
    const selectedSci=document.createElement('p');selectedSci.className='preg-selected-sci';selectedSci.textContent=val(drug,'scientific_name');
    const change=document.createElement('button');change.type='button';change.className='clinical-secondary preg-change';change.textContent=t('pregChangeProduct');
    change.addEventListener('click',()=>{pregnancySelectedProduct=null;runPregnancySearch();});
    head.append(selectedLabel,selectedName,selectedSci,change);box.append(head);
    const ingLabel=document.createElement('p');ingLabel.className='preg-ingredients-label';ingLabel.textContent=t('pregProductIngredients');box.append(ingLabel);
    const tokens=pregnancyTokens(drug);
    if(!tokens.length){const empty=document.createElement('p');empty.className='preg-nodata';empty.textContent=t('pregNoMatch');box.append(empty)}
    tokens.forEach(token=>box.append(pregnancyEntryCard(token)));
    box.hidden=false;
  }
  function pregnancyProductButton(drug){
    const button=document.createElement('button');button.type='button';button.className='preg-product';
    const name=document.createElement('strong');name.textContent=val(drug,'commercial_name_en')||val(drug,'commercial_name_ar');
    const ar=val(drug,'commercial_name_ar');
    const sci=document.createElement('span');sci.className='preg-product-sci';sci.textContent=val(drug,'scientific_name');
    const meta=document.createElement('span');meta.className='preg-product-meta';
    const bits=[val(drug,'manufacturer'),val(drug,'drug_class')].filter(Boolean);meta.textContent=bits.join(' · ');
    const logo=document.createElement('span');logo.className='drug-search-logo';logo.setAttribute('aria-hidden','true');logo.innerHTML='<img src="assets/red-crescent-rx-96.png" alt="">';button.append(logo,name);if(ar&&ar!==name.textContent){const arSpan=document.createElement('span');arSpan.className='preg-product-ar';arSpan.lang='ar';arSpan.dir='rtl';arSpan.textContent=ar;button.append(arSpan)}
    button.append(sci,meta);
    button.addEventListener('click',()=>{pregnancySelectedProduct=drug;pregProductList().hidden=true;pregInput().setAttribute('aria-expanded','false');renderPregnancyResults();});
    return button;
  }
  function matchPregnancyProducts(query){
    const q=clean(query);if(!q)return [];
    const lower=q.toLowerCase();
    const scored=[];
    drugs.forEach(drug=>{
      const brandEn=clean(val(drug,'commercial_name_en')),brandAr=val(drug,'commercial_name_ar')||'',sci=clean(val(drug,'scientific_name'));
      let score=-1;
      const parsed=buildWildcardQuery(query);
      if(parsed){
        score=Math.max(wildcardScore(parsed,brandEn),wildcardScore(parsed,brandAr),wildcardScore(parsed,sci)-20);
      }
      if(score<0){
        if(brandEn.toLowerCase().includes(lower))score=40;
        else if(brandAr.includes(query.trim()))score=40;
        else if(sci.toLowerCase().includes(lower))score=25;
      }
      if(score>=0)scored.push({drug,score});
    });
    scored.sort((a,b)=>b.score-a.score);
    const seen=new Set(),unique=[];
    scored.forEach(({drug})=>{
      const key=`${val(drug,'commercial_name_en')}||${val(drug,'scientific_name')}||${val(drug,'manufacturer')}`;
      if(seen.has(key))return;seen.add(key);unique.push(drug);
    });
    return unique.slice(0,15);
  }
  function runPregnancySearch(){
    const inputNode=pregInput(),listNode=pregProductList();
    if(!inputNode||!listNode)return;
    const query=inputNode.value.trim();inputNode.setAttribute('aria-expanded','false');
    listNode.innerHTML='';listNode.hidden=true;
    pregResults().hidden=true;
    if(!query&&!pregnancySelectedProduct){setPregStatus(t('pregEmptyPrompt'));renderPregnancyResults();return}
    if(pregnancyLoadFailed){setPregStatus(t('pregDataUnavailable'));return}
    if(!pregnancyData){setPregStatus(t('pregLoading'));loadPregnancyData().then(()=>{if(inputNode.value.trim()===query)runPregnancySearch()});return}
    if(query&&!drugs.length&&!loadFailed){
      setPregStatus(t('pregDbLoading'));
      clearTimeout(pregnancyDbWaitTimer);
      pregnancyDbWaitTimer=setTimeout(()=>{if(pregInput()&&pregInput().value.trim()===query)runPregnancySearch()},900);
      return;
    }
    if(pregnancySelectedProduct){setPregStatus('');renderPregnancyResults();return}
    // Direct ingredient hit in the curated dataset.
    const directEntry=findPregnancyEntry(query);
    const products=query?matchPregnancyProducts(query):[];
    if(directEntry&&!products.length){
      setPregStatus('');
      const choose=document.createElement('button');choose.type='button';choose.className='preg-product-button';choose.setAttribute('role','option');choose.textContent=query;
      choose.addEventListener('click',()=>{listNode.hidden=true;const box=pregResults();box.innerHTML='';box.hidden=false;box.append(pregnancyEntryCard({raw:query,base:query.toUpperCase(),alias:'',entry:directEntry}));inputNode.setAttribute('aria-expanded','false')});
      listNode.append(choose);listNode.hidden=false;inputNode.setAttribute('aria-expanded','true');return;
    }
    if(products.length>0){
      setPregStatus(tf('pregProductsCount',{count:products.length}));
      const note=document.createElement('p');note.className='preg-pick-note';note.textContent=t('pregProductPick');listNode.append(note);
      products.forEach(drug=>listNode.append(pregnancyProductButton(drug)));
      listNode.hidden=false;inputNode.setAttribute('aria-expanded','true');
      renderPregnancyResults();
      return;
    }
    setPregStatus(t('pregNoMatch'));
    const box=pregResults();box.innerHTML='';
    if(query.length>1)box.append(pregSourceLinks(query));
    box.hidden=!box.children.length;
  }
  function pregnancyOnLanguageChange(){
    const drawerButton=document.querySelector('[data-drawer-action=pregnancy]');
    if(drawerButton)drawerButton.innerHTML=`${esc(t('pregMenu'))}<small>${esc(t('pregMenuHint'))}</small>`;
    if(!$('#pregnancyPage')?.hidden){
      if(pregnancySelectedProduct){renderPregnancyResults()}
      else if(pregInput()?.value.trim())runPregnancySearch();
      else setPregStatus(t('pregEmptyPrompt'));
    }
  }
  function initPregnancyPage(){
    setPregStatus(pregInput()?.value.trim()?'':t('pregEmptyPrompt'));
    if(!pregnancyData&&!pregnancyLoadFailed)loadPregnancyData();
    if(pregInput()?.value.trim())runPregnancySearch();
    else renderPregnancyResults();
  }
  pregInput()?.addEventListener('input',()=>{
    pregnancySelectedProduct=null;
    clearTimeout(pregnancyDbWaitTimer);
    pregnancyDbWaitTimer=setTimeout(runPregnancySearch,220);
  });
  $('#pregSearchClear')?.addEventListener('click',()=>{
    if(pregInput())pregInput().value='';
    pregnancySelectedProduct=null;setPregStatus(t('pregEmptyPrompt'));
    pregProductList().innerHTML='';pregProductList().hidden=true;
    renderPregnancyResults();pregInput()?.focus();
  });
  document.querySelectorAll('[data-preg-cat]').forEach(btn=>btn.addEventListener('click',()=>{
    const key=btn.dataset.pregCat,detail=$('#pregCatDetail');if(!detail)return;
    const wasOpen=btn.getAttribute('aria-expanded')==='true';
    document.querySelectorAll('[data-preg-cat]').forEach(b=>b.setAttribute('aria-expanded','false'));
    detail.querySelectorAll('[data-preg-detail]').forEach(a=>{a.hidden=true});
    const legacy=$('#pregLegacyNote');
    if(wasOpen){detail.hidden=true;return}
    btn.setAttribute('aria-expanded','true');detail.hidden=false;
    const card=detail.querySelector('[data-preg-detail="'+key+'"]');if(card)card.hidden=false;
    if(legacy)legacy.hidden=key==='PLLR';
  }));
  // Keep the pregnancy page in sync with language/theme switches.
  const pregnancyBaseApplyLanguage=applyLanguage;
  applyLanguage=function(){pregnancyBaseApplyLanguage();pregnancyOnLanguageChange();};
  // Optional deep link: ?page=pregnancy&pregq=warfarin&lang=ar&theme=dark
  (function(){
    let params;try{params=new URLSearchParams(location.search)}catch(_){return}
    const langParam=params.get('lang');
    if(langParam==='ar'||langParam==='en'){language=langParam;try{localStorage.setItem('dawaya-language',langParam)}catch(_){}}
    const themeParam=params.get('theme');
    if(themeParam==='dark'||themeParam==='light'){themePreference=themeParam;try{core?.theme?.setPreference(themeParam)}catch(_){}}
    if(params.get('page')==='pregnancy'){
      const q=params.get('pregq')||params.get('q')||'';
      const pick=params.get('pregpick');
      window.addEventListener('DOMContentLoaded',()=>{
        switchPage('pregnancy','pregnancy');
        if(q&&pregInput()){pregInput().value=q;runPregnancySearch()}
        if(pick!==null&&pick!==''){
          const tryPick=()=>{
            const list=pregProductList();
            if(!list||list.hidden)return false;
            const buttons=list.querySelectorAll('.preg-product');
            if(!buttons.length)return false;
            buttons[Math.min(Math.max(Number(pick)||0,0),buttons.length-1)].click();
            return true;
          };
          const pickerTimer=setInterval(()=>{if(tryPick())clearInterval(pickerTimer)},600);
          setTimeout(()=>clearInterval(pickerTimer),45000);
        }
      });
    }
  })();

  initTypeScale();
  applyTheme();
  applyLanguage();
  loadDatabase();
  /* The assistant's first question used to pay for the model load. Once the page
     has settled the model is brought in on its own; the manager declines when the
     file is not on this device or the device has no room for it, so a phone that
     never downloaded anything sees nothing here. */
  const warmUpAssistant=()=>{try{window.DawayaAIModel?.warmUp?.()}catch(_){}};
  if('requestIdleCallback' in window) requestIdleCallback(warmUpAssistant,{timeout:8000});
  else setTimeout(warmUpAssistant,4000);
  window.DawayaApp={
    openExternal,
    switchPage,
    openDrug,
    goBack,
    closeModal,
    sanitizeUserText,
    loadConditionDatabase,
    loadKnowledgeIndex,
    get language(){return language},
    get drugs(){return drugs},
    get conditions(){return conditionLocal.topics},
    get clinicalNotes(){return clinicalNotes},
    get interactions(){return interactionLibrary},
    onDatasetUpdate(callback){document.addEventListener('dawaya:dataset-updated',callback);return()=>document.removeEventListener('dawaya:dataset-updated',callback)}
  };
})();
