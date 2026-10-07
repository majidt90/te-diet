'use strict';
/**
 * آزمون end-to-end مسیر گفت‌وگو.
 *
 * مسیر واقعیِ اجراشده:
 *   ipc.js chat:send → prompt.js (ساخت پرامپت با دادهٔ واقعی کاربر)
 *   → ai.js (SSE از سرور ساختگی) → actions.js (اجرای بلوک‌ها) → db.js
 *
 * ماژول electron با stub جایگزین شده تا ipc.js واقعاً registerIpc شود.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

// ——————— stub الکترون ———————
const channels = new Map();
let sentEvents = [];
const electronMock = {
  ipcMain: { handle: (ch, fn) => channels.set(ch, fn) },
  shell: { showItemInFolder: async () => true, openExternal: async () => true },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, ...rest);
};

const { registerIpc } = require('../lib/ipc.js');
const { createDatabase } = require('../lib/db.js');
const { createConfigManager } = require('../lib/config.js');
const { createAIClient } = require('../lib/ai.js');
const J = require('../lib/jalaali.js');

const APP_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(APP_DIR, 'data');

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/** سرور ساختگیِ سازگار با OpenAI که پاسخ ثابتی را جریانی می‌کند. */
function startAi(replyChunks, capture) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (capture) capture.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const c of replyChunks) sse(res, { choices: [{ delta: { content: c } }] });
        sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 99 } });
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

function createEnv(aiOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tediet-e2e-'));
  const config = createConfigManager({ userDataDir: dir, bundledConfigPath: path.join(APP_DIR, 'config.json') });
  config.ensureSeeded();
  config.update({ ai: { base_url: 'http://127.0.0.1:9/v1', api_key: 'k', model: 'm', ...aiOverrides } });

  const repo = createDatabase({ file: path.join(dir, 'e2e.db'), dataDir: DATA_DIR, log: () => {} });
  repo.seedCatalogues();
  const personalityData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'personality.json'), 'utf8'));

  channels.clear();
  sentEvents = [];
  registerIpc({
    config, repo, ai: createAIClient({}),
    getPersonality: () => config.load().user?.personality || 'nila',
    loadPersonalityData: () => personalityData,
    win: { isDestroyed: () => false, webContents: { send: (ch, p) => sentEvents.push({ ch, p }) } },
    log: () => {},
    appVersion: 'test', userDataDir: dir, appDir: APP_DIR,
  });

  const invoke = (ch) => (...args) => channels.get(ch)({ sender: {} }, ...args);
  return { repo, config, dir, invoke, events: () => sentEvents };
}

