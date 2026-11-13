'use strict';
// In-memory per-IP daily limit + short cooldown. No database; resets when the server restarts.
function createLimiter({ daily, cooldownMs = 1500 }) {
  const map = new Map(); // ip -> { day, count, last }
  const day = () => new Date().toISOString().slice(0, 10);
  const entry = ip => {
    let e = map.get(ip);
    if (!e || e.day !== day()) { e = { day: day(), count: 0, last: 0 }; map.set(ip, e); }
    return e;
  };
  const timer = setInterval(() => { const d = day(); for (const [k, v] of map) if (v.day !== d) map.delete(k); }, 3600e3);
  if (timer.unref) timer.unref();
  return {
    remaining: ip => Math.max(0, daily - entry(ip).count),
    check(ip) {
      const e = entry(ip);
      if (e.count >= daily) return { ok: false, status: 429, error: `Daily free limit reached (${daily} requests). Please come back tomorrow.` };
      if (Date.now() - e.last < cooldownMs) return { ok: false, status: 429, error: 'Please wait a moment between requests.' };
      e.last = Date.now(); return { ok: true };
    },
    record(ip) { entry(ip).count++; }
  };
}
module.exports = { createLimiter };
