'use strict';
/**
 * lib/db.js — لایهٔ دادهٔ SQLite (فقط در فرآیند main).
 *
 * چرا better-sqlite3؟
 *  - همگام (synchronous) و بدون سربار IPC داخلی؛ برای حجم دادهٔ شخصی کاربر
 *    میلی‌ثانیه‌ای پاسخ می‌دهد.
 *  - تراکنش واقعی، ایندکس، و یکپارچگی ارجاعی — چیزی که IndexedDB به این
 *    سادگی نمی‌دهد.
 *
 * قرارداد تاریخ: همهٔ ستون‌های `day` کلید جلالی به شکل 1405-07-15 هستند تا
 * «روز» در رابط کاربری با «روز» در پایگاه‌داده دقیقاً یکی باشد و نیازی به
 * تبدیل منطقهٔ زمانی در زمان پرس‌وجو نباشد. زمان‌های دقیق در `ts` (ISO UTC)
 * ذخیره می‌شوند.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const J = require('./jalaali.js');

const SCHEMA_VERSION = 1;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  display_name          TEXT,
  sex                   TEXT,
  birth_year            INTEGER,
  birth_month           INTEGER,
  birth_day             INTEGER,
  height_cm             REAL,
  activity_level        TEXT,
  goal                  TEXT,
  goal_rate_kg_per_week REAL,
  dietary_restrictions  TEXT,
  medical_notes         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weight_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  day          TEXT NOT NULL,
  weight_kg    REAL NOT NULL,
  body_fat_pct REAL,
  waist_cm     REAL,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_day ON weight_log(day);

CREATE TABLE IF NOT EXISTS food_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  category       TEXT,
  unit           TEXT NOT NULL,
  unit_label     TEXT,
  grams_per_unit REAL,
  kcal           REAL NOT NULL DEFAULT 0,
  protein        REAL NOT NULL DEFAULT 0,
  carbs          REAL NOT NULL DEFAULT 0,
  fat            REAL NOT NULL DEFAULT 0,
  fiber          REAL NOT NULL DEFAULT 0,
  sodium_mg      REAL NOT NULL DEFAULT 0,
  tags           TEXT NOT NULL DEFAULT '[]',
  aliases        TEXT NOT NULL DEFAULT '[]',
  source         TEXT
);
CREATE INDEX IF NOT EXISTS idx_food_name ON food_items(name);

CREATE TABLE IF NOT EXISTS meal_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT NOT NULL,
  meal    TEXT NOT NULL,
  ts      TEXT NOT NULL,
  food_id INTEGER REFERENCES food_items(id) ON DELETE SET NULL,
  name    TEXT NOT NULL,
  qty     REAL NOT NULL DEFAULT 1,
  unit    TEXT,
  kcal    REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  carbs   REAL NOT NULL DEFAULT 0,
  fat     REAL NOT NULL DEFAULT 0,
  fiber   REAL NOT NULL DEFAULT 0,
  note    TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_day ON meal_log(day, meal);

CREATE TABLE IF NOT EXISTS exercise_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  category     TEXT,
  met          REAL NOT NULL DEFAULT 4,
  equipment    TEXT,
  muscles      TEXT NOT NULL DEFAULT '[]',
  level        TEXT,
  aliases      TEXT NOT NULL DEFAULT '[]',
  instructions TEXT
);
CREATE INDEX IF NOT EXISTS idx_ex_name ON exercise_items(name);

CREATE TABLE IF NOT EXISTS workout_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  day          TEXT NOT NULL,
  ts           TEXT NOT NULL,
  exercise_id  INTEGER REFERENCES exercise_items(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'cardio',
  sets         INTEGER,
  reps         INTEGER,
  load_kg      REAL,
  duration_min REAL,
  kcal         REAL NOT NULL DEFAULT 0,
  rpe          REAL,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_workout_day ON workout_log(day, kind);

CREATE TABLE IF NOT EXISTS water_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  day       TEXT NOT NULL,
  ts        TEXT NOT NULL,
  amount_ml INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_water_day ON water_log(day);

CREATE TABLE IF NOT EXISTS sleep_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,
  hours      REAL NOT NULL,
  quality    INTEGER,
  bedtime    TEXT,
  wake_time  TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sleep_day ON sleep_log(day);

CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  target     REAL NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_kind ON goals(kind);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  personality TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  action          TEXT,
  status          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
`;

/** اعداد را امن و کران‌دار می‌کند؛ مقدار نامعتبر → null. */
function num(value, min = -1e6, max = 1e6) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function str(value, maxLen = 4000) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function jsonOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return null; }
}

function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

const nowIso = () => new Date().toISOString();

/**
 * فاصلهٔ لونشتاین (برای تطبیق نادقیق).
 * پیاده‌سازی دو-ردیفه تا حافظه O(min(m,n)) بماند.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** شباهت نرمال‌شده بین ۰ و ۱. */
