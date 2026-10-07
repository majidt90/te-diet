'use strict';
/**
 * آزمون لایهٔ داده با SQLite واقعی (better-sqlite3 روی ABI نود).
 * اجرا: node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase } = require('../lib/db.js');
const J = require('../lib/jalaali.js');

const DATA_DIR = path.join(__dirname, '..', 'data');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tediet-'));
  const repo = createDatabase({ file: path.join(dir, 'test.db'), dataDir: DATA_DIR });
  return { repo, dir };
}

test('اسکیمای اولیه ساخته می‌شود و جدول‌ها وجود دارند', () => {
  const { repo, dir } = makeDb();
  const tables = repo.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['profile', 'weight_log', 'food_items', 'meal_log', 'exercise_items',
    'workout_log', 'water_log', 'sleep_log', 'goals', 'conversations', 'messages', 'meta']) {
    assert.ok(tables.includes(t), `جدول ${t} ساخته نشد`);
  }
  assert.equal(repo.db.pragma('journal_mode', { simple: true }), 'wal');
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('seedCatalogues فهرست غذا و ورزش را وارد می‌کند', () => {
  const { repo, dir } = makeDb();
  const r = repo.seedCatalogues();
  assert.ok(r.foods >= 100, `تعداد غذا کم است: ${r.foods}`);
  assert.ok(r.exercises >= 40, `تعداد تمرین کم است: ${r.exercises}`);
  // اجرای دوباره باید بدون تغییر باشد (idempotent)
  const r2 = repo.seedCatalogues();
  assert.equal(r2.foods, 0);
  assert.equal(r2.exercises, 0);
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM food_items').get().n, r.foods);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('پروفایل ذخیره و بازیابی می‌شود و فیلدهای نامعتبر رد می‌شوند', () => {
  const { repo, dir } = makeDb();
  assert.equal(repo.getProfile(), null);
  const p = repo.saveProfile({
    display_name: 'مریم', sex: 'female', birth_year: 1370, height_cm: 165,
    activity_level: 'moderate', goal: 'lose', dietary_restrictions: ['گیاهخواری'],
  });
  assert.equal(p.display_name, 'مریم');
  assert.deepEqual(p.dietary_restrictions, ['گیاهخواری']);
  // به‌روزرسانی جزئی نباید فیلدهای قبلی را پاک کند
  const p2 = repo.saveProfile({ height_cm: 166 });
  assert.equal(p2.height_cm, 166);
  assert.equal(p2.display_name, 'مریم');
  // مقدار خارج از بازه نادیده گرفته می‌شود
  const p3 = repo.saveProfile({ height_cm: 900, sex: 'other' });
  assert.equal(p3.height_cm, 166);
  assert.equal(p3.sex, 'female');
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ثبت وزن در یک روز جایگزین می‌شود (upsert)', () => {
  const { repo, dir } = makeDb();
  repo.logWeight({ day: '1405-07-10', weight_kg: 78.4 });
  repo.logWeight({ day: '1405-07-10', weight_kg: 78.1 });
  const list = repo.listWeight({});
  assert.equal(list.length, 1);
  assert.equal(list[0].weight_kg, 78.1);
  assert.equal(repo.getLatestWeight().weight_kg, 78.1);
  assert.throws(() => repo.logWeight({ day: '1405-07-10', weight_kg: 5 }), /بین ۱۵ تا ۵۰۰/);
  assert.throws(() => repo.logWeight({ day: 'not-a-date', weight_kg: 70 }), /تاریخ نامعتبر/);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('جست‌وجوی فارسی غذا با نام مستعار و تطبیق نادقیق', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  const r1 = repo.searchFoods('قورمه سبزی');
  assert.ok(r1.length, 'قورمه سبزی پیدا نشد');
  assert.equal(r1[0].slug, 'ghorme-sabzi');
  // نام مستعار
  const r2 = repo.searchFoods('چایی');
  assert.ok(r2.some((x) => x.slug === 'chai-bedoon-shekar'), 'نام مستعار «چایی» کار نکرد');
  // ارقام فارسی و نویسهٔ عربی
  const r3 = repo.searchFoods('كباب');
  assert.ok(r3.some((x) => x.slug === 'kabab-koobide'), 'تطبیق «ك» عربی کار نکرد');
  // تزریق SQL باید بی‌اثر باشد
  const r4 = repo.searchFoods("'; DROP TABLE food_items; --");
  assert.ok(Array.isArray(r4));
  assert.ok(repo.db.prepare('SELECT COUNT(*) n FROM food_items').get().n > 0);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('جست‌وجوی نادقیق: حرف افتاده و غلط املایی را تحمل می‌کند', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  // «قرمه سبزی» بدون «و» — نوشتار بسیار رایج محاوره‌ای
  const r1 = repo.searchFoods('قرمه سبزی');
  assert.ok(r1.length, 'قرمه سبزی (بدون و) پیدا نشد');
  assert.equal(r1[0].slug, 'ghorme-sabzi');
  // املای درست باید امتیاز بالاتری بگیرد
  const r2 = repo.searchFoods('قورمه سبزی');
  assert.equal(r2[0].slug, 'ghorme-sabzi');
  assert.ok(r2[0].score > r1[0].score, 'املای دقیق باید اولویت داشته باشد');
  // ورودی بی‌معنی نباید نتیجهٔ الکی بدهد
  assert.equal(repo.searchFoods('zzzzqqq').length, 0);
  assert.equal(repo.searchFoods('').length, 0);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('levenshtein و similarity درست کار می‌کنند', () => {
  const { levenshtein, similarity } = require('../lib/db.js');
  assert.equal(levenshtein('', ''), 0);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', 'abd'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('قورمه', 'قرمه'), 1);
  assert.ok(similarity('قورمه سبزی', 'قرمه سبزی') > 0.85);
  assert.equal(similarity('', 'x'), 0);
  assert.equal(similarity('a', 'a'), 1);
});

test('جست‌وجوی تمرین هم نادقیق است', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  assert.equal(repo.searchExercises('پرس سينه')[0].slug, 'bench-press'); // «ي» عربی
  assert.equal(repo.searchExercises('پیاده روی')[0].slug, 'walking-slow');
  assert.equal(repo.searchExercises('zzz').length, 0);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ثبت وعده با food_slug مقادیر را از پایگاه‌داده محاسبه می‌کند', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  const m = repo.logMeal({ day: '1405-07-15', meal: 'lunch', food_slug: 'berenj-ghorme', qty: 2 });
  // یک کفگیر چلو = ۱۹۵ کیلوکالری → دو کفگیر = ۳۹۰
  assert.equal(m.kcal, 390);
  assert.equal(m.qty, 2);
  assert.ok(m.food_id, 'food_id وصل نشد');
  // غذای خارج از فهرست با مقدار دستی
  const m2 = repo.logMeal({ day: '1405-07-15', meal: 'snack', name: 'کیک خانگی', kcal: 320, protein: 5, carbs: 40, fat: 15 });
  assert.equal(m2.kcal, 320);
  assert.equal(m2.food_id, null);
  const meals = repo.listMeals('1405-07-15');
  assert.equal(meals.length, 2);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ثبت تمرین و برآورد کالری از MET', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  repo.logWeight({ day: '1405-07-15', weight_kg: 80 });
  // پیاده‌روی سریع MET=4.3، ۶۰ دقیقه، ۸۰ کیلو → 4.3*80*1 = 344
  const w = repo.logWorkout({ day: '1405-07-15', exercise_slug: 'walking-fast', duration_min: 60 });
  assert.equal(w.kcal, 344);
  assert.equal(w.kind, 'cardio');
  // قدرتی از روی حجم کار
  const s = repo.logWorkout({ day: '1405-07-15', exercise_slug: 'bench-press', sets: 3, reps: 10, load_kg: 60 });
  assert.equal(s.kind, 'strength');
  assert.ok(s.kcal > 0, 'کالری تمرین قدرتی صفر شد');
  assert.equal(repo.listWorkouts('1405-07-15').length, 2);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('آب و خواب ثبت و جمع می‌شوند', () => {
  const { repo, dir } = makeDb();
  repo.logWater(250, '1405-07-15');
  repo.logWater(300, '1405-07-15');
  const w = repo.waterByDay('1405-07-15');
  assert.equal(w.total_ml, 550);
  assert.equal(w.count, 2);
  assert.throws(() => repo.logWater(5, '1405-07-15'), /بین ۱۰ تا ۵۰۰۰/);
  repo.logSleep({ day: '1405-07-15', hours: 7.5, quality: 4 });
  repo.logSleep({ day: '1405-07-15', hours: 8 });
  assert.equal(repo.listSleep({}).length, 1);
  assert.equal(repo.listSleep({})[0].hours, 8);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('گفت‌وگو و پیام‌ها با عنوان خودکار', () => {
  const { repo, dir } = makeDb();
  const c = repo.createConversation({ personality: 'nila' });
  assert.ok(c.id);
  repo.addMessage({ conversation_id: c.id, role: 'user', content: 'سلام نیلا، امروز چه بخورم؟' });
  repo.addMessage({ conversation_id: c.id, role: 'assistant', content: 'سلام! بذار با هم ببینیم.' });
  const conv = repo.getConversation(c.id);
  assert.equal(conv.title, 'سلام نیلا، امروز چه بخورم؟');
  assert.equal(repo.listMessages(c.id).length, 2);
  const recent = repo.recentMessages(c.id, 10);
  assert.deepEqual(recent.map((m) => m.role), ['user', 'assistant']);
  // پیام با action
  const msg = repo.addMessage({ conversation_id: c.id, role: 'assistant', content: 'ثبت شد', action: { type: 'log_water', payload: { amount_ml: 250 } } });
  assert.equal(repo.listMessages(c.id).find((m) => m.id === msg.id).action.type, 'log_water');
  // نقش نامعتبر
  assert.throws(() => repo.addMessage({ conversation_id: c.id, role: 'hacker', content: 'x' }), /نقش پیام نامعتبر/);
  // گفت‌وگوی ناموجود
  assert.throws(() => repo.addMessage({ conversation_id: 'nope', role: 'user', content: 'x' }), /پیدا نشد/);
  // حذف آبشاری
  assert.ok(repo.deleteConversation(c.id));
  assert.equal(repo.listMessages(c.id).length, 0);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('هدف‌ها ذخیره و بازیابی می‌شوند', () => {
  const { repo, dir } = makeDb();
  repo.setGoal('kcal', 1850);
  repo.setGoal('water_ml', 2000);
  const g = repo.getGoals();
  assert.equal(g.kcal.target, 1850);
  assert.equal(g.water_ml.target, 2000);
  repo.setGoal('kcal', 2000);
  assert.equal(repo.getGoals().kcal.target, 2000);
  assert.throws(() => repo.setGoal('nonsense', 5), /نامعتبر/);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('جمع‌بندی روزانه مجموع درشت‌مغذی‌ها را درست حساب می‌کند', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  repo.logMeal({ day: '1405-07-15', meal: 'breakfast', food_slug: 'tokhm-morgh', qty: 2 });
  repo.logMeal({ day: '1405-07-15', meal: 'lunch', name: 'سینه مرغ', kcal: 200, protein: 37, carbs: 0, fat: 5 });
  repo.logWater(500, '1405-07-15');
  const s = repo.dailySummary('1405-07-15');
  // ۲ تخم مرغ = ۱۵۶ + ۲۰۰ = ۳۵۶
  assert.equal(s.totals.kcal_in, 356);
  assert.equal(s.totals.protein_g, Math.round(6.3 * 2 + 37));
  assert.equal(s.water.total_ml, 500);
  assert.equal(s.label, J.formatFullDate('1405-07-15'));
  assert.equal(s.by_meal.breakfast.count, 1);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rangeSummary بازهٔ تاریخ شمسی را بدون پرش پیمایش می‌کند', () => {
  const { repo, dir } = makeDb();
  repo.logMeal({ day: '1405-06-30', meal: 'dinner', name: 'شام', kcal: 400 });
  const rows = repo.rangeSummary('1405-06-29', '1405-07-02');
  // شهریور ۳۱ روزه است، پس این بازه ۵ روز دارد (نه ۴)
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.day),
    ['1405-06-29', '1405-06-30', '1405-06-31', '1405-07-01', '1405-07-02']);
  assert.equal(rows[1].kcal_in, 400);
  assert.equal(rows[1].label, '۳۰ شهر');
  // عبور از مرز سال: ۱۴۰۴ کبیسه نیست پس اسفند ۲۹ روز دارد
  const y = repo.rangeSummary('1404-12-28', '1405-01-02');
  assert.deepEqual(y.map((r) => r.day),
    ['1404-12-28', '1404-12-29', '1405-01-01', '1405-01-02']);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('streak روزهای پیوسته را می‌شمارد', () => {
  const { repo, dir } = makeDb();
  const t = J.todayKey();
  repo.logWater(250, J.addDaysKey(t, -1));
  repo.logWater(250, t);
  const s = repo.streak();
  assert.ok(s.current >= 2, `رشتهٔ جاری باید حداقل ۲ باشد، بود: ${s.current}`);
  assert.ok(s.longest >= 2);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('overview آمار کلی را برمی‌گرداند', () => {
  const { repo, dir } = makeDb();
  repo.seedCatalogues();
  repo.logWeight({ day: '1405-07-01', weight_kg: 80 });
  repo.logWeight({ day: '1405-07-15', weight_kg: 77.5 });
  const o = repo.overview();
  assert.equal(o.latest_weight, 77.5);
  assert.equal(o.weight_change, -2.5);
  assert.ok(o.counts.foods > 100);
  assert.ok(o.db_file.endsWith('test.db'));
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
