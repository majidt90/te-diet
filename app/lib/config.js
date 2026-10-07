'use strict';
/**
 * lib/config.js — مدیریت تنظیمات اپلیکیشن.
 *
 * نکتهٔ معماری مهم:
 * در نسخهٔ نصب‌شده، پوشهٔ اپلیکیشن داخل asar و «فقط‌خواندنی» است. بنابراین
 * config.json همراه برنامه فقط به‌عنوان «مقدار اولیه» استفاده می‌شود و در اولین
 * اجرا به userData کپی می‌گردد. از آن پس همیشه نسخهٔ userData خوانده/نوشته می‌شود.
 *
 * امنیت: کلید API هرگز به‌صورت کامل به renderer فرستاده نمی‌شود؛ تابع
 * publicConfig() آن را ماسکه می‌کند.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  ai: {
    base_url: '',
    api_key: '',
    model: '',
    temperature: 0.7,
    max_tokens: 4096,
    stream: true,
    request_timeout_ms: 90000,
    extra_headers: {},
    extra_body: {},
  },
  user: { personality: 'nila' },
  app: { locale: 'fa-IR', digits: 'persian', theme: 'auto', keep_history_turns: 24 },
};

/** ادغام عمیق دو شیء؛ مقادیر undefined در src نادیده گرفته می‌شوند. */
function deepMerge(base, src) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!src || typeof src !== 'object') return out;
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {{userDataDir:string, bundledConfigPath:string}} ctx
 */
function createConfigManager(ctx) {
  const { userDataDir, bundledConfigPath } = ctx;
  const livePath = path.join(userDataDir, 'config.json');

  /** مسیر واقعی فایلی که در حال استفاده است. */
  function liveConfigPath() {
    return livePath;
  }

  function readRaw(file) {
    try {
      const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(txt);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      const e = new Error(`فایل تنظیمات قابل خواندن نیست: ${err.message}`);
      e.cause = err;
      throw e;
    }
  }

  /** در اولین اجرا، تنظیمات همراه برنامه را به userData منتقل می‌کند. */
  function ensureSeeded() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch {
      /* اگر پوشه هست که مشکلی نیست */
    }
    if (!fs.existsSync(livePath)) {
      const bundled = readRaw(bundledConfigPath) || {};
      const merged = deepMerge(DEFAULTS, bundled);
      writeAtomic(merged);
      return { seeded: true, config: merged };
    }
    return { seeded: false, config: load() };
  }

  function load() {
    const raw = readRaw(livePath) ?? readRaw(bundledConfigPath) ?? {};
    return deepMerge(DEFAULTS, raw);
  }

  function writeAtomic(cfg) {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${livePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, livePath);
  }

  /** اعتبارسنجی و نرمال‌سازی؛ خطاها به فارسی برگردانده می‌شوند. */
  function validate(cfg) {
    const problems = [];
    const ai = cfg.ai || {};
    if (typeof ai.temperature === 'number' && (ai.temperature < 0 || ai.temperature > 2)) {
      problems.push('«temperature» باید عددی بین ۰ و ۲ باشد.');
    }
    if (typeof ai.max_tokens === 'number' && (ai.max_tokens < 1 || ai.max_tokens > 200000)) {
      problems.push('«max_tokens» باید بین ۱ و ۲۰۰۰۰۰ باشد.');
    }
    if (ai.base_url && !/^https?:\/\//i.test(String(ai.base_url))) {
      problems.push('«base_url» باید با http:// یا https:// شروع شود.');
    }
    if (problems.length) {
      const e = new Error(problems.join(' '));
      e.problems = problems;
      throw e;
    }
    const out = deepMerge(cfg, {});
    // پاک‌سازی فاصله‌های اضافی که کاربر ناخواسته وارد کرده
    for (const k of ['base_url', 'api_key', 'model']) {
      if (typeof out.ai?.[k] === 'string') out.ai[k] = out.ai[k].trim();
    }
    // حذف / انتهایی base_url تا از تولید آدرس .../v1//chat/completions جلوگیری شود
    if (out.ai.base_url) out.ai.base_url = out.ai.base_url.replace(/\/+$/, '');
    return out;
  }

  function update(patch) {
    const next = validate(deepMerge(load(), patch || {}));
    writeAtomic(next);
    return next;
  }

  /** ماسکه‌سازی کلید برای نمایش در رابط کاربری. */
  function maskKey(key) {
    if (!key) return '';
    const k = String(key);
    if (k.length <= 8) return '•'.repeat(k.length);
    return `${k.slice(0, 4)}${'•'.repeat(Math.min(12, k.length - 8))}${k.slice(-4)}`;
  }

  /** نسخهٔ امن برای ارسال به renderer (بدون کلید واقعی). */
  function publicConfig(cfg = load()) {
    const out = JSON.parse(JSON.stringify(cfg));
    out.ai.api_key = maskKey(out.ai.api_key);
    out.ai.api_key_set = Boolean(cfg.ai && cfg.ai.api_key);
    return out;
  }

  /** آیا تنظیمات برای برقراری تماس با AI کافی است؟ */
  function aiReady(cfg = load()) {
    const missing = [];
    if (!cfg.ai?.base_url) missing.push('آدرس سرویس (base_url)');
    if (!cfg.ai?.api_key) missing.push('کلید دسترسی (api_key)');
    if (!cfg.ai?.model) missing.push('نام مدل (model)');
    return { ready: missing.length === 0, missing };
  }

  return { liveConfigPath, ensureSeeded, load, validate, update, writeAtomic, publicConfig, aiReady, maskKey };
}

module.exports = { createConfigManager, deepMerge, DEFAULTS };
