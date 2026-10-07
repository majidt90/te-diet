#!/usr/bin/env node
/**
 * postinstall — بازسازی ماژول بومی better-sqlite3 برای ABI الکترون.
 *
 * چرا یک اسکریپت جدا به‌جای فراخوانی مستقیم electron-rebuild؟
 * better-sqlite3 یک ماژول بومی (native) است و باینری آن باید با نسخهٔ Nodeِ
 * داخل الکترون کامپایل شود، نه Nodeِ سیستم. اگر این مرحله ناموفق باشد
 * (مثلاً در CI بدون دسترسی به سرور هدرها)، نصب کل پروژه نباید شکست بخورد؛
 * چون برای ساخت نسخهٔ نهایی، خود electron-builder دوباره این کار را انجام
 * می‌دهد. پس خطا را به یک هشدار روشن تبدیل می‌کنیم.
 */
const { spawn } = require('node:child_process');

const banner = (t) => console.log(`\n\x1b[36m[postinstall]\x1b[0m ${t}`);

const child = spawn(
  process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild',
  ['-f', '-w', 'better-sqlite3'],
  { stdio: 'inherit', shell: process.platform === 'win32' }
);

child.on('error', (err) => {
  banner(`اجرای electron-rebuild ممکن نشد: ${err.message}`);
  banner('برای اجرای حالت توسعه، دستور «npm run rebuild» را دستی اجرا کنید.');
  process.exit(0);
});

child.on('close', (code) => {
  if (code !== 0) {
    banner('بازسازی better-sqlite3 برای الکترون ناموفق بود.');
    banner('این فقط روی «npm start» در حالت توسعه اثر دارد؛ ساخت نسخهٔ نهایی (npm run dist) خودش آن را انجام می‌دهد.');
    banner('در صورت نیاز دستی اجرا کنید: npm run rebuild');
  }
  process.exit(0);
});
