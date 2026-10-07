'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractActions, processAssistantText, resolveDay, tryRepairJson } = require('../lib/actions.js');
const { createDatabase } = require('../lib/db.js');

const DATA_DIR = path.join(__dirname, '..', 'data');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tediet-act-'));
  const repo = createDatabase({ file: path.join(dir, 'a.db'), dataDir: DATA_DIR });
  repo.seedCatalogues();
  return { repo, dir };
}

test('extractActions بلوک action را از متن جدا می‌کند', () => {
  const text = 'حتماً! آب رو ثبت کردم.\n```action\n{"type":"log_water","payload":{"amount_ml":250}}\n```\nموفق باشی.';
  const { cleanText, blocks } = extractActions(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'log_water');
  assert.equal(blocks[0].payload.amount_ml, 250);
  assert.ok(!cleanText.includes('action'), 'بلوک از متن پاک نشد');
  assert.ok(cleanText.includes('آب رو ثبت کردم'));
  assert.ok(cleanText.includes('موفق باشی'));
});

test('چند بلوک action در یک پاسخ', () => {
  const text = [
    'ثبت شد.',
    '```action',
    '{"type":"log_meal","payload":{"meal":"breakfast","name":"چای"}}',
    '```',
    'و آب هم:',
    '```action',
    '{"type":"log_water","payload":{"amount_ml":200}}',
    '```',
  ].join('\n');
  const { blocks } = extractActions(text);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.type), ['log_meal', 'log_water']);
});

test('بلوک آرایه‌ای و JSON بدون fence هم کار می‌کند', () => {
  const arr = extractActions('```action\n[{"type":"log_water","payload":{"amount_ml":100}},{"type":"log_water","payload":{"amount_ml":150}}]\n```');
  assert.equal(arr.blocks.length, 2);

  const raw = extractActions('بله {"type":"log_water","payload":{"amount_ml":300}} انجام شد');
  assert.equal(raw.blocks.length, 1);
  assert.equal(raw.blocks[0].payload.amount_ml, 300);
});

test('JSON خام تودرتو با آکولاد داخل رشته درست مرزیابی می‌شود', () => {
  // note عمداً یک «}» و کوتیشنِ escape‌شده دارد تا مرزیابی آزمایش شود
  const text = 'باشه {"type":"log_meal","payload":{"name":"سالاد","note":"بگو \\"}\\" سلام","kcal":180}} انجام شد';
  const { blocks, cleanText } = extractActions(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'log_meal');
  assert.equal(blocks[0].payload.kcal, 180);
  assert.ok(blocks[0].payload.note.includes('}'), 'آکولاد داخل رشته حفظ نشد');
  assert.ok(!cleanText.includes('log_meal'));
  assert.ok(cleanText.includes('باشه'));
  assert.ok(cleanText.includes('انجام شد'));
});

test('متن بدون action دست‌نخورده می‌ماند و بلوک کد واقعی حذف نمی‌شود', () => {
  const plain = 'امروز ۲۰۰۰ کالری خوردی. خوب بود!';
  assert.deepEqual(extractActions(plain).blocks, []);
  assert.equal(extractActions(plain).cleanText, plain);

  const code = 'این یک نمونه است:\n```js\nconst x = 1;\n```';
  const r = extractActions(code);
  assert.equal(r.blocks.length, 0);
  assert.ok(r.cleanText.includes('const x = 1'), 'بلوک کد js اشتباهاً حذف شد');
});

test('tryRepairJson کامای اضافی و کلید بدون کوتیشن را تعمیر می‌کند', () => {
  assert.deepEqual(tryRepairJson('{"type":"log_water","payload":{"amount_ml":250,},}'),
    { type: 'log_water', payload: { amount_ml: 250 } });
  assert.equal(tryRepairJson('کاملاً نامعتبر'), null);
});

test('resolveDay تاریخ‌های نسبی را درست حل می‌کند', () => {
  assert.equal(resolveDay(undefined, '1405-07-15'), '1405-07-15');
  assert.equal(resolveDay('دیروز', '1405-07-15'), '1405-07-14');
  assert.equal(resolveDay('پریروز', '1405-07-15'), '1405-07-13');
  assert.equal(resolveDay('امروز', '1405-07-15'), '1405-07-15');
  assert.equal(resolveDay('1405-06-31', '1405-07-15'), '1405-06-31');
  assert.equal(resolveDay('چیز بی‌معنی', '1405-07-15'), '1405-07-15');
});

test('processAssistantText واقعاً در پایگاه‌داده ثبت می‌کند', () => {
  const { repo, dir } = makeDb();
  const text = [
    'عالی! ثبتشون کردم.',
    '```action',
    '{"type":"log_meal","payload":{"meal":"lunch","food_slug":"berenj-ghorme","qty":2,"day":"1405-07-15"}}',
    '```',
    '```action',
    '{"type":"log_weight","payload":{"weight_kg":77.5,"day":"1405-07-15"}}',
    '```',
    '```action',
    '{"type":"log_water","payload":{"amount_ml":300,"day":"1405-07-15"}}',
    '```',
  ].join('\n');

  const { cleanText, results } = processAssistantText(repo, text, { today: '1405-07-15' });
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));

  assert.equal(repo.listMeals('1405-07-15').length, 1);
  assert.equal(repo.listMeals('1405-07-15')[0].kcal, 390); // دو کفگیر چلو
  assert.equal(repo.getWeight('1405-07-15').weight_kg, 77.5);
  assert.equal(repo.waterByDay('1405-07-15').total_ml, 300);

  assert.ok(!cleanText.includes('log_meal'));
  assert.match(results[1].message, /۷۷٫۵ کیلوگرم/);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('action نامعتبر خطای فارسی می‌دهد ولی بقیه را اجرا می‌کند', () => {
  const { repo, dir } = makeDb();
  const text = [
    '```action',
    '{"type":"nonsense_type","payload":{}}',
    '```',
    '```action',
    '{"type":"log_weight","payload":{"weight_kg":3,"day":"1405-07-15"}}',
    '```',
    '```action',
    '{"type":"log_water","payload":{"amount_ml":250,"day":"1405-07-15"}}',
    '```',
  ].join('\n');
  const { results } = processAssistantText(repo, text, { today: '1405-07-15' });
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, false);
  assert.match(results[0].message, /پشتیبانی نمی‌شود/);
  assert.equal(results[1].ok, false);
  assert.match(results[1].message, /بین ۱۵ تا ۵۰۰/);
  assert.equal(results[2].ok, true);
  assert.equal(repo.waterByDay('1405-07-15').total_ml, 250);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('set_goal و update_profile از طریق action کار می‌کنند', () => {
  const { repo, dir } = makeDb();
  const text = [
    '```action',
    '{"type":"set_goal","payload":{"kind":"kcal","target":1850}}',
    '```',
    '```action',
    '{"type":"update_profile","payload":{"display_name":"سارا","sex":"female","height_cm":168,"activity_level":"moderate"}}',
    '```',
  ].join('\n');
  const { results } = processAssistantText(repo, text, { today: '1405-07-15' });
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(repo.getGoals().kcal.target, 1850);
  const p = repo.getProfile();
  assert.equal(p.display_name, 'سارا');
  assert.equal(p.sex, 'female');
  assert.equal(p.height_cm, 168);
  assert.match(results[1].message, /نام: سارا/);
  repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
