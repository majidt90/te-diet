'use strict';
/**
 * آزمون کلاینت AI در برابر یک سرویس ساختگیِ سازگار با OpenAI که روی
 * localhost بالا می‌آید. هدف: اجرای مسیر واقعی کد (SSE، خطاها، timeout).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createAIClient, endpointFor, estimateTokens } = require('../lib/ai.js');

const AI = {
  base_url: '', // در هر تست پر می‌شود
  api_key: 'test-key',
  model: 'test-model',
  temperature: 0.5,
  max_tokens: 1024,
  stream: true,
  request_timeout_ms: 5000,
};

/** سرور ساختگی با رفتار قابل تنظیم. */
function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch { /* ignore */ }
        handler(req, res, parsed);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

test('endpointFor آدرس را درست می‌سازد', () => {
  assert.equal(endpointFor('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.equal(endpointFor('https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions');
  assert.equal(endpointFor('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  // اگر کاربر آدرس کامل داده، تکراری اضافه نشود
  assert.equal(endpointFor('https://x.com/v1/chat/completions'), 'https://x.com/v1/chat/completions');
  assert.equal(endpointFor(''), null);
});

test('برآورد توکن', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('سلام دنیا') > 0);
  assert.ok(estimateTokens('a'.repeat(260)) === 100);
});

test('پاسخ جریانی (SSE) قطعه‌قطعه دریافت می‌شود', async () => {
  const mock = await startMockServer((req, res, body) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(body.stream, true);
    assert.equal(body.model, 'test-model');

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'سلام' } }] });
    sse(res, { choices: [{ delta: { content: ' ' } }] });
    sse(res, { choices: [{ delta: { content: 'دوست من' } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 42 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  const client = createAIClient();
  const deltas = [];
  const out = await client.chat({
    messages: [{ role: 'user', content: 'سلام' }],
    ai: { ...AI, base_url: mock.baseUrl },
    onDelta: (d) => deltas.push(d),
  });

  assert.equal(out.text, 'سلام دوست من');
  assert.deepEqual(deltas, ['سلام', ' ', 'دوست من']);
  assert.equal(out.finishReason, 'stop');
  assert.equal(out.usage.total_tokens, 42);
  assert.equal(out.streamed, true);
  await mock.close();
});

test('پاسخ غیرجریانی هم کار می‌کند', async () => {
  const mock = await startMockServer((req, res, body) => {
    assert.equal(body.stream, false);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'پاسخ کامل' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });

  const client = createAIClient();
  const out = await client.chat({
    messages: [{ role: 'user', content: 'سلام' }],
    ai: { ...AI, base_url: mock.baseUrl, stream: false },
  });
  assert.equal(out.text, 'پاسخ کامل');
  assert.equal(out.streamed, false);
  assert.equal(out.usage.total_tokens, 15);
  await mock.close();
});

test('بلوک action در خروجی مدل سالم می‌ماند', async () => {
  const payload = '```action\n{"type":"log_water","payload":{"amount_ml":250}}\n```';
  const mock = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'ثبت شد! ' } }] });
    sse(res, { choices: [{ delta: { content: payload } }] });
    sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const client = createAIClient();
  const out = await client.chat({
    messages: [{ role: 'user', content: 'یک لیوان آب خوردم' }],
    ai: { ...AI, base_url: mock.baseUrl },
  });
  assert.ok(out.text.includes('```action'));
  assert.ok(out.text.includes('log_water'));
  await mock.close();
});

test('خطاهای HTTP به پیام فارسی تبدیل می‌شوند', async () => {
  const cases = [
    [401, /کلید دسترسی پذیرفته نشد/],
    [404, /پیدا نشد/],
    [429, /محدودیت تعداد درخواست/],
    [500, /پاسخ نداد/],
  ];
  for (const [code, pattern] of cases) {
    const mock = await startMockServer((req, res) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'boom' } }));
    });
    const client = createAIClient();
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'x' }], ai: { ...AI, base_url: mock.baseUrl } }),
      (err) => {
        assert.match(err.friendly, pattern, `برای کد ${code} پیام درست نبود: ${err.friendly}`);
        assert.equal(err.status, code);
        return true;
      }
    );
    await mock.close();
  }
});