function similarity(a, b) {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

/** نرمال‌سازی عبارت جست‌وجو برای تطبیق فارسی. */
function searchKey(s) {
  return J.stripDiacritics(J.normalize(String(s))).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} opts
 * @param {string} opts.file مسیر فایل پایگاه‌داده
 * @param {string} opts.dataDir پوشهٔ data (برای foods.json و exercises.json)
 * @param {(msg:string)=>void} [opts.log]
 */
function createDatabase(opts) {
  const { file, dataDir } = opts;
  const log = opts.log || (() => {});

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(SCHEMA);

  const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const setMeta = db.prepare(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  function metaGet(key) {
    const row = getMeta.get(key);
    return row ? row.value : null;
  }
  function metaSet(key, value) {
    setMeta.run(key, String(value));
  }

  const version = metaGet('schema_version');
  if (!version) metaSet('schema_version', SCHEMA_VERSION);
  else if (Number(version) > SCHEMA_VERSION) {
    log(`هشدار: نسخهٔ اسکیمای پایگاه‌داده (${version}) از نسخهٔ برنامه (${SCHEMA_VERSION}) جدیدتر است.`);
  }

  // —————————————————— پروفایل ——————————————————
  const profileStmt = db.prepare('SELECT * FROM profile WHERE id = 1');
  const profileUpsert = db.prepare(`
    INSERT INTO profile (id, display_name, sex, birth_year, birth_month, birth_day, height_cm,
                         activity_level, goal, goal_rate_kg_per_week, dietary_restrictions,
                         medical_notes, created_at, updated_at)
    VALUES (1, @display_name, @sex, @birth_year, @birth_month, @birth_day, @height_cm,
            @activity_level, @goal, @goal_rate_kg_per_week, @dietary_restrictions,
            @medical_notes, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, profile.display_name),
      sex = COALESCE(excluded.sex, profile.sex),
      birth_year = COALESCE(excluded.birth_year, profile.birth_year),
      birth_month = COALESCE(excluded.birth_month, profile.birth_month),
      birth_day = COALESCE(excluded.birth_day, profile.birth_day),
      height_cm = COALESCE(excluded.height_cm, profile.height_cm),
      activity_level = COALESCE(excluded.activity_level, profile.activity_level),
      goal = COALESCE(excluded.goal, profile.goal),
      goal_rate_kg_per_week = COALESCE(excluded.goal_rate_kg_per_week, profile.goal_rate_kg_per_week),
      dietary_restrictions = COALESCE(excluded.dietary_restrictions, profile.dietary_restrictions),
      medical_notes = COALESCE(excluded.medical_notes, profile.medical_notes),
      updated_at = excluded.updated_at
  `);

  function shapeProfile(row) {
    if (!row) return null;
    return {
      ...row,
      dietary_restrictions: jsonParse(row.dietary_restrictions, []),
      hasProfile: true,
    };
  }

  function getProfile() {
    return shapeProfile(profileStmt.get());
  }

  function saveProfile(patch = {}) {
    const current = getProfile() || {};
    profileUpsert.run({
      display_name: str(patch.display_name) ?? current.display_name ?? null,
      sex: ['male', 'female'].includes(patch.sex) ? patch.sex : (current.sex ?? null),
      birth_year: num(patch.birth_year, 1300, 1500) ?? current.birth_year ?? null,
      birth_month: num(patch.birth_month, 1, 12) ?? current.birth_month ?? null,
      birth_day: num(patch.birth_day, 1, 31) ?? current.birth_day ?? null,
      height_cm: num(patch.height_cm, 80, 260) ?? current.height_cm ?? null,
      activity_level: ['sedentary', 'light', 'moderate', 'active', 'athlete'].includes(patch.activity_level)
        ? patch.activity_level : (current.activity_level ?? null),
      goal: ['lose', 'maintain', 'gain', 'health'].includes(patch.goal)
        ? patch.goal : (current.goal ?? null),
      goal_rate_kg_per_week: num(patch.goal_rate_kg_per_week, 0, 2) ?? current.goal_rate_kg_per_week ?? null,
      dietary_restrictions: jsonOrNull(patch.dietary_restrictions) ?? jsonOrNull(current.dietary_restrictions) ?? '[]',
      medical_notes: str(patch.medical_notes) ?? current.medical_notes ?? null,
      now: nowIso(),
    });
    return getProfile();
  }

  // —————————————————— وزن ——————————————————
  const weightUpsert = db.prepare(`
    INSERT INTO weight_log (day, weight_kg, body_fat_pct, waist_cm, note, created_at)
    VALUES (@day, @weight_kg, @body_fat_pct, @waist_cm, @note, @created_at)
    ON CONFLICT(day) DO UPDATE SET
      weight_kg = excluded.weight_kg,
      body_fat_pct = COALESCE(excluded.body_fat_pct, weight_log.body_fat_pct),
      waist_cm = COALESCE(excluded.waist_cm, weight_log.waist_cm),
      note = COALESCE(excluded.note, weight_log.note),
      created_at = excluded.created_at
  `);

  function logWeight({ day, weight_kg, body_fat_pct, waist_cm, note }) {
    const d = J.parseDateKey(day || J.todayKey());
    if (!d) throw new Error('تاریخ نامعتبر است. نمونهٔ درست: 1405-07-15');
    const w = num(weight_kg, 15, 500);
    if (w === null) throw new Error('وزن باید عددی بین ۱۵ تا ۵۰۰ کیلوگرم باشد.');
    weightUpsert.run({
      day: J.dateKey(d.jy, d.jm, d.jd),
      weight_kg: w,
      body_fat_pct: num(body_fat_pct, 2, 75),
      waist_cm: num(waist_cm, 30, 250),
      note: str(note, 500),
      created_at: nowIso(),
    });
    return getWeight(J.dateKey(d.jy, d.jm, d.jd));
  }

  const weightByDay = db.prepare('SELECT * FROM weight_log WHERE day = ?');
  function getWeight(day) { return weightByDay.get(day) || null; }

  const weightList = db.prepare(`
    SELECT * FROM weight_log WHERE day >= ? AND day <= ? ORDER BY day ASC
  `);
  function listWeight({ from, to, limit } = {}) {
    if (limit) {
      return db.prepare('SELECT * FROM weight_log ORDER BY day DESC LIMIT ?').all(limit).reverse();
    }
    return weightList.all(from || '0000-00-00', to || '9999-99-99');
  }

  const latestWeight = db.prepare('SELECT * FROM weight_log ORDER BY day DESC, id DESC LIMIT 1');
  function getLatestWeight() { return latestWeight.get() || null; }

  // —————————————————— غذا ——————————————————
  function hashFile(p) {
    try { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
  }

  const foodInsert = db.prepare(`
    INSERT INTO food_items (slug, name, category, unit, unit_label, grams_per_unit, kcal,
                            protein, carbs, fat, fiber, sodium_mg, tags, aliases, source)
    VALUES (@slug, @name, @category, @unit, @unit_label, @grams_per_unit, @kcal,
            @protein, @carbs, @fat, @fiber, @sodium_mg, @tags, @aliases, @source)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, category = excluded.category, unit = excluded.unit,
      unit_label = excluded.unit_label, grams_per_unit = excluded.grams_per_unit,
      kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs,
      fat = excluded.fat, fiber = excluded.fiber, sodium_mg = excluded.sodium_mg,
      tags = excluded.tags, aliases = excluded.aliases, source = excluded.source
  `);

  const exerciseInsert = db.prepare(`
    INSERT INTO exercise_items (slug, name, category, met, equipment, muscles, level, aliases, instructions)
    VALUES (@slug, @name, @category, @met, @equipment, @muscles, @level, @aliases, @instructions)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, category = excluded.category, met = excluded.met,
      equipment = excluded.equipment, muscles = excluded.muscles, level = excluded.level,
      aliases = excluded.aliases, instructions = excluded.instructions
  `);

  /**
   * بارگذاری فهرست غذاها/حرکت‌ها از data/. اگر محتوای فایل تغییر کرده باشد
   * دوباره seed می‌شود (idempotent بر پایهٔ slug).
   */
  function seedCatalogues() {
    const result = { foods: 0, exercises: 0, updated: [] };

    const foodsPath = path.join(dataDir, 'foods.json');
    const exPath = path.join(dataDir, 'exercises.json');

    const foodsHash = hashFile(foodsPath);
    if (foodsHash && metaGet('seed.foods.hash') !== foodsHash) {
      const raw = jsonParse(fs.readFileSync(foodsPath, 'utf8'), { items: [] });
      const items = Array.isArray(raw) ? raw : (raw.items || []);
      const tx = db.transaction((rows) => {
        for (const f of rows) {
          foodInsert.run({
            slug: String(f.slug || f.name),
            name: String(f.name),
            category: f.category || null,
            unit: String(f.unit || 'واحد'),
            unit_label: f.unit_label || null,
            grams_per_unit: num(f.grams_per_unit, 0, 5000),
            kcal: num(f.kcal, 0, 20000) ?? 0,
            protein: num(f.protein, 0, 1000) ?? 0,
            carbs: num(f.carbs, 0, 1000) ?? 0,
            fat: num(f.fat, 0, 1000) ?? 0,
            fiber: num(f.fiber, 0, 500) ?? 0,
            sodium_mg: num(f.sodium_mg, 0, 20000) ?? 0,
            tags: jsonOrNull(f.tags) || '[]',
            aliases: jsonOrNull(f.aliases) || '[]',
            source: f.source || null,
          });
          result.foods += 1;
        }
      });
      tx(items);
      metaSet('seed.foods.hash', foodsHash);
      result.updated.push('foods');
    }

    const exHash = hashFile(exPath);
    if (exHash && metaGet('seed.exercises.hash') !== exHash) {
      const raw = jsonParse(fs.readFileSync(exPath, 'utf8'), { items: [] });
      const items = Array.isArray(raw) ? raw : (raw.items || []);
      const tx = db.transaction((rows) => {
        for (const e of rows) {
          exerciseInsert.run({
            slug: String(e.slug || e.name),
            name: String(e.name),
            category: e.category || null,
            met: num(e.met, 0.5, 30) ?? 4,
            equipment: e.equipment || null,
            muscles: jsonOrNull(e.muscles) || '[]',
            level: e.level || null,
            aliases: jsonOrNull(e.aliases) || '[]',
            instructions: e.instructions || null,
          });
          result.exercises += 1;
        }
      });
      tx(items);
      metaSet('seed.exercises.hash', exHash);
      result.updated.push('exercises');
    }

    return result;
  }

  const foodCount = db.prepare('SELECT COUNT(*) AS n FROM food_items');
  const exerciseCount = db.prepare('SELECT COUNT(*) AS n FROM exercise_items');
  const foodById = db.prepare('SELECT * FROM food_items WHERE id = ?');
  const foodBySlug = db.prepare('SELECT * FROM food_items WHERE slug = ?');

  /**
   * امتیازدهی یک ردیف در برابر عبارت‌های جست‌وجو.
   * سه سطح:
   *   ۱۰۰ تطابق کامل · ۷۰ پیشوند · ۵۰ زیررشته · تا ۴۵ شباهت (غلط املایی/حرف افتاده)
   */
  function scoreRow(names, terms) {
    let score = 0;
    for (const t of terms) {
      let hit = 0;
      for (const n of names) {
        if (n === t) hit = Math.max(hit, 100);
        else if (n.startsWith(t)) hit = Math.max(hit, 70);
        else if (n.includes(t)) hit = Math.max(hit, 50);
        else {
          // شباهت روی کل نام، و روی هر کلمهٔ نام
          let sim = similarity(n, t);
          for (const w of n.split(' ')) sim = Math.max(sim, similarity(w, t));
          if (sim >= 0.72) hit = Math.max(hit, Math.round(45 * sim));
        }
      }
      if (!hit) return 0;
      score += hit;
    }
    return score;
  }

  /**
   * جست‌وجوی عمومی روی جدولی از اقلام دارای name/aliases.
   *
   * چرا دو مرحله؟
   *  - LIKE روی SQLite سریع است ولی «قرمه سبزی» را به «قورمه سبزی» نمی‌رساند
   *    (حرف «و» در نوشتار محاوره‌ای فارسی اغلب می‌افتد).
   *  - پس اگر LIKE نتیجه نداد، یک لایهٔ شباهت روی همهٔ ردیف‌ها اجرا می‌شود.
   *    تعداد ردیف‌ها کوچک است (چند صد)، پس هزینه‌ای ندارد.
   */
  function searchTable(table, extraCols, query, limit) {
    // نام جدول فقط از ثابت‌های داخلی می‌آید؛ این نگهبان برای اطمینان است
    if (!['food_items', 'exercise_items'].includes(table)) {
      throw new Error('جدول جست‌وجوی نامعتبر است.');
    }
    const q = searchKey(query);
    if (!q) return [];
    const terms = q.split(' ').filter(Boolean);

    const shape = (row) => {
      const out = { ...row, aliases: jsonParse(row.aliases, []), tags: jsonParse(row.tags, []), muscles: jsonParse(row.muscles, []) };
      return out;
    };
    const namesOf = (row) => [row.name, ...jsonParse(row.aliases, [])].map(searchKey);

    const runOn = (rows) => {
      const scored = [];
      for (const row of rows) {
        const s = scoreRow(namesOf(row), terms);
        if (s > 0) scored.push({ ...shape(row), score: s });
      }
      return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fa'));
    };

    // لایهٔ ۱: پیش‌فیلتر با LIKE
    const like = `%${terms[0].replace(/[%_]/g, '')}%`;
    const cols = ['name', 'aliases', ...extraCols];
    const where = cols.map((c) => `${c} LIKE ?`).join(' OR ');
    const fast = db.prepare(`SELECT * FROM ${table} WHERE ${where} LIMIT 400`)
      .all(...cols.map(() => like));
    const result = runOn(fast);
    if (result.length >= limit) return result.slice(0, limit);

    // لایهٔ ۲: شباهت روی همهٔ ردیف‌ها (فقط برای پر کردن جای خالی)
    const seen = new Set(result.map((r) => r.id));
    const all = db.prepare(`SELECT * FROM ${table} LIMIT 2000`).all();
    const rest = runOn(all.filter((r) => !seen.has(r.id)));
    return [...result, ...rest].slice(0, limit);
  }

  /** جست‌وجوی غذا با تطبیق نادقیق فارسی (نام، نام مستعار، دسته). */
  function searchFoods(query, limit = 12) {
    return searchTable('food_items', ['category'], query, limit);
  }

  /** جست‌وجوی تمرین (نام، نام مستعار، دسته، عضلات). */
  function searchExercises(query, limit = 12) {
    return searchTable('exercise_items', ['category', 'muscles'], query, limit);
  }

  function listFoods({ category, limit = 200 } = {}) {
    const rows = category
      ? db.prepare('SELECT * FROM food_items WHERE category = ? ORDER BY name LIMIT ?').all(category, limit)
      : db.prepare('SELECT * FROM food_items ORDER BY name LIMIT ?').all(limit);
    return rows.map((r) => ({ ...r, tags: jsonParse(r.tags, []), aliases: jsonParse(r.aliases, []) }));
  }

  const foodCategories = db.prepare('SELECT DISTINCT category FROM food_items WHERE category IS NOT NULL ORDER BY category');
  function listFoodCategories() { return foodCategories.all().map((r) => r.category); }

  // —————————————————— وعده‌ها ——————————————————
  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

  /** حدس وعده بر پایهٔ ساعت محلی — وقتی کاربر وعده را مشخص نکرده است. */
  function guessMeal(date = new Date()) {
    const h = date.getHours();
    if (h >= 4 && h < 11) return 'breakfast';
    if (h >= 11 && h < 15) return 'lunch';
    if (h >= 15 && h < 18) return 'snack';
    if (h >= 18 && h < 23) return 'dinner';
    return 'snack';
  }

  const mealInsert = db.prepare(`
    INSERT INTO meal_log (day, meal, ts, food_id, name, qty, unit, kcal, protein, carbs, fat, fiber, note)
    VALUES (@day, @meal, @ts, @food_id, @name, @qty, @unit, @kcal, @protein, @carbs, @fat, @fiber, @note)
  `);

  function logMeal(input) {
    const dayKey = J.dateKey(J.parseDateKey(input.day || J.todayKey()) || J.today());
    const meal = MEALS.includes(input.meal) ? input.meal : guessMeal(new Date());
    let foodId = null;
    let base = null;
    if (input.food_id) {
      base = foodById.get(input.food_id) || null;
      foodId = base ? base.id : null;
    } else if (input.food_slug) {
      base = foodBySlug.get(input.food_slug) || null;
      foodId = base ? base.id : null;
    } else if (!input.name && input.query) {
      base = searchFoods(input.query, 1)[0] || null;
      foodId = base ? base.id : null;
    }

    const qty = num(input.qty, 0.01, 200) ?? 1;
    // اگر غذا در پایگاه‌داده بود، مقادیر از همان‌جا محاسبه می‌شود؛
    // در غیر این صورت مقدارهای داده‌شده توسط AI پذیرفته می‌شود.
    const kcal = base ? (num(base.kcal, 0, 20000) ?? 0) * qty : (num(input.kcal, 0, 20000) ?? 0);
    const info = db.transaction(() => {
      const r = mealInsert.run({
        day: dayKey,
        meal,
        ts: input.ts || nowIso(),
        food_id: foodId,
        name: str(input.name) ?? (base ? base.name : str(input.query) ?? 'وعدهٔ ثبت‌شده'),
        qty,
        unit: str(input.unit) ?? (base ? base.unit : null),
        kcal,
        protein: base ? (base.protein ?? 0) * qty : (num(input.protein, 0, 1000) ?? 0),
        carbs: base ? (base.carbs ?? 0) * qty : (num(input.carbs, 0, 1000) ?? 0),
        fat: base ? (base.fat ?? 0) * qty : (num(input.fat, 0, 1000) ?? 0),
        fiber: base ? (base.fiber ?? 0) * qty : (num(input.fiber, 0, 500) ?? 0),
        note: str(input.note, 500),
      });
      return db.prepare('SELECT * FROM meal_log WHERE id = ?').get(r.lastInsertRowid);
    })();
    return info;
  }

  const mealsByDay = db.prepare('SELECT * FROM meal_log WHERE day = ? ORDER BY ts ASC, id ASC');
  function listMeals(day) { return mealsByDay.all(J.dateKey(J.parseDateKey(day) || J.today())); }

  const mealById = db.prepare('SELECT * FROM meal_log WHERE id = ?');
  const mealDelete = db.prepare('DELETE FROM meal_log WHERE id = ?');
  function deleteMeal(id) {
    const row = mealById.get(id);
    if (!row) return false;
    mealDelete.run(id);
    return true;
  }

  // —————————————————— ورزش ——————————————————
  const workoutInsert = db.prepare(`
    INSERT INTO workout_log (day, ts, exercise_id, name, kind, sets, reps, load_kg, duration_min, kcal, rpe, note)
    VALUES (@day, @ts, @exercise_id, @name, @kind, @sets, @reps, @load_kg, @duration_min, @kcal, @rpe, @note)
  `);

  function logWorkout(input) {
    const dayKey = J.dateKey(J.parseDateKey(input.day || J.todayKey()) || J.today());
    let exId = null;
    let base = null;
    if (input.exercise_id) base = db.prepare('SELECT * FROM exercise_items WHERE id = ?').get(input.exercise_id) || null;
    else if (input.exercise_slug) base = db.prepare('SELECT * FROM exercise_items WHERE slug = ?').get(input.exercise_slug) || null;
    else if (!input.name && input.query) base = searchExercises(input.query, 1)[0] || null;
    exId = base ? base.id : null;

    const durationMin = num(input.duration_min, 0.5, 600);
    const sets = num(input.sets, 1, 30);
    const reps = num(input.reps, 1, 500);
    const kind = ['cardio', 'strength', 'flexibility', 'sport'].includes(input.kind)
      ? input.kind
      : (base && base.category === 'قدرتی' ? 'strength' : 'cardio');

    // برآورد کالری: برای هوازی از MET، برای قدرتی از حجم کار (ست × تکرار × بار)
    let kcal = num(input.kcal, 0, 5000);
    if (kcal === null) {
      if (kind === 'cardio' && durationMin) {
        const met = num(input.met, 0.5, 30) ?? (base ? base.met : 5);
        kcal = met * weight70() * (durationMin / 60);
      } else if (sets && reps) {
        // ~۰٫۰۳ کیلوکالری به ازای هر کیلوگرم جابه‌جا‌شده، ضریب متابولیک ۵
        const load = num(input.load_kg, 0, 500) ?? 0;
        kcal = sets * reps * (load * 0.03 + 1.2);
      } else {
        kcal = 0;
      }
    }

    const r = workoutInsert.run({
      day: dayKey,
      ts: input.ts || nowIso(),
      exercise_id: exId,
      name: str(input.name) ?? (base ? base.name : str(input.query) ?? 'تمرین ثبت‌شده'),
      kind,
      sets: sets ? Math.round(sets) : null,
      reps: reps ? Math.round(reps) : null,
      load_kg: num(input.load_kg, 0, 500),
      duration_min: durationMin,
      kcal: Math.max(0, Math.round(kcal)),
      rpe: num(input.rpe, 1, 10),
      note: str(input.note, 500),
    });
    return db.prepare('SELECT * FROM workout_log WHERE id = ?').get(r.lastInsertRowid);
  }

  /** وزن مرجع برای محاسبهٔ کالری (آخرین وزن ثبت‌شده یا ۷۰ کیلوگرم). */
  function weight70() {
    return getLatestWeight()?.weight_kg || 70;
  }

  const workoutsByDay = db.prepare('SELECT * FROM workout_log WHERE day = ? ORDER BY ts ASC, id ASC');
  function listWorkouts(day) { return workoutsByDay.all(J.dateKey(J.parseDateKey(day) || J.today())); }

  const workoutDelete = db.prepare('DELETE FROM workout_log WHERE id = ?');
  function deleteWorkout(id) {
    const row = db.prepare('SELECT * FROM workout_log WHERE id = ?').get(id);
    if (!row) return false;
    workoutDelete.run(id);
    return true;
  }

  // —————————————————— آب ——————————————————
  const waterInsert = db.prepare('INSERT INTO water_log (day, ts, amount_ml) VALUES (?, ?, ?)');
  function logWater(amountMl, day) {
    const ml = num(amountMl, 10, 5000);
    if (ml === null) throw new Error('مقدار آب باید بین ۱۰ تا ۵۰۰۰ میلی‌لیتر باشد.');
    const dayKey = J.dateKey(J.parseDateKey(day || J.todayKey()) || J.today());
    const r = waterInsert.run(dayKey, nowIso(), Math.round(ml));
    return db.prepare('SELECT * FROM water_log WHERE id = ?').get(r.lastInsertRowid);
  }
  function waterByDay(day) {
    const dayKey = J.dateKey(J.parseDateKey(day || J.todayKey()) || J.today());
    const row = db.prepare('SELECT COALESCE(SUM(amount_ml),0) AS total, COUNT(*) AS glasses FROM water_log WHERE day = ?').get(dayKey);
    return { day: dayKey, total_ml: row.total, count: row.glasses };
  }
  const waterDelete = db.prepare('DELETE FROM water_log WHERE id = ?');
  function deleteWater(id) { return waterDelete.run(id).changes > 0; }

  // —————————————————— خواب ——————————————————
  const sleepUpsert = db.prepare(`
    INSERT INTO sleep_log (day, hours, quality, bedtime, wake_time, note, created_at)
    VALUES (@day, @hours, @quality, @bedtime, @wake_time, @note, @created_at)
    ON CONFLICT(day) DO UPDATE SET
      hours = excluded.hours,
      quality = COALESCE(excluded.quality, sleep_log.quality),
      bedtime = COALESCE(excluded.bedtime, sleep_log.bedtime),
      wake_time = COALESCE(excluded.wake_time, sleep_log.wake_time),
      note = COALESCE(excluded.note, sleep_log.note),
      created_at = excluded.created_at
  `);
  function logSleep({ day, hours, quality, bedtime, wake_time, note }) {
    const h = num(hours, 0, 24);
    if (h === null) throw new Error('ساعت خواب باید عددی بین ۰ تا ۲۴ باشد.');
    const dayKey = J.dateKey(J.parseDateKey(day || J.todayKey()) || J.today());
    sleepUpsert.run({
      day: dayKey,
      hours: h,
      quality: num(quality, 1, 5) ? Math.round(num(quality, 1, 5)) : null,
      bedtime: str(bedtime, 20),
      wake_time: str(wake_time, 20),
      note: str(note, 500),
      created_at: nowIso(),
    });
    return db.prepare('SELECT * FROM sleep_log WHERE day = ?').get(dayKey);
  }
  function listSleep({ from, to, limit } = {}) {
    if (limit) return db.prepare('SELECT * FROM sleep_log ORDER BY day DESC LIMIT ?').all(limit).reverse();
    return db.prepare('SELECT * FROM sleep_log WHERE day >= ? AND day <= ? ORDER BY day ASC')
      .all(from || '0000-00-00', to || '9999-99-99');
  }

  // —————————————————— هدف‌ها ——————————————————
  const goalUpsert = db.prepare(`
    INSERT INTO goals (kind, target, active, note, created_at)
    VALUES (@kind, @target, 1, @note, @created_at)
    ON CONFLICT(kind) DO UPDATE SET target = excluded.target, active = 1, note = COALESCE(excluded.note, goals.note)
  `);
  const GOAL_KINDS = ['kcal', 'protein_g', 'water_ml', 'workouts_per_week', 'weight_kg', 'steps'];
  function setGoal(kind, target, note) {
    if (!GOAL_KINDS.includes(kind)) throw new Error(`نوع هدف نامعتبر است: ${kind}`);
    const t = num(target, 0, 100000);
    if (t === null) throw new Error('مقدار هدف نامعتبر است.');
    goalUpsert.run({ kind, target: t, note: str(note, 500), created_at: nowIso() });
    return getGoals()[kind] || null;
  }
  function getGoals() {
    const rows = db.prepare('SELECT * FROM goals WHERE active = 1').all();
    const out = {};
    for (const r of rows) out[r.kind] = { kind: r.kind, target: r.target, note: r.note };
    return out;
  }

  // —————————————————— گفت‌وگو ——————————————————
  const convInsert = db.prepare(`
    INSERT INTO conversations (id, title, personality, archived, created_at, updated_at)
    VALUES (@id, @title, @personality, 0, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      title = COALESCE(excluded.title, conversations.title),
      personality = COALESCE(excluded.personality, conversations.personality),
      updated_at = excluded.updated_at
  `);

  function createConversation({ id, title, personality }) {
    const cid = str(id) || crypto.randomUUID();
    convInsert.run({ id: cid, title: str(title, 200), personality: str(personality, 50), now: nowIso() });
    return getConversation(cid);
  }

  const convGet = db.prepare('SELECT * FROM conversations WHERE id = ?');
  function getConversation(id) { return convGet.get(id) || null; }

  function listConversations(limit = 50) {
    return db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
      FROM conversations c WHERE c.archived = 0 ORDER BY c.updated_at DESC LIMIT ?
    `).all(limit);
  }

  function renameConversation(id, title) {
    return db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(str(title, 200), nowIso(), id).changes > 0;
  }

  function deleteConversation(id) {
    return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  }

  const msgInsert = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, action, status, created_at)
    VALUES (@conversation_id, @role, @content, @action, @status, @created_at)
  `);

  function addMessage({ conversation_id, role, content, action, status }) {
    if (!['user', 'assistant', 'system'].includes(role)) throw new Error('نقش پیام نامعتبر است.');
    const conv = getConversation(conversation_id);
    if (!conv) throw new Error('گفت‌وگو پیدا نشد.');
    const r = msgInsert.run({
      conversation_id,
      role,
      content: String(content ?? ''),
      action: jsonOrNull(action),
      status: status || 'ok',
      created_at: nowIso(),
    });
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversation_id);
    // عنوان خودکار از اولین پیام کاربر
    if (role === 'user' && !conv.title) {
      const first = String(content).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (first) renameConversation(conversation_id, first);
    }
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
  }

  function listMessages(conversation_id, limit = 200) {
    return db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?
    `).all(conversation_id, limit).map((m) => ({ ...m, action: m.action ? jsonParse(m.action, null) : null }));
  }

  /** n پیام آخر، به ترتیب زمانی — برای فرستادن به مدل. */
  function recentMessages(conversation_id, n = 24) {
    const rows = db.prepare(`
      SELECT role, content FROM messages
      WHERE conversation_id = ? AND status = 'ok'
      ORDER BY id DESC LIMIT ?
    `).all(conversation_id, n).reverse();
    return rows.map((r) => ({ role: r.role, content: r.content }));
  }

  function updateMessage(id, patch = {}) {
    const fields = [];
    const params = { id };
    if (patch.content !== undefined) { fields.push('content = @content'); params.content = String(patch.content); }
    if (patch.action !== undefined) { fields.push('action = @action'); params.action = jsonOrNull(patch.action); }
    if (patch.status !== undefined) { fields.push('status = @status'); params.status = patch.status; }
    if (!fields.length) return null;
    db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = @id`).run(params);
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    return row ? { ...row, action: row.action ? jsonParse(row.action, null) : null } : null;
  }

  // —————————————————— جمع‌بندی روزانه ——————————————————
  function dailySummary(day) {
    const dayKey = J.dateKey(J.parseDateKey(day) || J.today());
    const meals = listMeals(dayKey);
    const workouts = listWorkouts(dayKey);
    const water = waterByDay(dayKey);
    const weight = getWeight(dayKey);
    const sleep = db.prepare('SELECT * FROM sleep_log WHERE day = ?').get(dayKey) || null;

    const totals = meals.reduce((acc, m) => ({
      kcal: acc.kcal + (m.kcal || 0),
      protein: acc.protein + (m.protein || 0),
      carbs: acc.carbs + (m.carbs || 0),
      fat: acc.fat + (m.fat || 0),
      fiber: acc.fiber + (m.fiber || 0),
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

    const burn = workouts.reduce((a, w) => a + (w.kcal || 0), 0);
    const byMeal = {};
    for (const m of meals) {
      byMeal[m.meal] = byMeal[m.meal] || { count: 0, kcal: 0 };
      byMeal[m.meal].count += 1;
      byMeal[m.meal].kcal += m.kcal || 0;
    }

    return {
      day: dayKey,
      label: J.formatFullDate(dayKey),
      meals,
      workouts,
      water,
      weight: weight ? weight.weight_kg : null,
      sleep_hours: sleep ? sleep.hours : null,
      totals: {
        kcal_in: Math.round(totals.kcal),
        kcal_burned: Math.round(burn),
        protein_g: Math.round(totals.protein),
        carbs_g: Math.round(totals.carbs),
        fat_g: Math.round(totals.fat),
        fiber_g: Math.round(totals.fiber * 10) / 10,
      },
      by_meal: byMeal,
    };
  }

  function rangeSummary(from, to) {
    const days = [];
    let cur = from;
    let guard = 0;
    while (J.daysBetween(cur, to) >= 0 && guard < 400) {
      days.push(cur);
      cur = J.addDaysKey(cur, 1);
      guard += 1;
    }
    return days.map((d) => {
      const s = dailySummary(d);
      return {
        day: d,
        label: J.formatDate(d, { short: true }),
        kcal_in: s.totals.kcal_in,
        kcal_burned: s.totals.kcal_burned,
        protein_g: s.totals.protein_g,
        water_ml: s.water.total_ml,
        workouts: s.workouts.length,
        weight_kg: s.weight,
        sleep_hours: s.sleep_hours,
      };
    });
  }

  /** تعداد روزهای پیوسته‌ای که کاربر چیزی ثبت کرده است. */
  function streak() {
    const rows = db.prepare(`
      SELECT day FROM (
        SELECT day FROM meal_log
        UNION SELECT day FROM workout_log
        UNION SELECT day FROM water_log
        UNION SELECT day FROM weight_log
      ) GROUP BY day ORDER BY day DESC
    `).all();
    if (!rows.length) return { current: 0, longest: 0, last_day: null };

    const set = new Set(rows.map((r) => r.day));
    let current = 0;
    let cursor = J.todayKey();
    // اگر امروز هنوز ثبتی نیست، از دیروز شروع می‌کنیم تا رشته نشکند
    if (!set.has(cursor)) cursor = J.addDaysKey(cursor, -1);
    while (set.has(cursor)) {
      current += 1;
      cursor = J.addDaysKey(cursor, -1);
    }

    const sorted = [...set].sort();
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      if (J.daysBetween(sorted[i - 1], sorted[i]) === 1) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 1;
      }
    }
    return { current, longest, last_day: sorted[sorted.length - 1] };
  }

  /** آمار کلی برای صفحهٔ گزارش. */
  function overview() {
    const counts = {
      meals: db.prepare('SELECT COUNT(*) n FROM meal_log').get().n,
      workouts: db.prepare('SELECT COUNT(*) n FROM workout_log').get().n,
      weights: db.prepare('SELECT COUNT(*) n FROM weight_log').get().n,
      conversations: db.prepare('SELECT COUNT(*) n FROM conversations').get().n,
      messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
      foods: foodCount.get().n,
      exercises: exerciseCount.get().n,
    };
    const firstMeal = db.prepare('SELECT MIN(day) AS d FROM meal_log').get().d;
    const last = getLatestWeight();
    const first = db.prepare('SELECT * FROM weight_log ORDER BY day ASC, id ASC LIMIT 1').get();
    return {
      counts,
      first_day: firstMeal,
      latest_weight: last ? last.weight_kg : null,
      weight_change: last && first ? Math.round((last.weight_kg - first.weight_kg) * 10) / 10 : null,
      streak: streak(),
      db_file: file,
    };
  }

  function close() {
    try { db.close(); } catch { /* already closed */ }
  }

  return {
    db,
    close,
    // پروفایل
    getProfile, saveProfile,
    // وزن
    logWeight, getWeight, listWeight, getLatestWeight,
    // غذا
    seedCatalogues, searchFoods, searchExercises, listFoods, listFoodCategories,
    // وعده
    logMeal, listMeals, deleteMeal,
    // ورزش
    logWorkout, listWorkouts, deleteWorkout,
    // آب و خواب
    logWater, waterByDay, deleteWater, logSleep, listSleep,
    // هدف
    setGoal, getGoals,
    // گفت‌وگو
    createConversation, getConversation, listConversations, renameConversation,
    deleteConversation, addMessage, listMessages, recentMessages, updateMessage,
    // گزارش
    dailySummary, rangeSummary, streak, overview,
    metaGet, metaSet,
  };
}

module.exports = { createDatabase, levenshtein, similarity, SCHEMA_VERSION, MEALS: ['breakfast', 'lunch', 'dinner', 'snack'] };
