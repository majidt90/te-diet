'use strict';
/**
 * preload.js — تنها پل بین فرآیند main و renderer.
 *
 * امنیت:
 *  - contextIsolation روشن است و فقط یک آبجکت API سفید‌شده از طریق
 *    contextBridge در اختیار renderer قرار می‌گیرد.
 *  - هیچ ipcRenderer خام، require یا دسترسی به fs به renderer داده نمی‌شود.
 *  - کلید API هرگز از main بیرون نمی‌رود؛ فقط نسخهٔ ماسکه‌شده.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** فهرست سفید کانال‌های رویداد — از ثبت شنوندهٔ دلخواه جلوگیری می‌کند. */
const ALLOWED_EVENTS = new Set([
  'chat:delta',
  'chat:done',
  'chat:error',
  'chat:cancelled',
  'app:newConversation',
  'app:openSettings',
]);

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const api = {
  // ——————— تنظیمات و اتصال ———————
  config: {
    get: invoke('config:get'),
    update: invoke('config:update'),
    path: invoke('config:path'),
    aiStatus: invoke('config:aiStatus'),
  },
  ai: {
    listModels: invoke('ai:listModels'),
    test: invoke('ai:test'),
  },

  // ——————— پروفایل ———————
  profile: {
    get: invoke('profile:get'),
    save: invoke('profile:save'),
  },

  // ——————— وزن ———————
  weight: {
    log: invoke('weight:log'),
    list: invoke('weight:list'),
    latest: invoke('weight:latest'),
  },

  // ——————— غذا و وعده ———————
  foods: {
    search: invoke('foods:search'),
    list: invoke('foods:list'),
    categories: invoke('foods:categories'),
  },
  meals: {
    log: invoke('meals:log'),
    list: invoke('meals:list'),
    delete: invoke('meals:delete'),
  },

  // ——————— ورزش ———————
  exercises: {
    search: invoke('exercises:search'),
  },
  workouts: {
    log: invoke('workouts:log'),
    list: invoke('workouts:list'),
    delete: invoke('workouts:delete'),
    plan: invoke('exercise:plan'),
    assess: invoke('exercise:assess'),
  },

  // ——————— آب و خواب ———————
  water: {
    log: invoke('water:log'),
    summary: invoke('water:summary'),
    delete: invoke('water:delete'),
  },
  sleep: {
    log: invoke('sleep:log'),
    list: invoke('sleep:list'),
  },

  // ——————— هدف‌ها ———————
  goals: {
    get: invoke('goals:get'),
    set: invoke('goals:set'),
  },

  // ——————— گفت‌وگو ———————
  conversations: {
    list: invoke('conversations:list'),
    create: invoke('conversations:create'),
    get: invoke('conversations:get'),
    messages: invoke('conversations:messages'),
    rename: invoke('conversations:rename'),
    delete: invoke('conversations:delete'),
  },

  chat: {
    send: invoke('chat:send'),
    stop: invoke('chat:stop'),
  },

  // ——————— گزارش ———————
  report: {
    daily: invoke('report:daily'),
    range: invoke('report:range'),
    overview: invoke('report:overview'),
    streak: invoke('report:streak'),
  },
  nutrition: {
    compute: invoke('nutrition:compute'),
  },
  nlp: {
    analyze: invoke('nlp:analyze'),
  },

  // ——————— برنامه ———————
  app: {
    info: invoke('app:info'),
    setPersonality: invoke('app:setPersonality'),
    openPath: invoke('app:openPath'),
  },
  debug: {
    systemPrompt: invoke('debug:systemPrompt'),
  },

  /**
   * ثبت شنوندهٔ رویداد. فقط کانال‌های سفیدشده و فقط یک‌بار برای هر شنونده.
   * تابع لغو برمی‌گرداند تا نشتی حافظه پیش نیاید.
   */
  on(channel, handler) {
    if (!ALLOWED_EVENTS.has(channel)) {
      throw new Error(`کانال رویداد مجاز نیست: ${channel}`);
    }
    if (typeof handler !== 'function') throw new Error('شنونده باید تابع باشد.');
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /** نسخهٔ امن: همهٔ شنونده‌های یک کانال را برمی‌دارد. */
  removeAll(channel) {
    if (!ALLOWED_EVENTS.has(channel)) return false;
    ipcRenderer.removeAllListeners(channel);
    return true;
  },
};

contextBridge.exposeInMainWorld('teDiet', api);
