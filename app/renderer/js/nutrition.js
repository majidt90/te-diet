/* global module, define, require */
/**
 * renderer/js/nutrition.js — محاسبات تغذیه.
 *
 * UMD: هم در renderer (نمایش) و هم در main (ساخت پرامپت) استفاده می‌شود تا
 * اعدادی که کاربر می‌بیند با اعدادی که مدل می‌بیند یکی باشد.
 *
 * منبع فرمول‌ها:
 *  - BMR: Mifflin-St Jeor (دقیق‌ترین فرمول عمومی برای بزرگسالان)
 *  - ضریب فعالیت: استاندارد FAO/WHO
 *  - BMI: سازمان جهانی بهداشت
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else root.Nutrition = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTIVITY_FACTOR = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    athlete: 1.9,
  };

  const ACTIVITY_FA = {
    sedentary: 'کم‌تحرک',
    light: 'تحرک سبک',
    moderate: 'تحرک متوسط',
    active: 'پرتحرک',
    athlete: 'ورزشکار',
  };

  /** محاسبهٔ سن از سال/ماه/روز تولد شمسی. */
  function ageFromJalaali(birthYear, birthMonth, birthDay, today) {
    if (!birthYear) return null;
    const t = today || { jy: 0, jm: 0, jd: 0 };
    if (!t.jy) return null;
    let age = t.jy - birthYear;
    const bm = birthMonth || 1;
    const bd = birthDay || 1;
    if (t.jm < bm || (t.jm === bm && t.jd < bd)) age -= 1;
    return age >= 0 && age < 130 ? age : null;
  }

  /**
   * BMR با Mifflin-St Jeor.
   * مرد: 10×وزن + 6.25×قد − 5×سن + 5
   * زن: 10×وزن + 6.25×قد − 5×سن − 161
   */
  function bmr({ sex, weightKg, heightCm, age }) {
    if (!weightKg || !heightCm || !age) return null;
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return Math.round(sex === 'female' ? base - 161 : base + 5);
  }

  /** TDEE = BMR × ضریب فعالیت. */
  function tdee(bmrValue, activityLevel) {
    if (!bmrValue) return null;
    const f = ACTIVITY_FACTOR[activityLevel] || ACTIVITY_FACTOR.light;
    return Math.round(bmrValue * f);
  }

  /** شاخص تودهٔ بدنی و برچسب فارسی آن. */
  function bmi(weightKg, heightCm) {
    if (!weightKg || !heightCm) return null;
    const m = heightCm / 100;
    const value = Math.round((weightKg / (m * m)) * 10) / 10;
    return { value, label: bmiLabel(value) };
  }

  function bmiLabel(value) {
    if (value < 18.5) return 'کمبود وزن';
    if (value < 25) return 'وزن سالم';
    if (value < 30) return 'اضافه وزن';
    if (value < 35) return 'چاقی درجهٔ یک';
    if (value < 40) return 'چاقی درجهٔ دو';
    return 'چاقی درجهٔ سه';
  }

  /**
   * محدودهٔ وزن سالم بر پایهٔ قد (BMI بین ۱۸٫۵ تا ۲۴٫۹).
   */
  function healthyWeightRange(heightCm) {
    if (!heightCm) return null;
    const m = heightCm / 100;
    return {
      min: Math.round(18.5 * m * m * 10) / 10,
      max: Math.round(24.9 * m * m * 10) / 10,
    };
  }

  /** وزن ایده‌آل با فرمول Devine. */
  function idealWeight(sex, heightCm) {
    if (!heightCm) return null;
    const inchesOver5ft = (heightCm - 152.4) / 2.54;
    const base = sex === 'female' ? 45.5 : 50;
    const w = base + 2.3 * Math.max(0, inchesOver5ft);
    return Math.round(w * 10) / 10;
  }

  /**
   * کالری هدف بر پایهٔ هدف کاربر.
   * ایمنی: هرگز زیر ۱۲۰۰ (زن) / ۱۵۰۰ (مرد) و حداکثر کسری ۱۰۰۰ کالری.
   */
  function targetCalories({ tdeeValue, goal, sex, goalRateKgPerWeek }) {
    if (!tdeeValue) return null;
    const notes = [];
    let target = tdeeValue;

    if (goal === 'lose') {
      // یک کیلوگرم چربی ≈ ۷۷۰۰ کیلوکالری
      const rate = goalRateKgPerWeek || 0.5;
      let deficit = Math.round(rate * 7700 / 7);
      if (deficit > 1000) {
        deficit = 1000;
        notes.push('کسری کالری برای حفظ سلامت و تودهٔ عضلانی به ۱۰۰۰ کیلوکالری در روز محدود شد.');
      }
      target = tdeeValue - deficit;
    } else if (goal === 'gain') {
      const rate = goalRateKgPerWeek || 0.25;
      const surplus = Math.min(500, Math.round(rate * 7700 / 7));
      target = tdeeValue + surplus;
      notes.push('مازاد کالری محدود نگه داشته شد تا افزایش وزن بیشتر از جنس عضله باشد تا چربی.');
    }

    const floor = sex === 'female' ? 1200 : 1500;
    if (target < floor) {
      target = floor;
      notes.push(`برای حفظ سلامت، کالری هدف از ${floor} کیلوکالری کمتر نشد. برای کاهش سریع‌تر حتماً با پزشک مشورت کنید.`);
    }
    return { target: Math.round(target), notes };
  }

  /**
   * هدف درشت‌مغذی‌ها.
   * پروتئین: ۱٫۶ تا ۲٫۲ گرم به ازای هر کیلوگرم (برای حفظ عضله در کسری کالری)
   * چربی: حداقل ۲۰٪ کالری برای جذب ویتامین‌های محلول در چربی و سلامت هورمونی
   * کربوهیدرات: باقی‌مانده
   */
  function macroTargets({ targetKcal, weightKg, goal, activityLevel }) {
    if (!targetKcal) return null;
    const active = ['active', 'athlete'].includes(activityLevel);
    const cutting = goal === 'lose';

    let proteinPerKg = 1.2;
    if (cutting) proteinPerKg = 1.8;
    else if (goal === 'gain') proteinPerKg = 1.9;
    else if (active) proteinPerKg = 1.6;

    let proteinG = weightKg ? Math.round(proteinPerKg * weightKg) : Math.round(targetKcal * 0.25 / 4);
    // سقف ایمن
    const cap = weightKg ? Math.round(2.2 * weightKg) : proteinG;
    proteinG = Math.min(proteinG, Math.max(cap, Math.round(targetKcal * 0.35 / 4)));

    const fatPct = cutting ? 0.25 : 0.28;
    const fatG = Math.round(targetKcal * fatPct / 9);

    const remain = targetKcal - proteinG * 4 - fatG * 9;
    const carbsG = Math.max(50, Math.round(remain / 4));
    const fiberG = Math.round(Math.min(38, Math.max(21, targetKcal / 1000 * 14)));

    return {
      protein_g: proteinG,
      fat_g: fatG,
      carbs_g: carbsG,
      fiber_g: fiberG,
      protein_per_kg: proteinPerKg,
      split: {
        protein: Math.round(proteinG * 4 / targetKcal * 100),
        fat: Math.round(fatG * 9 / targetKcal * 100),
        carbs: Math.round(carbsG * 4 / targetKcal * 100),
      },
    };
  }

  /**
   * هدف آب روزانه: ۳۵ میلی‌لیتر به ازای هر کیلوگرم + ۵۰۰ به ازای هر ساعت تمرین.
   */
  function waterTarget({ weightKg, workoutMinutes = 0 }) {
    const w = weightKg || 70;
    return Math.round((w * 35 + workoutMinutes * 8.3) / 50) * 50;
  }

  /**
   * همهٔ محاسبات در یک نقطه — همان چیزی که هم UI و هم پرامپت مصرف می‌کنند.
   */
  function computeAll({ profile, weightKg, today, goalRateKgPerWeek }) {
    const heightCm = profile?.height_cm || null;
    const weight = weightKg || null;
    const age = profile ? ageFromJalaali(profile.birth_year, profile.birth_month, profile.birth_day, today) : null;
    const notes = [];

    if (!weight) notes.push('وزنی ثبت نشده؛ محاسبات بر پایهٔ وزن انجام نشد.');
    if (!heightCm) notes.push('قد ثبت نشده؛ BMI و BMR قابل محاسبه نیست.');
    if (!age) notes.push('سال تولد ثبت نشده؛ BMR قابل محاسبه نیست.');

    const b = bmr({ sex: profile?.sex, weightKg: weight, heightCm, age });
    const t = b ? tdee(b, profile?.activity_level) : null;
    const bmiResult = weight && heightCm ? bmi(weight, heightCm) : null;

    let targetKcal = t;
    const tc = t ? targetCalories({
      tdeeValue: t, goal: profile?.goal, sex: profile?.sex,
      goalRateKgPerWeek: goalRateKgPerWeek ?? profile?.goal_rate_kg_per_week,
    }) : null;
    if (tc) {
      targetKcal = tc.target;
      notes.push(...tc.notes);
    }

    const macros = targetKcal ? macroTargets({
      targetKcal, weightKg: weight, goal: profile?.goal, activityLevel: profile?.activity_level,
    }) : null;

    return {
      age,
      bmi: bmiResult ? bmiResult.value : null,
      bmi_label: bmiResult ? bmiResult.label : null,
      healthy_weight: healthyWeightRange(heightCm),
      ideal_weight: idealWeight(profile?.sex, heightCm),
      bmr: b,
      tdee: t,
      activity_factor: ACTIVITY_FACTOR[profile?.activity_level] || null,
      target_kcal: targetKcal,
      protein_g: macros?.protein_g ?? null,
      fat_g: macros?.fat_g ?? null,
      carbs_g: macros?.carbs_g ?? null,
      fiber_g: macros?.fiber_g ?? null,
      macro_split: macros?.split ?? null,
      water_ml: waterTarget({ weightKg: weight }),
      notes,
    };
  }

  /** توزیع پیشنهادی وعده‌ها در روز. */
  const MEAL_SPLIT = {
    breakfast: 0.25,
    lunch: 0.35,
    dinner: 0.30,
    snack: 0.10,
  };

  function mealBudget(targetKcal) {
    if (!targetKcal) return null;
    return Object.fromEntries(Object.entries(MEAL_SPLIT).map(([k, v]) => [k, Math.round(targetKcal * v)]));
  }

  return {
    ACTIVITY_FACTOR,
    ACTIVITY_FA,
    MEAL_SPLIT,
    ageFromJalaali,
    bmr,
    tdee,
    bmi,
    bmiLabel,
    healthyWeightRange,
    idealWeight,
    targetCalories,
    macroTargets,
    waterTarget,
    computeAll,
    mealBudget,
  };
});
