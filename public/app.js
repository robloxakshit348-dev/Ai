(() => {
'use strict';
const $ = id => document.getElementById(id);
const meta = n => { const m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ''; };
const API_URL = meta('omniai-api') || 'api.php';
const BOOT_URL = meta('omniai-bootstrap') || 'bootstrap.php';
let O = {csrf: '', prompts: [], imageLive: false, limit: 30, remaining: null, keyOk: true};
const LABELS = {home: 'Overview', chat: 'AI Chat', image: 'Image Studio', docs: 'Documents', code: 'AI Coding', prompts: 'Prompt Library', pricing: 'Plans & Credits'};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

/* ---------- helpers ---------- */
let toastTimer;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.add('hidden'), 3200); }
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Small, safe Markdown renderer: escapes everything first; no raw HTML, no links.
function md(src) {
  const blocks = [];
  src = String(src).replace(/```([\w+#.-]*)[^\n]*\n?([\s\S]*?)(```|$)/g, (m, lang, code) => {
    blocks.push('<div class="codewrap"><button class="copy" type="button">Copy</button><pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre></div>');
    return '\n\u0000' + (blocks.length - 1) + '\u0000\n';
  });
  const inline = s => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  const out = []; let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push('<' + list.t + '>' + list.items.map(i => '<li>' + i + '</li>').join('') + '</' + list.t + '>'); list = null; } };
  src.split('\n').forEach(line => {
    let m;
    if ((m = line.match(/^\u0000(\d+)\u0000$/))) { flushPara(); flushList(); out.push(blocks[+m[1]]); }
    else if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) { flushPara(); flushList(); out.push('<h4>' + inline(m[1]) + '</h4>'); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = {t: 'ul', items: []}; } list.items.push(inline(m[1])); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = {t: 'ol', items: []}; } list.items.push(inline(m[1])); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(inline(line)); }
  });
  flushPara(); flushList();
  return out.join('');
}
function copyText(t) { return navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard')).catch(() => toast('Copy is not available in this browser')); }
document.addEventListener('click', e => { const b = e.target.closest('.copy'); if (b) copyText(b.nextElementSibling.textContent); });

async function api(action, data = {}) {
  let r;
  try {
    r = await fetch(API_URL, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': O.csrf, 'X-Requested-With': 'omniai'}, body: JSON.stringify(Object.assign({action}, data))});
  } catch (e) { throw new Error('Network error. Check your connection and try again.'); }
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('The server returned an unexpected response (HTTP ' + r.status + '). Please try again in a moment.'); }
  if (typeof j.remaining === 'number') setUsage(j.remaining);
  if (j.fallback && !sessionStorage.getItem('omniai_fb')) { try { sessionStorage.setItem('omniai_fb', '1'); } catch (e) { /* ignore */ } toast('Free AI quota is used up, so this answer came from the backup AI.'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.html = btn.innerHTML; btn.textContent = label || 'Working…'; btn.disabled = true; }
  else { if (btn.dataset.html) btn.innerHTML = btn.dataset.html; btn.disabled = false; }
}
function show(el, html, asText) { el.classList.remove('hidden'); if (asText) el.textContent = html; else el.innerHTML = html; }

/* ---------- usage + theme ---------- */
function setUsage(rem) {
  O.remaining = rem; const lim = O.limit || 1;
  $('usagePill').textContent = '✦ Free · ' + rem + ' left';
  $('usageText').textContent = rem + ' / ' + lim + ' left';
  $('usageBar').style.width = Math.max(0, Math.min(100, rem / lim * 100)) + '%';
}
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); $('themeIcon').setAttribute('href', t === 'light' ? '#i-moon' : '#i-sun'); store.set('omniai_theme', t); }
$('themeBtn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));
$('themeIcon').setAttribute('href', document.documentElement.getAttribute('data-theme') === 'light' ? '#i-moon' : '#i-sun');

/* ---------- navigation ---------- */
function view(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('show', x.id === 'view-' + v));
  document.querySelectorAll('.nav,.tab').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  $('crumb').textContent = LABELS[v] || v;
  window.scrollTo({top: 0});
  if (v === 'chat') { const m = $('messages'); m.scrollTop = m.scrollHeight; }
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => view(b.dataset.open)));

