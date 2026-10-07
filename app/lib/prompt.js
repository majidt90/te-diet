'use strict';
/**
 * lib/prompt.js — ساخت پیام سیستم برای مدل.
 *
 * سه لایه:
 *   ۱) core: هویت و قوانین سخت (برای همهٔ پرسونیتی‌ها مشترک)
 *   ۲) personality: لحن و سبک
 *   ۳) context: داده‌های واقعی کاربر + نامزدهای غذا/تمرین
 *
 * چرا نامزدهای غذا را داخل پرامپت می‌گذاریم؟ تا مدل بتواند food_slug درست را
 * انتخاب کند و مقادیر از پایگاه‌دادهٔ محلی خوانده شود، نه از حافظهٔ مدل.
 */
const J = require('./jalaali.js');

const SEX_FA = { male: 'مرد', female: 'زن' };
const ACTIVITY_FA = {
  sedentary: 'کم‌تحرک (پشت‌میزنشین)',
  light: 'تحرک سبک (۱ تا ۳ جلسه در هفته)',
  moderate: 'تحرک متوسط (۳ تا ۵ جلسه در هفته)',
  active: 'پرتحرک (۶ تا ۷ جلسه در هفته)',
  athlete: 'ورزشکار (دو جلسه در روز یا کار سنگین)',
};
const GOAL_FA = {
  lose: 'کاهش وزن',
  maintain: 'ثبات وزن',
  gain: 'افزایش وزن/عضله',
  health: 'سلامت عمومی',
};
const MEAL_FA = { breakfast: 'صبحانه', lunch: 'ناهار', dinner: 'شام', snack: 'میان‌وعده' };
const GOAL_KIND_FA = {
  kcal: 'کالری روزانه', protein_g: 'پروتئین (گرم)', water_ml: 'آب (میلی‌لیتر)',
  workouts_per_week: 'جلسه تمرین در هفته', weight_kg: 'وزن هدف (کیلوگرم)', steps: 'قدم در روز',
};

function fmt(n, digits) {
  return J.formatNumber(n, digits);
}

/** بخش پروفایل و داده‌های کاربر. */
function buildUserContext(ctx) {
  const { profile, latestWeight, goals, today, streak, summary, history, nutrition, restrictions } = ctx;
  const lines = [];

  const t = J.today();
  lines.push(`امروز: ${J.formatFullDate(t)} (کلید تاریخ: ${J.dateKey(t)})`);
  if (history && history.length) {
    lines.push('روزهای اخیر (برای درک روند):');
    for (const d of history) {
      const parts = [`  ${d.day}: ورودی ${fmt(d.kcal_in)} کالری`];
      if (d.kcal_burned) parts.push(`سوزانده ${fmt(d.kcal_burned)}`);
      if (d.water_ml) parts.push(`آب ${fmt(d.water_ml)} میلی‌لیتر`);
      if (d.workouts) parts.push(`${fmt(d.workouts)} تمرین`);
      if (d.weight_kg) parts.push(`وزن ${fmt(d.weight_kg, 1)}`);
      lines.push(parts.join('، '));
    }
  }

  if (!profile || !profile.height_cm) {
    lines.push('پروفایل: ناقص است. قد، سن، جنس و سطح تحرک کاربر را نمی‌دانیم؛ اگر لازم شد بپرس.');
  } else {
    const bits = [];
    if (profile.display_name) bits.push(`نام: ${profile.display_name}`);
    if (profile.sex) bits.push(`جنس: ${SEX_FA[profile.sex] || profile.sex}`);
    if (profile.birth_year) {
      const age = t.jy - profile.birth_year;
      bits.push(`سن: ${fmt(age)} سال (زادروز ${fmt(profile.birth_year)}/${fmt(profile.birth_month || 1)}/${fmt(profile.birth_day || 1)})`);
    }
    if (profile.height_cm) bits.push(`قد: ${fmt(profile.height_cm)} سانتی‌متر`);
    if (profile.activity_level) bits.push(`سطح تحرک: ${ACTIVITY_FA[profile.activity_level] || profile.activity_level}`);
    if (profile.goal) bits.push(`هدف: ${GOAL_FA[profile.goal] || profile.goal}`);
    if (profile.goal_rate_kg_per_week) bits.push(`سرعت هدف: ${fmt(profile.goal_rate_kg_per_week, 2)} کیلوگرم در هفته`);
    lines.push(`پروفایل: ${bits.join(' | ')}`);
  }

  if (restrictions && restrictions.length) lines.push(`محدودیت غذایی: ${restrictions.join('، ')}`);
  if (profile?.medical_notes) lines.push(`نکتهٔ سلامت (حساس — با احتیاط برخورد کن): ${profile.medical_notes}`);

  if (latestWeight) {
    lines.push(`آخرین وزن ثبت‌شده: ${fmt(latestWeight.weight_kg, 1)} کیلوگرم در ${J.formatDate(latestWeight.day)}`);
  } else {
    lines.push('هنوز وزنی ثبت نشده است.');
  }

  if (nutrition) {
    const n = nutrition;
    const nBits = [];
    if (n.bmi) nBits.push(`BMI: ${fmt(n.bmi, 1)} (${n.bmi_label})`);
    if (n.bmr) nBits.push(`BMR: ${fmt(n.bmr)} کیلوکالری`);
    if (n.tdee) nBits.push(`TDEE: ${fmt(n.tdee)} کیلوکالری`);
    if (n.target_kcal) nBits.push(`کالری هدف: ${fmt(n.target_kcal)} کیلوکالری`);
    if (n.protein_g) nBits.push(`پروتئین هدف: ${fmt(n.protein_g)} گرم`);
    if (n.water_ml) nBits.push(`آب هدف: ${fmt(n.water_ml)} میلی‌لیتر`);
    if (nBits.length) lines.push(`محاسبات (Mifflin-St Jeor): ${nBits.join(' | ')}`);
    if (n.notes) lines.push(`یادداشت محاسباتی: ${n.notes}`);
  }

  const g = goals && Object.keys(goals).length ? goals : null;
  if (g) {
    const parts = Object.entries(g).map(([k, v]) => `${GOAL_KIND_FA[k] || k}: ${fmt(v.target)}`);
    lines.push(`هدف‌های فعال: ${parts.join('، ')}`);
  }

  if (streak && streak.current > 0) {
    lines.push(`رشتهٔ ثبت پیوسته: ${fmt(streak.current)} روز (رکورد ${fmt(streak.longest)} روز)`);
  }

  if (summary) {
    const s = summary;
    lines.push(`وضعیت امروز (${J.formatDate(s.day)}):`);
    lines.push(`  وعده‌های ثبت‌شده: ${fmt(s.meals.length)} — مجموع ورودی ${fmt(s.totals.kcal_in)} کیلوکالری`);
    lines.push(`  درشت‌مغذی: پروتئین ${fmt(s.totals.protein_g)} گرم | کربوهیدرات ${fmt(s.totals.carbs_g)} گرم | چربی ${fmt(s.totals.fat_g)} گرم | فیبر ${fmt(s.totals.fiber_g, 1)} گرم`);
    const mealParts = Object.entries(s.by_meal).map(([m, v]) => `${MEAL_FA[m] || m}: ${fmt(v.kcal)} کالری`);
    if (mealParts.length) lines.push(`  تفکیک وعده: ${mealParts.join('، ')}`);
    lines.push(`  تمرین: ${fmt(s.workouts.length)} مورد — سوزانده‌شده ${fmt(s.totals.kcal_burned)} کیلوکالری`);
    lines.push(`  آب: ${fmt(s.water.total_ml)} میلی‌لیتر در ${fmt(s.water.count)} نوبت`);
    if (s.sleep_hours) lines.push(`  خواب دیشب: ${fmt(s.sleep_hours, 1)} ساعت`);
    if (!s.meals.length && !s.workouts.length) lines.push('  (هنوز چیزی برای امروز ثبت نشده است)');
  }

  return lines.join('\n');
}

