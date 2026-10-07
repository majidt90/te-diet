'use strict';
/**
 * آزمون تبدیل تاریخ جلالی در برابر نقاط مرجع شناخته‌شده.
 * اجرا: node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../lib/jalaali.js');

const REF = [
  // [سال میلادی، ماه، روز، سال شمسی، ماه شمسی، روز شمسی]
  [2024, 3, 20, 1403, 1, 1],   // نوروز ۱۴۰۳
  [2025, 3, 21, 1404, 1, 1],   // نوروز ۱۴۰۴
  [2026, 3, 21, 1405, 1, 1],   // نوروز ۱۴۰۵
  [2026, 10, 7, 1405, 7, 15],  // امروزِ محیط توسعه
  [2024, 3, 19, 1402, 12, 29], // آخرین روز ۱۴۰۲
  [1979, 2, 11, 1357, 11, 22], // ۲۲ بهمن ۱۳۵۷
  [2000, 1, 1, 1378, 10, 11],
  [2026, 1, 1, 1404, 10, 11],
];

test('تبدیل میلادی به شمسی برای نقاط مرجع', () => {
  for (const [gy, gm, gd, jy, jm, jd] of REF) {
    const r = J.toJalaali(new Date(gy, gm - 1, gd));
    assert.deepEqual(
      r,
      { jy, jm, jd },
      `${gy}-${gm}-${gd} باید بشود ${jy}/${jm}/${jd} ولی شد ${r.jy}/${r.jm}/${r.jd}`
    );
  }
});

test('رفت و برگشت شمسی↔میلادی بدون خطا', () => {
  for (const [gy, gm, gd, jy, jm, jd] of REF) {
    const g = J.toGregorian(jy, jm, jd);
    assert.equal(g.getFullYear(), gy);
    assert.equal(g.getMonth() + 1, gm);
    assert.equal(g.getDate(), gd);
  }
});

test('۱۴۰۳ کبیسه است و ۱۴۰۴ نیست', () => {
  assert.equal(J.isLeapJalaaliYear(1403), true);
  assert.equal(J.isLeapJalaaliYear(1404), false);
  assert.equal(J.jalaaliMonthLength(1403, 12), 30);
  assert.equal(J.jalaaliMonthLength(1404, 12), 29);
});

test('۲۰ سال رفت‌وبرگشت پیوسته بدون پرش', () => {
  const start = new Date(2020, 0, 1);
  let prevKey = null;
  for (let i = 0; i < 365 * 20; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    const j = J.toJalaali(d);
    const key = J.dateKey(j.jy, j.jm, j.jd);
    const back = J.toGregorian(j.jy, j.jm, j.jd);
    assert.equal(back.getTime(), new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
      `رفت‌وبرگشت در ${key} ناموفق بود`);
    if (prevKey) assert.equal(J.daysBetween(prevKey, key), 1, `پرش روز در ${key}`);
    prevKey = key;
  }
});

test('قالب‌بندی و ارقام فارسی', () => {
  assert.equal(J.formatDate(1405, 7, 15), '۱۵ مهر ۱۴۰۵');
  assert.equal(J.formatDate(1405, 7, 15, { short: true }), '۱۵ مهر');
  assert.equal(J.formatNumber(12345.6, 1), '۱۲٬۳۴۵٫۶');
  assert.equal(J.toPersianDigits('1405/07/15'), '۱۴۰۵/۰۷/۱۵');
  assert.equal(J.toLatinDigits('۱۴۰۵/۰۷/۱۵'), '1405/07/15');
  // ارقام عربی-هندی هم باید درست نرمال شوند (U+0660..U+0669)
  assert.equal(J.toLatinDigits('١٢٣'), '123');
  assert.equal(J.toLatinDigits('٠٩'), '09');
  assert.equal(J.toPersianDigits('٤٥٦'), '۴۵۶');
  assert.equal(J.toLatinDigits('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'), '01234567890123456789');
});

test('normalize ارقام و نویسه‌های عربی را یکدست می‌کند', () => {
  // normalize نباید اِعراب را حذف کند (حذف اِعراب کار stripDiacritics است)
  assert.equal(J.normalize('  كِتاب ي  ١٢٣ '), 'کِتاب ی 123');
  assert.equal(J.normalize('۱٫۵ کیلو'), '1.5 کیلو');
  assert.equal(J.stripDiacritics('کِتاب'), 'کتاب');
  // جداکنندهٔ هزارگان فارسی به کاما تبدیل می‌شود
  assert.equal(J.normalize('۱۲٬۳۴۵'), '12,345');
});

test('کار با کلید تاریخ: افزودن روز و بازهٔ هفته', () => {
  assert.equal(J.addDaysKey('1405-07-15', -15), '1405-06-31');
  assert.equal(J.addDaysKey('1404-12-29', 1), '1405-01-01');
  assert.equal(J.daysBetween('1405-07-01', '1405-07-15'), 14);
  assert.equal(J.lastNDays(3, '1405-07-15').join(','), '1405-07-13,1405-07-14,1405-07-15');
  // ۱۵ مهر ۱۴۰۵ = چهارشنبه؛ هفتهٔ شمسی از شنبه ۱۱ مهر تا جمعه ۱۷ مهر
  const w = J.currentWeekRange('1405-07-15');
  assert.deepEqual(w, { start: '1405-07-11', end: '1405-07-17' });
  assert.equal(J.weekdayName(1405, 7, 15), 'چهارشنبه');
});

test('نام‌گذاری نسبی روز', () => {
  assert.equal(J.relativeDayLabel(J.todayKey()), 'امروز');
  assert.equal(J.relativeDayLabel(J.addDaysKey(J.todayKey(), -1)), 'دیروز');
  assert.equal(J.relativeDayLabel(J.addDaysKey(J.todayKey(), 1)), 'فردا');
});

test('formatFullDate نام روز هفته را می‌آورد', () => {
  assert.equal(J.formatFullDate(1405, 7, 15), 'چهارشنبه ۱۵ مهر ۱۴۰۵');
});
