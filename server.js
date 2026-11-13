'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { chat, HttpError } = require('./ai');
const { createLimiter } = require('./limits');

/* ---------- configuration (environment variables) ---------- */
const list = (v, d) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : d);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
const DEFAULT_MODELS = ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free'];
const cfg = {
  keys: list(process.env.OPENROUTER_API_KEYS, []).concat(list(process.env.OPENROUTER_API_KEY, [])).filter((k, i, a) => a.indexOf(k) === i),
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  models: list(process.env.OPENROUTER_MODELS, DEFAULT_MODELS),
  codeModels: list(process.env.OPENROUTER_CODE_MODELS, list(process.env.OPENROUTER_MODELS, DEFAULT_MODELS)),
  imageModel: (process.env.OPENROUTER_IMAGE_MODEL || '').trim(),
  maxTokens: num(process.env.MAX_TOKENS, 4000),
  timeoutMs: num(process.env.MODEL_TIMEOUT_SECONDS, 45) * 1000,
  totalBudgetMs: num(process.env.TOTAL_BUDGET_SECONDS, 90) * 1000,
  appUrl: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '',
  fallback: {
    enabled: String(process.env.KEYLESS_FALLBACK || 'true').toLowerCase() !== 'false',
    url: process.env.FALLBACK_URL || 'https://text.pollinations.ai/openai',
    model: process.env.FALLBACK_MODEL || 'openai'
  },
  appName: 'OmniAI',
  dailyLimit: num(process.env.DAILY_FREE_MESSAGES, 30),
  maxHistory: num(process.env.MAX_HISTORY_MESSAGES, 12),
  maxDocChars: num(process.env.MAX_DOCUMENT_CHARS, 24000)
};
const PUBLIC = path.join(__dirname, 'public');
const prompts = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'prompts.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace('content="api.php"', 'content="/api"').replace('content="bootstrap.php"', 'content="/api/bootstrap"');
const limiter = createLimiter({ daily: cfg.dailyLimit });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render sits behind a proxy; needed for the real visitor IP

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  });
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get(['/', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(indexHtml); });
app.use(express.static(PUBLIC, { index: false, maxAge: '1h', dotfiles: 'ignore', setHeaders: (res, p) => { if (p.endsWith('.json')) res.set('Cache-Control', 'no-cache'); } }));

const clientIp = req => req.ip || 'unknown';
const cut = (s, n) => String(s).slice(0, n);

app.get('/api/bootstrap', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ csrf: '', prompts, imageLive: !!cfg.imageModel, limit: cfg.dailyLimit, remaining: limiter.remaining(clientIp(req)), keyOk: cfg.keys.length > 0 || cfg.fallback.enabled });
});

// Basic CSRF defence for a cookie-less API: custom header + same-origin check.
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (req.get('x-requested-with') !== 'omniai') return res.status(403).json({ error: 'Forbidden.' });
  if (origin) { try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Forbidden.' }); } catch (e) { return res.status(403).json({ error: 'Forbidden.' }); } }
  next();
}

function cleanMessages(input) {
  const msgs = [];
  for (const m of (Array.isArray(input) ? input : []).slice(-cfg.maxHistory)) {
    if (!m || typeof m !== 'object') continue;
    const content = String(m.content == null ? '' : m.content).trim();
    if (!content) continue;
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: cut(content, 8000) });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

