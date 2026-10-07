/* global window */
/**
 * renderer/js/reports.js — نمای گزارش‌ها: آمار، نمودارها و ارزیابی هفتگی.
 */
(function () {
  'use strict';

  const J = window.Jalaali;
  const Store = window.Store;
  const Charts = window.Charts;
  const Exercise = window.ExerciseLib;

  let days = 7;
  let lastRows = [];
  let lastNutrition = null;

  function el(id) { return document.getElementById(id); }

  function rangeKeys() {
    const to = J.todayKey();
    const from = J.addDaysKey(to, -(days - 1));
    return { from, to };
  }

  function stat(label, value, unit, delta) {
    const d = document.createElement('div');
    d.className = 'stat';
    const deltaCls = delta == null ? '' : (delta > 0 ? 'stat__delta--up' : 'stat__delta--down');
    const deltaTxt = delta == null ? '' :
      `<p class="stat__delta ${deltaCls}">${delta > 0 ? '▲' : '▼'} ${J.formatNumber(Math.abs(delta), 1)}</p>`;
    d.innerHTML =
      `<p class="stat__label"></p>
       <p class="stat__value"><span class="v"></span>${unit ? ' <span class="stat__unit"></span>' : ''}</p>
       ${deltaTxt}`;
    d.querySelector('.stat__label').textContent = label;
    d.querySelector('.v').textContent = value;
    const u = d.querySelector('.stat__unit');
    if (u) u.textContent = unit;
    return d;
  }

  function buildStats(rows, nutrition) {
    const grid = el('statGrid');
    grid.textContent = '';

    const withMeals = rows.filter((r) => r.kcal_in > 0);
    const avgIn = withMeals.length ? Math.round(withMeals.reduce((a, r) => a + r.kcal_in, 0) / withMeals.length) : 0;
    const totalBurn = Math.round(rows.reduce((a, r) => a + (r.kcal_burned || 0), 0));
    const avgProtein = withMeals.length
      ? Math.round(rows.reduce((a, r) => a + (r.protein_g || 0), 0) / withMeals.length) : 0;
    const avgWater = Math.round(rows.reduce((a, r) => a + (r.water_ml || 0), 0) / Math.max(1, rows.length));
    const workoutDays = rows.filter((r) => (r.workouts || 0) > 0).length;

    const weights = rows.filter((r) => r.weight_kg != null);
    const firstW = weights.length ? weights[0].weight_kg : null;
    const lastW = weights.length ? weights[weights.length - 1].weight_kg : null;
    const deltaW = firstW != null && lastW != null ? Math.round((lastW - firstW) * 10) / 10 : null;

    grid.append(
      stat('میانگین کالری دریافتی', J.formatNumber(avgIn), 'کیلوکالری'),
      stat('مجموع کالری سوزانده', J.formatNumber(totalBurn), 'کیلوکالری'),
      stat('میانگین پروتئین', J.formatNumber(avgProtein), 'گرم'),
      stat('میانگین آب روزانه', J.formatNumber(avgWater), 'میلی‌لیتر'),
      stat('روزهای دارای تمرین', J.formatNumber(workoutDays), `از ${J.formatNumber(rows.length)}`)
    );

    if (deltaW != null) {
      const g = stat('تغییر وزن در این بازه', J.formatNumber(Math.abs(deltaW), 1), 'کیلوگرم', deltaW === 0 ? null : deltaW);
      grid.append(g);
    } else {
      grid.append(stat('تغییر وزن', '—', ''));
    }

    if (nutrition && nutrition.target_kcal) {
      const diff = avgIn - nutrition.target_kcal;
      const g = stat('فاصله تا کالری هدف', J.formatNumber(Math.abs(diff)), 'کیلوکالری', diff === 0 ? null : diff);
      grid.append(g);
    }
  }

  function buildAssess(rows) {
    const box = el('weekAssess');
    box.textContent = '';
    // ارزیابی بر پایهٔ ۷ روز آخر (توصیه‌های WHO هفتگی است)
    const last7 = rows.slice(-7);
    const cardioMinutes = last7.reduce((a, r) => a + Math.round((r.kcal_burned || 0) / 8), 0); // برآورد دقیقه از کالری
    const strengthSessions = last7.filter((r) => (r.workouts || 0) > 0).length;

    const a = Exercise.assessWeek({ cardioMinutes, strengthSessions });

    const note = document.createElement('p');
    note.className = 'muted';
    note.style.fontSize = '11.5px';
    note.textContent = 'دقیقهٔ هوازی از کالری سوزانده‌شده برآورد شده و تقریبی است.';
    box.append(note);

    for (const g of a.good) {
      const d = document.createElement('p');
      d.className = 'assess__item assess__item--good';
      d.textContent = `✓ ${g}`;
      box.append(d);
    }
    for (const g of a.gaps) {
      const d = document.createElement('p');
      d.className = 'assess__item assess__item--gap';
      d.textContent = `• ${g}`;
      box.append(d);
    }
  }

  function renderCharts() {
    Charts.weight('chartWeight', lastRows);
    Charts.calories('chartCalories', lastRows);
    const protein = avgMacro('protein_g');
    const carbs = avgMacro('carbs_g');
    const fat = avgMacro('fat_g');
    Charts.macros('chartMacros', { protein, carbs, fat });
    Charts.waterAndWorkout('chartWater', lastRows, lastNutrition?.water_ml);
  }

  function avgMacro(key) {
    const withData = lastRows.filter((r) => (r.kcal_in || 0) > 0);
    if (!withData.length) return 0;
    return Math.round(withData.reduce((a, r) => a + (r[key] || 0), 0) / withData.length);
  }

  async function load() {
    const { from, to } = rangeKeys();
    el('rangeLabel').textContent = `${J.formatDate(from)} تا ${J.formatDate(to)}`;

    const rows = await Store.run('reports:range', () => Store.range(from, to), { fallback: [] });
    lastRows = rows;
    lastNutrition = await Store.run('reports:nutrition', () => Store.nutrition(), { fallback: null });

    buildStats(rows, lastNutrition);
    renderCharts();
    buildAssess(rows);
  }

  function init() {
    const picker = el('rangePicker');
    if (!picker) return;
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.segmented__btn');
      if (!btn) return;
      picker.querySelectorAll('.segmented__btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      days = Number(btn.dataset.days) || 7;
      load();
    });

    Charts.init();
  }

  function refresh() { load(); }

  /** هنگام تغییر پوسته */
  function regen() { renderCharts(); }

  window.Reports = { init, load, refresh, regen, get days() { return days; } };
})();
