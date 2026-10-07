'use strict';
/**
 * lib/actions.js — استخراج و اجرای بلوک‌های action از پاسخ مدل.
 *
 * چرا به‌جای tool-calling رسمی؟ چون بسیاری از سرویس‌های سازگار با OpenAI
 * (به‌ویژه نمونه‌های خودمیزبان مثل Ollama/LM Studio/vLLM) پیاده‌سازی
 * ناهمگون یا ناقص tools دارند. یک قرارداد JSON متنی روی «همهٔ» آن‌ها کار
 * می‌کند و دیباگش هم برای کاربر قابل فهم است.
 */
const J = require('./jalaali.js');

const MEAL_FA = { breakfast: 'صبحانه', lunch: 'ناهار', dinner: 'شام', snack: 'میان‌وعده' };
const KIND_FA = { cardio: 'هوازی', strength: 'قدرتی', flexibility: 'انعطافی', sport: 'ورزشی' };
const GOAL_KIND_FA = {
  kcal: 'کالری روزانه', protein_g: 'پروتئین روزانه (گرم)', water_ml: 'آب روزانه (میلی‌لیتر)',
  workouts_per_week: 'جلسهٔ تمرین در هفته', weight_kg: 'وزن هدف (کیلوگرم)', steps: 'قدم روزانه',
};
const PROFILE_FIELD_FA = {
  display_name: 'نام', sex: 'جنسیت', birth_year: 'سال تولد', height_cm: 'قد',
  activity_level: 'سطح تحرک', goal: 'هدف', dietary_restrictions: 'محدودیت غذایی',
  medical_notes: 'یادداشت سلامت', goal_rate_kg_per_week: 'سرعت تغییر وزن',
  birth_month: 'ماه تولد', birth_day: 'روز تولد',
};
const SEX_FA = { male: 'مرد', female: 'زن' };

/** پیدا کردن همهٔ بلوک‌های action در متن پاسخ. */
function extractActions(text) {
  if (!text || typeof text !== 'string') return { cleanText: String(text || ''), blocks: [] };

  const blocks = [];
  let cleanText = text;

  // بلوک ```action ... ``` (و ```json که محتوای action دارد)
  const fence = /```[ \t]*(action|json)?[ \t]*\r?\n([\s\S]*?)```/g;
  cleanText = text.replace(fence, (whole, lang, body) => {
    const trimmed = String(body || '').trim();
    if (!trimmed) return '';
    if (lang && lang !== 'action' && lang !== 'json') return whole;

    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // گاهی مدل چند شیء را پشت‌سرهم یا با کاما می‌نویسد
      const fixed = tryRepairJson(trimmed);
      if (fixed) parsed = fixed;
    }
    if (!parsed) return whole;

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    let took = 0;
    for (const item of arr) {
      if (item && typeof item === 'object' && typeof item.type === 'string' && item.payload !== undefined) {
        blocks.push(item);
        took += 1;
      } else if (item && typeof item === 'object' && Array.isArray(item.actions)) {
        for (const sub of item.actions) {
          if (sub && typeof sub.type === 'string') { blocks.push(sub); took += 1; }
        }
      }
    }
    // اگر بلوک json بود ولی action نبود، دست نمی‌زنیم
    if (lang === 'json' && took === 0) return whole;
    return '';
  });

  // JSON خام بدون fence (برخی مدل‌ها fence نمی‌گذارند)
  if (!blocks.length) {
    const spans = findRawActionObjects(cleanText);
    // از انتها به ابتدا پاک می‌کنیم تا ایندکس‌های قبلی معتبر بمانند
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const s = spans[i];
      const parsed = tryRepairJson(cleanText.slice(s.start, s.end));
      if (parsed && typeof parsed.type === 'string') {
        blocks.unshift(parsed);
        cleanText = cleanText.slice(0, s.start) + cleanText.slice(s.end);
      }
    }
  }

  // پاک‌سازی خطوط خالی اضافی
  cleanText = cleanText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { cleanText, blocks };
}

/**
 * پیدا کردن آبجکت‌های JSON خامی که با «"type"» شروع می‌شوند.
 * با شمارش آکولاد و احترام به رشته‌ها مرز درست را پیدا می‌کند؛ regex
 * غیرحریص اینجا جواب نمی‌دهد چون payload خودش یک آبجکت تودرتو است.
 */
function findRawActionObjects(text) {
  const out = [];
  const re = /\{\s*"type"\s*:\s*"[a-z_]+"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end > start) {
      out.push({ start, end });
      re.lastIndex = end;
    }
  }
  return out;
}

/** تلاش برای تعمیر JSON ناقص (کامای اضافی، کوتیشن تکی، کامنت). */
function tryRepairJson(input) {
  let s = String(input).trim();
  const attempts = [
    s,
    s.replace(/,\s*([}\]])/g, '$1'),                       // کامای انتهایی
    s.replace(/^\{/, '{"').replace(/([{,])\s*([A-Za-z_][\w]*)\s*:/g, '$1"$2":'), // کلید بدون کوت
    s.replace(/,\s*([}\]])/g, '$1').replace(/([{,])\s*([A-Za-z_][\w]*)\s*:/g, '$1"$2":'),
  ];
  for (const candidate of attempts) {
    try {
      const p = JSON.parse(candidate);
      if (p && typeof p === 'object') return p;
    } catch { /* try next */ }
  }
  return null;
}

