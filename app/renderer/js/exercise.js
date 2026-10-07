/* global module, define */
/**
 * renderer/js/exercise.js — منطق تمرین: برآورد کالری، حجم تمرین و برنامه‌سازی.
 * UMD تا main و renderer از یک منطق مشترک استفاده کنند.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.ExerciseLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KIND_FA = {
    cardio: 'هوازی',
    strength: 'قدرتی',
    flexibility: 'انعطافی',
    sport: 'ورزشی',
    rest: 'استراحت',
  };

  /**
   * کالری سوزانده‌شده.
   * هوازی: MET × وزن(کیلوگرم) × ساعت   (فرمول استاندارد Compendium)
   * قدرتی: بر پایهٔ حجم کار (ست × تکرار × بار)
   */
  function estimateCalories({ met, weightKg, durationMin, sets, reps, loadKg, kind }) {
    if (kind === 'strength' || (!durationMin && sets && reps)) {
      const s = sets || 0;
      const r = reps || 0;
      const load = loadKg || 0;
      if (!s || !r) return 0;
      return Math.round(s * r * (load * 0.03 + 1.2));
    }
    if (!met || !durationMin) return 0;
    const w = weightKg || 70;
    return Math.round(met * w * (durationMin / 60));
  }

  /** شدت تمرین از روی RPE (مقیاس ۱ تا ۱۰). */
  function rpeLabel(rpe) {
    const v = Number(rpe);
    if (!v) return null;
    if (v <= 3) return 'خیلی سبک';
    if (v <= 5) return 'سبک';
    if (v <= 7) return 'متوسط';
    if (v <= 8) return 'سخت';
    if (v <= 9) return 'خیلی سخت';
    return 'نهایت توان';
  }

  /** پیشنهاد بار بعدی بر پایهٔ اصل اضافه‌بار تدریجی (۲ برای ۲). */
  function nextLoadSuggestion({ sets, reps, loadKg, targetReps = 12 }) {
    if (!sets || !reps || !loadKg) return null;
    // اگر کاربر در همهٔ ست‌ها به تکرار هدف رسید، ۵٪ بار اضافه می‌شود
    if (reps >= targetReps) {
      return {
        action: 'increase',
        load_kg: Math.round(loadKg * 1.05 * 2) / 2,
        reason: `چون ${reps} تکرار کامل انجام دادی، بار را حدود ۵٪ زیاد کن.`,
      };
    }
    if (reps < targetReps - 4) {
      return {
        action: 'decrease',
        load_kg: Math.round(loadKg * 0.9 * 2) / 2,
        reason: 'تکرارها خیلی کمتر از هدف بود؛ بار را کمی کم کن تا تکنیک حفظ شود.',
      };
    }
    return {
      action: 'hold',
      load_kg: loadKg,
      reason: 'همین بار را نگه دار و سعی کن تکرارها را به هدف برسانی.',
    };
  }

  /** حجم تمرین هفتگی (ست × تکرار × بار) بر حسب کیلوگرم. */
  function weeklyVolume(rows) {
    return (rows || []).reduce((sum, r) => {
      if (r.kind !== 'strength') return sum;
      return sum + (r.sets || 0) * (r.reps || 0) * (r.load_kg || 0);
    }, 0);
  }

  /**
   * الگوهای برنامهٔ هفتگی.
   * هر روز شامل تمرکز عضلانی + مقدار پیشنهادی هوازی است.
   */
  const SPLIT_TEMPLATES = {
    2: {
      name: 'تمام‌بدن ۲ روز',
      level: 'مبتدی',
      days: [
        { focus: 'تمام بدن (تمرکز پایین‌تنه)', muscles: ['پا', 'باسن', 'شکم'] },
        { focus: 'تمام بدن (تمرکز بالاتنه)', muscles: ['سینه', 'پشت', 'بازو'] },
      ],
    },
    3: {
      name: 'فول‌بادی ۳ روز',
      level: 'مبتدی',
      days: [
        { focus: 'پا و باسن', muscles: ['پا', 'باسن'] },
        { focus: 'بالاتنه فشاری', muscles: ['سینه', 'سرشانه', 'پشت بازو'] },
        { focus: 'بالاتنه کششی و مرکز بدن', muscles: ['پشت', 'بازو', 'شکم'] },
      ],
    },
    4: {
      name: 'بالاتنه/پایین‌تنه ۴ روز',
      level: 'متوسط',
      days: [
        { focus: 'پایین‌تنه (اسکوات)', muscles: ['پا', 'باسن'] },
        { focus: 'بالاتنه (پرس)', muscles: ['سینه', 'سرشانه', 'پشت بازو'] },
        { focus: 'پایین‌تنه (ددلیفت)', muscles: ['پشت', 'پا'] },
        { focus: 'بالاتنه (زیربغل)', muscles: ['پشت', 'بازو', 'شکم'] },
      ],
    },
    5: {
      name: 'تک‌عضله‌ای ۵ روز',
      level: 'پیشرفته',
      days: [
        { focus: 'سینه', muscles: ['سینه'] },
        { focus: 'پشت', muscles: ['پشت'] },
        { focus: 'پا', muscles: ['پا', 'باسن'] },
        { focus: 'سرشانه', muscles: ['سرشانه'] },
        { focus: 'بازو و شکم', muscles: ['بازو', 'شکم'] },
      ],
    },
    6: {
      name: 'پوش/پول/لگز ۶ روز',
      level: 'پیشرفته',
      days: [
        { focus: 'فشار (Push)', muscles: ['سینه', 'سرشانه', 'پشت بازو'] },
        { focus: 'کشش (Pull)', muscles: ['پشت', 'بازو'] },
        { focus: 'پا (Legs)', muscles: ['پا', 'باسن'] },
        { focus: 'فشار (Push)', muscles: ['سینه', 'سرشانه', 'پشت بازو'] },
        { focus: 'کشش (Pull)', muscles: ['پشت', 'بازو'] },
        { focus: 'پا و مرکز بدن', muscles: ['پا', 'شکم'] },
      ],
    },
  };

  /**
   * ساخت یک برنامهٔ هفتگی.
   * @param {object} opts {daysPerWeek, goal, level, equipment, cardioMinPerWeek}
   */
  function buildWeeklyPlan({ daysPerWeek = 3, goal = 'health', level = 'مبتدی', equipment = 'بدون وسیله', cardioMinPerWeek = 150 }) {
    const d = Math.min(6, Math.max(2, Math.round(daysPerWeek) || 3));
    const template = SPLIT_TEMPLATES[d] || SPLIT_TEMPLATES[3];

    const setsByLevel = { 'مبتدی': 3, 'متوسط': 4, 'پیشرفته': 4 };
    const repsByGoal = { lose: '۱۲ تا ۱۵', gain: '۶ تا ۱۰', maintain: '۸ تا ۱۲', health: '۱۰ تا ۱۲' };
    const restByGoal = { lose: '۴۵ تا ۶۰ ثانیه', gain: '۲ تا ۳ دقیقه', maintain: '۶۰ تا ۹۰ ثانیه', health: '۶۰ تا ۹۰ ثانیه' };

    const perDayCardio = Math.round(cardioMinPerWeek / 7);
    const plan = template.days.slice(0, d).map((day, i) => ({
      day_index: i + 1,
      focus: day.focus,
      muscles: day.muscles,
      sets: setsByLevel[level] || 3,
      reps: repsByGoal[goal] || repsByGoal.health,
      rest: restByGoal[goal] || restByGoal.health,
      cardio_min: goal === 'lose' ? Math.min(40, perDayCardio + 10) : perDayCardio,
      warmup_min: 8,
      cooldown_min: 5,
    }));

    return {
      name: template.name,
      level,
      goal,
      equipment,
      days_per_week: d,
      days: plan,
      weekly_cardio_min: plan.reduce((a, x) => a + (x.cardio_min || 0), 0),
      notes: [
        'هر جلسه با ۸ دقیقه گرم کردن عمومی و ۵ دقیقه سرد کردن و کشش تمام شود.',
        'بین دو جلسهٔ تمرین یک گروه عضلانی حداقل ۴۸ ساعت فاصله بگذارید.',
        'اصل اضافه‌بار: هر هفته یا تکرار را زیاد کنید یا بار را حدود ۵٪.',
      ],
    };
  }

  /** توصیهٔ سازمان جهانی بهداشت برای بزرگسالان. */
  const WHO_GUIDELINES = {
    aerobic_min_per_week: 150,
    aerobic_vigorous_min_per_week: 75,
    strength_sessions_per_week: 2,
  };

  /** ارزیابی فعالیت هفتگی کاربر در برابر توصیه‌ها. */
  function assessWeek({ cardioMinutes = 0, strengthSessions = 0 }) {
    const gaps = [];
    const good = [];
    if (cardioMinutes < WHO_GUIDELINES.aerobic_min_per_week) {
      gaps.push(`${WHO_GUIDELINES.aerobic_min_per_week - Math.round(cardioMinutes)} دقیقه هوازی دیگر تا رسیدن به ۱۵۰ دقیقهٔ هفته`);
    } else {
      good.push('هوازی هفتگی به توصیهٔ ۱۵۰ دقیقه رسیده');
    }
    if (strengthSessions < WHO_GUIDELINES.strength_sessions_per_week) {
      gaps.push(`${WHO_GUIDELINES.strength_sessions_per_week - strengthSessions} جلسهٔ قدرتی دیگر تا رسیدن به ۲ جلسه در هفته`);
    } else {
      good.push('تمرین قدرتی هفتگی کافی است');
    }
    return {
      cardio_minutes: Math.round(cardioMinutes),
      strength_sessions: strengthSessions,
      meets_aerobic: cardioMinutes >= WHO_GUIDELINES.aerobic_min_per_week,
      meets_strength: strengthSessions >= WHO_GUIDELINES.strength_sessions_per_week,
      gaps,
      good,
    };
  }

  return {
    KIND_FA,
    WHO_GUIDELINES,
    SPLIT_TEMPLATES,
    estimateCalories,
    rpeLabel,
    nextLoadSuggestion,
    weeklyVolume,
    buildWeeklyPlan,
    assessWeek,
  };
});
