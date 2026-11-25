/* Home reading: official Egyptian drug news + curated scientific articles.
   News entries carry their official URL and are never rewritten by Drugcopeia.
   Article entries are offline educational content with cited source pages. */
window.DAWAYA_READING = {
  ui: {
    en: {
      readingEyebrow: 'NEWS AND ARTICLES',
      readingTitle: 'Drug news and scientific articles',
      readingIntro: 'Official drug news from the Egyptian Drug Authority, the Ministry of Health, WHO, the U.S. FDA and PubMed.',
      readingTabAll: 'All',
      readingTabNews: 'Drug news',
      readingTabArticles: 'Articles',
      readingSourceEda: 'Egyptian Drug Authority',
      readingSourceMohp: 'Egyptian Ministry of Health',
      readingSourceDawaya: 'Drugcopeia Egyptian medicine information',
      readingKindNews: 'Official announcement',
      readingKindArticle: 'Article',
      readingOpenSource: 'Open the official page',
      readingOpensExternally: 'Opens the authority website when you are online.',
      readingMinutes: '{minutes} min read',
      readingSectionHint: 'Tap a heading to read its details.',
      readingSourcesHeading: 'Information sources',
      readingEmpty: 'Nothing matches this filter yet.',
      readingFiltersAria: 'Filter news and articles',
      hideMedicineImages: 'Hide images',
      readingDisclaimer: 'Educational information only. It does not replace the product leaflet or advice from a doctor or pharmacist.',
      readingSourceWho: 'World Health Organization',
      readingSourceWhoFeature: 'WHO feature stories',
      readingSourceWhoAr: 'WHO — Arabic service',
      readingSourceFda: 'U.S. Food and Drug Administration',
      readingSourcePubmed: 'PubMed — U.S. National Library of Medicine',
      readingKindRecall: 'Drug recall',
      readingKindResearch: 'Research article',
      readingUpdated: 'Updated {date}',
      readingRefreshing: 'Updating…',
      readingRefreshFailed: 'Could not reach the official sources just now. The last saved headlines are shown below.',
      readingUpdateOffline: 'Offline mode is on, so the headlines did not update. The saved headlines are shown below. Turn offline mode off in Privacy to update.',
      readingSaved: 'Saved headlines from {date}.',
      readingLiveSourceNote: 'Headlines come from the publisher. The full article opens on the publisher’s website.'
    },
    ar: {
      readingEyebrow: 'أخبار ومقالات',
      readingTitle: 'أخبار الأدوية ومقالات علمية',
      readingIntro: 'أخبار دوائية رسمية من هيئة الدواء المصرية ووزارة الصحة ومنظمة الصحة العالمية وإدارة الغذاء والدواء الأمريكية وPubMed.',
      readingTabAll: 'الكل',
      readingTabNews: 'أخبار الأدوية',
      readingTabArticles: 'مقالات',
      readingSourceEda: 'هيئة الدواء المصرية',
      readingSourceMohp: 'وزارة الصحة والسكان',
      readingSourceDawaya: 'معلومات Drugcopeia الدوائية المصرية',
      readingKindNews: 'إعلان رسمي',
      readingKindArticle: 'مقال',
      readingOpenSource: 'افتح الصفحة الرسمية',
      readingOpensExternally: 'يفتح موقع الجهة عند الاتصال بالإنترنت.',
      readingMinutes: 'قراءة {minutes} دقيقة',
      readingSectionHint: 'اضغط على العنوان لعرض تفاصيله.',
      readingSourcesHeading: 'مصادر المعلومات',
      readingEmpty: 'لا يوجد ما يطابق هذا التصنيف حالياً.',
      readingFiltersAria: 'تصفية الأخبار والمقالات',
      hideMedicineImages: 'إخفاء الصور',
      readingDisclaimer: 'معلومات تعليمية فقط، ولا تغني عن نشرة الدواء أو استشارة الطبيب أو الصيدلي.',
      readingSourceWho: 'منظمة الصحة العالمية',
      readingSourceWhoFeature: 'قصص منظمة الصحة العالمية',
      readingSourceWhoAr: 'منظمة الصحة العالمية — الخدمة العربية',
      readingSourceFda: 'إدارة الغذاء والدواء الأمريكية',
      readingSourcePubmed: 'PubMed — المكتبة الوطنية الأمريكية للطب',
      readingKindRecall: 'استدعاء دوائي',
      readingKindResearch: 'مقال بحثي',
      readingUpdated: 'آخر تحديث {date}',
      readingRefreshing: 'جارٍ التحديث…',
      readingRefreshFailed: 'تعذر الوصول إلى المصادر الرسمية الآن. تُعرض آخر العناوين المحفوظة أدناه.',
      readingUpdateOffline: 'وضع عدم الاتصال مفعّل، لذلك لم تُحدَّث العناوين. تُعرض العناوين المحفوظة أدناه. أوقف وضع عدم الاتصال من صفحة الخصوصية للتحديث.',
      readingSaved: 'عناوين محفوظة بتاريخ {date}.',
      readingLiveSourceNote: 'العناوين من جهة النشر، والمقال كاملًا يُفتح على موقعها الرسمي.'
    }
  },
  items: [
    {
      id: 'eda-announcements', kind: 'news', source: 'eda',
      url: 'https://edaegypt.gov.eg/en/media-center/announcements/',
      title: { en: 'Egyptian Drug Authority — announcements', ar: 'هيئة الدواء المصرية — الإعلانات' },
      summary: {
        en: 'The authority publishes registration, pricing and pharmacovigilance announcements here as they are issued.',
        ar: 'تنشر الهيئة هنا إعلانات التسجيل والأسعار ويقظة الأدوية فور صدورها.'
      }
    },
    {
      id: 'eda-recalls', kind: 'news', source: 'eda',
      url: 'https://edaegypt.gov.eg/en/awareness/recalls-alerts-and-awareness-letters/recalls-and-alerts-notice-letters/',
      title: { en: 'EDA recalls and alert notice letters', ar: 'هيئة الدواء — خطابات السحب والتنبيهات' },
      summary: {
        en: 'The official list of medicine recall and alert notice letters, filed by year, with the recall class and report number for each product.',
        ar: 'القائمة الرسمية لخطابات سحب وتنبيهات الأدوية مرتبة بالسنة، مع درجة السحب ورقم التقرير لكل مستحضر.'
      }
    },
    {
      id: 'eda-report-side-effects', kind: 'news', source: 'eda',
      url: 'https://edaegypt.gov.eg/en/about-us/home-page-services/home-page-services/reporting-side-effects/',
      title: { en: 'Report a side effect to the Egyptian Drug Authority', ar: 'أبلغ عن أثر جانبي لهيئة الدواء المصرية' },
      summary: {
        en: 'The national service for reporting adverse reactions to medicines, vaccines, cosmetics and medical devices.',
        ar: 'الخدمة القومية للإبلاغ عن الآثار العكسية للأدوية واللقاحات ومستحضرات التجميل والأجهزة الطبية.'
      }
    },
    {
      id: 'eda-registration-pathways', kind: 'news', source: 'eda', date: '2026',
      url: 'https://edaegypt.gov.eg/en/media-center/announcements/important-announcement-regarding-the-continuation-of-registration-for-human-medicinal-products-under-pathways-c-and-d/',
      title: {
        en: 'Continuation of registration for human medicinal products under Pathways (C) and (D)',
        ar: 'استمرار تسجيل المستحضرات البشرية وفق المسارين (C) و(D)'
      },
      summary: {
        en: 'An EDA announcement about how human medicine registration applications continue under pathways C and D.',
        ar: 'إعلان من هيئة الدواء بشأن استمرار طلبات تسجيل الأدوية البشرية في المسارين C و D.'
      }
    },
    {
      id: 'eda-reports-2026', kind: 'news', source: 'eda', date: '2026',
      url: 'https://www.edaegypt.gov.eg/en/eda-publications/publication-post/periodic-reports/2026/',
      title: { en: 'EDA periodic reports — 2026', ar: 'تقارير هيئة الدواء الدورية — 2026' },
      summary: {
        en: 'Periodic authority reports covering its published work for the year.',
        ar: 'تقارير دورية للهيئة تغطي أعمالها المنشورة خلال العام.'
      }
    },
    {
      id: 'mohp-news', kind: 'news', source: 'mohp',
      url: 'https://www.mohp.gov.eg/',
      title: { en: 'Ministry of Health and Population — news', ar: 'وزارة الصحة والسكان — الأخبار' },
      summary: {
        en: 'Screening campaigns, vaccination drives and national health programme news from the Ministry of Health.',
        ar: 'أخبار الحملات القومية للفحص والتطعيمات وبرامج الصحة العامة من وزارة الصحة.'
      }
    },
    {
      id: 'eda-services', kind: 'news', source: 'eda',
      url: 'https://serviceportal.edaegypt.gov.eg/',
      title: { en: 'EDA services portal — pricing and product status', ar: 'بوابة خدمات هيئة الدواء — الأسعار وحالة المستحضر' },
      summary: {
        en: 'The authority service portal used to apply for services and follow up on registered product requests.',
        ar: 'بوابة خدمات الهيئة المستخدمة لتقديم الطلبات ومتابعة حالة المستحضرات المسجلة.'
      }
    },
    {
      id: 'antibiotic-course', kind: 'article', topic: 'medicines', minutes: 4,
      title: { en: 'Finishing an antibiotic course', ar: 'إكمال كورس المضاد الحيوي' },
      summary: {
        en: 'Why stopping early can leave the infection behind, and when an antibiotic was never the right answer.',
        ar: 'لماذا قد يترك التوقف المبكر العدوى قائمة، ومتى لا يكون المضاد الحيوي هو الحل أصلاً.'
      },
      sources: [{ en: 'Antimicrobial stewardship guidance — Egyptian Drug Authority', ar: 'إرشادات ترشيد مضادات الميكروبات — هيئة الدواء المصرية', url: 'https://edaegypt.gov.eg/en/' }],
      sections: [
        {
          heading: { en: 'Why the course length matters', ar: 'لماذا لمدة الكورس أهمية' },
          body: {
            en: 'An antibiotic reduces a bacterial population; it rarely kills every organism on day two. Symptoms improve before the infection is cleared, which is why feeling better is not a signal to stop. Stopping early leaves the hardiest bacteria behind, and those survivors are the ones most likely to develop resistance. Follow the duration the prescriber set, and ask the pharmacist if the pack size and the prescribed length do not match.',
            ar: 'المضاد الحيوي يقلل عدد البكتيريا ولا يقتل كل شيء في اليوم الثاني غالباً. تتحسن الأعراض قبل اختفاء العدوى، لذلك لا يعتبر تحسّن الحالة دليلاً على التوقف. الإيقاف المبكر يترك أقوى البكتيريا، وهي الأكثر قابلية لتكوين المقاومة. التزم بالمدة التي حددها الطبيب، واسأل الصيدلي إذا لم تتطابق عبوة الدواء مع المدة المكتوبة.'
          }
        },
        {
          heading: { en: 'When an antibiotic does not help', ar: 'متى لا يفيد المضاد الحيوي' },
          body: {
            en: 'Influenza, most sore throats, acute bronchitis and the common cold are viral. An antibiotic does nothing against a virus and still carries side effects. Green or yellow mucus alone does not prove a bacterial infection, and neither does a fever by itself. A clinician decides based on the pattern of illness, examination and sometimes a test.',
            ar: 'الإنفلونزا وأغلب التهابات الحلق والتهاب الشعب الهوائي الحاد ونزلات البرد سببها فيروس. المضاد الحيوي لا يؤثر على الفيروس ومع ذلك له آثار جانبية. اللون الأخضر أو الأصفر للمخاط وحده لا يثبت عدوى بكتيرية، والحرارة وحدها أيضاً لا تكفي. يقرر الطبيب بناءً على نمط المرض والفحص وأحياناً تحليل.'
          }
        },
        {
          heading: { en: 'Signs to go back for advice', ar: 'علامات تستدعي العودة للاستشارة' },
          body: {
            en: 'Return to a doctor or pharmacist if fever persists beyond the time the prescriber gave you, if symptoms worsen after initial improvement, if a rash, facial swelling, breathing difficulty or severe watery diarrhoea appears, or if you were prescribed an antibiotic and could not take it for more than a day for any reason.',
            ar: 'عد إلى الطبيب أو الصيدلي إذا استمرت الحرارة بعد المدة التي حددها الطبيب، أو ساءت الأعراض بعد تحسن مبدئي، أو ظهر طفح أو تورم بالوجه أو صعوبة تنفس أو إسهال مائي شديد، أو إذا لم تتمكن من أخذ المضاد الحيوي لأكثر من يوم لأي سبب.'
          }
        }
      ]
    },
    {
      id: 'paracetamol-safe', kind: 'article', topic: 'medicines', minutes: 4,
      title: { en: 'Paracetamol: staying inside the safe range', ar: 'الباراسيتامول: البقاء داخل الحد الآمن' },
      summary: {
        en: 'The dose ceiling for adults, the duplicate products that quietly add up, and the liver question.',
        ar: 'الحد الأقصى للبالغين، والأدوية المتكررة التي تتجمع بصمت، ومسألة الكبد.'
      },
      sources: [
        { en: 'Registered product leaflets — Egyptian Drug Authority', ar: 'نشرات المستحضرات المسجلة — هيئة الدواء المصرية', url: 'https://edaegypt.gov.eg/en/' },
        { en: 'Drugcopeia medicine directory (Egyptian market listings)', ar: 'دليل Drugcopeia للأدوية (قوائم السوق المصري)', url: 'https://github.com/hussein-elnagmy/egyptian-drug-database' }
      ],
      sections: [
        {
          heading: { en: 'The adult ceiling', ar: 'الحد الأقصى للبالغين' },
          body: {
            en: 'For a healthy adult, the usual single dose is 500 mg to 1000 mg, repeated no more often than every four to six hours, with a total that stays at or below 4000 mg in twenty-four hours — and lower for body weight under 50 kg. The ceiling is a maximum, not a target. Doses above the labelled range do not add pain relief; they add liver risk.',
            ar: 'للشخص البالغ الصحي تكون الجرعة المعتادة من 500 إلى 1000 ملجم، ولا تُكرر بأكثر من مرة كل أربع إلى ست ساعات، مع بقاء الإجمالي عند 4000 ملجم أو أقل خلال أربع وعشرين ساعة، وأقل من ذلك لمن يقل وزنه عن 50 كجم. الحد الأقصى سقف وليس هدفاً. الجرعات الزائدة لا تزيد تسكين الألم لكنها تزيد الخطر على الكبد.'
          }
        },
        {
          heading: { en: 'Where duplicates hide', ar: 'أين يختفي التكرار' },
          body: {
            en: 'Paracetamol is a ingredient in many combination products for cold, flu, sinus pain and period pain, and the amount is not always obvious from the brand name. Taking a plain tablet plus a combination tablet can double the dose without anyone noticing. Add up every product over the day, and search the ingredient name rather than the brand when you check.',
            ar: 'الباراسيتامول يوجد كمادة فعالة في كثير من الأدوية المركبة للبرد والإنفلونزا وألم الجيوب وألم الدورة، ولا يظهر المقدار دائماً بوضوح من الاسم التجاري. تناول قرص مفرد مع قرص مركّب قد يضاعف الجرعة دون انتباه. اجمع كل ما تناولته خلال اليوم، وابحث باسم المادة الفعالة لا بالاسم التجاري.'
          }
        },
        {
          heading: { en: 'Liver, alcohol and fasting', ar: 'الكبد والكحول والصيام' },
          body: {
            en: 'Regular heavy alcohol use, existing liver disease, malnutrition and prolonged fasting all lower the amount of paracetamol the liver can handle safely. In those situations the practical ceiling is set by a doctor, not by the packet. If an accidental overdose is suspected, seek medical advice immediately even when you feel completely well — liver injury can be silent for the first day.',
            ar: 'الإدمان المنتظم على الكحول وأمراض الكبد القائمة وسوء التغذية والصيام الطويل كلها تقلل ما يستطيع الكبد التعامل معه بأمان من الباراسيتامول. في هذه الحالات يحدد الطبيب السقف العملي وليس العبوة. وإذا اشتبهت في جرعة زائدة بالخطأ اطلب رعاية طبية فوراً حتى لو كنت تشعر أنك بخير تماماً، لأن إصابة الكبد قد تكون صامتة في اليوم الأول.'
          }
        }
      ]
    },
    {
      id: 'cbc-reading', kind: 'article', topic: 'tests', minutes: 5,
      title: { en: 'Reading a complete blood count', ar: 'قراءة صورة الدم الكاملة' },
      summary: {
        en: 'What each line of a CBC says, and why one number outside the range rarely means anything on its own.',
        ar: 'ماذا يعني كل سطر في صورة الدم، ولماذا نادراً ما يعني رقم واحد خارج المدى شيئاً بمفرده.'
      },
      sources: [{ en: 'Laboratory directory in Drugcopeia', ar: 'دليل التحاليل داخل Drugcopeia', url: '' }],
      sections: [
        {
          heading: { en: 'What the test measures', ar: 'ماذا يقيس التحليل' },
          body: {
            en: 'A complete blood count measures the cellular part of blood: red cells and the haemoglobin they carry, the white cell total and its differential, and the platelets. It is a screening picture of anaemia, infection, inflammation, bleeding risk and bone-marrow disorders — not a diagnosis of any one of them.',
            ar: 'صورة الدم الكاملة تقيس الجزء الخلوي من الدم: كرات الدم الحمراء والهيموجلوبين داخلها، وإجمالي كرات الدم البيضاء وتوزيعها، والصفائح الدموية. هي صورة استكشافية للأنيميا والعدوى والالتهاب وخطر النزيف وأمراض نخاع العظم، وليست تشخيصاً لشيء منها بمفردها.'
          }
        },
        {
          heading: { en: 'The lines that matter', ar: 'السطور المهمة' },
          body: {
            en: 'Haemoglobin and haematocrit describe how much oxygen-carrying blood you have; MCV says whether red cells are small, normal or large, which points in a direction — small cells suggest iron deficiency or thalassaemia trait, large cells suggest vitamin B12 or folate deficiency or liver disease. The white cell count rises in infection, inflammation and stress, and the differential says which cell type moved. Platelets above or below range change bleeding and clotting risk.',
            ar: 'الهيموجلوبين ومكدس الدم يصفان كمية الدم الحامل للأكسجين، بينما حجم الكرة المتوسط MCV يوضح إن كانت الكرات صغيرة أو طبيعية أو كبيرة، وهو ما يوجه التشخيص: الخلايا الصغيرة تقترح نقص حديد أو صفة ثلاسيميا، والكبيرة تقترح نقص فيتامين B12 أو الفولات أو مرضاً بالكبد. عدد كرات الدم البيضاء يرتفع في العدوى والالتهاب والتوتر، والتوزيع يوضح نوع الخلايا التي تحركت. ارتفاع أو انخفاض الصفائح يغيّر خطر النزيف أو التجلط.'
          }
        },
        {
          heading: { en: 'Why one value is not a verdict', ar: 'لماذا لا يكون رقم واحداً حكماً' },
          body: {
            en: 'Reference ranges describe the middle 95% of a healthy population, so a normal person can sit slightly outside them. Dehydration, recent exercise, a cold, the time of day and the laboratory method all move numbers. Trends and symptoms matter more than a single result, and a clinician reads the panel together rather than line by line.',
            ar: 'المدى المرجعي يصف 95% من الأشخاص الأصحاء، لذلك قد يقع شخص سليم قليلاً خارجه. الجفاف والمجهود البدني ونزلة برد وساعة اليوم وطريقة العمل في المعمل كلها تحرّك الأرقام. الاتجاه عبر الزمن مع الأعراض أهم من نتيجة واحدة، ويقرأ الطبيب التحليلات معاً لا سطراً سطراً.'
          }
        }
      ]
    },
    {
      id: 'hba1c', kind: 'article', topic: 'tests', minutes: 4,
      title: { en: 'HbA1c: the three-month sugar picture', ar: 'الهيموجلوبين السكري: صورة الشهور الثلاثة' },
      summary: {
        en: 'What the percentage really reflects, the bands used, and what can make it lie.',
        ar: 'ما يعكسه النسبة فعلاً، والمدى المستخدم، وما قد يجعلها غير دقيقة.'
      },
      sources: [{ en: 'National screening and treatment programmes — Ministry of Health and Population', ar: 'البرامج القومية للفحص والعلاج — وزارة الصحة والسكان', url: 'https://www.mohp.gov.eg/' }],
      sections: [
        {
          heading: { en: 'What it shows', ar: 'ماذا تعكس' },
          body: {
            en: 'Glucose sticks to haemoglobin inside red cells, and that bond is permanent for the life of the cell. Because red cells live roughly three months, HbA1c reports the average blood sugar over the previous two to three months, weighted towards the most recent weeks. It is a memory of exposure, not a reading of today.',
            ar: 'يرتبط الجلوكوز بالهيموجلوبين داخل كرات الدم الحمراء، وهذا الارتباط يبقى طوال عمر الخلية. لأن الكرة تعيش نحو ثلاثة أشهر، تعكس نسبة HbA1c متوسط السكر خلال الشهرين إلى الثلاثة السابقة، بتركيز أكبر على الأسابيع الأخيرة. هي ذاكرة للتعرض وليست قراءة لليوم.'
          }
        },
        {
          heading: { en: 'Typical bands', ar: 'المدى المعتاد' },
          body: {
            en: 'Below about 5.7% is usual for most adults. Roughly 5.7% to 6.4% is described as a pre-diabetes range. 6.5% or above on two separate occasions is one of the criteria used for diabetes. For someone already treated, the personal target is set by the treating team and depends on age, other illness and hypoglycaemia risk.',
            ar: 'أقل من نحو 5.7% يُعد طبيعياً لمعظم البالغين. ومن حوالي 5.7% إلى 6.4% يُوصف بمدى ما قبل السكري. ونسبة 6.5% أو أعلى في مرتين منفصلتين من معايير تشخيص السكري. أما للشخص الذي يتلقى علاجاً فيحدد الفريق المعالج الهدف الشخصي حسب السن والأمراض الأخرى وخطر هبوط السكر.'
          }
        },
        {
          heading: { en: 'When the number misleads', ar: 'متى يخدع الرقم' },
          body: {
            en: 'Anything that shortens or lengthens red-cell life distorts HbA1c: haemolytic anaemia, recent bleeding or transfusion, iron-deficiency anaemia, kidney failure on dialysis, pregnancy and some haemoglobin variants. In those cases a fructosamine test, continuous glucose monitoring or plain fasting glucose gives a truer picture.',
            ar: 'أي شيء يقصّر أو يطيل عمر كرات الدم الحمراء يشوّه النتيجة: الأنيميا الانحلالية، النزيف أو نقل الدم الحديث، أنيميا نقص الحديد، الفشل الكلوي مع الغسيل، الحمل، وبعض أنواع الهيموجلوبين المتغيرة. في هذه الحالات يعطي فحص الفركتوزامين أو متابعة السكر المستمرة أو سكر الصيام العادي صورة أدق.'
          }
        }
      ]
    },
    {
      id: 'hot-climate-storage', kind: 'article', topic: 'medicines', minutes: 4,
      title: { en: 'Storing medicines in a hot climate', ar: 'حفظ الأدوية في جو حار' },
      summary: {
        en: 'Which products need a fridge, why the bathroom cabinet is the worst place, and how to read a change in appearance.',
        ar: 'أي أصناف تحتاج الثلاجة، ولماذا تُعد خزانة الحمام أسوأ مكان، وكيف تقرأ تغيّر شكل الدواء.'
      },
      sources: [{ en: 'Storage conditions on registered labels — Egyptian Drug Authority', ar: 'ظروف التخزين على المستحضرات المسجلة — هيئة الدواء المصرية', url: 'https://edaegypt.gov.eg/en/' }],
      sections: [
        {
          heading: { en: 'Room temperature is not a guess', ar: 'درجة حرارة الغرفة ليست تخميناً' },
          body: {
            en: 'A label that says "store below 25°C" or "below 30°C" is a stability limit, not a suggestion. Egyptian summer indoor temperatures can exceed both, especially in a car, on a windowsill, or on a shelf above a fridge. Keep medicines in the coolest shaded inside room of the flat, away from the kitchen hob and direct sun.',
            ar: 'العبارة المكتوبة "يُحفظ أقل من 25 درجة" أو "أقل من 30" حدٌّ للثبات وليست نصيحة اختيارية. حرارة داخل المنازل في الصيف المصري قد تتجاوز الرقمين، خصوصاً داخل السيارة أو بجوار النافذة أو على رف فوق الثلاجة. احفظ الأدوية في أبرد غرفة مظللة داخل المنزل، بعيداً عن البوتاجاز وأشعة الشمس المباشرة.'
          }
        },
        {
          heading: { en: 'What belongs in the fridge', ar: 'ما الذي يوضع في الثلاجة' },
          body: {
            en: 'Insulin in use, many eye drops after opening, reconstituted antibiotic suspensions, some suppositories and most biological products need refrigeration at 2 to 8°C. Never freeze them and never place them against the back wall of the fridge, where a frozen insulin pen loses its action. Some products are fridge-only while sealed and room-temperature once opened, so read the leaflet for the opened-pack period.',
            ar: 'الأنسولين المستخدم، وكثير من قطرات العين بعد الفتح، ومعلقات المضادات الحيوية بعد الإعداد، وبعض التحاميل ومعظم المستحضرات الحيوية تحتاج تبريداً من 2 إلى 8 درجات. لا تجمّدها أبداً ولا تلصقها بالجدار الخلفي للثلاجة، لأن قلم الأنسولين المتجمد يفقد مفعوله. بعض الأصناف تُحفظ بالثلاجة وهي مغلقة وتُترك في حرارة الغرفة بعد الفتح، فاقرأ نشرة مدة العبوة المفتوحة.'
          }
        },
        {
          heading: { en: 'Moisture, and when to discard', ar: 'الرطوبة ومتى تتخلص منه' },
          body: {
            en: 'Bathrooms and kitchens are humid, and moisture breaks tablets down inside the blister. Take the medicine out of those rooms. Discard and replace a product that is past its printed date, that has changed colour, smell or texture, that has tablets sticking together or powder inside the blister, or a cream that has separated into oil and water. An expired antibiotic in particular may simply fail when you need it.',
            ar: 'الحمام والمطبخ رطبان، والرطوبة تكسر الأقراص داخل الشريط. انقل الأدوية خارج هاتين الغرفتين. تخلص من أي صنف تجاوز تاريخ الصلاحية المكتوب أو تغيّر لونه أو رائحته أو قوامه، أو التصقت أقراصه أو ظهر مسحوق داخل الشريط، أو كريم انفصل إلى زيت وماء، واستبدله. المضاد الحيوي منتهي الصلاحية بصفة خاصة قد يفشل وقت الحاجة.'
          }
        }
      ]
    },
    {
      id: 'full-medication-list', kind: 'article', topic: 'medicines', minutes: 3,
      title: { en: 'Everything you take belongs in the list', ar: 'كل ما تتناوله يجب أن يكون في القائمة' },
      summary: {
        en: 'Interactions are missed most often because supplements, inhalers and as-needed tablets never made it onto the list.',
        ar: 'أكثر أسباب تفويت التداخلات الدوائية أن المكملات والبخاخات وأقراص الحاجة لم تدخل القائمة أصلاً.'
      },
      sources: [{ en: 'Interaction checker in Drugcopeia', ar: 'أداة فحص التداخلات في Drugcopeia', url: '' }],
      sections: [
        {
          heading: { en: 'What to disclose', ar: 'ماذا يجب أن تذكر' },
          body: {
            en: 'Prescribed medicines, over-the-counter painkillers and antacids, vitamins and minerals, herbal and Arabic-medicine preparations, contraceptives, inhalers, eye drops, skin creams, and anything you take only when symptoms appear. Include doses and how often, not just names.',
            ar: 'الأدوية الموصوفة، ومسكنات الألم ومضادات الحموضة التي تُصرف بدون وصفة، والفيتامينات والأملاح المعدنية، والأعشاب والمستحضرات الطبية، ووسائل منع الحمل، والبخاخات، وقطرات العين، وكريمات الجلد، وأي شيء تأخذه عند ظهور الأعراض فقط. اذكر الجرعة وعدد المرات وليس الاسم وحده.'
          }
        },
        {
          heading: { en: 'The commonest missed pairs', ar: 'أكثر الأزواج إغفالاً' },
          body: {
            en: 'St John\'s wort lowering the level of hormonal contraceptives and some heart medicines; calcium, iron, magnesium and antacids blocking absorption of certain antibiotics and thyroid tablets when taken at the same hour; NSAID painkillers raising the effect of blood thinners and stressing the kidneys of someone on an ACE inhibitor plus a diuretic; grapefruit juice with some statins. None of these are obvious from the brand name.',
            ar: 'نبتة سانت جون تخفّض مستوى وسائل منع الحمل الهرمونية وبعض أدوية القلب؛ الكالسيوم والحديد والمغنيسيوم ومضادات الحموضة تمنع امتصاص بعض المضادات الحيوية وأقراص الغدة الدرقية عند تناولها في نفس الساعة؛ مسكنات مجموعة NSAID ترفع أثر مميّعات الدم وتجهِد الكلى عند من يتناول مثبط ACE مع مدرّ بول؛ وعصير الجريب فروت مع بعض الستاتينات. لا شيء من هذا يظهر من الاسم التجاري.'
          }
        },
        {
          heading: { en: 'A habit that works', ar: 'عادة عملية تنفع' },
          body: {
            en: 'Keep one photograph or note on your phone with every product, its strength and how often you take it, and show it at each visit and each pharmacy counter. Update it the day a medicine changes, not the day you remember. For long-term conditions, carry the list in the wallet as well as the phone.',
            ar: 'احتفظ بصورة أو ملاحظة واحدة على الهاتف توضح كل صنف وقوته وعدد مرات تناوله، وأرِها في كل زيارة وكل مرة تقف فيها أمام الصيدلية. حدّثها في يوم تغيّر الدواء لا حين تتذكر. ولمن يعاني مرضاً مزمناً، احتفظ بالقائمة في المحفظة مع الهاتف.'
          }
        }
      ]
    },
    {
      id: 'vitamin-d', kind: 'article', topic: 'medicines', minutes: 4,
      title: { en: 'Vitamin D: testing, dosing and overdoing it', ar: 'فيتامين د: التحليل والجرعة والإفراط' },
      summary: {
        en: 'Which blood level is used, how supplements differ, and the signs that the dose went too far.',
        ar: 'أي مستوى دم يُستخدم، وما الفرق بين المكملات، وعلامات أن الجرعة تجاوزت الحد.'
      },
      sources: [{ en: 'Registered supplement labels — Egyptian Drug Authority', ar: 'بطاقات المكملات المسجلة — هيئة الدواء المصرية', url: 'https://edaegypt.gov.eg/en/' }],
      sections: [
        {
          heading: { en: 'Which test and which range', ar: 'أي تحليل وأي مدى' },
          body: {
            en: 'The test used is 25-hydroxyvitamin D. Many laboratories treat roughly 30 ng/mL and above as adequate, 20 to 30 as low, and below 20 as deficient, while targets differ with age, pregnancy, osteoporosis treatment and kidney or parathyroid disease. Ask which number your clinician is aiming at rather than reading one band off the printout.',
            ar: 'التحليل المستخدم هو 25-هيدروكسي فيتامين د. كثير من المعامل تعتبر نحو 30 نانوجرام/مل وأعلى كافياً، ومن 20 إلى 30 منخفضة، وأقل من 20 نقصاً، بينما تختلف الأهداف مع السن والحمل وعلاج هشاشة العظم وأمراض الكلى والغدة الجاردرقية. اسأل عن الرقم الذي يستهدفه الطبيب بدلاً من قراءة مدى واحد من الورقة.'
          }
        },
        {
          heading: { en: 'D2, D3 and the dose question', ar: 'D2 و D3 وسؤال الجرعة' },
          body: {
            en: 'Cholecalciferol (D3) and ergocalciferol (D2) both work, with D3 usually raising levels a little more efficiently per unit. Daily maintenance doses are safer and steadier than very large infrequent doses, and high-dose loading courses are meant to be time-limited and supervised. Products vary widely in strength in the Egyptian market, so check the units per drop or per tablet rather than the brand.',
            ar: 'الكوليكالسيفيرول D3 والإرجوكالسيفيرول D2 كلاهما يعمل، وغالباً يرفع D3 المستوى بكفاءة أكبر لكل وحدة. الجرعات اليومية المعوضة أكثر أماناً وثباتاً من الجرعات الكبيرة المتباعدة، ودورات التحميل بجرعات عالية المقصود بها مدة محدودة وتحت إشراف. تختلف القوة اختلافاً كبيراً بين الأصناف في السوق المصري، راجع الوحدات في النقطة أو القرص لا الاسم التجاري.'
          }
        },
        {
          heading: { en: 'Too much is real', ar: 'الزيادة ممكنة فعلاً' },
          body: {
            en: 'Vitamin D is fat-soluble and accumulates. Excess raises calcium, which causes nausea, vomiting, constipation, thirst, frequent urination, confusion and, over time, kidney stones and kidney injury. The usual cause is a high daily dose taken for months without a test. Persistent symptoms on supplements warrant a blood calcium and vitamin D check, and stopping the supplement is the first sensible step while you seek advice.',
            ar: 'فيتامين د يذوب في الدهون ويتجمع في الجسم. الزيادة ترفع الكالسيوم، فيسبب غثياناً وقيئاً وإمساكاً وعطشاً وكثرة بول وتشوشاً، ومع الوقت حصوات وكلوى متضررة. السبب المعتاد جرعة يومية عالية لعدة أشهر بدون تحليل. الأعراض المستمرة مع المكملات تستدعي فحص الكالسيوم وفيتامين د في الدم، وإيقاف المكمل هي أول خطوة معقولة أثناء طلب الاستشارة.'
          }
        }
      ]
    }
  ]
};
