#!/usr/bin/env python3
"""Shortens the explanatory copy in the two translation dictionaries.

Each entry maps an i18n key to its new English and Arabic text. A key whose
current value is already shorter than the replacement is left alone and
reported, so the script can never make a string longer by accident.
"""
import re
import sys

APP = "webapp/app.js"

# key -> (english, arabic)
TRIMS = {
    "remindersIntro": (
        "Plan your daily medicines and track what is due.",
        "خطط لأدويتك اليومية وتابع ما حان موعده.",
    ),
    "reminderNotice": (
        "Dawaya sounds a long alert at the chosen time and repeats 10 and 30 minutes later "
        "until you mark the dose taken. Never double a missed dose.",
        "يُصدر دوايا نغمة طويلة في الموعد المحدد ثم يعيد التنبيه بعد 10 و30 دقيقة حتى تسجّل "
        "أن الجرعة أُخذت. لا تضاعف جرعة فاتتك.",
    ),
    "reminderNoticeWindow": (
        "Alerts arrive even while Dawaya is closed.",
        "التنبيهات تصل حتى والتطبيق مغلق.",
    ),
    "reminderFormHint": (
        "Repeats daily. Confirm the dose with your pharmacist.",
        "يتكرر يوميًا. تحقق من الجرعة مع الصيدلي.",
    ),
    "reminderLimitNote": (
        "Up to 20 reminders on this device.",
        "حتى 20 تذكيرًا على هذا الجهاز.",
    ),
    "reminderNoReminders": (
        "Add a reminder to start today\\u2019s timeline.",
        "أضف تذكيرًا لبدء خطة اليوم.",
    ),
    "reminderEmptyText": (
        "Add a medicine and a time to start.",
        "أضف دواء ووقتًا للبدء.",
    ),
    "heroMeta": (
        "Ingredients, pharmacology and details",
        "المادة الفعالة وآلية العمل والتفاصيل",
    ),
    "conditionsDescription": (
        "Search the condition index by name or body system, then follow the source links.",
        "ابحث في فهرس الحالات بالاسم أو حسب جهاز الجسم ثم افتح روابط المصادر.",
    ),
    "conditionsAttribution": (
        "Condition names, synonyms, ICD codes and source links ship inside the app from the free "
        "NLM ClinicalTables and MedlinePlus data. Nothing is looked up online.",
        "أسماء الحالات والمرادفات ورموز ICD وروابط المصادر مضمّنة من بيانات ClinicalTables "
        "وMedlinePlus المجانية. لا يتم أي بحث عبر الإنترنت.",
    ),
    "conditionDisclaimer": (
        "Treatment depends on the diagnosis and the person. This page does not diagnose or prescribe.",
        "العلاج يعتمد على التشخيص وحالة الشخص. لا تشخّص هذه الصفحة ولا تصف علاجًا.",
    ),
    "safetyText": (
        "This guide is educational and does not provide diagnosis or individualized treatment. "
        "Doses and risks depend on the product, age, pregnancy and medical history. Read the "
        "product leaflet and ask a doctor or pharmacist.",
        "هذا الدليل تعليمي ولا يقدم تشخيصًا أو علاجًا فرديًا. تختلف الجرعات والمخاطر حسب المنتج "
        "والعمر والحمل والتاريخ الصحي. اقرأ نشرة المنتج واستشر طبيبًا أو صيدليًا.",
    ),
    "aboutText1": (
        "Dawaya brings medicines found in Egypt into one searchable directory: brand names, "
        "active ingredients, manufacturers, classifications, routes and prices.",
        "يجمع دوايا الأدوية المتداولة في مصر في دليل واحد قابل للبحث: الأسماء التجارية والمواد "
        "الفعالة والشركات والتصنيفات وطرق الإعطاء والأسعار.",
    ),
    "aboutText2": (
        "Medicine data ships inside the app and changes only with a new build. Educational notes "
        "do not replace the approved product leaflet.",
        "بيانات الأدوية مضمّنة داخل التطبيق ولا تتغيّر إلا بإصدار جديد. الشروح التعليمية لا تغني "
        "عن النشرة المعتمدة للمنتج.",
    ),
    "routeInstruction": (
        "This describes the route or dosage form only, not a dose or schedule. Follow the product "
        "leaflet and prescription.",
        "هذه المعلومة تحدد طريقة الإعطاء أو الشكل الدوائي فقط، ولا تحدد جرعة أو مواعيد. اتبع "
        "النشرة والوصفة.",
    ),
    "safeUse": (
        "Check the approved leaflet for this exact brand. Confirm allergies, interactions and "
        "pregnancy cautions with a healthcare professional.",
        "راجع النشرة المعتمدة للعلامة التجارية نفسها. تحقق من الحساسية والتداخلات وتحذيرات الحمل "
        "مع مختص صحي.",
    ),
    "classLimits": (
        "The class alone cannot confirm the action, uses, side effects or warnings for this product.",
        "لا يكفي التصنيف وحده لتأكيد آلية العمل أو الاستخدامات أو الآثار أو التحذيرات الخاصة "
        "بالمنتج.",
    ),
    "noInstructions": (
        "The database holds no verified indications, instructions or side effects for this product. "
        "Check the leaflet and ask a pharmacist.",
        "لا تتضمن القاعدة دواعي استعمال أو تعليمات أو آثارًا جانبية موثقة لهذا المنتج. راجع "
        "النشرة واستشر صيدليًا.",
    ),
    "leafletAdvice": (
        "For product-specific information, check the approved leaflet and ask a pharmacist.",
        "للمعلومات الخاصة بالمنتج، راجع النشرة المعتمدة واستشر الصيدلي.",
    ),
    "officialProductAdvice": (
        "For product-specific information, check the approved leaflet and ask a pharmacist.",
        "للمعلومات الخاصة بالمنتج، راجع النشرة المعتمدة واستشر الصيدلي.",
    ),
}

VALUE = "%s:'((?:[^'\\\\]|\\\\.)*)'"


def rewrite(text, key, new_value, which, report):
    """Replace the `which`th `key:'...'` value in the file, 1-based."""
    pattern = re.compile(VALUE % re.escape(key))
    matches = list(pattern.finditer(text))
    if len(matches) < which:
        report.append("MISSING %s (#%d)" % (key, which))
        return text
    match = matches[which - 1]
    current = match.group(1)
    if len(current) <= len(new_value):
        report.append("KEPT %s (#%d): %d -> %d chars" % (key, which, len(current), len(new_value)))
        return text
    start, end = match.span(1)
    report.append("TRIMMED %s (#%d): %d -> %d chars" % (key, which, len(current), len(new_value)))
    return text[:start] + new_value + text[end:]


def main():
    with open(APP, encoding="utf-8") as handle:
        text = handle.read()
    report = []
    for key, (english, arabic) in sorted(TRIMS.items()):
        occurrences = len(re.findall(r"(?<![A-Za-z_])%s:'" % re.escape(key), text))
        if occurrences != 2:
            report.append("SKIPPED %s: %d dictionary entries, expected 2" % (key, occurrences))
            continue
        text = rewrite(text, key, english, 1, report)
        text = rewrite(text, key, arabic, 2, report)
    with open(APP, "w", encoding="utf-8") as handle:
        handle.write(text)
    print("\n".join(report))
    return 0 if not any(item.startswith(("MISSING", "SKIPPED")) for item in report) else 1


if __name__ == "__main__":
    sys.exit(main())