/** فهرست فشردهٔ نامزدهای غذا برای اینکه مدل slug درست را انتخاب کند. */
function formatCandidates(title, rows, fields) {
  if (!rows || !rows.length) return '';
  const lines = rows.map((r) => {
    const extra = fields.map((f) => `${f.label}:${fmt(r[f.key], f.digits)}`).join(' ');
    return `  ${r.slug} = ${r.name} [${extra}]`;
  });
  return `${title}\n${lines.join('\n')}`;
}

/** ساخت پیام سیستم کامل. */
function buildSystemPrompt({ personalityData, personalityId, context, foodCandidates, exerciseCandidates }) {
  const core = personalityData.core || {};
  const list = personalityData.personalities || [];
  const p = list.find((x) => x.id === personalityId) || list.find((x) => x.id === personalityData.default) || list[0];
  if (!p) throw new Error('هیچ پرسونیتی‌ای در personality.json پیدا نشد.');

  const sections = [];

  sections.push(`# هویت\n${core.identity || ''}\nنام و نقش تو در این گفت‌وگو: ${p.name} — ${p.role}`);

  if (p.style?.length) sections.push(`# سبک تو\n${p.style.map((s) => `- ${s}`).join('\n')}`);
  if (p.avoid?.length) sections.push(`# از این‌ها پرهیز کن\n${p.avoid.map((s) => `- ${s}`).join('\n')}`);
  if (core.hard_rules?.length) sections.push(`# قوانین سخت\n${core.hard_rules.map((s) => `- ${s}`).join('\n')}`);

  if (context) sections.push(`# داده‌های کاربر\n${context}`);

  const cand = [
    formatCandidates('# غذاهای موجود در پایگاه‌دادهٔ محلی (اگر کاربر یکی از این‌ها را گفت، از همان slug استفاده کن)',
      foodCandidates, [
        { key: 'unit', label: 'واحد', digits: undefined },
        { key: 'kcal', label: 'کالری', digits: 0 },
        { key: 'protein', label: 'پروتئین', digits: 1 },
        { key: 'carbs', label: 'کربوهیدرات', digits: 1 },
        { key: 'fat', label: 'چربی', digits: 1 },
      ]),
    formatCandidates('# تمرین‌های موجود در پایگاه‌دادهٔ محلی',
      exerciseCandidates, [
        { key: 'met', label: 'MET', digits: 1 },
        { key: 'category', label: 'دسته', digits: undefined },
      ]),
  ].filter(Boolean).join('\n\n');
  if (cand) sections.push(cand);

  const ac = core.action_contract;
  if (ac) {
    const typeLines = Object.entries(ac.types || {}).map(([name, schema]) => {
      const fields = Object.entries(schema).map(([k, v]) => `${k}: ${v}`).join('، ');
      return `- ${name} → { ${fields} }`;
    });
    sections.push([
      '# قرارداد ثبت اطلاعات (بسیار مهم)',
      ac.description,
      ac.format,
      '',
      'انواع عملیات:',
      ...typeLines,
      '',
      'قواعد:',
      ...(ac.rules || []).map((r) => `- ${r}`),
      '',
      'نمونه:',
      ac.example,
    ].join('\n'));
  }

  return sections.join('\n\n');
}

module.exports = {
  buildSystemPrompt,
  buildUserContext,
  formatCandidates,
  SEX_FA,
  ACTIVITY_FA,
  GOAL_FA,
  MEAL_FA,
  GOAL_KIND_FA,
};
