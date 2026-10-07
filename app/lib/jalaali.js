/* global module, define */
/**
 * lib/jalaali.js — تبدیل تقویم جلالی (شمسی) و ابزار اعداد فارسی.
 *
 * این ماژول به‌صورت UMD نوشته شده تا «یک منبع حقیقت» هم در فرآیند main
 * (برای ذخیرهٔ تاریخ در SQLite) و هم در renderer (برای نمایش) استفاده شود.
 *
 * الگوریتمان بر پایهٔ پیاده‌سازی مرجع jalaali-js (لایسنس MIT) است و با
 * آزمون‌های test/jalaali.test.js در برابر تاریخ‌های شناخته‌شده بررسی می‌شود.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.Jalaali = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ——————— ریاضی پایه ———————
  var div = function (a, b) { return ~~(a / b); };
  var mod = function (a, b) { return a - ~~(a / b) * b; };

  /** محاسبهٔ پارامترهای سال جلالی (نقطهٔ تحویل و سال کبیسه). */
  function jalCal(jy) {
    var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635,
      2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    var bl = breaks.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = breaks[0];
    var jm, jump = 0, leap, leapG, march, n, i;

    if (jy < jp || jy >= breaks[bl - 1]) {
      throw new Error('سال جلالی نامعتبر: ' + jy);
    }

    for (i = 1; i < bl; i += 1) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;

    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;

    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;

    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
      + div(153 * mod(gm + 9, 12) + 2, 5)
      + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy);
    var jdn1f = g2d(gy, 3, r.march);
    var k = jdn - jdn1f;
    var jd, jm;

    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  function isLeapJalaaliYear(jy) { return jalCal(jy).leap === 0; }

  function jalaaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeapJalaaliYear(jy) ? 30 : 29;
  }

  // ——————— تبدیل از/به Date ———————
  function toJalaali(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d2j(g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  }

  function toGregorian(jy, jm, jd) {
    var g = d2g(j2d(jy, jm, jd));
    return new Date(g.gy, g.gm - 1, g.gd);
  }

  // ——————— ثابت‌های زبانی ———————
  var MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

  var MONTH_NAMES_SHORT = ['فرو', 'ارد', 'خرد', 'تیر', 'مرد', 'شهر', 'مهر', 'آبا', 'آذر', 'دی', 'بهم', 'اسف'];

  // هفته در ایران از شنبه شروع می‌شود
  var WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  var WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  // ——————— اعداد فارسی ———————
  var FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  var AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  var FA_MAP = { '٫': '.', '،': ',', '٬': ',', '؛': ';' };

  /** تبدیل ارقام لاتین/عربی به فارسی. */
  function toPersianDigits(input) {
    if (input === null || input === undefined) return '';
    return String(input).replace(/[0-9٠-٩]/g, function (c) {
      var code = c.charCodeAt(0);
      return FA_DIGITS[code <= 0x39 ? code - 0x30 : code - 0x0660];
    });
  }

  /**
   * تبدیل ارقام فارسی/عربی به لاتین (برای پردازش ورودی کاربر).
   * توجه: باید با «کدِ نویسه» مقایسه کنیم نه با خود رشته؛ چون ارقام عربی-هندی
   * (U+0660..U+0669) در ترتیب یونیکد «قبل از» ارقام فارسی (U+06F0..U+06F9)
   * قرار دارند و مقایسهٔ رشته‌ای آن‌ها را اشتباه تشخیص می‌دهد.
   */
  function toLatinDigits(input) {
    if (input === null || input === undefined) return '';
    return String(input).replace(/[۰-۹٠-٩]/g, function (c) {
      var code = c.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
  }

  /** حذف اِعراب (حرکت‌ها) برای تطبیق نادقیق متن. */
  function stripDiacritics(input) {
    if (input === null || input === undefined) return '';
    return String(input).replace(/[\u064B-\u0652\u0670\u0640]/g, '');
  }

  /** نرمال‌سازی نشانه‌های فارسی به لاتین برای parsing. */
  function normalize(input) {
    if (input === null || input === undefined) return '';
    var s = toLatinDigits(String(input)).trim();
    return s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
      .replace(/[٫،٬؛]/g, function (c) { return FA_MAP[c] || c; })
      .replace(/[\u200c\u200e\u200f]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  /** قالب‌بندی عدد با جداکنندهٔ هزارگان و ارقام فارسی. */
  function formatNumber(value, fractionDigits) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    var fd = fractionDigits === undefined ? (Number.isInteger(n) ? 0 : 1) : fractionDigits;
    var parts = n.toFixed(fd).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    return toPersianDigits(parts.join('٫'));
  }

  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /**
   * هر ورودی قابل قبول را به {jy, jm, jd} تبدیل می‌کند.
   * پشتیبانی از: آبجکت جلالی، کلید «1405-07-15»، و Date/مهر زمانی میلادی.
   */
  function coerceJalaali(input) {
    if (input === null || input === undefined || input === '') return toJalaali(new Date());
    if (typeof input === 'object' && input.jy !== undefined) {
      return { jy: input.jy, jm: input.jm, jd: input.jd };
    }
    if (typeof input === 'string') {
      var parsed = parseDateKey(input);
      if (parsed) return parsed;
      var d = new Date(input);
      if (!isNaN(d.getTime())) return toJalaali(d);
      throw new Error('تاریخ قابل تشخیص نیست: ' + input);
    }
    if (input instanceof Date) return toJalaali(input);
    if (typeof input === 'number') return toJalaali(new Date(input));
    throw new Error('ورودی تاریخ نامعتبر است.');
  }

  /** کلید تاریخ به شکل 1405-07-15 (برای ذخیره و ایندکس در SQLite). */
  function dateKey(a, b, c) {
    var o = resolveDate(a, b, c);
    return `${o.jy}-${pad2(o.jm)}-${pad2(o.jd)}`;
  }

  function parseDateKey(key) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(key || '').trim());
    if (!m) return null;
    return { jy: +m[1], jm: +m[2], jd: +m[3] };
  }

  /**
   * حل ورودی تاریخ: هم امضای سه‌عددی (jy, jm, jd) و هم تک‌ورودی
   * (کلید «1405-07-15»، آبجکت جلالی، Date یا مهر زمانی).
   */
  function resolveDate(a, b, c) {
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      return { jy: a, jm: b, jd: c };
    }
    return coerceJalaali(a);
  }

  /**
   * قالب‌بندی تاریخ شمسی.
   *   formatDate(1405, 7, 15)            → «۱۵ مهر ۱۴۰۵»
   *   formatDate('1405-07-15', {short})  → «۱۵ مهر»
   */
  function formatDate(a, b, c, d) {
    var o;
    var options;
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      o = { jy: a, jm: b, jd: c };
      options = d || {};
    } else {
      o = resolveDate(a);
      options = (b && typeof b === 'object') ? b : {};
    }

    if (options.short) {
      return toPersianDigits(`${o.jd} ${MONTH_NAMES_SHORT[o.jm - 1]}`);
    }
    var s = `${o.jd} ${MONTH_NAMES[o.jm - 1]}`;
    if (options.withYear !== false) s += ` ${o.jy}`;
    return toPersianDigits(s);
  }

  /** «شنبه ۱۵ مهر ۱۴۰۵» */
  function formatFullDate(a, b, c) {
    var o = resolveDate(a, b, c);
    var g = toGregorian(o.jy, o.jm, o.jd);
    var wd = WEEKDAY_NAMES[(g.getDay() + 1) % 7];
    return `${wd} ${formatDate(o)}`;
  }

  /** نام روز هفتهٔ شمسی برای یک تاریخ. */
  function weekdayName(a, b, c) {
    var o = resolveDate(a, b, c);
    var g = toGregorian(o.jy, o.jm, o.jd);
    return WEEKDAY_NAMES[(g.getDay() + 1) % 7];
  }

  /** «امروز»، «دیروز»، «فردا» یا نام روز. */
  function relativeDayLabel(key) {
    var parsed = parseDateKey(key);
    if (!parsed) return key;
    var today = dateKey(new Date());
    var target = dateKey(parsed.jy, parsed.jm, parsed.jd);
    if (target === today) return 'امروز';
    var yesterday = addDaysKey(today, -1);
    var tomorrow = addDaysKey(today, 1);
    if (target === yesterday) return 'دیروز';
    if (target === tomorrow) return 'فردا';
    return formatFullDate(parsed.jy, parsed.jm, parsed.jd);
  }

  function addDaysKey(key, days) {
    var p = parseDateKey(key);
    if (!p) return key;
    var jdn = j2d(p.jy, p.jm, p.jd) + days;
    var r = d2j(jdn);
    return dateKey(r.jy, r.jm, r.jd);
  }

  /** فاصلهٔ روزهای بین دو کلید تاریخ (target - base). */
  function daysBetween(baseKey, targetKey) {
    var a = parseDateKey(baseKey);
    var b = parseDateKey(targetKey);
    if (!a || !b) return 0;
    return j2d(b.jy, b.jm, b.jd) - j2d(a.jy, a.jm, a.jd);
  }

  /** n روز آخر، از قدیم به جدید. */
  function lastNDays(n, endKey) {
    var end = endKey || dateKey(new Date());
    var out = [];
    for (var i = n - 1; i >= 0; i -= 1) out.push(addDaysKey(end, -i));
    return out;
  }

  /** بازهٔ هفتهٔ جاری (شنبه تا جمعه) بر پایهٔ تاریخ داده‌شده. */
  function currentWeekRange(endKey) {
    var end = endKey || dateKey(new Date());
    var p = parseDateKey(end);
    if (!p) return null;
    var g = toGregorian(p.jy, p.jm, p.jd);
    var offset = (g.getDay() + 1) % 7; // 0 = شنبه
    return { start: addDaysKey(end, -offset), end: addDaysKey(end, 6 - offset) };
  }

  return {
    // تبدیل‌ها
    toJalaali: toJalaali,
    toGregorian: toGregorian,
    resolveDate: resolveDate,
    coerceJalaali: coerceJalaali,
    jalCal: jalCal,
    j2d: j2d,
    d2j: d2j,
    g2d: g2d,
    d2g: d2g,
    isLeapJalaaliYear: isLeapJalaaliYear,
    jalaaliMonthLength: jalaaliMonthLength,
    // قالب‌بندی
    formatDate: formatDate,
    formatFullDate: formatFullDate,
    weekdayName: weekdayName,
    relativeDayLabel: relativeDayLabel,
    formatNumber: formatNumber,
    toPersianDigits: toPersianDigits,
    toLatinDigits: toLatinDigits,
    stripDiacritics: stripDiacritics,
    normalize: normalize,
    // کار با کلید تاریخ
    dateKey: dateKey,
    parseDateKey: parseDateKey,
    addDaysKey: addDaysKey,
    daysBetween: daysBetween,
    lastNDays: lastNDays,
    currentWeekRange: currentWeekRange,
    today: function () { return toJalaali(new Date()); },
    todayKey: function () { return dateKey(new Date()); },
    MONTH_NAMES: MONTH_NAMES,
    MONTH_NAMES_SHORT: MONTH_NAMES_SHORT,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    WEEKDAY_SHORT: WEEKDAY_SHORT,
  };
});
