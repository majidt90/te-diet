'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const N = require('../renderer/js/nutrition.js');
const X = require('../renderer/js/exercise.js');
const Nlp = require('../renderer/js/nlp.js');
const J = require('../lib/jalaali.js');

// —————————————————— تغذیه ——————————————————

test('سن از تاریخ شمسی درست حساب می‌شود', () => {
  const today = { jy: 1405, jm: 7, jd: 15 };
  assert.equal(N.ageFromJalaali(1370, 5, 1, today), 35);
  // هنوز تولدش نرسیده
  assert.equal(N.ageFromJalaali(1370, 9, 1, today), 34);
  assert.equal(N.ageFromJalaali(null, null, null, today), null);
});

test('BMR با Mifflin-St Jeor', () => {
  // مرد ۸۰ کیلو، ۱۸۰ سانتی، ۳۰ سال: 10*80 + 6.25*180 - 5*30 + 5 = 1780
  assert.equal(N.bmr({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 }), 1780);
  // زن ۶۵ کیلو، ۱۶۵ سانتی، ۳۰ سال: 650 + 1031.25 - 150 - 161 = 1370.25
  assert.equal(N.bmr({ sex: 'female', weightKg: 65, heightCm: 165, age: 30 }), 1370);
  assert.equal(N.bmr({ sex: 'male', weightKg: 80 }), null);
});

test('TDEE و ضریب فعالیت', () => {
  assert.equal(N.tdee(1780, 'sedentary'), 2136);
  assert.equal(N.tdee(1780, 'athlete'), 3382);
  // سطح ناشناخته به «تحرک سبک» برمی‌گردد
  assert.equal(N.tdee(1780, 'نامعلوم'), N.tdee(1780, 'light'));
  assert.equal(N.tdee(null, 'light'), null);
});

test('BMI و برچسب فارسی', () => {
  const b = N.bmi(80, 180);
  assert.equal(b.value, 24.7);
  assert.equal(b.label, 'وزن سالم');
  assert.equal(N.bmiLabel(17), 'کمبود وزن');
  assert.equal(N.bmiLabel(27), 'اضافه وزن');
  assert.equal(N.bmiLabel(32), 'چاقی درجهٔ یک');
  assert.equal(N.bmiLabel(45), 'چاقی درجهٔ سه');
});

test('کالری هدف هرگز از کف ایمن کمتر نمی‌شود', () => {
  const aggressive = N.targetCalories({ tdeeValue: 1600, goal: 'lose', sex: 'female', goalRateKgPerWeek: 1.5 });
  assert.ok(aggressive.target >= 1200, `کف ایمن رعایت نشد: ${aggressive.target}`);
  assert.ok(aggressive.notes.length > 0, 'هشداری تولید نشد');
  // کسری بیش از ۱۰۰۰ محدود می‌شود
  const capped = N.targetCalories({ tdeeValue: 3000, goal: 'lose', sex: 'male', goalRateKgPerWeek: 3 });
  assert.ok(capped.target >= 2000, `کسری بیش از حد مجاز شد: ${capped.target}`);
  // افزایش وزن
  const gain = N.targetCalories({ tdeeValue: 2500, goal: 'gain', sex: 'male', goalRateKgPerWeek: 0.25 });
  assert.ok(gain.target > 2500);
  assert.ok(gain.target <= 3000);
  // ثبات
  assert.equal(N.targetCalories({ tdeeValue: 2200, goal: 'maintain', sex: 'male' }).target, 2200);
});

test('درشت‌مغذی‌ها با کالری هدف هم‌خوان هستند', () => {
  const m = N.macroTargets({ targetKcal: 2000, weightKg: 75, goal: 'lose', activityLevel: 'moderate' });
  const kcal = m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4;
  assert.ok(Math.abs(kcal - 2000) <= 200, `مجموع کالری درشت‌مغذی‌ها پرت است: ${kcal}`);
  assert.ok(m.fiber_g >= 21 && m.fiber_g <= 38);
  assert.equal(m.split.protein + m.split.fat + m.split.carbs > 90, true);
  // پروتئین در کسری کالری بالاتر است
  const bulk = N.macroTargets({ targetKcal: 2000, weightKg: 75, goal: 'maintain', activityLevel: 'sedentary' });
  assert.ok(m.protein_g >= bulk.protein_g);
});

test('هدف آب', () => {
  assert.equal(N.waterTarget({ weightKg: 70 }), 2450);
  assert.ok(N.waterTarget({ weightKg: 70, workoutMinutes: 60 }) > N.waterTarget({ weightKg: 70 }));
  // بدون وزن، پیش‌فرض ۷۰
  assert.equal(N.waterTarget({}), N.waterTarget({ weightKg: 70 }));
});

