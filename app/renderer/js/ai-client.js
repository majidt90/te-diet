/* global window */
/**
 * renderer/js/ai-client.js — سمت کاربرِ گفت‌وگو.
 *
 * درخواست واقعی در فرآیند main انجام می‌شود (lib/ai.js). این ماژول فقط:
 *  - پیام را می‌فرستد
 *  - قطعه‌های جریانی را از رویداد chat:delta می‌گیرد و به UI می‌دهد
 *  - لغو، خطا و پایان را مدیریت می‌کند
 */
(function () {
  'use strict';

  const Store = window.Store;

  const state = {
    conversationId: null,
    streamingMessageId: null,
    busy: false,
    /** تابع‌های اطلاع‌رسانی که توسط chat.js تنظیم می‌شوند */
    onStart: null,
    onDelta: null,
    onDone: null,
    onError: null,
    onCancelled: null,
  };

  const offs = [];

  function wire() {
    offs.push(Store.on('chat:delta', (p) => {
      if (state.streamingMessageId && p.message_id !== state.streamingMessageId) return;
      if (state.onDelta) state.onDelta(p.delta, p.full, p.message_id);
    }));

    offs.push(Store.on('chat:done', (p) => {
      state.busy = false;
      if (state.onDone) state.onDone(p);
    }));

    offs.push(Store.on('chat:error', (p) => {
      state.busy = false;
      if (state.onError) state.onError(p.message, p);
    }));

    offs.push(Store.on('chat:cancelled', (p) => {
      state.busy = false;
      if (state.onCancelled) state.onCancelled(p);
    }));
  }

  function unwire() {
    offs.forEach((off) => { try { off(); } catch { /* ignore */ } });
    offs.length = 0;
  }

  /**
   * ارسال پیام.
   * @returns {Promise<object|null>} نتیجهٔ نهایی یا null اگر خطا/لغو رخ داد
   */
  async function send(text, opts = {}) {
    if (state.busy) {
      Store.toast('پاسخ قبلی هنوز در جریان است. ابتدا آن را متوقف کنید.', 'bad');
      return null;
    }
    const t = String(text || '').trim();
    if (!t) return null;

    state.busy = true;
    state.streamingMessageId = null;
    if (state.onStart) state.onStart(t);

    try {
      const res = await Store.run('chat:send', () => window.teDiet.chat.send({
        text: t,
        conversation_id: opts.conversationId || state.conversationId || null,
      }), { silent: true });

      if (!res || res.ok !== true) {
        state.busy = false;
        const message = (res && res.error) || 'ارسال پیام ناموفق بود.';
        if (res && res.needSetup && state.onNeedSetup) state.onNeedSetup(message);
        if (state.onError) state.onError(message, res);
        return null;
      }

      state.conversationId = res.data.conversation_id;
      state.busy = false;
      return res.data;
    } catch (err) {
      state.busy = false;
      if (state.onError) state.onError(err.message, null);
      return null;
    }
  }

  async function stop() {
    try {
      await window.teDiet.chat.stop(state.streamingMessageId || undefined);
    } catch (err) {
      console.error('لغو ناموفق:', err);
    }
  }

  window.AiClient = {
    wire,
    unwire,
    send,
    stop,
    get busy() { return state.busy; },
    get conversationId() { return state.conversationId; },
    set conversationId(v) { state.conversationId = v; },
    get streamingMessageId() { return state.streamingMessageId; },
    set streamingMessageId(v) { state.streamingMessageId = v; },
    setHandlers(handlers) { Object.assign(state, handlers); },
  };
})();