/* ---------- chat ---------- */
let history = store.get('omniai_chat', []);
let chatBusy = false;
const SUGGESTIONS = ['Explain how the internet works in simple terms', 'Help me write a polite follow-up email', 'Give me a 3-day workout plan for beginners', 'Write a Python function to remove duplicates from a list'];
function avatar() { const a = document.createElement('div'); a.className = 'avatar'; a.innerHTML = '<svg class="ic"><use href="#i-spark"/></svg>'; return a; }
function bubble(role, text) {
  const row = document.createElement('div'); row.className = 'msgrow' + (role === 'user' ? ' me' : '');
  if (role === 'user') { const d = document.createElement('div'); d.className = 'usermsg'; d.textContent = text; row.append(d); }
  else { const d = document.createElement('div'); d.className = 'assistantmsg md'; d.innerHTML = md(text); row.append(avatar(), d); }
  $('messages').append(row); $('messages').scrollTop = $('messages').scrollHeight; return row;
}
function renderChat() {
  const box = $('messages'); box.innerHTML = '';
  if (!history.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.append(avatar());
    const h = document.createElement('h3'); h.textContent = 'How can I help you today?';
    const p = document.createElement('p'); p.textContent = 'Ask a question, brainstorm ideas, or get help writing and learning.';
    const g = document.createElement('div'); g.className = 'suggestgrid';
    SUGGESTIONS.forEach(s => { const b = document.createElement('button'); b.type = 'button'; b.textContent = s; b.addEventListener('click', () => chat(s)); g.append(b); });
    e.append(h, p, g); box.append(e); return;
  }
  history.forEach(m => bubble(m.role, m.content));
}
function saveChat() { history = history.slice(-40); store.set('omniai_chat', history); }
async function chat(text) {
  text = (text || '').trim();
  if (!text || chatBusy) return;
  chatBusy = true; $('chatSend').disabled = true;
  history.push({role: 'user', content: text}); saveChat(); renderChat();
  const wait = document.createElement('div'); wait.className = 'msgrow'; wait.append(avatar());
  const d = document.createElement('div'); d.className = 'assistantmsg'; d.innerHTML = '<span class="typingdots"><span></span><span></span><span></span></span>'; wait.append(d);
  $('messages').append(wait); $('messages').scrollTop = $('messages').scrollHeight;
  try {
    const r = await api('chat', {messages: history});
    history.push({role: 'assistant', content: r.answer}); saveChat(); renderChat();
  } catch (e) {
    history.pop(); saveChat(); renderChat(); bubble('assistant', '⚠️ ' + e.message); $('chatInput').value = text; grow();
  } finally { chatBusy = false; $('chatSend').disabled = false; }
}
function grow() { const t = $('chatInput'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 170) + 'px'; }
$('chatInput').addEventListener('input', grow);
$('chatSend').addEventListener('click', () => { const t = $('chatInput').value; if (!t.trim()) return; $('chatInput').value = ''; grow(); chat(t); });
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chatSend').click(); } });
$('clearChat').addEventListener('click', () => { history = []; saveChat(); renderChat(); toast('Started a new chat'); });
function homeAsk() { const t = $('homeAsk').value.trim(); if (!t) return toast('Type a question first.'); $('homeAsk').value = ''; view('chat'); chat(t); }
$('homeSend').addEventListener('click', homeAsk);
$('homeAsk').addEventListener('keydown', e => { if (e.key === 'Enter') homeAsk(); });
document.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => { view('chat'); chat(b.dataset.suggest); }));

/* ---------- coding ---------- */
$('generateCode').addEventListener('click', async () => {
  const p = $('codePrompt').value.trim(); if (!p) return toast('Describe the code you need.');
  const btn = $('generateCode'); busy(btn, true, 'Generating…'); show($('codeResult'), 'Generating…', true); $('copyCode').classList.add('hidden');
  try { const r = await api('code', {messages: [{role: 'user', content: 'Language: ' + $('codeLang').value + '\nTask: ' + p}]}); show($('codeResult'), md(r.answer)); $('copyCode').classList.remove('hidden'); $('copyCode').dataset.text = r.answer; }
  catch (e) { show($('codeResult'), '⚠️ ' + e.message, true); }
  finally { busy(btn, false); }
});
$('copyCode').addEventListener('click', () => copyText($('copyCode').dataset.text || $('codeResult').textContent));

