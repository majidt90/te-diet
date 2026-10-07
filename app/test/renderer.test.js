'use strict';
/**
 * آزمون یکپارچگیِ رابط کاربری.
 *
 * اینجا «کد واقعی» اجرا می‌شود، نه نمونهٔ جایگزین:
 *  - lib/ipc.js با stub کردن ماژول electron واقعاً registerIpc می‌شود
 *  - هندلرهای ثبت‌شده پشت یک teDiet جعلی (همان قرارداد preload.js) قرار می‌گیرند
 *  - renderer/index.html و همهٔ اسکریپت‌هایش داخل jsdom اجرا می‌شوند
 *  - لایهٔ داده، SQLite واقعی (better-sqlite3) روی فایل موقت است
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const { JSDOM, VirtualConsole } = require('jsdom');

const APP_DIR = path.join(__dirname, '..');
const RENDERER = path.join(APP_DIR, 'renderer');
const DATA_DIR = path.join(APP_DIR, 'data');

// ——————— stub ماژول electron (قبل از require کردن lib/ipc.js) ———————
const channels = new Map();
const sentEvents = [];
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

// ——————— getContext جعلی برای Chart.js ———————
function makeCtxStub(canvas) {
  const store = {};
  return new Proxy(store, {
    get(t, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') return () => ({ width: 12, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (prop === 'createPattern') return () => ({});
      if (prop === 'setLineDash' || prop === 'getLineDash') return prop === 'getLineDash' ? () => [] : () => {};
      if (prop === 'save' || prop === 'restore' || prop === 'beginPath' || prop === 'closePath') return () => {};
      if (prop in t) return t[prop];
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}

/** ساخت محیط jsdom با هستهٔ واقعی. */
function createEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tediet-ui-'));
  const config = createConfigManager({
    userDataDir: dir,
    bundledConfigPath: path.join(APP_DIR, 'config.json'),
  });
  config.ensureSeeded();
  config.update({
    ai: { base_url: 'http://127.0.0.1:9/v1', api_key: 'test', model: 'test-model' },
  });

  const repo = createDatabase({ file: path.join(dir, 'ui.db'), dataDir: DATA_DIR, log: () => {} });
  repo.seedCatalogues();

  const personalityData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'personality.json'), 'utf8'));
  const getPersonality = () => config.load().user?.personality || 'nila';

  const fakeWin = {
    isDestroyed: () => false,
    webContents: { send: (ch, payload) => sentEvents.push({ ch, payload }) },
  };

  channels.clear();
  sentEvents.length = 0;
  registerIpc({
    config, repo, ai: createAIClient({}), getPersonality,
    loadPersonalityData: () => personalityData,
    win: fakeWin, log: () => {},
    appVersion: '1.0.0-test', userDataDir: dir, appDir: APP_DIR,
  });

  // teDiet جعلی با همان ساختار preload.js، اما روی هندلرهای واقعی ipc.js
  const invoke = (ch) => async (...args) => {
    const fn = channels.get(ch);
    if (!fn) throw new Error(`کانال ثبت‌نشده: ${ch}`);
    return fn({ sender: {} }, ...args);
  };

  const teDiet = {
    config: { get: invoke('config:get'), update: invoke('config:update'), path: invoke('config:path'), aiStatus: invoke('config:aiStatus') },
    ai: { listModels: invoke('ai:listModels'), test: invoke('ai:test') },
    profile: { get: invoke('profile:get'), save: invoke('profile:save') },
    weight: { log: invoke('weight:log'), list: invoke('weight:list'), latest: invoke('weight:latest') },
    foods: { search: invoke('foods:search'), list: invoke('foods:list'), categories: invoke('foods:categories') },
    meals: { log: invoke('meals:log'), list: invoke('meals:list'), delete: invoke('meals:delete') },
    exercises: { search: invoke('exercises:search') },
    workouts: { log: invoke('workouts:log'), list: invoke('workouts:list'), delete: invoke('workouts:delete'), plan: invoke('exercise:plan'), assess: invoke('exercise:assess') },
    water: { log: invoke('water:log'), summary: invoke('water:summary'), delete: invoke('water:delete') },
    sleep: { log: invoke('sleep:log'), list: invoke('sleep:list') },
    goals: { get: invoke('goals:get'), set: invoke('goals:set') },
    conversations: {
      list: invoke('conversations:list'), create: invoke('conversations:create'), get: invoke('conversations:get'),
      messages: invoke('conversations:messages'), rename: invoke('conversations:rename'), delete: invoke('conversations:delete'),
    },
    chat: { send: invoke('chat:send'), stop: invoke('chat:stop') },
    report: { daily: invoke('report:daily'), range: invoke('report:range'), overview: invoke('report:overview'), streak: invoke('report:streak') },
    nutrition: { compute: invoke('nutrition:compute') },
    nlp: { analyze: invoke('nlp:analyze') },
    app: { info: invoke('app:info'), setPersonality: invoke('app:setPersonality'), openPath: invoke('app:openPath') },
    debug: { systemPrompt: invoke('debug:systemPrompt') },
    on() { return () => {}; },
    removeAll() { return true; },
  };

  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => consoleErrors.push(`jsdomError: ${e.message}`));
  virtualConsole.on('error', (...a) => consoleErrors.push(`console.error: ${a.join(' ')}`));

  const dom = new JSDOM(fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8'), {
    url: 'file://' + path.join(RENDERER, 'index.html'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.teDiet = teDiet;
      window.HTMLCanvasElement.prototype.getContext = function () { return makeCtxStub(this); };
      // jsdom پیاده‌سازی ندارد (Chromiumِ الکترون هر دو را دارد)
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      if (!window.ResizeObserver) {
        window.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      }
    },
  });

  return { dom, repo, config, dir, teDiet, consoleErrors, sentEvents };
}

