'use strict';
/**
 * main.js — فرآیند اصلی الکترون.
 *
 * مسئولیت‌ها:
 *  - ساخت پنجره با تنظیمات امن (contextIsolation, بدون nodeIntegration)
 *  - مالکیت SQLite و config.json (هیچ‌کدام در renderer نیست)
 *  - ثبت کانال‌های IPC
 *  - جلوگیری از ناوبری به دامنهٔ خارجی و باز شدن پنجرهٔ جدید
 */
const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { createConfigManager } = require('./lib/config.js');
const { createDatabase } = require('./lib/db.js');
const { createAIClient } = require('./lib/ai.js');
const { registerIpc } = require('./lib/ipc.js');

const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const isDev = process.argv.includes('--dev');

// —————————————————— لاگ ——————————————————
let logFile = null;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (isDev) console.log(line);
  try {
    if (logFile) fs.appendFileSync(logFile, line + '\n');
  } catch { /* لاگ نباید اپ را بخواباند */ }
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});

// —————————————————— تک‌نمونه بودن ——————————————————
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let config = null;
let repo = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'دستیار تغذیه و ورزش',
    backgroundColor: '#0f1419',
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // دسترسی به کلیپ‌بورد و ناوبری محدود است
    },
  });

  mainWindow.loadFile(path.join(APP_DIR, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // ——— سیاست‌های امنیتی ———
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; " +
          "img-src 'self' data: blob:; " +
          "connect-src 'self'; " +
          "object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
        ],
      },
    });
  });

  // ناوبری به بیرون ممنوع؛ لینک‌ها در مرورگر سیستم باز می‌شوند
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'پرونده',
      submenu: [
        {
          label: 'گفت‌وگوی جدید',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('app:newConversation'),
        },
        {
          label: 'باز کردن پوشهٔ داده‌ها',
          click: () => { if (config) shell.openPath(config.liveConfigPath().replace(/config\.json$/, '')); },
        },
        { type: 'separator' },
        { role: 'quit', label: 'خروج' },
      ],
    },
    {
      label: 'نمایش',
      submenu: [
        { role: 'reload', label: 'بارگذاری مجدد' },
        { role: 'toggleDevTools', label: 'ابزار توسعه‌دهنده' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'اندازهٔ پیش‌فرض' },
        { role: 'zoomIn', label: 'بزرگ‌نمایی' },
        { role: 'zoomOut', label: 'کوچک‌نمایی' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'تمام‌صفحه' },
      ],
    },
    {
      label: 'تنظیمات',
      submenu: [
        {
          label: 'تنظیمات هوش مصنوعی',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('app:openSettings'),
        },
      ],
    },
    {
      label: 'راهنما',
      submenu: [
        {
          label: 'دربارهٔ برنامه',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'دربارهٔ برنامه',
              message: 'دستیار تغذیه و ورزش',
              detail: [
                `نسخه ${app.getVersion()}`,
                '',
                'مشاور تغذیه و مربی ورزشی با رابط کاملاً فارسی،',
                'تقویم شمسی و ذخیره‌سازی محلی داده‌ها.',
                '',
                'این برنامه جایگزین پزشک یا متخصص تغذیه نیست.',
              ].join('\n'),
              buttons: ['باشه'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('ready', () => {
  const userDataDir = app.getPath('userData');
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    logFile = path.join(userDataDir, 'app.log');
  } catch { /* ignore */ }

  log(`راه‌اندازی — نسخه ${app.getVersion()} — userData: ${userDataDir}`);

  try {
    config = createConfigManager({
      userDataDir,
      bundledConfigPath: path.join(APP_DIR, 'config.json'),
    });
    const seeded = config.ensureSeeded();
    log(seeded.seeded ? 'config.json برای اولین بار ساخته شد.' : 'config.json موجود بارگذاری شد.');

    repo = createDatabase({
      file: path.join(userDataDir, 'te-diet.db'),
      dataDir: DATA_DIR,
      log,
    });
    const seed = repo.seedCatalogues();
    if (seed.updated.length) log(`فهرست‌ها بارگذاری شد: ${seed.updated.join(', ')}`);

    const ai = createAIClient({ log });

    let personalityCache = null;
    const loadPersonalityData = () => {
      if (!personalityCache) {
        personalityCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'personality.json'), 'utf8'));
      }
      return personalityCache;
    };
    const getPersonality = () => {
      const cfg = config.load();
      const wanted = cfg.user?.personality;
      const data = loadPersonalityData();
      const ids = data.personalities.map((p) => p.id);
      return ids.includes(wanted) ? wanted : (data.default || ids[0]);
    };

    // ترتیب مهم است: اول پنجره ساخته می‌شود، بعد IPC ثبت می‌شود.
    // چون ipc.js ارجاع win را یک‌بار از ctx می‌گیرد، اگر پنجره هنوز null
    // باشد رویدادهای جریانی (chat:delta) هرگز به renderer نمی‌رسند.
    buildMenu();
    createWindow();

    registerIpc({
      config,
      repo,
      ai,
      getPersonality,
      loadPersonalityData,
      win: mainWindow,
      log,
      appVersion: app.getVersion(),
      userDataDir,
      appDir: APP_DIR,
    });
  } catch (err) {
    log(`خطای راه‌اندازی: ${err.stack || err.message}`);
    dialog.showErrorBox(
      'خطا در راه‌اندازی برنامه',
      `برنامه نتوانست پایگاه‌داده یا تنظیمات را آماده کند.\n\n${err.message}\n\n` +
      `مسیر داده‌ها: ${userDataDir}`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try { repo?.close(); } catch { /* ignore */ }
});

// ارجاع زندهٔ پنجره برای IPC
Object.defineProperty(module.exports, 'mainWindow', { get: () => mainWindow });
