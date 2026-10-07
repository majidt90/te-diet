/* global window */
/**
 * renderer/js/charts.js — نمودارها با Chart.js (کاملاً لوکال).
 *
 * دو نکتهٔ مهم برای فارسی/RTL:
 *  ۱) همهٔ برچسب‌ها و tooltipها با ارقام فارسی رندر می‌شوند.
 *  ۲) Chart.js به‌طور پیش‌فرض چپ‌به‌راست است؛ options.rtl و
 *     textDirection برای راهنما و tooltip تنظیم می‌شود.
 *
 * حلقه‌های پیشرفتِ صفحهٔ «امروز» با canvas خام کشیده می‌شوند چون
 * برای چهار حلقهٔ ساده، سربار Chart.js بیهوده است.
 */
(function () {
  'use strict';

  const J = window.Jalaali;
  const instances = new Map();

  /** خواندن متغیر رنگ از پوستهٔ فعال — با تغییر پوسته، نمودارها تازه می‌شوند. */
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function theme() {
    return {
      text: cssVar('--text', '#e8edf2'),
      muted: cssVar('--text-muted', '#8b98a5'),
      faint: cssVar('--text-faint', '#5f6b78'),
      border: cssVar('--border', '#26303c'),
      surface: cssVar('--surface', '#1a212b'),
      accent: cssVar('--accent', '#3fbf8f'),
      protein: cssVar('--protein', '#6aa9f0'),
      carbs: cssVar('--carbs', '#e8b53a'),
      fat: cssVar('--fat', '#e07a5f'),
      water: cssVar('--water', '#4fb3d9'),
      burn: cssVar('--burn', '#e8763a'),
    };
  }

  /** تنظیمات سراسری — یک‌بار اجرا می‌شود. */
  function init() {
    const Chart = window.Chart;
    if (!Chart) {
      console.warn('Chart.js بارگذاری نشد.');
      return;
    }
    const t = theme();
    Chart.defaults.font.family = "'Vazirmatn', 'Segoe UI', Tahoma, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = t.muted;
    Chart.defaults.borderColor = t.border;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 420;
    Chart.defaults.plugins.legend.rtl = true;
    Chart.defaults.plugins.legend.textDirection = 'rtl';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.rtl = true;
    Chart.defaults.plugins.tooltip.textDirection = 'rtl';
    Chart.defaults.plugins.tooltip.backgroundColor = t.surface;
    Chart.defaults.plugins.tooltip.borderColor = t.border;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = t.text;
    Chart.defaults.plugins.tooltip.bodyColor = t.text;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
  }

  /** نمودار قبلی روی همان canvas را از بین می‌برد تا نشتی حافظه نشود. */
  function take(id, canvas) {
    const Chart = window.Chart;
    if (!Chart) return null;
    const prev = instances.get(id);
    if (prev) { prev.destroy(); instances.delete(id); }
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) return null;
    return ctx;
  }

  function make(id, canvas, config) {
    const ctx = take(id, canvas);
    if (!ctx) return null;
    const chart = new window.Chart(ctx, config);
    instances.set(id, chart);
    return chart;
  }

  /** برچسب محور افقی از کلید تاریخ شمسی → «۱۵ مهر» */
  function dayLabels(rows) {
    return rows.map((r) => (r.label || J.formatDate(r.day, { short: true })));
  }

  /** ابزار محور عمودی با ارقام فارسی. */
  function axisNumber(opts = {}) {
    const t = theme();
    return {
      beginAtZero: opts.beginAtZero !== false,
      grid: { color: t.border, drawTicks: false },
      border: { display: false },
      ticks: {
        color: t.faint,
        padding: 8,
        maxTicksLimit: opts.maxTicksLimit || 6,
        callback: (v) => J.formatNumber(v, 0),
      },
      ...opts.extra,
    };
  }

  function axisCategory(labels) {
    const t = theme();
    return {
      grid: { display: false },
      border: { color: t.border },
      ticks: { color: t.faint, maxRotation: 0, autoSkipPadding: 12, padding: 6 },
    };
  }

  // —————————————————— نمودار وزن ——————————————————
  function weight(id, rows) {
    const t = theme();
    const points = rows.filter((r) => r.weight_kg != null);
    if (!points.length) return empty(id, 'هنوز وزنی ثبت نشده است.');

    return make(id, id, {
      type: 'line',
      data: {
        labels: points.map((p) => J.formatDate(p.day, { short: true })),
        datasets: [{
          label: 'وزن (کیلوگرم)',
          data: points.map((p) => p.weight_kg),
          borderColor: t.accent,
          backgroundColor: hexToRgba(t.accent, 0.14),
          borderWidth: 2.5,
          fill: true,
          tension: 0.32,
          pointRadius: points.length > 40 ? 0 : 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: t.accent,
          pointBorderColor: t.surface,
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => `${J.formatNumber(c.parsed.y, 1)} کیلوگرم`,
            },
          },
        },
        scales: {
          x: axisCategory(),
          y: axisNumber({ beginAtZero: false, extra: { ticks: { callback: (v) => J.formatNumber(v, 0) } } }),
        },
      },
    });
  }

  // —————————————————— کالری ورودی/خروجی ——————————————————
  function calories(id, rows) {
    const t = theme();
    if (!rows.length) return empty(id, 'داده‌ای برای نمایش نیست.');

    return make(id, id, {
      type: 'bar',
      data: {
        labels: dayLabels(rows),
        datasets: [
          {
            label: 'دریافتی',
            data: rows.map((r) => r.kcal_in || 0),
            backgroundColor: hexToRgba(t.accent, 0.85),
            borderRadius: 5,
            borderSkipped: false,
            maxBarThickness: 26,
          },
          {
            label: 'سوزانده‌شده',
            data: rows.map((r) => -(r.kcal_burned || 0)),
            backgroundColor: hexToRgba(t.burn, 0.85),
            borderRadius: 5,
            borderSkipped: false,
            maxBarThickness: 26,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start' },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${J.formatNumber(Math.abs(c.parsed.y))} کیلوکالری`,
            },
          },
        },
        scales: {
          x: { ...axisCategory(), stacked: false },
          y: axisNumber({
            extra: {
              ticks: { callback: (v) => J.formatNumber(Math.abs(v), 0), color: t.faint, maxTicksLimit: 6 },
            },
          }),
        },
      },
    });
  }

  // —————————————————— درشت‌مغذی‌ها ——————————————————
  function macros(id, { protein, carbs, fat }) {
    const t = theme();
    const total = (protein || 0) + (carbs || 0) + (fat || 0);
    if (!total) return empty(id, 'هنوز وعده‌ای ثبت نشده است.');

    return make(id, id, {
      type: 'doughnut',
      data: {
        labels: ['پروتئین', 'کربوهیدرات', 'چربی'],
        datasets: [{
          data: [protein || 0, carbs || 0, fat || 0],
          backgroundColor: [t.protein, t.carbs, t.fat],
          borderColor: t.surface,
          borderWidth: 3,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (c) => {
                const pct = Math.round(c.parsed / total * 100);
                return `${c.label}: ${J.formatNumber(c.parsed)} گرم (${J.toPersianDigits(pct)}٪)`;
              },
            },
          },
        },
      },
    });
  }

  // —————————————————— آب و تمرین ——————————————————
  function waterAndWorkout(id, rows, waterGoal) {
    const t = theme();
    if (!rows.length) return empty(id, 'داده‌ای برای نمایش نیست.');

    return make(id, id, {
      data: {
        labels: dayLabels(rows),
        datasets: [
          {
            type: 'bar',
            label: 'آب (میلی‌لیتر)',
            data: rows.map((r) => r.water_ml || 0),
            backgroundColor: hexToRgba(t.water, 0.75),
            borderRadius: 5,
            borderSkipped: false,
            maxBarThickness: 22,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'تمرین (تعداد)',
            data: rows.map((r) => r.workouts || 0),
            borderColor: t.burn,
            backgroundColor: t.burn,
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start' },
          tooltip: {
            callbacks: {
              label: (c) => {
                if (c.dataset.yAxisID === 'y1') return `تمرین: ${J.formatNumber(c.parsed.y)} مورد`;
                const goal = waterGoal ? ` از ${J.formatNumber(waterGoal)}` : '';
                return `آب: ${J.formatNumber(c.parsed.y)} میلی‌لیتر${goal}`;
              },
            },
          },
        },
        scales: {
          x: axisCategory(),
          y: axisNumber({ extra: { position: 'right' } }),
          y1: axisNumber({
            beginAtZero: true,
            extra: {
              position: 'left',
              grid: { display: false },
              ticks: { precision: 0, callback: (v) => J.formatNumber(v, 0), color: t.faint },
            },
          }),
        },
      },
    });
  }

  /** حالت «داده‌ای نیست» — روی canvas پیام فارسی می‌کشد. */
  function empty(id, message) {
    const canvas = take(id, id);
    if (!canvas) return null;
    const ctx2d = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, rect.width, rect.height);
    ctx2d.fillStyle = theme().faint;
    ctx2d.font = "13px 'Vazirmatn', sans-serif";
    ctx2d.textAlign = 'center';
    ctx2d.direction = 'rtl';
    ctx2d.fillText(message, rect.width / 2, rect.height / 2);
    return null;
  }

  // —————————————————— حلقهٔ پیشرفت (canvas خام) ——————————————————
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} ratio ۰ تا ۱ (بیش از ۱ کران‌دار می‌شود)
   * @param {string} color
   */
  function drawRing(canvas, ratio, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssSize = canvas.getAttribute('width') ? Number(canvas.getAttribute('width')) : canvas.clientWidth;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const lineW = Math.max(7, cssSize * 0.075);
    const r = (cssSize - lineW) / 2 - 1;

    // ریل
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = lineW;
    ctx.strokeStyle = theme().border;
    ctx.lineCap = 'round';
    ctx.stroke();

    // پیشرفت — از بالای دایره و در جهت ساعت‌گرد
    const pct = Math.max(0, Math.min(1, ratio));
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.lineWidth = lineW;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  /** تبدیل #rrggbb به rgba با شفافیت — برای گرادیان‌ها و پرکردن. */
  function hexToRgba(hex, alpha) {
    const h = String(hex || '').trim();
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    if (!m) return h;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
  }

  /** با تغییر پوسته، رنگ‌ها را تازه می‌کند. */
  function refreshAll(regen) {
    init();
    instances.forEach((c) => { try { c.destroy(); } catch { /* ignore */ } });
    instances.clear();
    if (typeof regen === 'function') regen();
  }

  window.Charts = {
    init,
    theme,
    weight,
    calories,
    macros,
    waterAndWorkout,
    drawRing,
    empty,
    hexToRgba,
    refreshAll,
    get instances() { return instances; },
  };
})();
