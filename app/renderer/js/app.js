/* global window */
/**
 * renderer/js/app.js — راه‌اندازی و چسباندن نماها به هم.
 */
(function () {
  'use strict';

  const J = window.Jalaali;
  const Store = window.Store;
  const Charts = window.Charts;
  const Nutrition = window.Nutrition;

  let info = null;
  let cfg = null;
  let profile = null;
  let nutrition = null;
  let currentView = 'chat';

  function el(id) { return document.getElementById(id); }
  function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }

  const MEAL_FA = { breakfast: 'صبحانه', lunch: 'ناهار', dinner: 'شام', snack: 'میان‌وعده' };

  // —————————————————— ناوبری ——————————————————

  const VIEW_TITLES = {
    chat: ['گفت‌وگو', 'هرچه خوردی یا انجام دادی را بنویس'],
    today: ['امروز', ''],
    reports: ['گزارش‌ها', 'روند و پیشرفت شما'],
    foods: ['مواد غذایی', 'پایگاه‌دادهٔ محلی غذاها'],
    settings: ['تنظیمات', ''],
  };

  function switchView(name) {
    currentView = name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
    $$('.nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));

    const [title, sub] = VIEW_TITLES[name] || ['', ''];
    el('viewTitle').textContent = title;
    el('viewSubtitle').textContent = name === 'today' ? J.formatFullDate(new Date()) : (sub || '');

    if (name === 'today') Today.load();
    if (name === 'reports') window.Reports.load();
    if (name === 'foods') Foods.load();
    if (name === 'settings') Settings.refresh();
  }

  // —————————————————— وضعیت اتصال ——————————————————

  async function refreshAiStatus() {
    const s = await Store.run('aiStatus', () => Store.aiStatus(), { fallback: { ready: false, missing: [] } });
    const dot = el('aiStatusDot');
    const txt = el('aiStatusText');
    dot.className = 'dot ' + (s.ready ? 'dot--ok' : 'dot--bad');
    txt.textContent = s.ready ? 'متصل' : 'تنظیم نشده';
    el('aiStatusChip').title = s.ready
      ? 'اتصال به سرویس هوش مصنوعی برقرار است'
      : `نیاز به تنظیم: ${s.missing.join('، ')}`;
    return s;
  }

  // —————————————————— نوار کناری ——————————————————

  function renderPersonas() {
    const box = el('personaSwitch');
    box.textContent = '';
    const active = cfg?.user?.personality || info?.personality;
    for (const p of info?.personalities || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `persona${p.id === active ? ' is-active' : ''}`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.id === active));
      b.style.setProperty('--persona-accent', p.accent || '');

      const emoji = document.createElement('span');
      emoji.className = 'persona__emoji';
      emoji.textContent = p.emoji || '•';
      const meta = document.createElement('span');
      const n = document.createElement('span');
      n.className = 'persona__name';
      n.textContent = p.name;
      const r = document.createElement('span');
      r.className = 'persona__role';
      r.textContent = p.role;
      meta.append(n, r);
      meta.style.display = 'flex';
      meta.style.flexDirection = 'column';

      b.append(emoji, meta);
      b.addEventListener('click', async () => {
        await Store.run('setPersonality', async () => {
          await Store.setPersonality(p.id);
          cfg = await Store.getConfig();
          const full = (info?.personalities || []).find((x) => x.id === p.id);
          window.Chat.setPersona({ ...full, greeting: '', sample_prompts: [] });
          renderPersonas();
          Store.toast(`دستیار به «${p.name}» تغییر کرد.`, 'ok');
        });
      });
      box.append(b);
    }
  }

  async function refreshStreak() {
    const s = await Store.run('streak', () => Store.streak(), { fallback: { current: 0 } });
    el('streakValue').textContent = J.formatNumber(s.current || 0);
  }

  // —————————————————— نمای امروز ——————————————————

  const Today = {
    async load() {
      const summary = await Store.run('today', () => Store.daily(), { fallback: null });
      nutrition = await Store.run('nutrition', () => Store.nutrition(), { fallback: null });
      if (!summary) return;

      el('todayLabel').textContent = summary.label;
      this.rings(summary);
      this.meals(summary.meals);
      this.workouts(summary.workouts);
    },

    rings(s) {
      const target = nutrition?.target_kcal || 2000;
      const pTarget = nutrition?.protein_g || 100;
      const wTarget = nutrition?.water_ml || 2000;

      const defs = [
        { key: 'kcal', ratio: s.totals.kcal_in / target, color: Charts.theme().accent,
          value: J.formatNumber(s.totals.kcal_in), sub: `از ${J.formatNumber(target)}` },
        { key: 'protein', ratio: s.totals.protein_g / pTarget, color: Charts.theme().protein,
          value: `${J.formatNumber(s.totals.protein_g)} گرم`, sub: `از ${J.formatNumber(pTarget)}` },
        { key: 'water', ratio: s.water.total_ml / wTarget, color: Charts.theme().water,
          value: J.formatNumber(s.water.total_ml), sub: `از ${J.formatNumber(wTarget)}` },
        { key: 'burn', ratio: target ? s.totals.kcal_burned / Math.round(target * 0.25) : 0, color: Charts.theme().burn,
          value: J.formatNumber(s.totals.kcal_burned), sub: 'کیلوکالری' },
      ];

      for (const d of defs) {
        const ring = document.querySelector(`.ring[data-metric="${d.key}"]`);
        if (!ring) continue;
        Charts.drawRing(ring.querySelector('canvas'), d.ratio, d.color);
        ring.querySelector('[data-value]').textContent = d.value;
        ring.querySelector('[data-sub]').textContent = d.sub;
      }
    },

    meals(meals) {
      const box = el('mealList');
      box.textContent = '';
      const groups = {};
      for (const m of meals) (groups[m.meal] = groups[m.meal] || []).push(m);

      if (!meals.length) {
        const p = document.createElement('p');
        p.className = 'list__empty';
        p.textContent = 'هنوز وعده‌ای برای امروز ثبت نشده. از گفت‌وگو یا دکمهٔ «افزودن» اضافه کن.';
        box.append(p);
        return;
      }

      for (const key of ['breakfast', 'lunch', 'dinner', 'snack']) {
        const items = groups[key];
        if (!items) continue;
        const g = document.createElement('div');
        g.className = 'meal-group';
        const head = document.createElement('div');
        head.className = 'meal-group__head';
        const kcal = items.reduce((a, x) => a + (x.kcal || 0), 0);
        const hName = document.createElement('span');
        hName.textContent = MEAL_FA[key] || key;
        const hKcal = document.createElement('span');
        hKcal.className = 'meal-group__kcal';
        hKcal.textContent = `${J.formatNumber(kcal)} کیلوکالری`;
        head.append(hName, hKcal);
        g.append(head);

        const ul = document.createElement('ul');
        ul.className = 'list';
        for (const m of items) {
          const li = document.createElement('li');
          li.className = 'list__item';
          const main = document.createElement('div');
          main.className = 'list__item-main';
          const nm = document.createElement('p');
          nm.className = 'list__item-name';
          nm.textContent = m.name;
          const sb = document.createElement('p');
          sb.className = 'list__item-sub';
          sb.textContent = `${J.formatNumber(m.qty, 1)} ${m.unit || ''} · پ ${J.formatNumber(m.protein)} ک ${J.formatNumber(m.carbs)} چ ${J.formatNumber(m.fat)}`;
          main.append(nm, sb);

          const val = document.createElement('span');
          val.className = 'list__item-value';
          val.textContent = J.formatNumber(m.kcal);

          const del = document.createElement('button');
          del.className = 'icon-btn';
          del.type = 'button';
          del.textContent = '✕';
          del.title = 'حذف';
          del.setAttribute('aria-label', `حذف ${m.name}`);
          del.addEventListener('click', async () => {
            await Store.run('deleteMeal', async () => { await Store.deleteMeal(m.id); this.load(); refreshStreak(); });
          });

          li.append(main, val, del);
          ul.append(li);
        }
        g.append(ul);
        box.append(g);
      }
    },

    workouts(items) {
      const ul = el('workoutList');
      ul.textContent = '';
      if (!items.length) {
        const p = document.createElement('li');
        p.className = 'list__empty';
        p.textContent = 'تمرینی ثبت نشده است.';
        ul.append(p);
        return;
      }
      for (const w of items) {
        const li = document.createElement('li');
        li.className = 'list__item';
        const main = document.createElement('div');
        main.className = 'list__item-main';
        const nm = document.createElement('p');
        nm.className = 'list__item-name';
        nm.textContent = w.name;
        const sb = document.createElement('p');
        sb.className = 'list__item-sub';
        const bits = [];
        if (w.duration_min) bits.push(`${J.formatNumber(w.duration_min)} دقیقه`);
        if (w.sets && w.reps) bits.push(`${J.formatNumber(w.sets)}×${J.formatNumber(w.reps)}`);
        if (w.load_kg) bits.push(`${J.formatNumber(w.load_kg)} کیلوگرم`);
        sb.textContent = bits.join(' · ') || '—';
        main.append(nm, sb);

        const val = document.createElement('span');
        val.className = 'list__item-value';
        val.textContent = `${J.formatNumber(w.kcal)} کالری`;

        const del = document.createElement('button');
        del.className = 'icon-btn';
        del.type = 'button';
        del.textContent = '✕';
        del.title = 'حذف';
        del.addEventListener('click', async () => {
          await Store.run('deleteWorkout', async () => { await Store.deleteWorkout(w.id); this.load(); refreshStreak(); });
        });

        li.append(main, val, del);
        ul.append(li);
      }
    },

    wire() {
      el('todayRefresh').addEventListener('click', () => this.load());

      el('quickWeightBtn').addEventListener('click', async () => {
        const v = parseFloat(el('quickWeight').value);
        if (!v) return Store.toast('وزن را وارد کنید.', 'bad');
        await Store.run('quickWeight', async () => {
          await Store.logWeight({ weight_kg: v });
          el('quickWeight').value = '';
          Store.toast('وزن ثبت شد.', 'ok');
          await this.load();
          refreshStreak();
        });
      });

      $$('[data-water]').forEach((b) => b.addEventListener('click', async () => {
        await Store.run('quickWater', async () => {
          await Store.logWater(Number(b.dataset.water));
          Store.toast(`${J.formatNumber(b.dataset.water)} میلی‌لیتر آب ثبت شد.`, 'ok');
          await this.load();
          refreshStreak();
        });
      }));

      el('quickSleepBtn').addEventListener('click', async () => {
        const h = parseFloat(el('quickSleep').value);
        if (Number.isNaN(h)) return Store.toast('ساعت خواب را وارد کنید.', 'bad');
        await Store.run('quickSleep', async () => {
          await Store.logSleep({ hours: h });
          el('quickSleep').value = '';
          Store.toast('خواب ثبت شد.', 'ok');
          await this.load();
          refreshStreak();
        });
      });

      el('addMealBtn').addEventListener('click', () => Modal.open('mealModal'));
      el('addWorkoutBtn').addEventListener('click', () => Modal.open('workoutModal'));
    },
  };

  // —————————————————— نمای مواد غذایی ——————————————————

  const Foods = {
    rows: [],
    selected: null,

    async load() {
      const cats = await Store.run('foodCats', () => Store.foodCategories(), { fallback: [] });
      const sel = el('foodCategory');
      if (sel && !sel.options.length) {
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'همهٔ دسته‌ها';
        sel.append(all);
        for (const c of cats) {
          const o = document.createElement('option');
          o.value = c;
          o.textContent = c;
          sel.append(o);
        }
      }
      await this.query();
    },

    async query() {
      const q = el('foodSearch').value.trim();
      const cat = el('foodCategory').value;
      if (q) {
        this.rows = await Store.run('foodSearch', () => Store.searchFoods(q, 60), { fallback: [] });
        if (cat) this.rows = this.rows.filter((r) => r.category === cat);
      } else {
        this.rows = await Store.run('foodList', () => Store.listFoods({ category: cat || undefined, limit: 400 }), { fallback: [] });
      }
      this.render();
    },

    render() {
      const body = el('foodTableBody');
      body.textContent = '';
      if (!this.rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.className = 'table__empty';
        td.textContent = 'موردی پیدا نشد.';
        tr.append(td);
        body.append(tr);
        return;
      }
      for (const f of this.rows) {
        const tr = document.createElement('tr');
        const cells = [
          [f.name, 'table__name'],
          [f.category || '—', ''],
          [f.unit_label || f.unit, ''],
          [J.formatNumber(f.kcal), 'num'],
          [J.formatNumber(f.protein, 1), 'num'],
          [J.formatNumber(f.carbs, 1), 'num'],
          [J.formatNumber(f.fat, 1), 'num'],
        ];
        for (const [txt, cls] of cells) {
          const td = document.createElement('td');
          if (cls) td.className = cls;
          td.textContent = txt;
          tr.append(td);
        }
        const td = document.createElement('td');
        const btn = document.createElement('button');
        btn.className = 'btn btn--ghost btn--sm';
        btn.type = 'button';
        btn.textContent = 'ثبت';
        btn.addEventListener('click', () => Modal.openMealFor(f));
        td.append(btn);
        tr.append(td);
        body.append(tr);
      }
    },

    wire() {
      let t = null;
      el('foodSearch').addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => this.query(), 220);
      });
      el('foodCategory').addEventListener('change', () => this.query());
    },
  };

  // —————————————————— مودال‌ها ——————————————————

  const Modal = {
    mealPick: null,
    workoutPick: null,

    open(id) {
      const m = el(id);
      if (!m) return;
      m.hidden = false;
      const first = m.querySelector('input, select, textarea');
      if (first) setTimeout(() => first.focus(), 40);
    },
    close(m) {
      if (m) m.hidden = true;
    },

    openMealFor(food) {
      this.mealPick = food;
      el('mealSearch').value = food.name;
      el('mealSuggest').textContent = '';
      this.previewMeal();
      this.open('mealModal');
    },

    previewMeal() {
      const box = el('mealPreview');
      box.textContent = '';
      if (!this.mealPick) return;
      const qty = parseFloat(el('mealQty').value) || 1;
      const f = this.mealPick;
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.fontSize = '12.5px';
      p.textContent = `${f.name} — ${J.formatNumber(qty, 2)} ${f.unit || ''} = ` +
        `${J.formatNumber(f.kcal * qty)} کیلوکالری · پروتئین ${J.formatNumber(f.protein * qty, 1)} · ` +
        `کربوهیدرات ${J.formatNumber(f.carbs * qty, 1)} · چربی ${J.formatNumber(f.fat * qty, 1)}`;
      box.append(p);
    },

    async suggestMeal(q) {
      const box = el('mealSuggest');
      box.textContent = '';
      if (q.trim().length < 2) return;
      const rows = await Store.run('mealSuggest', () => Store.searchFoods(q, 8), { fallback: [] });
      for (const f of rows) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'suggest__item';
        const n = document.createElement('span');
        n.textContent = f.name;
        const k = document.createElement('span');
        k.className = 'suggest__kcal';
        k.textContent = `${J.formatNumber(f.kcal)} کالری در ${f.unit_label || f.unit}`;
        b.append(n, k);
        b.addEventListener('click', () => {
          this.mealPick = f;
          el('mealSearch').value = f.name;
          box.textContent = '';
          this.previewMeal();
        });
        box.append(b);
      }
    },

    async suggestWorkout(q) {
      const box = el('workoutSuggest');
      box.textContent = '';
      if (q.trim().length < 2) return;
      const rows = await Store.run('exSuggest', () => Store.searchExercises(q, 8), { fallback: [] });
      for (const x of rows) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'suggest__item';
        const n = document.createElement('span');
        n.textContent = x.name;
        const k = document.createElement('span');
        k.className = 'suggest__kcal';
        k.textContent = `MET ${J.formatNumber(x.met, 1)} · ${x.category || ''}`;
        b.append(n, k);
        b.addEventListener('click', () => {
          this.workoutPick = x;
          el('workoutSearch').value = x.name;
          box.textContent = '';
        });
        box.append(b);
      }
    },

    wire() {
      $$('[data-close]').forEach((b) => b.addEventListener('click', () => {
        const modal = b.closest('.modal');
        if (modal) this.close(modal);
      }));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') $$('.modal').forEach((m) => { if (!m.hidden) this.close(m); });
      });

      let t1 = null;
      el('mealSearch').addEventListener('input', (e) => {
        this.mealPick = null;
        el('mealPreview').textContent = '';
        clearTimeout(t1);
        const v = e.target.value;
        t1 = setTimeout(() => this.suggestMeal(v), 200);
      });
      el('mealQty').addEventListener('input', () => this.previewMeal());

      el('mealForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          meal: el('mealType').value,
          qty: parseFloat(el('mealQty').value) || 1,
        };
        if (this.mealPick) { payload.food_id = this.mealPick.id; payload.name = this.mealPick.name; }
        else {
          const n = el('mealSearch').value.trim();
          if (!n) return Store.toast('نام غذا را وارد کنید.', 'bad');
          payload.name = n;
        }
        await Store.run('logMeal', async () => {
          const r = await Store.logMeal(payload);
          this.close(el('mealModal'));
          el('mealSearch').value = '';
          el('mealQty').value = '1';
          this.mealPick = null;
          Store.toast(`${r.name} ثبت شد (${J.formatNumber(r.kcal)} کیلوکالری).`, 'ok');
          await Today.load();
          refreshStreak();
        });
      });

      let t2 = null;
      el('workoutSearch').addEventListener('input', (e) => {
        this.workoutPick = null;
        clearTimeout(t2);
        const v = e.target.value;
        t2 = setTimeout(() => this.suggestWorkout(v), 200);
      });

      el('workoutForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          kind: el('workoutKind').value,
          duration_min: parseFloat(el('workoutDuration').value) || null,
          sets: parseFloat(el('workoutSets').value) || null,
          reps: parseFloat(el('workoutReps').value) || null,
          load_kg: parseFloat(el('workoutLoad').value) || null,
          rpe: parseFloat(el('workoutRpe').value) || null,
        };
        if (this.workoutPick) { payload.exercise_id = this.workoutPick.id; payload.name = this.workoutPick.name; }
        else {
          const n = el('workoutSearch').value.trim();
          if (!n) return Store.toast('نام تمرین را وارد کنید.', 'bad');
          payload.name = n;
        }
        if (!payload.duration_min && !payload.sets) {
          return Store.toast('مدت یا تعداد ست را وارد کنید.', 'bad');
        }
        await Store.run('logWorkout', async () => {
          const r = await Store.logWorkout(payload);
          this.close(el('workoutModal'));
          el('workoutForm').reset();
          this.workoutPick = null;
          Store.toast(`${r.name} ثبت شد (حدود ${J.formatNumber(r.kcal)} کیلوکالری).`, 'ok');
          await Today.load();
          refreshStreak();
        });
      });
    },
  };

  // —————————————————— تنظیمات ——————————————————

  const Settings = {
    async refresh() {
      cfg = await Store.run('cfg', () => Store.getConfig(), { fallback: null });
      profile = await Store.run('profile', () => Store.getProfile(), { fallback: null });
      nutrition = await Store.run('nutrition', () => Store.nutrition(), { fallback: null });
      if (cfg) this.fillAi();
      this.fillProfile();
      this.fillDataInfo();
      this.renderNutrition();
    },

    fillAi() {
      el('aiBaseUrl').value = cfg.ai.base_url || '';
      el('aiApiKey').value = '';
      el('aiApiKey').placeholder = cfg.ai.api_key_set ? `ذخیره شده: ${cfg.ai.api_key}` : 'sk-…';
      el('aiModel').value = cfg.ai.model || '';
      el('aiTemperature').value = cfg.ai.temperature ?? 0.7;
      el('aiMaxTokens').value = cfg.ai.max_tokens ?? 4096;
      el('aiStream').checked = cfg.ai.stream !== false;
    },

    fillProfile() {
      const p = profile || {};
      el('pfName').value = p.display_name || '';
      el('pfSex').value = p.sex || '';
      el('pfBirthYear').value = p.birth_year || '';
      const ms = el('pfBirthMonth');
      if (!ms.options.length) {
        const e0 = document.createElement('option');
        e0.value = '';
        e0.textContent = '—';
        ms.append(e0);
        J.MONTH_NAMES.forEach((m, i) => {
          const o = document.createElement('option');
          o.value = String(i + 1);
          o.textContent = m;
          ms.append(o);
        });
      }
      ms.value = p.birth_month ? String(p.birth_month) : '';
      el('pfHeight').value = p.height_cm || '';
      el('pfActivity').value = p.activity_level || '';
      el('pfGoal').value = p.goal || '';
      el('pfRate').value = p.goal_rate_kg_per_week || '';
      el('pfRestrictions').value = (p.dietary_restrictions || []).join('، ');
      el('pfMedical').value = p.medical_notes || '';
    },

    renderNutrition() {
      const box = el('nutritionSummary');
      box.textContent = '';
      const n = nutrition || {};
      const items = [
        ['کالری هدف', n.target_kcal != null ? J.formatNumber(n.target_kcal) : '—', 'کیلوکالری'],
        ['پروتئین', n.protein_g != null ? J.formatNumber(n.protein_g) : '—', 'گرم'],
        ['کربوهیدرات', n.carbs_g != null ? J.formatNumber(n.carbs_g) : '—', 'گرم'],
        ['چربی', n.fat_g != null ? J.formatNumber(n.fat_g) : '—', 'گرم'],
        ['آب روزانه', n.water_ml != null ? J.formatNumber(n.water_ml) : '—', 'میلی‌لیتر'],
        ['BMI', n.bmi != null ? J.formatNumber(n.bmi, 1) : '—', n.bmi_label || ''],
        ['BMR', n.bmr != null ? J.formatNumber(n.bmr) : '—', 'کیلوکالری'],
        ['TDEE', n.tdee != null ? J.formatNumber(n.tdee) : '—', 'کیلوکالری'],
      ];
      for (const [label, value, unit] of items) {
        const d = document.createElement('div');
        d.className = 'nutrition-summary__item';
        const l = document.createElement('p');
        l.textContent = label;
        const v = document.createElement('p');
        v.textContent = unit ? `${value} ${unit}` : value;
        d.append(l, v);
        box.append(d);
      }
      for (const note of n.notes || []) {
        const p = document.createElement('p');
        p.className = 'nutrition-summary__note';
        p.textContent = `⚠ ${note}`;
        box.append(p);
      }
    },

    fillDataInfo() {
      const box = el('dataInfo');
      box.textContent = '';
      const add = (label, value) => {
        const d = document.createElement('div');
        const l = document.createElement('p');
        l.textContent = label;
        const v = document.createElement('p');
        v.textContent = value || '—';
        d.append(l, v);
        box.append(d);
      };
      const paths = info?.paths || {};
      add('نسخهٔ برنامه', info?.version);
      add('پایگاه‌داده', paths.db);
      add('فایل تنظیمات', paths.config);
      add('تعداد غذاها', J.formatNumber(0)); // در overview پر می‌شود
      Store.run('overview', async () => {
        const o = await Store.overview();
        const nodes = box.children;
        if (nodes[3]) nodes[3].children[1].textContent = J.formatNumber(o.counts.foods);
      }, { silent: true, fallback: null });
    },

    wire() {
      el('aiForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const patch = {
          ai: {
            base_url: el('aiBaseUrl').value.trim(),
            model: el('aiModel').value.trim(),
            temperature: parseFloat(el('aiTemperature').value),
            max_tokens: parseInt(el('aiMaxTokens').value, 10),
            stream: el('aiStream').checked,
          },
        };
        const key = el('aiApiKey').value.trim();
        if (key) patch.ai.api_key = key;

        await Store.run('saveConfig', async () => {
          cfg = await Store.saveConfig(patch);
          el('aiApiKey').value = '';
          this.fillAi();
          await refreshAiStatus();
          const r = el('aiTestResult');
          r.textContent = 'تنظیمات ذخیره شد.';
          r.className = 'test-result test-result--ok';
          Store.toast('تنظیمات ذخیره شد.', 'ok');
        });
      });

      el('toggleKeyBtn').addEventListener('click', () => {
        const i = el('aiApiKey');
        const showing = i.type === 'text';
        i.type = showing ? 'password' : 'text';
        el('toggleKeyBtn').textContent = showing ? 'نمایش' : 'پنهان';
      });

      el('testAiBtn').addEventListener('click', async () => {
        const r = el('aiTestResult');
        r.textContent = 'در حال آزمایش…';
        r.className = 'test-result';
        const res = await Store.run('testAi', () => Store.testAi(), { fallback: null });
        if (!res) { r.textContent = 'آزمایش ناموفق بود.'; r.className = 'test-result test-result--bad'; return; }
        if (res.ok) {
          r.textContent = `✓ اتصال برقرار است (${J.toPersianDigits(res.ms)} میلی‌ثانیه) — مدل: ${res.model}`;
          r.className = 'test-result test-result--ok';
        } else {
          r.textContent = `✗ ${res.error}`;
          r.className = 'test-result test-result--bad';
        }
      });

      el('listModelsBtn').addEventListener('click', async () => {
        const r = el('aiTestResult');
        r.textContent = 'در حال دریافت فهرست…';
        r.className = 'test-result';
        const models = await Store.run('listModels', () => Store.listModels(), { fallback: null });
        const sel = el('modelSelect');
        sel.textContent = '';
        if (!models || !models.length) {
          r.textContent = 'فهرستی دریافت نشد. نام مدل را دستی وارد کنید.';
          r.className = 'test-result test-result--bad';
          sel.classList.add('is-hidden');
          return;
        }
        for (const m of models) {
          const o = document.createElement('option');
          o.value = m;
          o.textContent = m;
          sel.append(o);
        }
        sel.classList.remove('is-hidden');
        sel.value = el('aiModel').value;
        r.textContent = `${J.formatNumber(models.length)} مدل پیدا شد.`;
        r.className = 'test-result test-result--ok';
      });

      el('modelSelect').addEventListener('change', (e) => { el('aiModel').value = e.target.value; });

      el('profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const restrictions = el('pfRestrictions').value
          .split(/[،,]/).map((s) => s.trim()).filter(Boolean);
        const patch = {
          display_name: el('pfName').value.trim() || null,
          sex: el('pfSex').value || null,
          birth_year: parseInt(el('pfBirthYear').value, 10) || null,
          birth_month: parseInt(el('pfBirthMonth').value, 10) || null,
          height_cm: parseFloat(el('pfHeight').value) || null,
          activity_level: el('pfActivity').value || null,
          goal: el('pfGoal').value || null,
          goal_rate_kg_per_week: parseFloat(el('pfRate').value) || null,
          dietary_restrictions: restrictions,
          medical_notes: el('pfMedical').value.trim() || null,
        };
        await Store.run('saveProfile', async () => {
          profile = await Store.saveProfile(patch);
          nutrition = await Store.nutrition();
          this.renderNutrition();
          const r = el('profileResult');
          r.textContent = 'مشخصات ذخیره شد.';
          r.className = 'test-result test-result--ok';
          Store.toast('مشخصات ذخیره شد.', 'ok');
        });
      });

      el('themePicker').addEventListener('click', async (e) => {
        const btn = e.target.closest('.segmented__btn');
        if (!btn) return;
        $$('.segmented__btn', el('themePicker')).forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        applyTheme(btn.dataset.theme);
        await Store.saveConfig({ app: { theme: btn.dataset.theme } });
        setTimeout(() => {
          Charts.refreshAll(() => { if (currentView === 'reports') window.Reports.regen(); if (currentView === 'today') Today.load(); });
        }, 60);
      });

      el('openUserDataBtn').addEventListener('click', () => Store.openPath('userData'));

      el('showPromptBtn').addEventListener('click', async () => {
        const p = await Store.run('sysPrompt', () => Store.systemPrompt(), { fallback: null });
        if (!p) return;
        const w = window.open('', '_blank', 'width=760,height=620');
        if (!w) return Store.toast('باز کردن پنجره ممکن نشد.', 'bad');
        w.document.title = 'پرامپت سیستم';
        w.document.body.dir = 'rtl';
        w.document.body.style.fontFamily = 'Vazirmatn, Tahoma, sans-serif';
        const pre = w.document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.padding = '20px';
        pre.textContent = p;
        w.document.body.append(pre);
      });
    },
  };

  // —————————————————— پوسته ——————————————————

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme || 'auto';
  }

  // —————————————————— راه‌اندازی ——————————————————

  async function boot() {
    applyTheme('auto');
    Charts.init();

    try {
      info = await Store.info();
    } catch (err) {
      document.body.innerHTML = `<div style="padding:40px;text-align:center">
        <h2>خطا در اتصال به هستهٔ برنامه</h2><p>${Chat.escapeHtml(err.message)}</p></div>`;
      return;
    }

    cfg = await Store.run('cfg', () => Store.getConfig(), { fallback: null });
    applyTheme(cfg?.app?.theme || 'auto');

    const personaId = cfg?.user?.personality || info.personality;
    const persona = (info.personalities || []).find((p) => p.id === personaId) || info.personalities?.[0];

    // ناوبری
    $$('.nav__item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

    // ماژول‌ها
    window.Chat.init(persona);
    window.Reports.init();
    Today.wire();
    Foods.wire();
    Modal.wire();
    Settings.wire();

    renderPersonas();
    await refreshAiStatus();
    await refreshStreak();

    // نمونه‌پرامپت‌های پرسونیتی (از app:info می‌آیند)
    window.Chat.showSamplePrompts(persona?.sample_prompts || []);

    // گفت‌وگوی فعال: آخرین گفت‌وگو، و در نبود آن یک گفت‌وگوی تازه
    const convs = await Store.run('convs', () => Store.listConversations(), { fallback: [] });
    if (convs.length) {
      await window.Chat.loadConversation(convs[0].id);
    } else {
      const conv = await Store.run('newConv', () => Store.createConversation({}), { fallback: null });
      if (conv) window.AiClient.conversationId = conv.id;
    }
    el('emptyText').textContent = persona?.role
      ? 'هرچه خوردی یا هر ورزشی که کردی را بنویس تا ثبتش کنم و راهنمایی‌ات کنم.'
      : 'در حال آماده‌سازی…';

    // به‌روزرسانی خودکار نماها پس از ثبت توسط AI
    document.addEventListener('data-changed', async () => {
      await refreshStreak();
      await refreshAiStatus();
      if (currentView === 'today') await Today.load();
      if (currentView === 'reports') await window.Reports.load();
    });

    Store.on('app:openSettings', () => switchView('settings'));

    // بازخوانی هنگام بازگشت از حالت کمینه (تاریخ ممکن است عوض شده باشد)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && currentView === 'today') Today.load();
    });

    switchView('chat');
  }

  window.addEventListener('DOMContentLoaded', () => {
    boot().catch((err) => {
      console.error('راه‌اندازی ناموفق:', err);
      const t = document.getElementById('toastWrap');
      if (t) {
        const d = document.createElement('div');
        d.className = 'toast toast--bad';
        d.textContent = `خطا در راه‌اندازی: ${err.message}`;
        t.append(d);
      }
    });
  });

  window.App = { switchView, Today, Foods, Modal, Settings, refreshStreak, refreshAiStatus };
})();