test('تنظیمات ناقص → پیام فارسی و needSetup بدون تماس شبکه', async () => {
  const env = createEnv({ api_key: '' });
  const res = await env.invoke('chat:send')({ text: 'سلام' });
  assert.equal(res.ok, false);
  assert.equal(res.needSetup, true);
  assert.match(res.error, /تنظیمات هوش مصنوعی کامل نیست/);
  assert.match(res.error, /api_key/);
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('پیام خالی رد می‌شود', async () => {
  const env = createEnv();
  const res = await env.invoke('chat:send')({ text: '   ' });
  assert.equal(res.ok, false);
  assert.match(res.error, /خالی است/);
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('مسیر کامل: پیام کاربر → پاسخ جریانی → action → ثبت در SQLite', async () => {
  const captured = [];
  const reply = [
    'حتماً! همه را ثبت کردم. ',
    '```action\n{"type":"log_meal","payload":{"meal":"lunch","food_slug":"berenj-ghorme","qty":2}}\n```\n',
    '```action\n{"type":"log_water","payload":{"amount_ml":250}}\n```\n',
    'موفق باشی!',
  ];
  const mock = await startAi(reply, captured);
  const env = createEnv({ base_url: mock.baseUrl });

  // دادهٔ زمینه‌ای کاربر
  env.repo.saveProfile({ display_name: 'سارا', sex: 'female', birth_year: 1370, height_cm: 165, activity_level: 'moderate', goal: 'lose' });
  env.repo.logWeight({ weight_kg: 72 });

  const res = await env.invoke('chat:send')({ text: 'ناهار دو کفگیر چلو خوردم و یک لیوان آب' });
  await mock.close();

  assert.equal(res.ok, true, JSON.stringify(res));
  const d = res.data;
  assert.ok(d.conversation_id);
  assert.ok(d.content.includes('ثبت کردم'));
  assert.ok(!d.content.includes('```action'), 'بلوک action از متن پاک نشد');
  assert.equal(d.applied_count, 2, JSON.stringify(d.results));
  assert.equal(d.failed_count, 0);

  // واقعاً در پایگاه‌داده نوشته شده؟
  const meals = env.repo.listMeals(J.todayKey());
  assert.equal(meals.length, 1);
  assert.equal(meals[0].slug ?? meals[0].name, meals[0].name);
  assert.equal(meals[0].kcal, 390, 'دو کفگیر چلو باید ۳۹۰ کالری باشد');
  assert.equal(env.repo.waterByDay(J.todayKey()).total_ml, 250);

  // رویدادهای جریانی به renderer فرستاده شده‌اند؟
  const evs = env.events();
  assert.ok(evs.some((e) => e.ch === 'chat:delta'), 'رویداد chat:delta ارسال نشد');
  assert.ok(evs.some((e) => e.ch === 'chat:done'), 'رویداد chat:done ارسال نشد');
  const done = evs.find((e) => e.ch === 'chat:done');
  assert.equal(done.p.results.length, 2);
  assert.ok(done.p.summary, 'خلاصهٔ روزانه در chat:done نبود');

  // تاریخچه ذخیره شده
  const msgs = env.repo.listMessages(d.conversation_id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].status, 'ok');

  // پرامپت ارسالی به مدل باید دادهٔ واقعی کاربر را داشته باشد
  const sent = captured[0];
  const sys = sent.messages.find((m) => m.role === 'system').content;
  assert.ok(sys.includes('سارا'), 'نام کاربر در پرامپت نبود');
  assert.ok(sys.includes('نیلا'), 'نام پرسونیتی در پرامپت نبود');
  assert.ok(sys.includes('قرمه سبزی') || sys.includes('چلو'), 'نامزد غذا در پرامپت نبود');
  assert.ok(sys.includes('log_meal'), 'قرارداد action در پرامپت نبود');
  assert.ok(sys.includes(J.todayKey()), 'کلید تاریخ امروز در پرامپت نبود');
  assert.ok(sys.includes('۷۲') || sys.includes('72'), 'وزن کاربر در پرامپت نبود');

  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('تاریخچهٔ چند پیام به مدل فرستاده می‌شود', async () => {
  const captured = [];
  const mock = await startAi(['باشه.'], captured);
  const env = createEnv({ base_url: mock.baseUrl });

  await env.invoke('chat:send')({ text: 'پیام اول' });
  await env.invoke('chat:send')({ text: 'پیام دوم' });
  await mock.close();

  assert.equal(captured.length, 2);
  const second = captured[1];
  const roles = second.messages.map((m) => m.role);
  assert.equal(roles[0], 'system');
  // پیام اول (کاربر) و پاسخ آن (دستیار) و پیام دوم (کاربر)
  assert.ok(roles.filter((r) => r === 'user').length >= 2, 'تاریخچهٔ کاربر فرستاده نشد');
  assert.ok(roles.includes('assistant'), 'پاسخ قبلی در تاریخچه نبود');
  assert.equal(roles[roles.length - 1], 'user');
  assert.ok(second.messages.some((m) => m.content.includes('پیام اول')));

  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('action ناموفق، بقیه را متوقف نمی‌کند و خطا را گزارش می‌دهد', async () => {
  const reply = [
    '```action\n{"type":"log_weight","payload":{"weight_kg":5}}\n```',
    '```action\n{"type":"log_water","payload":{"amount_ml":300}}\n```',
  ];
  const mock = await startAi(reply, []);
  const env = createEnv({ base_url: mock.baseUrl });
  const res = await env.invoke('chat:send')({ text: 'وزن و آب' });
  await mock.close();

  assert.equal(res.ok, true);
  assert.equal(res.data.failed_count, 1);
  assert.equal(res.data.applied_count, 1);
  const failed = res.data.results.find((r) => !r.ok);
  assert.match(failed.message, /بین ۱۵ تا ۵۰۰/);
  assert.equal(env.repo.waterByDay(J.todayKey()).total_ml, 300);

  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('قطعی سرویس → خطای فارسی و وضعیت error در پایگاه‌داده', async () => {
  const env = createEnv({ base_url: 'http://127.0.0.1:9/v1' });
  const res = await env.invoke('chat:send')({ text: 'سلام' });
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 10);

  const evs = env.events();
  assert.ok(evs.some((e) => e.ch === 'chat:error'), 'رویداد chat:error ارسال نشد');

  // پیام دستیار با وضعیت error ذخیره شده باشد
  const convs = env.repo.listConversations();
  const msgs = env.repo.listMessages(convs[0].id);
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, 'assistant');
  assert.equal(last.status, 'error');

  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('تغییر پرسونیتی، پرامپت سیستم را عوض می‌کند', async () => {
  const captured = [];
  const mock = await startAi(['سلام!'], captured);
  const env = createEnv({ base_url: mock.baseUrl });

  await env.invoke('app:setPersonality')('arash');
  await env.invoke('chat:send')({ text: 'برنامه تمرین بده' });
  await mock.close();

  const sys = captured[0].messages.find((m) => m.role === 'system').content;
  assert.ok(sys.includes('آرش'), 'پرسونیتی آرش در پرامپت نبود');
  assert.ok(!sys.includes('من نیلا هستم'), 'پرسونیتی قبلی باقی مانده');
  assert.equal(env.config.load().user.personality, 'arash');

  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('app:info اطلاعات کامل و مسیرها را می‌دهد', async () => {
  const env = createEnv();
  const res = await env.invoke('app:info')();
  assert.equal(res.ok, true);
  assert.equal(res.data.personalities.length, 3);
  assert.ok(res.data.personalities[0].sample_prompts.length > 0);
  assert.ok(res.data.paths.db.endsWith('e2e.db'));
  assert.ok(res.data.paths.config.endsWith('config.json'));
  assert.equal(res.data.aiReady.ready, true);
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('debug:systemPrompt پرامپت کامل را برمی‌گرداند', async () => {
  const env = createEnv();
  env.repo.saveProfile({ display_name: 'رضا', height_cm: 178, sex: 'male', birth_year: 1365, goal: 'gain', activity_level: 'active' });
  env.repo.logWeight({ weight_kg: 76 });
  const res = await env.invoke('debug:systemPrompt')();
  assert.equal(res.ok, true);
  assert.ok(res.data.includes('رضا'));
  assert.ok(res.data.includes('قرارداد ثبت اطلاعات'));
  assert.ok(res.data.includes('Mifflin-St Jeor'));
  assert.ok(res.data.length > 1000, 'پرامپت خیلی کوتاه است');
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});