/* ---------- documents ---------- */
$('analyzeDoc').addEventListener('click', async () => {
  const file = $('docFile').files[0]; if (!file) return toast('Choose a text file first.');
  if (file.size > 2 * 1024 * 1024) return toast('Maximum file size is 2 MB.');
  if (!/\.(txt|md)$/i.test(file.name) && !/^text\//.test(file.type)) return toast('Please choose a .txt or .md file.');
  const btn = $('analyzeDoc'); busy(btn, true, 'Analyzing…'); show($('docResult'), 'Analyzing…', true);
  try {
    const text = await file.text();
    if (!text.trim()) throw new Error('That file is empty.');
    const r = await api('document', {task: $('docAction').value, document: text.slice(0, 40000)});
    show($('docResult'), md(r.answer) + (r.truncated || text.length > 24000 ? '<p class="tiny">Note: the file was long, so only the first part was analyzed.</p>' : ''));
  } catch (e) { show($('docResult'), '⚠️ ' + e.message, true); }
  finally { busy(btn, false); }
});

/* ---------- image studio ---------- */
$('makeImage').addEventListener('click', async () => {
  const p = $('imagePrompt').value.trim(); if (!p) return toast('Describe your image first.');
  const btn = $('makeImage'); busy(btn, true, 'Working…'); show($('imageResult'), O.imageLive ? 'Generating image…' : 'Writing your prompts…', true);
  try {
    const r = await api('image', {prompt: p, style: $('imageStyle').value});
    if (r.mode === 'image') { const box = $('imageResult'); box.innerHTML = ''; const img = document.createElement('img'); img.alt = 'AI generated image'; img.className = 'generated'; img.src = r.image; box.append(img); }
    else show($('imageResult'), md(r.answer));
  } catch (e) { show($('imageResult'), '⚠️ ' + e.message, true); }
  finally { busy(btn, false); }
});

/* ---------- prompt library ---------- */
let category = 'All';
const mine = () => store.get('omniai_my_prompts', []);
function usePrompt(body) { view('chat'); $('chatInput').value = body; grow(); $('chatInput').focus(); toast('Prompt added — edit it and press Send.'); }
function card(p, canDelete, idx) {
  const c = document.createElement('article'); c.className = 'promptcard';
  const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = p.category + (canDelete ? ' · Mine' : '');
  const t = document.createElement('h4'); t.textContent = p.title;
  const d = document.createElement('p'); d.textContent = p.body;
  const row = document.createElement('div'); row.className = 'cardrow';
  const use = document.createElement('button'); use.className = 'link'; use.type = 'button'; use.innerHTML = 'Use prompt <svg class="ic"><use href="#i-arrow"/></svg>'; use.addEventListener('click', () => usePrompt(p.body));
  row.append(use);
  if (canDelete) { const del = document.createElement('button'); del.className = 'link danger'; del.type = 'button'; del.textContent = 'Delete'; del.addEventListener('click', () => { const l = mine(); l.splice(idx, 1); store.set('omniai_my_prompts', l); renderPrompts(); }); row.append(del); }
  c.append(meta, t, d, row); return c;
}
function renderPrompts() {
  const term = $('promptSearch').value.toLowerCase();
  const all = (O.prompts || []).map(p => ({p, own: false, i: -1})).concat(mine().map((p, i) => ({p, own: true, i})));
  const list = all.filter(x => (category === 'All' || (category === 'Mine' ? x.own : x.p.category === category)) && (x.p.title + ' ' + x.p.body).toLowerCase().includes(term));
  const el = $('promptList'); el.innerHTML = '';
  if (!list.length) { const n = document.createElement('p'); n.className = 'tiny'; n.textContent = category === 'Mine' ? 'You have not saved any prompts yet.' : 'No prompts match your search.'; el.append(n); }
  list.forEach(x => el.append(card(x.p, x.own, x.i)));
  const home = $('homePrompts'); home.innerHTML = ''; (O.prompts || []).slice(0, 4).forEach(p => home.append(card(p, false, -1)));
}
$('promptSearch').addEventListener('input', renderPrompts);
document.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { category = b.dataset.cat; document.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('active', x === b)); renderPrompts(); }));
$('publishPrompt').addEventListener('click', () => {
  const title = $('newTitle').value.trim(), body = $('newBody').value.trim();
  if (title.length < 3 || body.length < 10) return toast('Add a title (3+ characters) and a prompt (10+ characters).');
  const l = mine(); l.unshift({title, category: $('newCategory').value, body}); store.set('omniai_my_prompts', l.slice(0, 50));
  $('newTitle').value = ''; $('newBody').value = ''; toast('Prompt saved in this browser'); category = 'Mine';
  document.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('active', x.dataset.cat === 'Mine')); renderPrompts();
});

/* ---------- plans ---------- */
$('proPlan').addEventListener('click', () => toast('Paid plans are coming soon. Everything is free for now.'));
$('teamPlan').addEventListener('click', () => toast('Team plans are coming soon.'));

/* ---------- start ---------- */
renderChat(); renderPrompts();
fetch(BOOT_URL, {credentials: 'same-origin', headers: {'X-Requested-With': 'omniai'}})
  .then(r => r.json())
  .then(b => {
    O = Object.assign(O, b);
    if (!O.keyOk) $('keyNotice').classList.remove('hidden');
    if (O.imageLive) { $('makeImage').innerHTML = '<svg class="ic"><use href="#i-spark"/></svg> Generate image'; $('imageSub').textContent = 'Turn your imagination into visuals.'; }
    $('freeLimitItem').textContent = O.limit + ' AI requests per day';
    setUsage(typeof O.remaining === 'number' ? O.remaining : O.limit);
    renderPrompts();
  })
  .catch(() => { setUsage(O.limit); toast('Could not reach the server. Some features may not work.'); });
})();
