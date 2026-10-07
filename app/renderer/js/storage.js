/* global window */
/**
 * renderer/js/storage.js — لایهٔ دسترسی به داده از renderer.
 *
 * همهٔ فراخوانی‌های IPC از اینجا می‌گذرند تا:
 *  ۱) شکل پاسخ ({ok, data} / {ok:false, error}) یک‌جا باز شود
 *  ۲) خطاها به‌صورت فارسی به کاربر نشان داده شوند
 *  ۳) کش سبک در حافظه، فراخوانی‌های تکراری را حذف کند
 */
(function () {
  'use strict';

  const api = window.teDiet;
  if (!api) {
    throw new Error('پل ارتباطی (teDiet) در دسترس نیست. برنامه باید داخل الکترون اجرا شود.');
  }

  const J = window.Jalaali;
  const cache = new Map();
  const listeners = new Map();

  /** یک فراخوانی IPC را باز می‌کند و در صورت خطا استثنا می‌زند. */
  async function call(fn, ...args) {
    const res = await fn(...args);
    if (!res || res.ok !== true) {
      const err = new Error((res && res.error) || 'خطای ناشناخته در ارتباط با هستهٔ برنامه.');
      err.detail = res || null;
      throw err;
    }
    return res.data;
  }

  /** نسخهٔ کش‌شده. کلید باید صریح داده شود تا باطل‌سازی قابل کنترل باشد. */
  async function cached(key, fn) {
    if (cache.has(key)) return cache.get(key);
    const value = await fn();
    cache.set(key, value);
    return value;
  }

  function invalidate(prefix) {
    if (!prefix) { cache.clear(); return; }
    for (const k of [...cache.keys()]) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
  }

  /** اعلان (toast) — در همین‌جا تا همهٔ ماژول‌ها به آن دسترسی داشته باشند. */
  function toast(message, kind = 'ok', ms = 2600) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  /** اجرای امن یک عملیات + نمایش خطا. */
  async function run(label, fn, opts = {}) {
    try {
      return await fn();
    } catch (err) {
      console.error(`[${label}]`, err);
      if (!opts.silent) toast(err.message || 'عملیات ناموفق بود.', 'bad', 4200);
      if (opts.fallback !== undefined) return opts.fallback;
      throw err;
    }
  }

  // —————————————————— اشیای دامنه ——————————————————

  const Store = {
    // ——— ابزار ———
    toast,
    run,
    invalidate,
    cached,

    // ——— اطلاعات برنامه ———
    async info() { return call(api.app.info); },
    async setPersonality(id) { invalidate(); return call(api.app.setPersonality, id); },
    async openPath(target) { return call(api.app.openPath, target); },
    async systemPrompt() { return call(api.debug.systemPrompt); },

    // ——— تنظیمات ———
    async getConfig() { return call(api.config.get); },
    async saveConfig(patch) { const r = await call(api.config.update, patch); invalidate('cfg'); return r; },
    async aiStatus() { return call(api.config.aiStatus); },
    async listModels() { return call(api.ai.listModels); },
    async testAi() { return call(api.ai.test); },

    // ——— پروفایل ———
    async getProfile() { return cached('profile', () => call(api.profile.get)); },
    async saveProfile(patch) {
      const r = await call(api.profile.save, patch);
      invalidate('profile');
      invalidate('nutrition');
      return r;
    },
    async nutrition() { return call(api.nutrition.compute); },

    // ——— وزن ———
    async logWeight(p) { const r = await call(api.weight.log, p); invalidate('rep'); invalidate('daily'); return r; },
    async listWeight(p) { return call(api.weight.list, p); },
    async latestWeight() { return call(api.weight.latest); },

    // ——— غذا ———
    async searchFoods(q, limit) { return call(api.foods.search, q, limit); },
    async listFoods(p) { return call(api.foods.list, p); },
    async foodCategories() { return cached('foodCats', () => call(api.foods.categories)); },

    // ——— وعده ———
    async logMeal(p) { const r = await call(api.meals.log, p); invalidate('daily'); return r; },
    async listMeals(day) { return call(api.meals.list, day || J.todayKey()); },
    async deleteMeal(id) { const r = await call(api.meals.delete, id); invalidate('daily'); return r; },

    // ——— ورزش ———
    async searchExercises(q, limit) { return call(api.exercises.search, q, limit); },
    async logWorkout(p) { const r = await call(api.workouts.log, p); invalidate('daily'); return r; },
    async listWorkouts(day) { return call(api.workouts.list, day || J.todayKey()); },
    async deleteWorkout(id) { const r = await call(api.workouts.delete, id); invalidate('daily'); return r; },
    async exercisePlan(p) { return call(api.workouts.plan, p); },
    async assessWeek(p) { return call(api.workouts.assess, p); },

    // ——— آب و خواب ———
    async logWater(ml, day) { const r = await call(api.water.log, ml, day); invalidate('daily'); return r; },
    async waterSummary(day) { return call(api.water.summary, day); },
    async deleteWater(id) { const r = await call(api.water.delete, id); invalidate('daily'); return r; },
    async logSleep(p) { const r = await call(api.sleep.log, p); invalidate('daily'); return r; },
    async listSleep(p) { return call(api.sleep.list, p); },

    // ——— هدف‌ها ———
    async getGoals() { return call(api.goals.get); },
    async setGoal(kind, target, note) { const r = await call(api.goals.set, kind, target, note); invalidate('daily'); return r; },

    // ——— گفت‌وگو ———
    async listConversations() { return call(api.conversations.list); },
    async createConversation(p) { return call(api.conversations.create, p || {}); },
    async messages(id, limit) { return call(api.conversations.messages, id, limit); },
    async deleteConversation(id) { return call(api.conversations.delete, id); },

    // ——— گزارش ———
    async daily(day) { return call(api.report.daily, day || J.todayKey()); },
    async range(from, to) { return call(api.report.range, from, to); },
    async overview() { return call(api.report.overview); },
    async streak() { return call(api.report.streak); },

    // ——— رویدادها ———
    on(channel, handler) {
      const off = api.on(channel, handler);
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(off);
      return off;
    },
    offAll(channel) {
      const list = listeners.get(channel) || [];
      list.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      listeners.delete(channel);
    },
  };

  window.Store = Store;
})();
