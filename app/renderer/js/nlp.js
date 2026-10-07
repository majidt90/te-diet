/* global module, define, require */
/**
 * renderer/js/nlp.js — استخراج موجودیت از متن فارسی.
 *
 * UMD: در renderer برای چیپ‌های سریع و در main برای پیدا کردن نامزدهای
 * غذا/تمرین و غنی‌سازی پرامپت استفاده می‌شود.
 *
 * نکته: این ماژول جایگزین مدل نیست؛ فقط ورودی کاربر را «ساختارمند» می‌کند
 * تا هم پرامپت دقیق‌تر شود و هم کاربر بتواند با یک کلیک ثبت کند.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../lib/jalaali.js'));
  } else if (typeof define === 'function' && define.amd) {
    define(['jalaali'], factory);
  } else {
    root.Nlp = factory(root.Jalaali);
  }
})(typeof self !== 'undefined' ? self : this, function (J) {
  'use strict';

  // —————————————————— واژه‌نامه ——————————————————

  const MEAL_KEYWORDS = {
    breakfast: ['صبحانه', 'صبحونه', 'سحری', 'صبح'],
    lunch: ['ناهار', 'نهار', 'ظهر', 'ناهارم'],
    dinner: ['شام', 'شامم', 'شب'],
    snack: ['میان وعده', 'میان‌وعده', 'عصرانه', 'اسنک', 'تنقلات', 'هله هوله'],
  };

  const FOOD_VERBS = ['خوردم', 'خوردیم', 'خورده', 'میل کردم', 'صبحانه خوردم', 'داشتم', 'داشتیم', 'سفارش دادم', 'درست کردم', 'پختم', 'گرفتم'];

  const WATER_WORDS = ['آب', 'اب', 'مایعات', 'لیوان آب'];

  const SLEEP_WORDS = ['خوابیدم', 'خواب', 'خوابم', 'استراحت'];

  const WORKOUT_WORDS = ['تمرین', 'ورزش', 'دویدم', 'دویدن', 'پیاده روی', 'پیاده‌روی', 'راه رفتم',
    'رفتم باشگاه', 'باشگاه', 'وزنه', 'شنا', 'بارفیکس', 'اسکوات', 'دوچرخه', 'طناب', 'یوگا', 'فوتبال'];

  const WEIGHT_WORDS = ['وزنم', 'وزن', 'کیلو شدم', 'کیلوگرم شدم'];

  // کلماتی که نباید به‌عنوان نام غذا جست‌وجو شوند
  const STOP_WORDS = new Set([
    'من', 'امروز', 'دیروز', 'پریروز', 'فردا', 'که', 'و', 'یا', 'اما', 'ولی', 'چون', 'اگر', 'هم',
    'خیلی', 'یکم', 'کمی', 'یه', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده',
    'خوردم', 'خوردیم', 'خورده', 'کردم', 'کرد', 'کردیم', 'داشتم', 'داشتیم', 'بود', 'بودم', 'شده',
    'برای', 'با', 'بدون', 'از', 'به', 'در', 'روی', 'تا', 'بعد', 'قبل', 'نیم', 'و نیم',
    'لیوان', 'قاشق', 'کاسه', 'بشقاب', 'پرس', 'عدد', 'گرم', 'کیلوگرم', 'کیلو', 'میلی لیتر', 'میلی‌لیتر',
    'دقیقه', 'ساعت', 'ست', 'تکرار', 'سلام', 'خوبی', 'چطوری', 'ممنون', 'لطفا', 'بگو', 'میخوام', 'می‌خوام',
    'صبحانه', 'ناهار', 'شام', 'میان وعده', 'میان‌وعده', 'عصرانه', 'چقدر', 'چند', 'کالری', 'چاق', 'لاغری',
  ]);

  const UNITS = {
    'کیلوگرم': 'kg', 'کیلو': 'kg', 'kg': 'kg',
    'گرم': 'g', 'g': 'g',
    'میلی لیتر': 'ml', 'میلی‌لیتر': 'ml', 'ml': 'ml', 'سی سی': 'ml',
    'لیتر': 'l', 'l': 'l',
    'لیوان': 'cup', 'پیمانه': 'cup',
    'قاشق غذاخوری': 'tbsp', 'قاشق': 'tbsp',
    'قاشق چایخوری': 'tsp',
    'کف دست': 'palm',
    'کفگیر': 'scoop',
    'بشقاب': 'plate',
    'کاسه': 'bowl',
    'پرس': 'serving',
    'عدد': 'piece',
    'برش': 'slice',
    'دانه': 'piece',
    'دقیقه': 'min', 'min': 'min',
    'ساعت': 'hour', 'hour': 'hour',
  };

  const DAY_WORDS = {
    'امروز': 0, 'دیروز': -1, 'پریروز': -2, 'فردا': 1,
    'شنبه': null, 'یکشنبه': null, 'دوشنبه': null, 'سه شنبه': null, 'سه‌شنبه': null,
    'چهارشنبه': null, 'پنجشنبه': null, 'جمعه': null,
  };

  // —————————————————— ابزار ——————————————————

  function norm(text) {
    let s = J.stripDiacritics(J.normalize(text)).replace(/[\u200c]/g, ' ').replace(/\s+/g, ' ').trim();
    // ممیز فارسی و اسلشِ بین دو رقم → ممیز لاتین.
    // «۷۴/۵» در فارسی محاوره‌ای یعنی ۷۴٫۵ و بدون این تبدیل ۷۴ خوانده می‌شود.
    s = s.replace(/(\d)\s*[٫\/]\s*(\d)/g, '$1.$2');
    // اعداد نوشته‌شده با حروف → رقم
    s = replaceNumberWords(s);
    return s;
  }

  const NUMBER_WORDS = {
    'نیم': 0.5, 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5,
    'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12,
  };

  /**
   * «دو لیوان آب» → «2 لیوان آب» (فقط وقتی واحد بلافاصله دنبال آن بیاید).
   *
   * توجه: از \b استفاده نمی‌کنیم! در جاوااسکریپت \b بر پایهٔ \w یعنی
   * [A-Za-z0-9_] تعریف شده و حروف فارسی «word» حساب نمی‌شوند، پس \b کنار
   * متن فارسی هرگز تطبیق نمی‌شود. به‌جایش از لنگر فاصله استفاده می‌کنیم.
   */
  function replaceNumberWords(s) {
    const unitNames = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');
    const words = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp(`(^|\\s)(${words})\\s+(?=${unitNames}(\\s|$))`, 'g');
    return s.replace(re, (_m, pre, w) => `${pre}${NUMBER_WORDS[w]} `);
  }

  /** «۷۴/۵» و «۷۴٫۵» و «۱٬۲۰۰» → عدد لاتین */
  function parseNumber(raw) {
    const s = J.toLatinDigits(String(raw))
      .replace(/٬|,/g, '')
      .replace(/[٫\/]/g, '.')
      .trim();
    const m = /^-?\d*\.?\d+/.exec(s);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  /** همهٔ عددهای متن همراه با موقعیت و واحدشان. */
  function extractMeasurements(text) {
    const s = norm(text);
    if (!s) return [];
    const unitNames = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*)(و\\s*نیم)?\\s*(${unitNames})?`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[0].trim() === '') continue;
      let value = parseNumber(m[1]);
      if (value === null) continue;
      if (m[2]) value += 0.5;
      const unitRaw = m[3] ? m[3].trim() : null;
      out.push({
        value,
        raw: m[0].trim(),
        unit_raw: unitRaw,
        unit: unitRaw ? UNITS[unitRaw] : null,
        index: m.index,
      });
      re.lastIndex = m.index + m[0].length;
    }
    return out;
  }

  /** تشخیص وعده از متن. */
  function detectMeal(text) {
    const s = norm(text);
    for (const [meal, words] of Object.entries(MEAL_KEYWORDS)) {
      for (const w of words) {
        if (s.includes(w)) return meal;
      }
    }
    // بر پایهٔ ساعت
    const h = new Date().getHours();
    if (h >= 4 && h < 11) return 'breakfast';
    if (h >= 11 && h < 15) return 'lunch';
    if (h >= 15 && h < 18) return 'snack';
    if (h >= 18 && h < 23) return 'dinner';
    return 'snack';
  }

  /** تشخیص اشارهٔ روز به کلید تاریخ شمسی. */
  function detectDay(text, todayKey) {
    const s = norm(text);
    const today = todayKey || J.todayKey();
    for (const [word, offset] of Object.entries(DAY_WORDS)) {
      if (!s.includes(word)) continue;
      if (offset !== null) return J.addDaysKey(today, offset);
      // نام روز هفته: نزدیک‌ترین نمونهٔ گذشته (۰ تا ۶ روز قبل)
      for (let back = 0; back <= 7; back += 1) {
        const key = J.addDaysKey(today, -back);
        if (J.weekdayName(key) === word) return key;
      }
    }
    return today;
  }

  /** وزن ذکرشده در متن. */
  function detectWeight(text) {
    const s = norm(text);
    const hasWord = WEIGHT_WORDS.some((w) => s.includes(w)) || /کیلو(g|گرم)?/.test(s);
    if (!hasWord) return null;
    const ms = extractMeasurements(s).filter((m) => m.unit === 'kg');
    if (ms.length) {
      const v = ms[0].value;
      if (v >= 15 && v <= 500) return v;
    }
    // «وزنم ۷۴» بدون واحد
    const m2 = /وزنم?\s*[:=]?\s*(\d+(?:[.\/]\d+)?)/.exec(s);
    if (m2) {
      const v = parseNumber(m2[1]);
      if (v && v >= 15 && v <= 500) return v;
    }
    return null;
  }

  /** مقدار آب. */
  function detectWater(text) {
    const s = norm(text);
    if (!WATER_WORDS.some((w) => s.includes(w))) return null;
    const ms = extractMeasurements(s);
    for (const m of ms) {
      if (m.unit === 'ml') return Math.round(m.value);
      if (m.unit === 'l') return Math.round(m.value * 1000);
      if (m.unit === 'cup') return Math.round(m.value * 240);
      if (!m.unit && m.value >= 1 && m.value <= 20) return Math.round(m.value * 240); // «دو لیوان آب»
    }
    return null;
  }

  /** ساعت خواب. */
  function detectSleep(text) {
    const s = norm(text);
    if (!SLEEP_WORDS.some((w) => s.includes(w))) return null;
    for (const m of extractMeasurements(s)) {
      if (m.unit === 'hour' && m.value <= 24) return m.value;
      if (!m.unit && m.value >= 1 && m.value <= 16) return m.value;
    }
    return null;
  }

  /**
   * الگوی «۳ ست ۱۲ تکرار با ۶۰ کیلو» یا «۳×۱۲ با ۶۰ کیلو».
   * هر سه جزء جداگانه پیدا می‌شوند؛ چون ترتیب و حضورشان در جملهٔ فارسی
   * خیلی متغیر است و یک regex واحد شکننده می‌شود.
   */
  function detectSetsReps(text) {
    const s = norm(text);
    const setsM = /(\d+(?:\.\d+)?)\s*ست/.exec(s);
    // تکرار: یا بعد از ضربدر، یا دقیقاً قبل از کلمهٔ «تکرار»
    const repsM = /(?:[×x*]\s*(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*تکرار)/.exec(s);
    // بار: «با ۶۰ کیلو» یا «۶۰ کیلوگرم»
    const loadM = /(?:با\s*)?(\d+(?:\.\d+)?)\s*کیلو(?:گرم)?/.exec(s);

    const sets = setsM ? parseNumber(setsM[1]) : null;
    const reps = repsM ? parseNumber(repsM[1] || repsM[2]) : null;
    const loadKg = loadM ? parseNumber(loadM[1]) : null;

    if (sets === null && reps === null && loadKg === null) return null;
    return { sets, reps, load_kg: loadKg };
  }

  /** مدت زمان (دقیقه). */
  function detectDuration(text) {
    const s = norm(text);
    for (const m of extractMeasurements(s)) {
      if (m.unit === 'min') return m.value;
      if (m.unit === 'hour') return m.value * 60;
    }
    // «نیم ساعت»
    if (/نیم ساعت/.test(s)) return 30;
    return null;
  }

  /**
   * تولید عبارت‌های جست‌وجو برای پیدا کردن غذا/تمرین.
   * n-gramهای ۱ تا ۳ کلمه‌ای از کلمات محتوایی.
   */
  function searchTerms(text, maxTerms = 12) {
    const s = norm(text);
    const words = s.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d/.test(w));
    const terms = [];
    const seen = new Set();
    const push = (t) => {
      const k = t.trim();
      if (k.length > 1 && !seen.has(k)) { seen.add(k); terms.push(k); }
    };
    for (let n = 3; n >= 1; n -= 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        push(words.slice(i, i + n).join(' '));
      }
    }
    return terms.slice(0, maxTerms);
  }

  /**
   * تحلیل کامل پیام کاربر — خروجی برای پرامپت و UI.
   */
  function analyze(text, opts = {}) {
    const todayKey = opts.today || J.todayKey();
    const s = norm(text);
    const measurements = extractMeasurements(text);

    const intents = [];
    if (FOOD_VERBS.some((v) => s.includes(v)) || MEAL_KEYWORDS.snack.concat(MEAL_KEYWORDS.breakfast, MEAL_KEYWORDS.lunch, MEAL_KEYWORDS.dinner).some((w) => s.includes(w))) {
      intents.push('log_meal');
    }
    if (detectWater(text) !== null) intents.push('log_water');
    if (detectWeight(text) !== null) intents.push('log_weight');
    if (detectSleep(text) !== null) intents.push('log_sleep');
    if (WORKOUT_WORDS.some((w) => s.includes(w)) || detectSetsReps(text)) intents.push('log_workout');

    return {
      text: s,
      intents: [...new Set(intents)],
      meal: detectMeal(text),
      day: detectDay(text, todayKey),
      day_label: J.relativeDayLabel(detectDay(text, todayKey)),
      weight_kg: detectWeight(text),
      water_ml: detectWater(text),
      sleep_hours: detectSleep(text),
      duration_min: detectDuration(text),
      sets_reps: detectSetsReps(text),
      measurements,
      terms: searchTerms(text),
      is_greeting: /^(سلام|درود|صبح بخیر|شب بخیر|خوبی|چطوری)/.test(s),
    };
  }

  /**
   * چیپ‌های پیشنهادی سریع برای زیر کادر ورودی.
   * @returns {Array<{label:string, text:string}>}
   */
  function quickActions(analysis) {
    const out = [];
    if (analysis.weight_kg) {
      out.push({ label: `ثبت وزن ${J.formatNumber(analysis.weight_kg, 1)} کیلوگرم`, text: `وزنم ${analysis.weight_kg} کیلوگرم است، ثبتش کن` });
    }
    if (analysis.water_ml) {
      out.push({ label: `ثبت ${J.formatNumber(analysis.water_ml)} میلی‌لیتر آب`, text: `${analysis.water_ml} میلی‌لیتر آب خوردم` });
    }
    const common = [
      { label: 'یک لیوان آب', text: 'یک لیوان آب خوردم' },
      { label: '۳۰ دقیقه پیاده‌روی', text: '۳۰ دقیقه پیاده‌روی سریع کردم' },
      { label: 'خلاصهٔ امروز', text: 'خلاصهٔ امروز را بگو' },
    ];
    for (const c of common) if (out.length < 4) out.push(c);
    return out.slice(0, 4);
  }

  return {
    MEAL_KEYWORDS,
    STOP_WORDS,
    UNITS,
    norm,
    parseNumber,
    extractMeasurements,
    detectMeal,
    detectDay,
    detectWeight,
    detectWater,
    detectSleep,
    detectDuration,
    detectSetsReps,
    searchTerms,
    analyze,
    quickActions,
  };
});