/** منتظر می‌ماند تا boot تمام شود. */
async function waitBoot(env, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (env.dom.window.App) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return Boolean(env.dom.window.App);
}

test('رابط کاربری بدون خطا راه‌اندازی می‌شود', async () => {
  const env = createEnv();
  const booted = await waitBoot(env);
  assert.ok(booted, 'window.App ساخته نشد — boot اجرا نشده');

  const fatal = env.consoleErrors.filter((e) => !/Not implemented|Could not load|Error: Not impl/i.test(e));
  assert.deepEqual(fatal, [], 'خطای کنسول هنگام راه‌اندازی:\n' + fatal.join('\n'));

  // ماژول‌های سراسری باید تعریف شده باشند
  for (const g of ['Jalaali', 'Nutrition', 'ExerciseLib', 'Nlp', 'Chart', 'Store', 'AiClient', 'Charts', 'Reports', 'Chat', 'App']) {
    assert.ok(env.dom.window[g], `سراسری ${g} تعریف نشد`);
  }
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('پرسونیتی‌ها در نوار کناری رندر می‌شوند', async () => {
  const env = createEnv();
  await waitBoot(env);
  const doc = env.dom.window.document;
  const personas = [...doc.querySelectorAll('.persona')];
  assert.equal(personas.length, 3, 'باید سه پرسونیتی نمایش داده شود');
  assert.ok(personas.some((p) => p.textContent.includes('نیلا')));
  assert.ok(personas.some((p) => p.textContent.includes('آرش')));
  assert.ok(personas.some((p) => p.textContent.includes('رها')));
  assert.ok(doc.querySelector('.persona.is-active'), 'هیچ پرسونیتی فعال نیست');
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('نمونه‌پرامپت‌ها و پیام خوش‌آمد نمایش داده می‌شوند', async () => {
  const env = createEnv();
  await waitBoot(env);
  const doc = env.dom.window.document;
  assert.ok(doc.getElementById('emptyTitle').textContent.includes('نیلا'));
  const chips = [...doc.querySelectorAll('#emptyPrompts .prompt-chip')];
  assert.ok(chips.length >= 3, `نمونه‌پرامپت کم است: ${chips.length}`);
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('جابه‌جایی بین نماها کار می‌کند و عنوان عوض می‌شود', async () => {
  const env = createEnv();
  await waitBoot(env);
  const doc = env.dom.window.document;

  for (const v of ['today', 'reports', 'foods', 'settings', 'chat']) {
    env.dom.window.App.switchView(v);
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(doc.getElementById(`view-${v}`).classList.contains('is-active'), `نمای ${v} فعال نشد`);
    assert.ok(doc.getElementById('viewTitle').textContent.length > 0);
  }
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('جست‌وجوی غذا در رابط، نتایج فارسی با ارقام فارسی نشان می‌دهد', async () => {
  const env = createEnv();
  await waitBoot(env);
  const doc = env.dom.window.document;
  env.dom.window.App.switchView('foods');
  await new Promise((r) => setTimeout(r, 80));

  const input = doc.getElementById('foodSearch');
  input.value = 'قرمه سبزی';
  input.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));

  const rows = [...doc.querySelectorAll('#foodTableBody tr')];
  assert.ok(rows.length >= 1, 'نتیجه‌ای در جدول نبود');
  assert.ok(rows[0].textContent.includes('قورمه سبزی'), `سطر اول: ${rows[0].textContent}`);
  // ارقام باید فارسی باشند
  assert.match(rows[0].textContent, /[۰-۹]/, 'ارقام فارسی در جدول نبود');
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('ثبت وعده از مودال، داده را واقعاً در SQLite می‌نویسد', async () => {
  const env = createEnv();
  await waitBoot(env);
  const doc = env.dom.window.document;
  env.dom.window.App.switchView('today');
  await new Promise((r) => setTimeout(r, 100));

  doc.getElementById('addMealBtn').dispatchEvent(new env.dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(doc.getElementById('mealModal').hidden, false, 'مودال باز نشد');

  doc.getElementById('mealSearch').value = 'تخم مرغ';
  doc.getElementById('mealSearch').dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));

  const suggestions = [...doc.querySelectorAll('#mealSuggest .suggest__item')];
  assert.ok(suggestions.length > 0, 'پیشنهادی نمایش داده نشد');
  suggestions[0].dispatchEvent(new env.dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));

  doc.getElementById('mealQty').value = '2';
  doc.getElementById('mealQty').dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));

  doc.getElementById('mealForm').dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 300));

  // بررسی در پایگاه‌دادهٔ واقعی
  const meals = env.repo.listMeals(undefined);
  assert.equal(meals.length, 1, 'وعده در SQLite ثبت نشد');
  assert.equal(meals[0].qty, 2);
  assert.ok(meals[0].kcal > 0);
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('ذخیرهٔ پروفایل از فرم تنظیمات محاسبات تغذیه را پر می‌کند', async () => {
  const env = createEnv();
  await waitBoot(env);
  const doc = env.dom.window.document;
  env.dom.window.App.switchView('settings');
  await new Promise((r) => setTimeout(r, 100));

  doc.getElementById('pfName').value = 'مریم';
  doc.getElementById('pfSex').value = 'female';
  doc.getElementById('pfBirthYear').value = '1370';
  doc.getElementById('pfHeight').value = '165';
  doc.getElementById('pfActivity').value = 'moderate';
  doc.getElementById('pfGoal').value = 'lose';

  await env.teDiet.weight.log({ weight_kg: 78 });

  doc.getElementById('profileForm').dispatchEvent(new env.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 300));

  const p = env.repo.getProfile();
  assert.equal(p.display_name, 'مریم');
  assert.equal(p.sex, 'female');
  assert.equal(p.height_cm, 165);

  const box = doc.getElementById('nutritionSummary');
  assert.ok(box.textContent.includes('کالری هدف'), 'خلاصهٔ تغذیه رندر نشد');
  assert.match(box.textContent, /[۰-۹]/, 'ارقام فارسی در خلاصهٔ تغذیه نبود');
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('رندر Markdown امن است: HTML تزریق‌شده اجرا نمی‌شود', async () => {
  const env = createEnv();
  await waitBoot(env);
  const { renderMarkdown, escapeHtml } = env.dom.window.Chat;

  const html = renderMarkdown('<img src=x onerror="alert(1)"> سلام **دنیا**');
  assert.ok(!html.includes('<img'), 'تگ img تزریق شد!');
  assert.ok(html.includes('&lt;img'), 'HTML فرار نشد');
  assert.ok(html.includes('<strong>دنیا</strong>'), 'بولد کار نکرد');

  const script = renderMarkdown('<script>window.hacked=1</script>');
  assert.ok(!script.includes('<script>'), 'تگ script عبور کرد!');

  // جدول و فهرست
  const list = renderMarkdown('- مورد یک\n- مورد دو');
  assert.ok(list.includes('<ul>') && list.includes('<li>مورد یک</li>'));
  const table = renderMarkdown('| الف | ب |\n| --- | --- |\n| ۱ | ۲ |');
  assert.ok(table.includes('<table>') && table.includes('<th>الف</th>'), 'جدول رندر نشد: ' + table);
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('گزارش‌ها بدون داده نمی‌شکنند و آمار خالی می‌دهند', async () => {
  const env = createEnv();
  await waitBoot(env);
  env.dom.window.App.switchView('reports');
  await new Promise((r) => setTimeout(r, 300));
  const doc = env.dom.window.document;
  assert.ok(doc.querySelectorAll('#statGrid .stat').length >= 5, 'کارت آمار ساخته نشد');
  const fatal = env.consoleErrors.filter((e) => !/Not implemented|Could not load/i.test(e));
  assert.deepEqual(fatal, [], fatal.join('\n'));
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('گزارش‌ها با دادهٔ واقعی نمودار و آمار می‌سازند', async () => {
  const env = createEnv();
  await waitBoot(env);
  const J = require('../lib/jalaali.js');
  const t = J.todayKey();
  env.repo.logWeight({ day: J.addDaysKey(t, -2), weight_kg: 80 });
  env.repo.logWeight({ day: t, weight_kg: 79.2 });
  env.repo.logMeal({ day: t, meal: 'lunch', name: 'ناهار', kcal: 620, protein: 30, carbs: 70, fat: 22 });
  env.repo.logWorkout({ day: t, name: 'پیاده‌روی', duration_min: 40, met: 4.3 });
  env.repo.logWater(750, t);

  env.dom.window.App.switchView('reports');
  await new Promise((r) => setTimeout(r, 400));

  const doc = env.dom.window.document;
  const grid = doc.getElementById('statGrid').textContent;
  assert.ok(grid.includes('کالری'), 'آمار کالری نبود');
  assert.match(grid, /[۰-۹]/, 'ارقام فارسی نبود');
  const fatal = env.consoleErrors.filter((e) => !/Not implemented|Could not load/i.test(e));
  assert.deepEqual(fatal, [], fatal.join('\n'));
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('کانال‌های IPC موردنیاز preload همگی ثبت شده‌اند', async () => {
  const env = createEnv();
  await waitBoot(env);
  const src = fs.readFileSync(path.join(APP_DIR, 'preload.js'), 'utf8');
  const used = [...src.matchAll(/invoke\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 40, `تعداد کانال‌های preload غیرمنتظره است: ${used.length}`);
  const missing = used.filter((ch) => !channels.has(ch));
  assert.deepEqual(missing, [], 'کانال‌های استفاده‌شده در preload ولی ثبت‌نشده در ipc.js: ' + missing.join(', '));
  env.repo.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});

test('همهٔ شناسه‌های getElementById در کد، در index.html وجود دارند', async () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const jsFiles = fs.readdirSync(path.join(RENDERER, 'js')).filter((f) => f.endsWith('.js'));
  const missing = [];
  for (const f of jsFiles) {
    const code = fs.readFileSync(path.join(RENDERER, 'js', f), 'utf8');
    for (const m of code.matchAll(/el\('([^']+)'\)|getElementById\('([^']+)'\)/g)) {
      const id = m[1] || m[2];
      if (!ids.has(id)) missing.push(`${f}: #${id}`);
    }
  }
  assert.deepEqual(missing, [], 'شناسه‌های ناموجود:\n' + missing.join('\n'));
});

test('مسیر همهٔ منابع ارجاع‌شده در index.html موجود است', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const refs = [
    ...[...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const r of refs) {
    const p = path.resolve(RENDERER, r);
    assert.ok(fs.existsSync(p), `فایل پیدا نشد: ${r} → ${p}`);
  }
  // فونت وزیرمتن
  const css = fs.readFileSync(path.join(RENDERER, 'css', 'main.css'), 'utf8');
  for (const m of css.matchAll(/url\('\.\.\/([^']+)'\)/g)) {
    const p = path.resolve(RENDERER, 'css', '..', m[1]);
    assert.ok(fs.existsSync(p), `فونت/منبع پیدا نشد: ${m[1]} → ${p}`);
  }
});
