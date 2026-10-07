'use strict';
/**
 * lib/ai.js — کلاینت عمومی برای هر سرویس سازگار با OpenAI.
 *
 * تصمیم معماری: تماس شبکه از فرآیند main انجام می‌شود، نه renderer.
 *   - کلید API هرگز وارد حافظهٔ renderer نمی‌شود.
 *   - مشکل CORS وجود ندارد.
 *   - تنظیم پروکسی سیستم به‌صورت خودکار اعمال می‌شود.
 *
 * سازگاری: فقط به POST {base_url}/chat/completions نیاز داریم؛ همین یک
 * نقطه اشتراک همهٔ سرویس‌های OpenAI-compatible است (OpenAI، OpenRouter،
 * Together، Groq، DeepInfra، Ollama، LM Studio، vLLM و …).
 */
const J = require('./jalaali.js');

/** خطاهای شناخته‌شده را به پیام فارسی قابل‌فهم تبدیل می‌کند. */
function humanizeError(err, ctx = {}) {
  const status = err.status;
  if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
    return 'پاسخ سرویس هوش مصنوعی به‌موقع نرسید (اتمام مهلت). اتصال اینترنت یا مقدار timeout را بررسی کنید.';
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return 'آدرس سرویس پیدا نشد. base_url را در تنظیمات بررسی کنید و از اتصال اینترنت مطمئن شوید.';
  }
  if (err.code === 'ECONNREFUSED') {
    return 'اتصال به سرویس رد شد. اگر از سرویس محلی (مثل Ollama یا LM Studio) استفاده می‌کنید، مطمئن شوید در حال اجراست.';
  }
  if (err.code === 'ECONNRESET' || err.code === 'UND_ERR_SOCKET') {
    return 'اتصال در میانهٔ گفت‌وگو قطع شد. دوباره تلاش کنید.';
  }
  if (err.cause && !status) {
    const c = err.cause;
    if (c.code === 'ENOTFOUND') return 'آدرس سرویس پیدا نشد. base_url را در تنظیمات بررسی کنید.';
    if (c.code === 'ECONNREFUSED') return 'اتصال به سرویس رد شد؛ سرویس در حال اجرا نیست یا آدرس اشتباه است.';
    if (c.code === 'CERT_HAS_EXPIRED' || String(c.code).startsWith('UNABLE_TO_VERIFY') || c.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
      return 'گواهی امنیتی سرویس معتبر نیست. اگر از سرویس داخلی استفاده می‌کنید، گواهی آن را نصب کنید.';
    }
  }
  if (status === 401 || status === 403) {
    return 'کلید دسترسی پذیرفته نشد (خطای ۴۰۱). api_key را در تنظیمات بررسی کنید.';
  }
  if (status === 404) {
    return 'مسیر یا مدل پیدا نشد (خطای ۴۰۴). معمولاً یعنی base_url باید به /v1 ختم شود یا نام model اشتباه است.';
  }
  if (status === 413) {
    return 'درخواست خیلی بزرگ بود (خطای ۴۱۳). تاریخچهٔ گفت‌وگو را کوتاه کنید یا max_tokens را کاهش دهید.';
  }
  if (status === 429) {
    return 'به محدودیت تعداد درخواست رسیده‌اید (خطای ۴۲۹). کمی صبر کنید یا سهمیهٔ سرویس را بررسی کنید.';
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return `سرویس هوش مصنوعی پاسخ نداد (خطای ${J.toPersianDigits(status)}). احتمالاً مشکل از سمت ارائه‌دهنده است؛ چند لحظه بعد دوباره تلاش کنید.`;
  }
  if (status) {
    return `سرویس خطا برگرداند (کد ${J.toPersianDigits(status)}).${err.body ? ` جزئیات: ${String(err.body).slice(0, 300)}` : ''}`;
  }
  if (ctx.notConfigured) {
    return 'تنظیمات هوش مصنوعی کامل نیست. از منوی «تنظیمات» آدرس سرویس، کلید دسترسی و نام مدل را وارد کنید.';
  }
  return `خطای ناشناخته در ارتباط با سرویس هوش مصنوعی: ${err.message || err}`;
}

/** آدرس کامل chat/completions را از base_url می‌سازد. */
function endpointFor(baseUrl, path = '/chat/completions') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  // اگر کاربر آدرس کامل را داده، دست نمی‌زنیم
  if (base.endsWith(path)) return base;
  return `${base}${path}`;
}

/** برآورد تقریبی تعداد توکن (برای کوتاه کردن تاریخچه). */
function estimateTokens(text) {
  if (!text) return 0;
  // فارسی تراکم توکن بیشتری دارد؛ ضریب بالاتر در نظر می‌گیریم
  return Math.ceil(String(text).length / 2.6);
}

/**
 * @param {object} opts
 * @param {Function} [opts.fetchImpl] برای تست؛ پیش‌فرض global fetch
 * @param {Function} [opts.log]
 */