test('computeAll همه‌چیز را یکجا می‌دهد', () => {
  const today = { jy: 1405, jm: 7, jd: 15 };
  const r = N.computeAll({
    profile: { sex: 'male', birth_year: 1370, birth_month: 1, birth_day: 1, height_cm: 180, activity_level: 'moderate', goal: 'lose' },
    weightKg: 90,
    today,
  });
  assert.equal(r.age, 35);
  assert.equal(r.bmr, 1855); // 10×90 + 6.25×180 − 5×35 + 5
  assert.ok(r.tdee > r.bmr);
  assert.ok(r.target_kcal < r.tdee, 'در هدف کاهش وزن، کالری هدف باید کمتر از TDEE باشد');
  assert.equal(r.bmi_label, 'اضافه وزن');
  assert.ok(r.protein_g > 0 && r.fat_g > 0 && r.carbs_g > 0);
  assert.equal(r.healthy_weight.max < 90, true);
});

test('computeAll با پروفایل ناقص یادداشت می‌دهد و نمی‌شکند', () => {
  const r = N.computeAll({ profile: null, weightKg: null, today: { jy: 1405, jm: 7, jd: 15 } });
  assert.equal(r.bmr, null);
  assert.equal(r.target_kcal, null);
  assert.ok(r.notes.length >= 2);
});

// —————————————————— ورزش ——————————————————

test('برآورد کالری هوازی از MET', () => {
  // MET 4.3 × 80 کیلو × 1 ساعت = 344
  assert.equal(X.estimateCalories({ met: 4.3, weightKg: 80, durationMin: 60, kind: 'cardio' }), 344);
  assert.equal(X.estimateCalories({ met: 4.3, weightKg: 80, durationMin: 30, kind: 'cardio' }), 172);
  assert.equal(X.estimateCalories({ kind: 'cardio' }), 0);
});

test('برآورد کالری قدرتی از حجم کار', () => {
  const c = X.estimateCalories({ kind: 'strength', sets: 3, reps: 10, loadKg: 60 });
  assert.ok(c > 0);
  assert.equal(X.estimateCalories({ kind: 'strength', sets: 0, reps: 10, loadKg: 60 }), 0);
});

test('پیشنهاد اضافه‌بار تدریجی', () => {
  assert.equal(X.nextLoadSuggestion({ sets: 3, reps: 12, loadKg: 60 }).action, 'increase');
  assert.equal(X.nextLoadSuggestion({ sets: 3, reps: 12, loadKg: 60 }).load_kg, 63);
  assert.equal(X.nextLoadSuggestion({ sets: 3, reps: 6, loadKg: 60 }).action, 'decrease');
  assert.equal(X.nextLoadSuggestion({ sets: 3, reps: 10, loadKg: 60 }).action, 'hold');
  assert.equal(X.nextLoadSuggestion({ sets: 0, reps: 10, loadKg: 60 }), null);
});

test('RPE به برچسب فارسی', () => {
  assert.equal(X.rpeLabel(2), 'خیلی سبک');
  assert.equal(X.rpeLabel(6), 'متوسط');
  assert.equal(X.rpeLabel(10), 'نهایت توان');
  assert.equal(X.rpeLabel(null), null);
});

test('برنامهٔ هفتگی برای تعداد روزهای مختلف', () => {
  for (const d of [2, 3, 4, 5, 6]) {
    const p = X.buildWeeklyPlan({ daysPerWeek: d, goal: 'lose', level: 'متوسط' });
    assert.equal(p.days.length, d);
    assert.ok(p.days.every((x) => x.sets > 0 && x.reps && x.warmup_min === 8));
  }
  // خارج از بازه کران‌دار می‌شود
  assert.equal(X.buildWeeklyPlan({ daysPerWeek: 99 }).days.length, 6);
  assert.equal(X.buildWeeklyPlan({ daysPerWeek: 0 }).days.length, 3);
});

test('ارزیابی هفته در برابر توصیهٔ WHO', () => {
  const bad = X.assessWeek({ cardioMinutes: 60, strengthSessions: 0 });
  assert.equal(bad.meets_aerobic, false);
  assert.equal(bad.meets_strength, false);
  assert.equal(bad.gaps.length, 2);
  const good = X.assessWeek({ cardioMinutes: 180, strengthSessions: 3 });
  assert.equal(good.meets_aerobic, true);
  assert.equal(good.meets_strength, true);
  assert.equal(good.gaps.length, 0);
});

test('حجم هفتگی فقط تمرین قدرتی را می‌شمارد', () => {
  assert.equal(X.weeklyVolume([
    { kind: 'strength', sets: 3, reps: 10, load_kg: 50 },
    { kind: 'cardio', sets: 3, reps: 10, load_kg: 50 },
  ]), 1500);
});

// —————————————————— NLP ——————————————————

test('parseNumber ارقام فارسی، ممیز فارسی و «و نیم»', () => {
  assert.equal(Nlp.parseNumber('۷۴'), 74);
  assert.equal(Nlp.parseNumber('۷۴٫۵'), 74.5);
  assert.equal(Nlp.parseNumber('۷۴/۵'), 74.5);
  assert.equal(Nlp.parseNumber('۱٬۲۰۰'), 1200);
  assert.equal(Nlp.parseNumber('abc'), null);
});

