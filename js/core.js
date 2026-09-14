// Pure logic: no DOM, no storage. Everything here is covered by tests/core.test.js.

export const NUTRIENTS = [
  { key: 'satFat',     label: 'Sat fat',     unit: 'g',  kind: 'limit' },
  { key: 'transFat',   label: 'Trans fat',   unit: 'g',  kind: 'limit' },
  { key: 'addedSugar', label: 'Added sugar', unit: 'g',  kind: 'limit' },
  { key: 'fiber',      label: 'Fiber',       unit: 'g',  kind: 'goal' },
  { key: 'omega3',     label: 'Omega-3',     unit: 'mg', kind: 'weekly' },
];
export const NUTRIENT_KEYS = NUTRIENTS.map(n => n.key);
export const LIMIT_KEYS = NUTRIENTS.filter(n => n.kind === 'limit').map(n => n.key);

export const DEFAULT_TARGETS = { satFat: 20, transFat: 2, addedSugar: 50, fiber: 15, omega3Weekly: 3500 };
export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export const CHECKLIST = [
  { id: 'oatmeal',  label: 'Oatmeal',  emoji: '🥣' },
  { id: 'psyllium', label: 'Psyllium', emoji: '🌾' },
  { id: 'flaxseed', label: 'Flaxseed', emoji: '🌱' },
  { id: 'nuts',     label: 'Nuts',     emoji: '🥜' },
  { id: 'fruits',   label: 'Fruits',   emoji: '🍎' },
];

// ── Dates ─────────────────────────────────────────────────────
// Date keys are local-time YYYY-MM-DD strings, so they sort lexically.
export const toDateKey = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDateKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (key, n) => { const d = parseDateKey(key); d.setDate(d.getDate() + n); return toDateKey(d); };
// Always call this rather than caching a value: the app may stay open past midnight.
export const todayKey = (now = new Date()) => toDateKey(now);

// ── Numbers ───────────────────────────────────────────────────
export const round = (n, dp = 1) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };
export const fmt = (n, dp = 1) => String(round(n, dp));
export const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

export function cleanBase(src = {}) {
  const base = {};
  for (const k of NUTRIENT_KEYS) base[k] = round(num(src[k]), k === 'omega3' ? 0 : 2);
  return base;
}

// ── Items & days ──────────────────────────────────────────────
// v2 item: { id, name, serving, servings, base: {per-serving nutrients}, photoId? }
export const itemValue = (item, key) => (item.base?.[key] || 0) * (item.servings || 1);
export const emptyDay = () => Object.fromEntries(MEALS.map(m => [m, []]));
export const dayItems = day => (day ? MEALS.flatMap(m => day[m] || []) : []);

export function totals(items) {
  const t = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, 0]));
  for (const it of items) for (const k of NUTRIENT_KEYS) t[k] += itemValue(it, k);
  return t;
}
export const dayTotals = day => totals(dayItems(day));

export function dayStatus(day, targets = DEFAULT_TARGETS) {
  const items = dayItems(day);
  if (!items.length) return 'empty';
  const t = totals(items);
  const ratio = Math.max(...LIMIT_KEYS.map(k => (targets[k] ? t[k] / targets[k] : 0)));
  if (ratio > 1) return 'over';
  if (ratio > 0.75) return 'close';
  return 'good';
}

// Consecutive logged days within all limits, ending today. An empty today doesn't break it.
export function computeStreak(logs, targets = DEFAULT_TARGETS, today = todayKey()) {
  let streak = 0;
  for (let i = 0; i <= 3650; i++) {
    const status = dayStatus(logs[addDays(today, -i)], targets);
    if (status === 'empty') { if (i === 0) continue; break; }
    if (status === 'over') break;
    streak++;
  }
  return streak;
}

export function sumRange(logs, endKey, days, key) {
  let s = 0;
  for (let i = 0; i < days; i++) s += dayTotals(logs[addDays(endKey, -i)])[key];
  return s;
}

export function series(logs, endKey, days, targets = DEFAULT_TARGETS) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(endKey, -i);
    const day = logs[key];
    out.push({ key, logged: dayItems(day).length > 0, totals: dayTotals(day), status: dayStatus(day, targets) });
  }
  return out;
}

