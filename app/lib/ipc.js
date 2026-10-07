'use strict';
/**
 * lib/ipc.js — همهٔ کانال‌های IPC و ارکستراسیون گفت‌وگو.
 *
 * جریان یک پیام:
 *   ۱) پیام کاربر ذخیره می‌شود
 *   ۲) متن با nlp.js تحلیل می‌شود → نامزدهای غذا/تمرین از پایگاه‌داده
 *   ۳) پرامپت سیستم از personality.json + دادهٔ واقعی کاربر ساخته می‌شود
 *   ۴) پاسخ به‌صورت جریانی به renderer فرستاده می‌شود
 *   ۵) بلوک‌های action اجرا و در SQLite ثبت می‌شوند
 */
const { ipcMain, shell } = require('electron');
const J = require('./jalaali.js');
const Nlp = require('../renderer/js/nlp.js');
const Nutrition = require('../renderer/js/nutrition.js');
const Exercise = require('../renderer/js/exercise.js');
const { buildSystemPrompt, buildUserContext } = require('./prompt.js');
const { processAssistantText } = require('./actions.js');
const { MEAL_FA, GOAL_FA, ACTIVITY_FA } = require('./prompt.js');

/** همهٔ هندلرها را ثبت می‌کند. */
function registerIpc(ctx) {
  const { config, repo, ai, getPersonality, loadPersonalityData, win, log } = ctx;

  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, payload); } catch (e) { log(`ارسال ${channel} ناموفق: ${e.message}`); }
    }
  };

  /** پاسخ موفق و یکدست برای renderer. */
  const ok = (data) => ({ ok: true, data });
  const fail = (message, extra = {}) => ({ ok: false, error: message, ...extra });

  /** خطای غیرمنتظره را به پیام فارسی امن تبدیل می‌کند. */
  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log(`خطای IPC: ${err.stack || err.message}`);
      return fail(err.friendly || err.message || 'خطای ناشناخته');
    }
  };

  // —————————————————— تنظیمات ——————————————————

  ipcMain.handle('config:get', guard(() => ok(config.publicConfig())));

  ipcMain.handle('config:update', guard((e, patch) => {
    const updated = config.update(patch || {});
    return ok(config.publicConfig(updated));
  }));

  ipcMain.handle('config:path', guard(() => ok(config.liveConfigPath())));

  ipcMain.handle('config:aiStatus', guard(() => ok(config.aiReady())));

  ipcMain.handle('ai:listModels', guard(async () => {
    const cfg = config.load();
    const models = await ai.listModels(cfg.ai);
    return ok(models);
  }));

  ipcMain.handle('ai:test', guard(async () => {
    const cfg = config.load();
    const result = await ai.ping(cfg.ai);
    return ok(result);
  }));

  // —————————————————— پروفایل ——————————————————

  ipcMain.handle('profile:get', guard(() => ok(repo.getProfile())));
  ipcMain.handle('profile:save', guard((e, patch) => ok(repo.saveProfile(patch || {}))));

  // —————————————————— وزن ——————————————————

  ipcMain.handle('weight:log', guard((e, p) => ok(repo.logWeight(p || {}))));
  ipcMain.handle('weight:list', guard((e, p) => ok(repo.listWeight(p || {}))));
  ipcMain.handle('weight:latest', guard(() => ok(repo.getLatestWeight())));

  // —————————————————— غذا و وعده ——————————————————

  ipcMain.handle('foods:search', guard((e, q, limit) => ok(repo.searchFoods(q, limit))));
  ipcMain.handle('foods:list', guard((e, p) => ok(repo.listFoods(p || {}))));
  ipcMain.handle('foods:categories', guard(() => ok(repo.listFoodCategories())));
  ipcMain.handle('meals:log', guard((e, p) => ok(repo.logMeal(p || {}))));
  ipcMain.handle('meals:list', guard((e, day) => ok(repo.listMeals(day))));
  ipcMain.handle('meals:delete', guard((e, id) => ok(repo.deleteMeal(id))));

  // —————————————————— ورزش ——————————————————

  ipcMain.handle('exercises:search', guard((e, q, limit) => ok(repo.searchExercises(q, limit))));
  ipcMain.handle('workouts:log', guard((e, p) => ok(repo.logWorkout(p || {}))));
  ipcMain.handle('workouts:list', guard((e, day) => ok(repo.listWorkouts(day))));
  ipcMain.handle('workouts:delete', guard((e, id) => ok(repo.deleteWorkout(id))));
  ipcMain.handle('exercise:plan', guard((e, p) => ok(Exercise.buildWeeklyPlan(p || {}))));
  ipcMain.handle('exercise:assess', guard((e, p) => ok(Exercise.assessWeek(p || {}))));

  // —————————————————— آب و خواب ——————————————————

  ipcMain.handle('water:log', guard((e, amount, day) => ok(repo.logWater(amount, day))));
  ipcMain.handle('water:summary', guard((e, day) => ok(repo.waterByDay(day))));
  ipcMain.handle('water:delete', guard((e, id) => ok(repo.deleteWater(id))));
  ipcMain.handle('sleep:log', guard((e, p) => ok(repo.logSleep(p || {}))));
  ipcMain.handle('sleep:list', guard((e, p) => ok(repo.listSleep(p || {}))));

  // —————————————————— هدف‌ها ——————————————————

  ipcMain.handle('goals:get', guard(() => ok(repo.getGoals())));
  ipcMain.handle('goals:set', guard((e, kind, target, note) => ok(repo.setGoal(kind, target, note))));

  // —————————————————— گفت‌وگو ——————————————————

  ipcMain.handle('conversations:list', guard(() => ok(repo.listConversations())));
  ipcMain.handle('conversations:create', guard((e, p) => ok(repo.createConversation(p || {}))));
  ipcMain.handle('conversations:get', guard((e, id) => ok(repo.getConversation(id))));
  ipcMain.handle('conversations:messages', guard((e, id, limit) => ok(repo.listMessages(id, limit))));
  ipcMain.handle('conversations:rename', guard((e, id, title) => ok(repo.renameConversation(id, title))));
  ipcMain.handle('conversations:delete', guard((e, id) => ok(repo.deleteConversation(id))));

  // —————————————————— گزارش ——————————————————

  ipcMain.handle('report:daily', guard((e, day) => ok(repo.dailySummary(day))));
  ipcMain.handle('report:range', guard((e, from, to) => ok(repo.rangeSummary(from, to))));
  ipcMain.handle('report:overview', guard(() => ok(repo.overview())));
  ipcMain.handle('report:streak', guard(() => ok(repo.streak())));

  /** همهٔ محاسبات تغذیه در یک تماس. */
  ipcMain.handle('nutrition:compute', guard(() => {
    const profile = repo.getProfile();
    const latest = repo.getLatestWeight();
    const n = Nutrition.computeAll({
      profile,
      weightKg: latest ? latest.weight_kg : null,
      today: J.today(),
    });
    return ok({ ...n, weight_kg: latest ? latest.weight_kg : null });
  }));

  // —————————————————— NLP و ابزار ——————————————————

  ipcMain.handle('nlp:analyze', guard((e, text) => ok(Nlp.analyze(text))));

  ipcMain.handle('util:formatNumber', guard((e, v, d) => ok(J.formatNumber(v, d))));

  ipcMain.handle('app:info', guard(() => ok({
    version: ctx.appVersion,
    paths: { userData: ctx.userDataDir, db: repo.overview().db_file, config: config.liveConfigPath() },
    personality: getPersonality(),
    personalities: loadPersonalityData().personalities.map((p) => ({
      id: p.id, name: p.name, role: p.role, emoji: p.emoji, accent: p.accent,
      greeting: p.greeting, sample_prompts: p.sample_prompts || [],
    })),
    aiReady: config.aiReady(),
  })));

  ipcMain.handle('app:setPersonality', guard((e, id) => {
    config.update({ user: { personality: id } });
    return ok(getPersonality());
  }));

  ipcMain.handle('app:openPath', guard(async (e, target) => {
    // فقط مسیرهای مجاز باز می‌شوند (جلوگیری از باز کردن مسیر دلخواه)
    const allowed = [ctx.userDataDir, ctx.appDir].filter(Boolean);
    const p = target === 'userData' ? ctx.userDataDir
      : target === 'config' ? config.liveConfigPath()
        : target === 'db' ? repo.overview().db_file
          : null;
    if (!p) return fail('مسیر درخواستی مجاز نیست.');
    if (!allowed.some((a) => p === a || p.startsWith(a))) return fail('مسیر خارج از محدودهٔ مجاز است.');
    await shell.showItemInFolder(p);
    return ok(true);
  }));

  // —————————————————— گفت‌وگو با هوش مصنوعی ——————————————————

  /** نامزدهای غذا و تمرین را از متن کاربر پیدا می‌کند. */
  function findCandidates(terms, limits = { foods: 8, exercises: 6 }) {
    const foods = [];
    const exercises = [];
    const seenF = new Set();
    const seenE = new Set();
    for (const t of terms) {
      if (foods.length >= limits.foods && exercises.length >= limits.exercises) break;
      if (foods.length < limits.foods) {
        for (const f of repo.searchFoods(t, 3)) {
          if (!seenF.has(f.id)) { seenF.add(f.id); foods.push(f); }
          if (foods.length >= limits.foods) break;
        }
      }
      if (exercises.length < limits.exercises) {
        for (const x of repo.searchExercises(t, 3)) {
          if (!seenE.has(x.id)) { seenE.add(x.id); exercises.push(x); }
          if (exercises.length >= limits.exercises) break;
        }
      }
    }
    return { foods: foods.slice(0, limits.foods), exercises: exercises.slice(0, limits.exercises) };
  }

  /** ساخت متن «داده‌های کاربر» برای پرامپت. */
  function buildContext() {
    const profile = repo.getProfile();
    const latest = repo.getLatestWeight();
    const goals = repo.getGoals();
    const todayKey = J.todayKey();
    const summary = repo.dailySummary(todayKey);
    const history = repo.rangeSummary(J.addDaysKey(todayKey, -6), todayKey).slice(0, -1);
    const streak = repo.streak();
    const nutrition = Nutrition.computeAll({
      profile,
      weightKg: latest ? latest.weight_kg : null,
      today: J.today(),
    });
    return buildUserContext({
      profile,
      latestWeight: latest,
      goals,
      streak,
      summary,
      history,
      nutrition,
      restrictions: profile?.dietary_restrictions || [],
    });
  }

  /**
   * گفت‌وگوی فعال را برمی‌گرداند.
   * اگر شناسه داده نشد یا معتبر نبود، آخرین گفت‌وگو بازیابی می‌شود — چون
   * اپ یک «چت‌باکس واحد» است و هر پیام نباید گفت‌وگوی تازه بسازد.
   * فقط دکمهٔ «گفت‌وگوی جدید» صریحاً یک گفت‌وگوی جدید می‌سازد.
   */
  function ensureConversation(id) {
    if (id) {
      const c = repo.getConversation(id);
      if (c) return c;
    }
    const recent = repo.listConversations(1)[0];
    if (recent) return recent;
    return repo.createConversation({ personality: getPersonality() });
  }

  // نگهدارندهٔ AbortController برای لغو
  const running = new Map();

  ipcMain.handle('chat:send', guard(async (e, payload = {}) => {
    const text = String(payload.text || '').trim();
    if (!text) return fail('متن پیام خالی است.');
    if (text.length > 4000) return fail('پیام خیلی طولانی است (حداکثر ۴۰۰۰ نویسه).');

    const ready = config.aiReady();
    if (!ready.ready) {
      return fail(`تنظیمات هوش مصنوعی کامل نیست. موارد زیر را در صفحهٔ تنظیمات وارد کنید: ${ready.missing.join('، ')}`,
        { needSetup: true });
    }

    const cfg = config.load();
    const conv = ensureConversation(payload.conversation_id);
    repo.addMessage({ conversation_id: conv.id, role: 'user', content: text });

    // تحلیل ورودی برای یافتن نامزدها
    const analysis = Nlp.analyze(text);
    const { foods, exercises } = findCandidates(analysis.terms);

    const personalityData = loadPersonalityData();
    const systemPrompt = buildSystemPrompt({
      personalityData,
      personalityId: getPersonality(),
      context: buildContext(),
      foodCandidates: foods,
      exerciseCandidates: exercises,
    });

    const keepTurns = Number(cfg.app?.keep_history_turns) || 24;
    const history = repo.recentMessages(conv.id, keepTurns * 2);
    const messages = ai.trimHistory(
      [{ role: 'system', content: systemPrompt }, ...history],
      Math.max(2000, (cfg.ai.max_tokens || 4096) * 3)
    );

    // جای پیام موقت در رابط کاربری
    const placeholder = repo.addMessage({
      conversation_id: conv.id, role: 'assistant', content: '', status: 'streaming',
    });
    const messageId = placeholder.id;
    const ac = new AbortController();
    running.set(messageId, ac);

    let full = '';
    try {
      const result = await ai.chat({
        messages,
        ai: cfg.ai,
        signal: ac.signal,
        onDelta: (delta, acc) => {
          full = acc;
          send('chat:delta', { conversation_id: conv.id, message_id: messageId, delta, full: acc });
        },
      });
      full = result.text || full;

      const { cleanText, results } = processAssistantText(repo, full, { today: J.todayKey() });
      repo.updateMessage(messageId, { content: cleanText, status: 'ok', action: results.length ? results : null });

      const applied = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      send('chat:done', {
        conversation_id: conv.id,
        message_id: messageId,
        content: cleanText,
        results,
        summary: repo.dailySummary(J.todayKey()),
        nutrition: Nutrition.computeAll({
          profile: repo.getProfile(),
          weightKg: repo.getLatestWeight()?.weight_kg || null,
          today: J.today(),
        }),
      });

      return ok({
        conversation_id: conv.id,
        message_id: messageId,
        content: cleanText,
        results,
        applied_count: applied.length,
        failed_count: failed.length,
        title: repo.getConversation(conv.id)?.title || null,
        usage: result.usage || null,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        repo.updateMessage(messageId, { content: full, status: 'cancelled' });
        send('chat:cancelled', { conversation_id: conv.id, message_id: messageId, content: full });
        return fail('پاسخ توسط شما متوقف شد.', { cancelled: true });
      }
      log(`خطای AI: ${err.stack || err.message}`);
      repo.updateMessage(messageId, { content: full, status: 'error' });
      send('chat:error', {
        conversation_id: conv.id,
        message_id: messageId,
        message: err.friendly || 'ارتباط با سرویس هوش مصنوعی برقرار نشد.',
      });
      return fail(err.friendly || 'ارتباط با سرویس هوش مصنوعی برقرار نشد.', { needSetup: false });
    } finally {
      running.delete(messageId);
    }
  }));

  ipcMain.handle('chat:stop', guard((e, messageId) => {
    const ac = running.get(messageId);
    if (ac) { ac.abort(); return ok(true); }
    // اگر شناسه نداشت، همهٔ جریان‌های فعال لغو می‌شوند
    for (const c of running.values()) c.abort();
    return ok(running.size === 0);
  }));

  /** پیش‌نمایش پرامپت سیستم — برای دیباگ و صفحهٔ تنظیمات. */
  ipcMain.handle('debug:systemPrompt', guard(() => {
    const personalityData = loadPersonalityData();
    const analysis = Nlp.analyze('سلام');
    const { foods, exercises } = findCandidates(analysis.terms, { foods: 3, exercises: 3 });
    return ok(buildSystemPrompt({
      personalityData,
      personalityId: getPersonality(),
      context: buildContext(),
      foodCandidates: foods,
      exerciseCandidates: exercises,
    }));
  }));

  return { MEAL_FA, GOAL_FA, ACTIVITY_FA };
}

module.exports = { registerIpc };