test('رگرسیون: \\b جاوااسکریپت برای فارسی کار نمی‌کند و لنگر فاصله لازم است', () => {
  // اگر کسی دوباره از \b استفاده کند، این دو خطا می‌دهند
  assert.equal(Nlp.norm('دو لیوان آب خوردم'), '2 لیوان آب خوردم');
  assert.equal(Nlp.norm('یک لیتر آب خوردم'), '1 لیتر آب خوردم');
  // «یکشنبه» نباید به عدد تبدیل شود
  assert.equal(Nlp.norm('یکشنبه دویدم'), 'یکشنبه دویدم');
  // کلمهٔ عدد بدون واحد دست نمی‌خورد
  assert.equal(Nlp.norm('سه تا دوست دارم'), 'سه تا دوست دارم');
});

test('extractMeasurements عدد و واحد را جفت می‌کند', () => {
  const ms = Nlp.extractMeasurements('۵۰۰ میلی‌لیتر آب و ۳۰ دقیقه دویدم');
  const units = ms.map((m) => m.unit).filter(Boolean);
  assert.ok(units.includes('ml'));
  assert.ok(units.includes('min'));
  const water = ms.find((m) => m.unit === 'ml');
  assert.equal(water.value, 500);
});

test('detectWeight از جمله‌های مختلف', () => {
  assert.equal(Nlp.detectWeight('وزنم ۷۴ کیلوگرم شد'), 74);
  assert.equal(Nlp.detectWeight('وزنم ۷۴/۵ کیلو'), 74.5);
  assert.equal(Nlp.detectWeight('وزنم ۷۴'), 74);
  assert.equal(Nlp.detectWeight('امروز ۳۰ دقیقه دویدم'), null);
});

test('detectWater واحدها را تبدیل می‌کند', () => {
  assert.equal(Nlp.detectWater('۵۰۰ میلی‌لیتر آب خوردم'), 500);
  assert.equal(Nlp.detectWater('یک لیتر آب خوردم'), 1000);
  assert.equal(Nlp.detectWater('۲ لیوان آب خوردم'), 480);
  assert.equal(Nlp.detectWater('امروز دویدم'), null);
});

test('detectSleep و detectDuration', () => {
  assert.equal(Nlp.detectSleep('دیشب ۷ ساعت خوابیدم'), 7);
  assert.equal(Nlp.detectSleep('۷/۵ ساعت خواب'), 7.5);
  assert.equal(Nlp.detectDuration('۳۰ دقیقه دویدم'), 30);
  assert.equal(Nlp.detectDuration('نیم ساعت راه رفتم'), 30);
});

test('detectSetsReps الگوی ست و تکرار', () => {
  const r = Nlp.detectSetsReps('۳ ست ۱۲ تکرار با ۶۰ کیلو');
  assert.equal(r.sets, 3);
  assert.equal(r.reps, 12);
  assert.equal(r.load_kg, 60);
});

test('detectMeal از کلیدواژه و از ساعت', () => {
  assert.equal(Nlp.detectMeal('صبحانه نان و پنیر خوردم'), 'breakfast');
  assert.equal(Nlp.detectMeal('ناهار قرمه سبزی'), 'lunch');
  assert.equal(Nlp.detectMeal('شام سبک بود'), 'dinner');
  assert.ok(['breakfast', 'lunch', 'dinner', 'snack'].includes(Nlp.detectMeal('چیزی خوردم')));
});

test('detectDay تاریخ نسبی و نام روز هفته', () => {
  const t = '1405-07-15';
  assert.equal(Nlp.detectDay('دیروز دویدم', t), '1405-07-14');
  assert.equal(Nlp.detectDay('پریروز', t), '1405-07-13');
  assert.equal(Nlp.detectDay('امروز', t), t);
  // ۱۵ مهر ۱۴۰۵ چهارشنبه است؛ «شنبه» باید بشود ۱۱ مهر
  assert.equal(Nlp.detectDay('شنبه دویدم', t), '1405-07-11');
  assert.equal(J.weekdayName('1405-07-11'), 'شنبه');
});

test('searchTerms کلمات توقفی و اعداد را حذف می‌کند', () => {
  const terms = Nlp.searchTerms('امروز ناهار قرمه سبزی با دو کفگیر برنج خوردم');
  assert.ok(terms.includes('قرمه سبزی'), terms.join('|'));
  assert.ok(!terms.includes('امروز'));
  assert.ok(!terms.includes('خوردم'));
});

test('analyze همهٔ موجودیت‌ها را یکجا می‌دهد', () => {
  const a = Nlp.analyze('دیروز ۳۰ دقیقه پیاده‌روی کردم و ۲ لیوان آب خوردم', { today: '1405-07-15' });
  assert.equal(a.day, '1405-07-14');
  assert.equal(a.day_label, 'دیروز');
  assert.equal(a.duration_min, 30);
  assert.equal(a.water_ml, 480);
  assert.ok(a.intents.includes('log_water'));
  assert.ok(a.intents.includes('log_workout'));
});

test('quickActions چیپ‌های کاربردی می‌سازد', () => {
  const a = Nlp.analyze('وزنم ۷۴ کیلو شد');
  const q = Nlp.quickActions(a);
  assert.ok(q.length >= 1 && q.length <= 4);
  assert.ok(q[0].label.includes('۷۴'));
});