export function summarize(points) {
  const logged = points.filter(p => p.logged);
  const avg = Object.fromEntries(NUTRIENT_KEYS.map(k =>
    [k, logged.length ? logged.reduce((s, p) => s + p.totals[k], 0) / logged.length : 0]));
  return {
    loggedDays: logged.length,
    withinLimits: logged.filter(p => p.status !== 'over').length,
    avg,
  };
}

// ── Foods ─────────────────────────────────────────────────────
const normal = s => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export const foodKey = name => normal(name);

// Every query word must appear somewhere; names starting with the query rank first.
export function searchFoods(foods, query) {
  const q = normal(query);
  if (!q) return foods;
  const words = q.split(' ');
  return foods
    .map(f => ({ f, n: normal(f.name) }))
    .filter(({ n }) => words.every(w => n.includes(w)))
    .sort((a, b) => (b.n.startsWith(q) - a.n.startsWith(q)) || a.n.length - b.n.length)
    .map(({ f }) => f);
}

// Most recently logged distinct foods, newest first.
export function recentFoods(logs, limit = 8) {
  const seen = new Set(), out = [];
  for (const key of Object.keys(logs).sort().reverse()) {
    const items = dayItems(logs[key]).slice().reverse();
    for (const it of items) {
      const k = foodKey(it.name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: it.name, serving: it.serving, base: it.base });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ── Migration from WellTrack v1 ───────────────────────────────
// v1 stored nutrient values already multiplied by servings, and photos inline as data URLs.
export function migrateV1Item(old, idx = 0) {
  const servings = num(old.servings) || 1;
  const base = {};
  for (const k of NUTRIENT_KEYS) base[k] = num(old[k]) / servings;
  return {
    id: String(old.id ?? `${Date.now()}-${idx}`),
    name: String(old.name || 'Food'),
    serving: String(old.serving || '1 serving'),
    servings,
    base: cleanBase(base),
    ...(old.photo ? { photo: old.photo } : {}), // caller moves this into IndexedDB
  };
}

const isV2Item = it => it && typeof it === 'object' && it.base && typeof it.base === 'object';

export function migrateLogs(logs) {
  const out = {};
  let n = 0;
  for (const [key, day] of Object.entries(logs || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day) continue;
    const d = emptyDay();
    for (const m of MEALS) d[m] = (day[m] || []).map(it => (isV2Item(it) ? it : migrateV1Item(it, n++)));
    if (dayItems(d).length) out[key] = d;
  }
  return out;
}

// v1 food cache: { "laksa": { name, serving, satFat, ..., source } }
export function migrateFoodCache(cache) {
  return Object.values(cache || {})
    .filter(f => f && f.name)
    .map(f => ({ name: f.name, serving: f.serving || '1 serving', base: cleanBase(f), source: f.source === 'user' ? 'user' : 'ai' }));
}

// v1 favourites were full display names like "🇸🇬 Laksa (1 bowl)"; v2 stores food keys.
export const migrateFavs = favs => [...new Set((favs || []).map(n => foodKey(String(n).replace(/\s*\([^)]*\)\s*$/, ''))))];

// Accepts a v1 backup ({version:1, allLogs, allChecks, favs, foodCache}) or a v2 backup.
export function normalizeBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a WellTrack backup');
  if (data.app === 'welltrack' && data.version === 2) {
    return {
      logs: migrateLogs(data.logs), checks: data.checks || {}, foods: data.foods || [],
      favs: data.favs || [], settings: data.settings || null, photos: data.photos || {},
    };
  }
  if (data.allLogs) {
    return {
      logs: migrateLogs(data.allLogs), checks: data.allChecks || {}, foods: migrateFoodCache(data.foodCache),
      favs: migrateFavs(data.favs), settings: null, photos: {},
    };
  }
  throw new Error('Not a WellTrack backup');
}

// ── CSV ───────────────────────────────────────────────────────
export function toCSV(logs) {
  const head = ['Date', 'Meal', 'Food', 'Serving', 'Servings', 'Sat fat (g)', 'Trans fat (g)', 'Added sugar (g)', 'Fiber (g)', 'Omega-3 (mg)'];
  const rows = [head];
  for (const key of Object.keys(logs).sort()) {
    for (const meal of MEALS) {
      for (const it of logs[key][meal] || []) {
        rows.push([key, meal, it.name, it.serving, it.servings,
          ...NUTRIENT_KEYS.map(k => round(itemValue(it, k), k === 'omega3' ? 0 : 2))]);
      }
    }
  }
  if (rows.length === 1) return null;
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
