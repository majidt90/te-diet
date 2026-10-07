/* global window */
/**
 * renderer/js/chat.js — رابط گفت‌وگو.
 *
 * امنیت رندر: متن مدل «هرگز» مستقیم داخل innerHTML نمی‌رود.
 * ابتدا همهٔ نویسه‌های HTML فرار (escape) می‌شوند و بعد زیرمجموعهٔ
 * کوچکی از Markdown روی متنِ امن اعمال می‌شود.
 */
(function () {
  'use strict';

  const J = window.Jalaali;
  const Store = window.Store;
  const AiClient = window.AiClient;

  let persona = null;
  let emptyPromptsShown = false;

  function el(id) { return document.getElementById(id); }

  // —————————————————— Markdown امن ——————————————————

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** تبدیل Markdown محدود به HTML — ورودی باید قبلاً escape شده باشد. */
  function mdToHtml(escaped) {
    const blocks = [];

    // ۱) بلوک‌های کد را بیرون می‌کشیم تا از پردازش بعدی محفوظ بمانند
    let text = escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const i = blocks.length;
      blocks.push(`<pre class="code-block"><code data-lang="${lang || ''}">${code.replace(/\n$/, '')}</code></pre>`);
      return `\u0000B${i}\u0000`;
    });

    // ۲) جدول‌ها
    text = text.replace(/(^|\n)((?:\|.+\|[ \t]*\n)(?:\|[\s:|-]+\|[ \t]*\n)((?:\|.+\|[ \t]*(?:\n|$))+))/g,
      (whole, pre, table) => {
        const lines = table.trim().split('\n');
        if (lines.length < 2) return whole;
        const headCells = splitRow(lines[0]);
        const bodyRows = lines.slice(2).map(splitRow);
        const html = [
          '<table><thead><tr>',
          ...headCells.map((c) => `<th>${inline(c.trim())}</th>`),
          '</tr></thead><tbody>',
          ...bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`),
          '</tbody></table>',
        ].join('');
        const i = blocks.length;
        blocks.push(html);
        return `${pre}\u0000B${i}\u0000`;
      });

    // ۳) پردازش خط‌به‌خط
    const lines = text.split('\n');
    const out = [];
    let listType = null;   // 'ul' | 'ol'
    let para = [];

    const flushPara = () => {
      if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    };
    const closeList = () => {
      if (listType) { out.push(`</${listType}>`); listType = null; }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, '');
      if (!line.trim()) { flushPara(); closeList(); continue; }

      // خط جداکننده
      if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }

      // سرتیتر
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        flushPara(); closeList();
        const level = Math.min(4, h[1].length + 1); // h2..h5 تا از h1 صفحه بزرگ‌تر نشود
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        continue;
      }

      // نقل‌قول
      const bq = /^&gt;\s?(.*)$/.exec(line);
      if (bq) { flushPara(); closeList(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue; }

      // فهرست بی‌ترتیب
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (ul) {
        flushPara();
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push(`<li>${inline(ul[1])}</li>`);
        continue;
      }

      // فهرست با ترتیب (ارقام فارسی هم پذیرفته می‌شود)
      const ol = /^\s*([0-9۰-۹]+)[.)]\s+(.*)$/.exec(line);
      if (ol) {
        flushPara();
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push(`<li>${inline(ol[2])}</li>`);
        continue;
      }

      closeList();
      para.push(line.trim());
    }
    flushPara();
    closeList();

    let html = out.join('\n');

    // ۴) بازگرداندن بلوک‌ها
    html = html.replace(/\u0000B(\d+)\u0000/g, (_m, i) => blocks[Number(i)] || '');
    return html;
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  }

  /** قالب‌بندی درون‌خطی روی متن escape‌شده. */
  function inline(s) {
    return String(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  /** رندر امن متن مدل. */
  function renderMarkdown(text) {
    return mdToHtml(escapeHtml(text));
  }

  // —————————————————— اجزای پیام ——————————————————

  function avatarFor(role) {
    if (role === 'user') return '🧑';
    return persona?.emoji || '🌿';
  }

  function nameFor(role) {
    return role === 'user' ? 'شما' : (persona?.name || 'دستیار');
  }

  function messageNode({ role, content, results, status, created_at }) {
    const wrap = document.createElement('article');
    wrap.className = `msg msg--${role}${status === 'error' ? ' msg--error' : ''}`;

    const av = document.createElement('div');
    av.className = 'msg__avatar';
    av.textContent = status === 'error' ? '⚠️' : avatarFor(role);
    av.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'msg__body';

    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    const name = document.createElement('span');
    name.textContent = nameFor(role);
    meta.append(name);
    if (created_at) {
      const time = document.createElement('span');
      time.textContent = J.toPersianDigits(new Date(created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
      meta.append(time);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';
    bubble.innerHTML = renderMarkdown(content || '');

    body.append(meta, bubble);

    if (results && results.length) {
      const cards = document.createElement('div');
      cards.className = 'action-cards';
      for (const r of results) cards.append(actionCard(r));
      body.append(cards);
    }

    wrap.append(av, body);
    return { wrap, bubble };
  }

  const ACTION_ICONS = {
    log_meal: '🍽️', log_workout: '🏋️', log_weight: '⚖️', log_water: '💧',
    log_sleep: '😴', set_goal: '🎯', update_profile: '👤',
  };

  function actionCard(r) {
    const d = document.createElement('div');
    d.className = `action-card${r.ok ? '' : ' action-card--fail'}`;

    const icon = document.createElement('div');
    icon.className = 'action-card__icon';
    icon.textContent = r.ok ? (ACTION_ICONS[r.type] || '✅') : '⚠️';
    icon.setAttribute('aria-hidden', 'true');

    const box = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'action-card__title';
    title.textContent = r.title || (r.ok ? 'ثبت شد' : 'ثبت ناموفق');
    const msg = document.createElement('p');
    msg.className = 'action-card__msg';
    msg.textContent = r.message || '';
    box.append(title, msg);

    d.append(icon, box);
    return d;
  }

  // —————————————————— مدیریت گفت‌وگو ——————————————————

  function scrollDown(force) {
    const sc = el('chatScroll');
    if (!sc) return;
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
    if (force || nearBottom) sc.scrollTop = sc.scrollHeight;
  }

  function setEmpty(visible) {
    const e = el('chatEmpty');
    if (e) e.style.display = visible ? '' : 'none';
  }

  function addUserMessage(text) {
    setEmpty(false);
    const { wrap } = messageNode({ role: 'user', content: text, created_at: new Date().toISOString() });
    el('chatMessages').append(wrap);
    scrollDown(true);
  }

  /** حباب در حال جریان را می‌سازد و تابع به‌روزرسانی برمی‌گرداند. */
  function startAssistantBubble() {
    setEmpty(false);
    const { wrap, bubble } = messageNode({ role: 'assistant', content: '', created_at: new Date().toISOString() });
    bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    el('chatMessages').append(wrap);
    scrollDown(true);

    let started = false;
    return {
      wrap,
      update(full) {
        if (!started) { started = true; bubble.textContent = ''; }
        bubble.innerHTML = renderMarkdown(full) + '<span class="cursor-blink"></span>';
        scrollDown(false);
      },
      finish(full, results, isError, errorMessage) {
        if (isError) {
          wrap.classList.add('msg--error');
          bubble.innerHTML = renderMarkdown(errorMessage || 'خطا');
        } else {
          bubble.innerHTML = renderMarkdown(full || '_(پاسخی دریافت نشد)_');
        }
        if (results && results.length) {
          const cards = document.createElement('div');
          cards.className = 'action-cards';
          for (const r of results) cards.append(actionCard(r));
          wrap.querySelector('.msg__body').append(cards);
        }
        scrollDown(false);
      },
    };
  }

  function setBusy(busy) {
    const send = el('sendBtn');
    const stop = el('stopBtn');
    const input = el('composerInput');
    if (send) send.disabled = busy;
    if (stop) stop.hidden = !busy;
    if (input) input.disabled = busy;
    if (!busy && input) input.focus();
  }

  function renderChips(chips) {
    const box = el('quickChips');
    if (!box) return;
    box.textContent = '';
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'prompt-chip';
      b.textContent = c.label;
      b.addEventListener('click', () => {
        el('composerInput').value = c.text;
        submit();
      });
      box.append(b);
    }
  }

  async function updateChipsFor(text) {
    if (!text.trim()) { renderChips([]); return; }
    const a = await Store.run('nlp:chips', () => window.teDiet.nlp.analyze(text), { silent: true, fallback: null });
    if (!a) return;
    renderChips(window.Nlp.quickActions(a));
  }

  // —————————————————— ارسال ——————————————————

  let currentBubble = null;

  async function submit() {
    const input = el('composerInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    renderChips([]);

    addUserMessage(text);
    setBusy(true);
    currentBubble = startAssistantBubble();

    const res = await AiClient.send(text);
    // اگر پاسخ از مسیر رویداد (chat:done) آمده باشد، قبلاً تمام شده
    if (!res && !AiClient.busy && currentBubble) {
      currentBubble.finish('', null, true, 'ارتباط با سرویس برقرار نشد.');
      setBusy(false);
    }
  }

  function autoGrow() {
    const t = el('composerInput');
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  }

  // —————————————————— بارگذاری گفت‌وگو ——————————————————

  async function loadConversation(id) {
    const box = el('chatMessages');
    box.textContent = '';
    AiClient.conversationId = id;
    if (!id) { setEmpty(true); return; }

    const msgs = await Store.run('chat:history', () => Store.messages(id, 200), { fallback: [] });
    if (!msgs.length) { setEmpty(true); return; }
    setEmpty(false);
    for (const m of msgs) {
      if (m.status === 'streaming' && !m.content) continue; // پیام ناتمامِ باقی‌مانده
      const { wrap } = messageNode({
        role: m.role,
        content: m.content,
        results: m.action || null,
        status: m.status,
        created_at: m.created_at,
      });
      box.append(wrap);
    }
    scrollDown(true);
  }

  async function newConversation() {
    const conv = await Store.run('chat:new', () => Store.createConversation({}), { fallback: null });
    if (conv) await loadConversation(conv.id);
    el('chatMessages').textContent = '';
    setEmpty(true);
  }

  // —————————————————— راه‌اندازی ——————————————————

  function setPersona(p) {
    persona = p;
    const mark = el('emptyMark');
    const title = el('emptyTitle');
    if (mark && p?.emoji) mark.textContent = p.emoji;
    if (title && p?.name) title.textContent = `سلام! من ${p.name} هستم.`;
    if (p?.accent) {
      document.documentElement.style.setProperty('--accent', p.accent);
      document.documentElement.style.setProperty('--accent-soft', `rgba(${hexRgb(p.accent)}, 0.14)`);
    }
  }

  function hexRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '63, 191, 143';
  }

  async function showSamplePrompts(prompts) {
    const box = el('emptyPrompts');
    if (!box || emptyPromptsShown) return;
    emptyPromptsShown = true;
    box.textContent = '';
    for (const p of prompts || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'prompt-chip';
      b.textContent = p;
      b.addEventListener('click', () => {
        el('composerInput').value = p;
        submit();
      });
      box.append(b);
    }
  }

  function init(p) {
    if (p) setPersona(p);

    // سیم‌کشی رویدادهای جریانی
    AiClient.setHandlers({
      onStart() { setBusy(true); },
      onDelta(_delta, full, messageId) {
        AiClient.streamingMessageId = messageId;
        if (currentBubble) currentBubble.update(full);
      },
      onDone(payload) {
        if (currentBubble) currentBubble.finish(payload.content, payload.results, false);
        currentBubble = null;
        setBusy(false);
        document.dispatchEvent(new CustomEvent('data-changed', { detail: payload }));
      },
      onError(message) {
        if (currentBubble) currentBubble.finish('', null, true, message);
        currentBubble = null;
        setBusy(false);
        Store.toast(message || 'خطا در دریافت پاسخ.', 'bad', 4500);
      },
      onCancelled(payload) {
        if (currentBubble) currentBubble.finish(payload?.content || '_(متوقف شد)_', null, false);
        currentBubble = null;
        setBusy(false);
        Store.toast('پاسخ متوقف شد.', 'ok');
      },
      onNeedSetup(message) {
        Store.toast(message, 'bad', 5000);
      },
    });
    AiClient.wire();

    // فرم ورودی
    const form = el('composerForm');
    const input = el('composerInput');
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });

    let chipTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(chipTimer);
      chipTimer = setTimeout(() => updateChipsFor(input.value), 280);
    });

    const stopBtn = el('stopBtn');
    if (stopBtn) stopBtn.addEventListener('click', () => AiClient.stop());

    const newBtn = el('newChatBtn');
    if (newBtn) newBtn.addEventListener('click', () => newConversation());

    Store.on('app:newConversation', () => newConversation());
  }

  window.Chat = {
    init,
    setPersona,
    loadConversation,
    newConversation,
    showSamplePrompts,
    renderMarkdown,
    escapeHtml,
  };
})();