const handlers = {
  async chat(body, ip, code) {
    const msgs = cleanMessages(body.messages);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new HttpError('Please enter a message.', 422);
    const system = code
      ? 'You are OmniAI Code, a senior software engineer. Write correct, secure, maintainable code. Put code in fenced code blocks with a language tag and explain key decisions briefly.'
      : 'You are OmniAI, a helpful, accurate and friendly assistant. Answer clearly and concisely. Use Markdown (lists, code blocks) when it helps.';
    guard(ip);
    const r = await chat(cfg, code ? cfg.codeModels : cfg.models, [{ role: 'system', content: system }].concat(msgs));
    limiter.record(ip);
    return { answer: r.text, model: r.model, fallback: !!r.fallback };
  },
  async document(body, ip) {
    const task = String(body.task || '').trim(); let doc = String(body.document || '').trim();
    if (!task || !doc) throw new HttpError('Choose a file and a task first.', 422);
    const truncated = doc.length > cfg.maxDocChars; if (truncated) doc = doc.slice(0, cfg.maxDocChars);
    guard(ip);
    const r = await chat(cfg, cfg.models, [
      { role: 'system', content: 'You are OmniAI Document Assistant. Use only the supplied document. If something is not in the document, say so. Follow the user task and format the answer in clear Markdown.' },
      { role: 'user', content: cut(task, 300) + '\n\nDOCUMENT:\n' + doc }
    ]);
    limiter.record(ip);
    return { answer: r.text, truncated, model: r.model, fallback: !!r.fallback };
  },
  async image(body, ip) {
    const prompt = String(body.prompt || '').trim(); const style = cut(String(body.style || '').trim(), 60);
    if (!prompt || prompt.length > 2000) throw new HttpError('Describe your image in under 2,000 characters.', 422);
    guard(ip);
    if (cfg.imageModel) {
      const r = await chat(cfg, [cfg.imageModel], [{ role: 'user', content: prompt + (style ? '\nStyle: ' + style : '') }], { modalities: ['image', 'text'] });
      const img = r.raw && r.raw.choices && r.raw.choices[0] && r.raw.choices[0].message && r.raw.choices[0].message.images && r.raw.choices[0].message.images[0] && r.raw.choices[0].message.images[0].image_url && r.raw.choices[0].message.images[0].image_url.url;
      if (!img) throw new HttpError('The image model did not return an image. Try another model or prompt.', 502);
      limiter.record(ip);
      return { mode: 'image', image: img };
    }
    const r = await chat(cfg, cfg.models, [
      { role: 'system', content: 'You are an expert prompt engineer for AI image generators (Midjourney, DALL·E, Stable Diffusion, Flux). Turn the idea into 3 polished, copy-ready prompts: (1) Detailed, (2) Cinematic, (3) Minimal. For each, include subject, setting, lighting, composition, style and a suggested aspect ratio. Then add a short "Negative prompt" line. Use Markdown.' },
      { role: 'user', content: 'Idea: ' + prompt + (style ? '\nPreferred style: ' + style : '') }
    ]);
    limiter.record(ip);
    return { mode: 'prompt', answer: r.text, model: r.model, fallback: !!r.fallback };
  }
};

function guard(ip) { const c = limiter.check(ip); if (!c.ok) throw new HttpError(c.error, c.status); }

app.post('/api', sameOrigin, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ip = clientIp(req); res.set('Cache-Control', 'no-store');
  try {
    let out;
    if (body.action === 'chat') out = await handlers.chat(body, ip, false);
    else if (body.action === 'code') out = await handlers.chat(body, ip, true);
    else if (body.action === 'document') out = await handlers.document(body, ip);
    else if (body.action === 'image') out = await handlers.image(body, ip);
    else throw new HttpError('Unknown action.', 404);
    out.remaining = limiter.remaining(ip);
    res.json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (!(e instanceof HttpError)) console.error('API error:', e);
    res.status(status).json({ error: e instanceof HttpError ? e.message : 'Something went wrong on the server. Please try again.', remaining: limiter.remaining(ip) });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((req, res) => res.status(404).type('text').send('Not found'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 413 ? 'That request is too large.' : status < 500 ? 'Invalid request.' : 'Server error.' });
});

const PORT = num(process.env.PORT, 3000);
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OmniAI running on port ${PORT} | keys: ${cfg.keys.length} | models: ${cfg.models.join(', ')}`);
    if (!cfg.keys.length) console.warn(cfg.fallback.enabled ? 'NOTE: no OPENROUTER_API_KEY set; using the keyless backup AI only.' : 'WARNING: OPENROUTER_API_KEY is not set. AI features will not work.');
  });
}
module.exports = app;