/** حل تاریخ نسبی بر پایهٔ کلید امروز. */
function resolveDay(value, todayKey) {
  if (!value) return todayKey;
  const s = J.normalize(String(value));
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return J.dateKey(J.parseDateKey(s));
  const rel = { 'امروز': 0, 'دیروز': -1, 'پریروز': -2, 'فردا': 1 };
  if (rel[s] !== undefined) return J.addDaysKey(todayKey, rel[s]);
  const parsed = J.parseDateKey(s);
  if (parsed) return J.dateKey(parsed.jy, parsed.jm, parsed.jd);
  return todayKey;
}

/** اجرای یک بلوک action روی پایگاه‌داده و ساخت پیام فارسی نتیجه. */
function applyAction(repo, block, opts = {}) {
  const todayKey = opts.today || J.todayKey();
  const type = String(block.type || '').trim();
  const payload = (block.payload && typeof block.payload === 'object') ? block.payload : {};

  try {
    switch (type) {
      case 'log_meal': {
        const row = repo.logMeal({
          ...payload,
          day: resolveDay(payload.day, todayKey),
          meal: payload.meal,
          qty: payload.qty ?? 1,
        });
        const unit = row.unit ? ` ${row.unit}` : '';
        return ok({
          type,
          title: `${MEAL_FA[row.meal] || row.meal} ثبت شد`,
          message: `${row.name} — ${J.formatNumber(row.qty, 1)}${unit} — ${J.formatNumber(row.kcal)} کیلوکالری`,
          data: row,
        });
      }

      case 'log_workout': {
        const row = repo.logWorkout({ ...payload, day: resolveDay(payload.day, todayKey) });
        const detail = [];
        if (row.duration_min) detail.push(`${J.formatNumber(row.duration_min)} دقیقه`);
        if (row.sets && row.reps) detail.push(`${J.formatNumber(row.sets)} ست × ${J.formatNumber(row.reps)}`);
        if (row.load_kg) detail.push(`${J.formatNumber(row.load_kg)} کیلوگرم`);
        return ok({
          type,
          title: 'تمرین ثبت شد',
          message: `${row.name}${detail.length ? ' — ' + detail.join('، ') : ''} — حدود ${J.formatNumber(row.kcal)} کیلوکالری سوزانده شد`,
          data: row,
        });
      }

      case 'log_weight': {
        const row = repo.logWeight({ ...payload, day: resolveDay(payload.day, todayKey) });
        const extra = [];
        if (row.body_fat_pct) extra.push(`چربی بدن ${J.formatNumber(row.body_fat_pct, 1)}٪`);
        if (row.waist_cm) extra.push(`دور کمر ${J.formatNumber(row.waist_cm)} سانتی‌متر`);
        return ok({
          type,
          title: 'وزن ثبت شد',
          message: `${J.formatNumber(row.weight_kg, 1)} کیلوگرم برای ${J.relativeDayLabel(row.day)}${extra.length ? ' — ' + extra.join('، ') : ''}`,
          data: row,
        });
      }

      case 'log_water': {
        const row = repo.logWater(payload.amount_ml, resolveDay(payload.day, todayKey));
        const total = repo.waterByDay(row.day);
        return ok({
          type,
          title: 'آب ثبت شد',
          message: `${J.formatNumber(row.amount_ml)} میلی‌لیتر — مجموع امروز ${J.formatNumber(total.total_ml)} میلی‌لیتر`,
          data: row,
        });
      }

      case 'log_sleep': {
        const row = repo.logSleep({ ...payload, day: resolveDay(payload.day, todayKey) });
        return ok({
          type,
          title: 'خواب ثبت شد',
          message: `${J.formatNumber(row.hours, 1)} ساعت${row.quality ? ` با کیفیت ${J.formatNumber(row.quality)} از ۵` : ''}`,
          data: row,
        });
      }

      case 'set_goal': {
        const g = repo.setGoal(payload.kind, payload.target, payload.note);
        return ok({
          type,
          title: 'هدف تنظیم شد',
          message: `${GOAL_KIND_FA[g.kind] || g.kind}: ${J.formatNumber(g.target)}`,
          data: g,
        });
      }

      case 'update_profile': {
        const allowed = {};
        const changed = [];
        for (const [k, v] of Object.entries(payload)) {
          if (!(k in PROFILE_FIELD_FA)) continue;
          allowed[k] = v;
          changed.push(`${PROFILE_FIELD_FA[k]}: ${k === 'sex' ? (SEX_FA[v] || v) : Array.isArray(v) ? v.join('، ') : J.toPersianDigits(String(v))}`);
        }
        if (!Object.keys(allowed).length) {
          return fail(type, 'هیچ فیلد معتبری برای به‌روزرسانی پروفایل پیدا نشد.');
        }
        const p = repo.saveProfile(allowed);
        return ok({
          type,
          title: 'مشخصات به‌روزرسانی شد',
          message: changed.join(' | '),
          data: p,
        });
      }

      default:
        return fail(type, `نوع عملیات «${type || 'نامشخص'}» پشتیبانی نمی‌شود.`);
    }
  } catch (err) {
    return fail(type, err.message || String(err));
  }
}

function ok(o) {
  return { ok: true, type: o.type, title: o.title, message: o.message, data: o.data };
}
function fail(type, message) {
  return { ok: false, type: type || 'unknown', title: 'ثبت انجام نشد', message, data: null };
}

/**
 * اجرای همهٔ بلوک‌های یک پاسخ.
 * @returns {{cleanText:string, results:Array}}
 */
function processAssistantText(repo, text, opts = {}) {
  const { cleanText, blocks } = extractActions(text);
  const results = blocks.map((b) => applyAction(repo, b, opts));
  return { cleanText, results };
}

module.exports = { extractActions, findRawActionObjects, applyAction, processAssistantText, tryRepairJson, resolveDay, MEAL_FA, KIND_FA };
