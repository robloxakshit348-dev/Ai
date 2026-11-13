'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { chat, extractText, cleanFallback } = require('../ai');
const { createLimiter } = require('../limits');

function mock(handler) {
  return new Promise(resolve => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', d => (b += d));
      req.on('end', () => {
        const body = JSON.parse(b); calls.push({ body, auth: req.headers.authorization });
        const r = handler(body, req.headers.authorization, calls.length);
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.json));
      });
    });
    srv.listen(0, () => resolve({ srv, calls, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}
const ok = (text, model = 'm') => ({ json: { model, choices: [{ message: { content: text } }] } });
const cfg = (url, keys = ['k1']) => ({ keys, baseUrl: url, maxTokens: 100, timeoutMs: 5000, totalBudgetMs: 20000, appName: 'T', appUrl: '' });
const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];

test('extractText handles strings and content parts', () => {
  assert.strictEqual(extractText({ choices: [{ message: { content: ' hi ' } }] }), 'hi');
  assert.strictEqual(extractText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.strictEqual(extractText({}), '');
});

test('returns answer from first model', async () => {
  const m = await mock(() => ok('hello'));
  const r = await chat(cfg(m.url), ['a:free'], msgs);
  assert.strictEqual(r.text, 'hello'); assert.strictEqual(m.calls[0].auth, 'Bearer k1'); m.srv.close();
});

test('falls back to the next model on server error and on empty content', async () => {
  const m = await mock((b, a, n) => n === 1 ? { status: 500, json: { error: { message: 'boom' } } } : n === 2 ? ok('') : ok('third'));
  const r = await chat(cfg(m.url), ['a:free', 'b:free', 'openrouter/free'], msgs);
  assert.strictEqual(r.text, 'third'); assert.deepStrictEqual(m.calls.map(c => c.body.model), ['a:free', 'b:free', 'openrouter/free']); m.srv.close();
});

test('rotates to the next API key when credits run out (402)', async () => {
  const m = await mock((b, auth) => auth === 'Bearer k1' ? { status: 402, json: { error: { message: 'no credits' } } } : ok('from k2'));
  const r = await chat(cfg(m.url, ['k1', 'k2']), ['a:free'], msgs);
  assert.strictEqual(r.text, 'from k2'); m.srv.close();
});

test('retries with merged system prompt when the model rejects system role', async () => {
  const m = await mock(b => b.messages[0].role === 'system' ? { status: 400, json: { error: { message: 'Developer instruction is not enabled' } } } : ok('merged ok'));
  const r = await chat(cfg(m.url), ['a:free'], msgs);
  assert.strictEqual(r.text, 'merged ok'); assert.strictEqual(m.calls[1].body.messages[0].content, 'sys\n\nhi'); m.srv.close();
});

test('friendly errors for rate limit, bad key, no key', async () => {
  let m = await mock(() => ({ status: 429, json: { error: { message: 'rate' } } }));
  await assert.rejects(chat(cfg(m.url), ['a:free'], msgs), e => e.status === 429 && /busy/.test(e.message)); m.srv.close();
  m = await mock(() => ({ status: 401, json: { error: { message: 'bad' } } }));
  await assert.rejects(chat(cfg(m.url), ['a:free'], msgs), e => /rejected the API key/.test(e.message)); m.srv.close();
  await assert.rejects(chat(cfg('http://x', []), ['a'], msgs), e => e.status === 503);
});

test('limiter enforces daily cap and cooldown', () => {
  const l = createLimiter({ daily: 2, cooldownMs: 0 });
  assert.ok(l.check('ip').ok); l.record('ip'); assert.ok(l.check('ip').ok); l.record('ip');
  const r = l.check('ip'); assert.strictEqual(r.ok, false); assert.strictEqual(l.remaining('ip'), 0); assert.strictEqual(l.remaining('other'), 2);
  const c = createLimiter({ daily: 5, cooldownMs: 10000 }); assert.ok(c.check('x').ok); assert.strictEqual(c.check('x').ok, false);
});

test('keyless fallback answers when OpenRouter credits are out, and with no key at all', async () => {
  const or = await mock(() => ({ status: 402, json: { error: { message: 'no credits' } } }));
  const fb = await mock(() => ok('backup answer\n\n---\n**Powered by Pollinations.AI free text APIs. Support our mission**'));
  const c = Object.assign(cfg(or.url), { fallback: { enabled: true, url: fb.url, model: 'openai' } });
  let r = await chat(c, ['a:free'], msgs);
  assert.strictEqual(r.text, 'backup answer'); assert.strictEqual(r.fallback, true); assert.strictEqual(fb.calls[0].auth, undefined);
  r = await chat(Object.assign(cfg(or.url, []), { fallback: c.fallback }), ['a:free'], msgs);
  assert.strictEqual(r.fallback, true); assert.strictEqual(or.calls.length, 1); // no OpenRouter call without a key
  await assert.rejects(chat(Object.assign(cfg(or.url, []), { fallback: { enabled: false } }), ['a'], msgs), e => e.status === 503);
  or.srv.close(); fb.srv.close();
});

test('fallback failure gives a friendly message', async () => {
  const fb = await mock(() => ({ status: 429, json: { error: { message: 'slow down' } } }));
  await assert.rejects(chat(Object.assign(cfg('http://x', []), { fallback: { enabled: true, url: fb.url, model: 'openai' } }), ['a'], msgs), e => e.status === 429 && /busy/.test(e.message));
  fb.srv.close(); assert.strictEqual(cleanFallback('hi'), 'hi');
});