test('تنظیمات ناقص بدون تماس شبکه خطای فارسی می‌دهد', async () => {
  const client = createAIClient();
  for (const bad of [{ ...AI, api_key: '' }, { ...AI, base_url: '' }, { ...AI, model: '' }]) {
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'x' }], ai: bad }),
      (err) => {
        assert.match(err.friendly, /تنظیمات هوش مصنوعی کامل نیست/);
        return true;
      }
    );
  }
});

test('اندپوینت ناموجود و قطعی اتصال پیام روشن می‌دهد', async () => {
  const client = createAIClient();
  await assert.rejects(
    () => client.chat({ messages: [{ role: 'user', content: 'x' }], ai: { ...AI, base_url: 'http://127.0.0.1:9/v1' } }),
    (err) => {
      assert.ok(err.friendly && err.friendly.length > 10, 'پیام فارسی تولید نشد');
      return true;
    }
  );
});

test('اتمام مهلت (timeout) پیام فارسی می‌دهد', async () => {
  const mock = await startMockServer((req, res) => {
    // هیچ‌وقت پاسخ نمی‌دهد
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    setTimeout(() => res.end(), 4000);
  });
  const client = createAIClient();
  await assert.rejects(
    () => client.chat({
      messages: [{ role: 'user', content: 'x' }],
      ai: { ...AI, base_url: mock.baseUrl, request_timeout_ms: 300 },
    }),
    (err) => {
      assert.match(err.friendly, /به‌موقع نرسید/);
      return true;
    }
  );
  await mock.close();
});

test('لغو توسط کاربر جریان را متوقف می‌کند', async () => {
  const mock = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'قسمت اول' } }] });
    const t = setInterval(() => sse(res, { choices: [{ delta: { content: '...' } }] }), 20);
    res.on('close', () => clearInterval(t));
  });
  const client = createAIClient();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 120);
  await assert.rejects(
    () => client.chat({
      messages: [{ role: 'user', content: 'x' }],
      ai: { ...AI, base_url: mock.baseUrl, request_timeout_ms: 10000 },
      signal: ac.signal,
    }),
    (err) => err.name === 'AbortError' || /لغو|aborted/i.test(err.message)
  );
  await mock.close();
});

test('trimHistory پیام سیستم و آخرین پیام کاربر را نگه می‌دارد', () => {
  const client = createAIClient();
  const msgs = [
    { role: 'system', content: 'تو نیلا هستی.' },
    ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'پیام '.repeat(200) + i })),
  ];
  const trimmed = client.trimHistory(msgs, 1500);
  assert.equal(trimmed[0].role, 'system');
  assert.equal(trimmed[0].content, 'تو نیلا هستی.');
  assert.equal(trimmed[trimmed.length - 1].content, msgs[msgs.length - 1].content);
  assert.ok(trimmed.length < msgs.length, 'تاریخچه کوتاه نشد');
  // اولین پیام غیر سیستم نباید assistant باشد
  assert.equal(trimmed[1].role, 'user');
});

test('listModels فهرست مدل‌ها را برمی‌گرداند', async () => {
  const mock = await startMockServer((req, res) => {
    assert.equal(req.url, '/v1/models');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'zeta-model' }, { id: 'alpha-model' }] }));
  });
  const client = createAIClient();
  const models = await client.listModels({ ...AI, base_url: mock.baseUrl });
  assert.deepEqual(models, ['alpha-model', 'zeta-model']);
  await mock.close();
});

test('ping وضعیت اتصال را گزارش می‌کند', async () => {
  const mock = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
  });
  const client = createAIClient();
  const ok = await client.ping({ ...AI, base_url: mock.baseUrl });
  assert.equal(ok.ok, true);
  assert.equal(ok.sample, 'pong');

  await mock.close();
  const bad = await client.ping({ ...AI, base_url: 'http://127.0.0.1:9/v1' });
  assert.equal(bad.ok, false);
  assert.ok(bad.error.length > 5);
});
