'use strict';
// OpenRouter client with free-model fallback and API-key rotation. Pure Node 18+ (global fetch).

class HttpError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

function extractText(data) {
  const m = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
  let c = m.content == null ? '' : m.content;
  if (Array.isArray(c)) c = c.map(p => (p && p.text) || '').join('');
  return typeof c === 'string' ? c.trim() : '';
}

async function callOnce({ url, key, appUrl, appName, payload, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { 'Content-Type': 'application/json' };
  if (key) { headers.Authorization = 'Bearer ' + key; headers['X-Title'] = appName || 'OmniAI'; if (appUrl) headers['HTTP-Referer'] = appUrl; }
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!res.ok) return { ok: false, code: res.status, error: (data && data.error && data.error.message) || 'OpenRouter returned HTTP ' + res.status };
    if (!data) return { ok: false, code: res.status, error: 'OpenRouter returned an unreadable response.' };
    if (data.error && data.error.message) return { ok: false, code: Number(data.error.code) || 502, error: String(data.error.message) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, code: 0, error: e.name === 'AbortError' ? 'The model took too long to answer.' : 'Could not reach the AI service: ' + e.message };
  } finally { clearTimeout(timer); }
}

/**
 * Try every model (in order) with every API key. A key is skipped on 401/402/429
 * (invalid / out of credits / rate-limited), so a spare key keeps the site working.
 */
async function chat(cfg, models, messages, extra = {}) {
  const fb = cfg.fallback && cfg.fallback.enabled && !extra.modalities ? cfg.fallback : null;
  if (!cfg.keys.length && !fb) throw new HttpError('The site owner has not added an OpenRouter API key yet.', 503);
  const start = Date.now();
  let lastError = 'No free model responded.', lastCode = 0, attempts = 0, authFailures = 0, keyAttempts = 0;
  for (const model of models) {
    for (const key of cfg.keys) {
      const left = cfg.totalBudgetMs - (Date.now() - start);
      if (attempts > 0 && left < 8000) return tryFallback();
      attempts++; keyAttempts++;
      const base = Object.assign({ model, messages, max_tokens: cfg.maxTokens, temperature: 0.7 }, extra);
      const opts = { url: cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', key, appUrl: cfg.appUrl, appName: cfg.appName, timeoutMs: Math.min(cfg.timeoutMs, Math.max(8000, left)) };
      let r = await callOnce(Object.assign({ payload: base }, opts));
      // Some free models reject a system role: retry once with it merged into the first user message.
      if (!r.ok && /system|developer|instruction/i.test(r.error) && messages[0] && messages[0].role === 'system' && messages[1]) {
        const merged = messages.slice(1).map(m => Object.assign({}, m));
        merged[0].content = messages[0].content + '\n\n' + merged[0].content;
        r = await callOnce(Object.assign({ payload: Object.assign({}, base, { messages: merged }) }, opts));
      }
      if (r.ok) {
        const text = extractText(r.data);
        if (text || extra.modalities) return { text, model: r.data.model || model, raw: r.data };
        lastError = 'The model returned an empty response.'; lastCode = 0; break; // try the next model
      }
      lastError = r.error; lastCode = r.code;
      if (r.code === 401 || r.code === 403) { authFailures++; continue; }
      if (r.code === 402 || r.code === 429) continue; // try the next key for this model
      break; // model-specific problem: go to the next model
    }
  }
  return tryFallback();

  // Last resort when OpenRouter is out of credits / rate-limited / has no key: a keyless public endpoint.
  async function tryFallback() {
    if (fb) {
      const payload = { model: fb.model, messages, max_tokens: Math.min(cfg.maxTokens, 2000), temperature: 0.7 };
      const r = await callOnce({ url: fb.url, key: '', payload, timeoutMs: Math.min(cfg.timeoutMs, Math.max(10000, cfg.totalBudgetMs - (Date.now() - start))) });
      if (r.ok) {
        const text = cleanFallback(extractText(r.data));
        if (text) return { text, model: 'backup-ai', raw: r.data, fallback: true };
      } else if (r.code === 429) { lastCode = 429; }
      if (!cfg.keys.length) throw new HttpError(r.code === 429 ? 'The free backup AI is busy right now. Please wait a moment and try again.' : 'The backup AI is unavailable right now. Please try again later.', r.code === 429 ? 429 : 502);
    }
    throw finish();
  }
  function finish() {
    if (authFailures && authFailures === keyAttempts) return new HttpError('OpenRouter rejected the API key. Check OPENROUTER_API_KEY.', 502);
    if (lastCode === 402) return new HttpError('The OpenRouter account is out of credits. Add credits or another API key.', 502);
    if (lastCode === 429) return new HttpError('Free models are busy or rate-limited right now. Please wait a minute and try again.', 429);
    return new HttpError(lastError, 502);
  }
}

// Some keyless public endpoints append a promo line; remove it from the answer.
function cleanFallback(t) { return String(t || '').replace(/\n+[-*_\s]*(\*\*)?(\[)?\s*Powered by Pollinations[\s\S]*$/i, '').trim(); }

module.exports = { chat, extractText, HttpError, cleanFallback };