function createAIClient(opts = {}) {
  const fetchImpl = opts.fetchImpl || ((url, init) => globalThis.fetch(url, init));
  const log = opts.log || (() => {});

  /** استخراج پیام خطای سرویس از بدنهٔ JSON پاسخ. */
  async function readErrorBody(res) {
    try {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        return j?.error?.message || j?.message || j?.detail || txt.slice(0, 400);
      } catch {
        return txt.slice(0, 400);
      }
    } catch {
      return '';
    }
  }

  /** پارس جریان SSE و فراخوانی onDelta برای هر قطعهٔ متن. */
  async function readStream(res, onDelta, signal) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let text = '';
    let usage = null;
    let finishReason = null;

    while (true) {
      if (signal?.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        try { await reader.cancel(); } catch { /* ignore */ }
        throw e;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.replace(/\r$/, '').trim();
        if (!line || line.startsWith(':')) continue; // دیدگاه/کامنت SSE
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return { text, usage, finishReason };

        let json;
        try {
          json = JSON.parse(data);
        } catch {
          log('قطعهٔ SSE غیرقابل تجزیه نادیده گرفته شد');
          continue;
        }
        if (json.usage) usage = json.usage;
        const choice = Array.isArray(json.choices) ? json.choices[0] : null;
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta?.content
          ?? choice.text
          ?? choice.message?.content
          ?? '';
        if (delta) {
          text += delta;
          if (onDelta) onDelta(delta, text);
        }
      }
    }
    return { text, usage, finishReason };
  }

  /**
   * ارسال گفت‌وگو.
   * @param {object} args
   * @param {Array<{role:string,content:string}>} args.messages
   * @param {object} args.ai بخش ai از config
   * @param {(delta:string, full:string)=>void} [args.onDelta]
   * @param {AbortSignal} [args.signal]
   */
  async function chat({ messages, ai, onDelta, signal }) {
    if (!ai || !ai.base_url || !ai.api_key || !ai.model) {
      const e = new Error('AI not configured');
      e.notConfigured = true;
      throw Object.assign(e, { friendly: humanizeError(e, { notConfigured: true }) });
    }

    const url = endpointFor(ai.base_url);
    if (!url) throw new Error('base_url نامعتبر است.');

    const useStream = ai.stream !== false;
    const body = {
      model: ai.model,
      messages,
      stream: useStream,
      ...(typeof ai.temperature === 'number' ? { temperature: ai.temperature } : {}),
      ...(typeof ai.max_tokens === 'number' && ai.max_tokens > 0 ? { max_tokens: ai.max_tokens } : {}),
      ...(useStream ? { stream_options: { include_usage: true } } : {}),
      ...(ai.extra_body && typeof ai.extra_body === 'object' ? ai.extra_body : {}),
    };

    const headers = {
      'Content-Type': 'application/json',
      Accept: useStream ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${ai.api_key}`,
      ...(ai.extra_headers && typeof ai.extra_headers === 'object' ? ai.extra_headers : {}),
    };

    const timeoutMs = Number(ai.request_timeout_ms) || 90000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // اگر سیگنال بیرونی هم داده شده، به آن گوش می‌دهیم
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      throw Object.assign(err, { friendly: humanizeError(err) });
    }

    if (!res.ok) {
      const detail = await readErrorBody(res);
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.body = detail;
      throw Object.assign(err, { friendly: humanizeError(err) });
    }

    try {
      if (useStream && res.body) {
        const out = await readStream(res, onDelta, controller.signal);
        return { ...out, streamed: true, url, model: ai.model };
      }
      const json = await res.json();
      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const text = choice?.message?.content ?? '';
      return {
        text,
        usage: json.usage || null,
        finishReason: choice?.finish_reason || null,
        streamed: false,
        url,
        model: ai.model,
      };
    } catch (err) {
      throw Object.assign(err, { friendly: humanizeError(err) });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  /**
   * تاریخچه را تا سقف توکن کوتاه می‌کند؛ همیشه پیام سیستم و آخرین پیام
   * کاربر نگه داشته می‌شوند.
   */
  function trimHistory(messages, maxTokens = 6000) {
    if (!Array.isArray(messages) || !messages.length) return [];
    const system = messages.filter((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');

    const budget = Math.max(800, maxTokens);
    let used = system.reduce((a, m) => a + estimateTokens(m.content), 0);
    const kept = [];
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      const t = estimateTokens(rest[i].content);
      if (used + t > budget) break;
      used += t;
      kept.unshift(rest[i]);
    }
    // آخرین پیام کاربر هرگز حذف نشود
    if (!kept.length && rest.length) kept.push(rest[rest.length - 1]);
    // تاریخچه باید با پیام کاربر شروع شود نه دستیار
    while (kept.length && kept[0].role === 'assistant') kept.shift();
    return [...system, ...kept];
  }

  /** فهرست مدل‌ها — برای صفحهٔ تنظیمات (بسیاری از سرویس‌ها پشتیبانی می‌کنند). */
  async function listModels(ai) {
    if (!ai?.base_url || !ai?.api_key) {
      const e = new Error('AI not configured');
      throw Object.assign(e, { friendly: humanizeError(e, { notConfigured: true }) });
    }
    const url = endpointFor(ai.base_url, '/models');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${ai.api_key}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await readErrorBody(res);
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.body = detail;
        throw Object.assign(err, { friendly: humanizeError(err) });
      }
      const json = await res.json();
      const data = Array.isArray(json) ? json : (json.data || json.models || []);
      return data
        .map((m) => (typeof m === 'string' ? m : (m.id || m.name || m.model)))
        .filter(Boolean)
        .sort((a, b) => String(a).localeCompare(String(b)));
    } catch (err) {
      throw Object.assign(err, { friendly: humanizeError(err) });
    } finally {
      clearTimeout(timer);
    }
  }

  /** پینگ سریع برای دکمهٔ «آزمایش اتصال». */
  async function ping(ai) {
    const started = Date.now();
    try {
      const out = await chat({
        messages: [{ role: 'user', content: 'ping' }],
        ai: { ...ai, stream: false, max_tokens: 5 },
      });
      return { ok: true, ms: Date.now() - started, model: out.model, sample: String(out.text).slice(0, 40) };
    } catch (err) {
      return { ok: false, ms: Date.now() - started, error: err.friendly || String(err.message) };
    }
  }

  return { chat, listModels, ping, trimHistory, estimateTokens, endpointFor, humanizeError };
}

module.exports = { createAIClient, endpointFor, estimateTokens, humanizeError };
