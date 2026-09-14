// Pure logic: no DOM, no storage. Everything here is covered by tests/core.test.js.
import { FOODS, LEGACY } from './foods.js';

// `dp` is how many decimals to keep and show. `kind`: limit (stay under), goal (reach daily),
// weekly (reach over 7 days), track (recorded, no target).
// Omega-3 is split because guidelines count EPA+DHA from fish; plant ALA converts to those poorly.
export const NUTRIENTS = [
  { key: 'satFat',       label: 'Sat fat',        unit: 'g',  kind: 'limit',  dp: 1 },
  { key: 'cholesterol',  label: 'Cholesterol',    unit: 'mg', kind: 'limit',  dp: 0 },
  { key: 'transFat',     label: 'Trans fat',      unit: 'g',  kind: 'limit',  dp: 1 },
  { key: 'solubleFiber', label: 'Soluble fiber',  unit: 'g',  kind: 'goal',   dp: 1 },
  { key: 'sterols',      label: 'Plant sterols',  unit: 'mg', kind: 'goal',   dp: 0 },
  { key: 'nuts',         label: 'Nuts',           unit: 'g',  kind: 'goal',   dp: 0 },
  { key: 'sodium',       label: 'Sodium',         unit: 'mg', kind: 'limit',  dp: 0 },
  { key: 'addedSugar',   label: 'Added sugar',    unit: 'g',  kind: 'limit',  dp: 1 },
  { key: 'fiber',        label: 'Total fiber',    unit: 'g',  kind: 'goal',   dp: 1 },
  { key: 'omega3',       label: 'Fish omega-3',   unit: 'mg', kind: 'weekly', dp: 0 },
  { key: 'ala',          label: 'Plant omega-3',  unit: 'mg', kind: 'track',  dp: 0 },
];
export const NUTRIENT_KEYS = NUTRIENTS.map(n => n.key);
export const LIMIT_KEYS = NUTRIENTS.filter(n => n.kind === 'limit').map(n => n.key);
export const nutrient = key => NUTRIENTS.find(n => n.key === key);

// Cholesterol-lowering (LDL) targets plus the Portfolio diet: sat fat under 6% of calories (AHA),
// no trans fat, dietary cholesterol ≤200 mg, soluble fiber 10–20 g, plant sterols 2 g, nuts 45 g.
// Also: sodium ≤2,000 mg (blood pressure), added sugar ≤36 g (triglycerides), total fiber 35 g,
// fish omega-3 ~500 mg a day, counted over the week because fish isn't eaten daily.
export const DEFAULT_TARGETS = {
  satFat: 13, transFat: 0, cholesterol: 200, solubleFiber: 10, sterols: 2000, nuts: 45,
  sodium: 2000, addedSugar: 36, fiber: 35, omega3Weekly: 3500,
};

// A limit of 0 means "avoid". Labels round anything under 0.5 g down to "0 g", so that's the line.
export const TRACE = 0.5;
export const limitRatio = (value, target) => (target > 0 ? value / target : value >= TRACE ? Infinity : 0);
export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
// `food` is the built-in food a tick logs until the user edits that entry; their version is then remembered.
export const CHECKLIST = [
  { id: 'oatmeal',  label: 'Oatmeal',  emoji: '🥣', food: 'Oatmeal, cooked' },
  { id: 'psyllium', label: 'Psyllium', emoji: '🌾', food: 'Psyllium husk' },
  { id: 'flaxseed', label: 'Flaxseed', emoji: '🌱', food: 'Flaxseed, ground' },
  { id: 'nuts',     label: 'Nuts',     emoji: '🥜', food: 'Mixed nuts, unsalted' },
  { id: 'fruits',   label: 'Fruits',   emoji: '🍎', food: 'Apple' },
];

// Breakfast before 11:00, lunch 11:00–14:59, dinner 17:00–20:59, snacks any other time.
export function mealForTime(date = new Date()) {
  const h = date.getHours();
  if (h < 11) return 'Breakfast';
  if (h < 15) return 'Lunch';
  if (h >= 17 && h < 21) return 'Dinner';
  return 'Snacks';
}

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
  for (const n of NUTRIENTS) base[n.key] = round(num(src[n.key]), n.dp === 0 ? 0 : 2);
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
  const ratio = Math.max(...LIMIT_KEYS.map(k => (k in targets ? limitRatio(t[k], targets[k]) : 0)));
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

// ── Migration ─────────────────────────────────────────────────
// v1 stored nutrient values already multiplied by servings, and photos inline as data URLs.
// The base keeps only the old five nutrients; upgradeBase() fills in the rest.
const OLD_KEYS = ['satFat', 'transFat', 'addedSugar', 'fiber', 'omega3'];
export function migrateV1Item(old, idx = 0) {
  const servings = num(old.servings) || 1;
  const base = {};
  for (const k of OLD_KEYS) base[k] = round(num(old[k]) / servings, 2);
  return {
    id: String(old.id ?? `${Date.now()}-${idx}`),
    name: String(old.name || 'Food'),
    serving: String(old.serving || '1 serving'),
    servings,
    base,
    ...(old.photo ? { photo: old.photo } : {}), // caller moves this into IndexedDB
  };
}

const STOP = new Set(['cup', 'cooked', 'plate', 'bowl', 'piece', 'pieces', 'slice', 'slices', 'large', 'medium', 'with', 'and', 'the', 'tbsp', 'sticks', 'lean', 'plain']);
const words = name => foodKey(name).split(' ').filter(w => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
// Word-start matches only, so "eel" doesn't catch "peeled".
const SEAFOOD = /\b(fish|salmon|tuna|sardine|mackerel|prawn|shrimp|squid|sotong|crab|oyster|seafood|cod|anchov|ikan|lala|clam|mussel|scallop|eel|saba|unagi)/;

const same = (a, b, keys) => keys.every(k => Math.abs(num(a[k]) - num(b[k])) < 0.011);
const S2_KEYS = ['satFat', 'transFat', 'addedSugar', 'fiber', 'sodium', 'omega3', 'ala'];

// Entries carry whichever nutrients existed when they were saved:
//   schema 1: five nutrients, no `ala`;  schema 2: adds sodium and `ala`;  schema 3: adds cholesterol,
//   soluble fiber, sterols and nuts.
// If an entry still has a built-in food's numbers untouched, it gets that food's current values.
// Otherwise the user's numbers are kept and anything new starts at 0 (unknown); for schema-1 entries
// omega-3 counts as fish only when the name sounds like seafood.
export function upgradeBase(name, base) {
  if (!base || 'cholesterol' in base) return base;
  const w = new Set(words(name));
  const nameMatches = other => words(other).some(x => w.has(x));

  if (!('ala' in base)) {
    const legacy = LEGACY.find(([oldName, ...rest]) =>
      OLD_KEYS.every((k, i) => Math.abs(num(base[k]) - rest[i]) < 0.011) && nameMatches(oldName));
    const food = legacy && FOODS.find(f => f.name === legacy[6]);
    if (food) return { ...food.base };
    const fishy = SEAFOOD.test(foodKey(name));
    return cleanBase({ ...base, omega3: fishy ? base.omega3 : 0, ala: fishy ? 0 : base.omega3 });
  }

  const food = FOODS.find(f => same(f.base, base, S2_KEYS) && nameMatches(f.name));
  return food ? { ...food.base } : cleanBase(base);
}

export const upgradeItem = it => ('cholesterol' in (it.base || {}) ? it : { ...it, base: upgradeBase(it.name, it.base) });
export const upgradeFoods = foods => (foods || []).map(upgradeItem);
export const upgradeCheckFoods = map => Object.fromEntries(Object.entries(map || {}).map(([k, f]) => [k, upgradeItem(f)]));

const isV2Item = it => it && typeof it === 'object' && it.base && typeof it.base === 'object';

export function migrateLogs(logs) {
  const out = {};
  let n = 0;
  for (const [key, day] of Object.entries(logs || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day) continue;
    const d = emptyDay();
    for (const m of MEALS) d[m] = (day[m] || []).map(it => upgradeItem(isV2Item(it) ? it : migrateV1Item(it, n++)));
    if (dayItems(d).length) out[key] = d;
  }
  return out;
}

// v1 food cache: { "laksa": { name, serving, satFat, ..., source } }
export function migrateFoodCache(cache) {
  return Object.values(cache || {})
    .filter(f => f && f.name)
    .map(f => upgradeItem({
      name: f.name, serving: f.serving || '1 serving', source: f.source === 'user' ? 'user' : 'ai',
      base: Object.fromEntries(OLD_KEYS.map(k => [k, num(f[k])])),
    }));
}

// Targets saved before the LDL-focused set (no `cholesterol` target) are replaced by it, as the
// user asked; targets set after that are kept.
export function upgradeSettings(settings) {
  if (!settings) return settings;
  const current = settings.targets && 'cholesterol' in settings.targets;
  const targets = current ? { ...DEFAULT_TARGETS, ...settings.targets } : { ...DEFAULT_TARGETS };
  return { ...settings, targets, checkFoods: upgradeCheckFoods(settings.checkFoods) };
}

// v1 favourites were full display names like "🇸🇬 Laksa (1 bowl)"; v2 stores food keys.
export const migrateFavs = favs => [...new Set((favs || []).map(n => foodKey(String(n).replace(/\s*\([^)]*\)\s*$/, ''))))];

// Accepts a v1 backup ({version:1, allLogs, allChecks, favs, foodCache}) or a v2 backup.
export function normalizeBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a WellTrack backup');
  if (data.app === 'welltrack' && data.version === 2) {
    return {
      logs: migrateLogs(data.logs), checks: data.checks || {}, foods: upgradeFoods(data.foods),
      favs: data.favs || [], settings: upgradeSettings(data.settings) || null, photos: data.photos || {},
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
  const head = ['Date', 'Meal', 'Food', 'Serving', 'Servings', ...NUTRIENTS.map(n => `${n.label} (${n.unit})`)];
  const rows = [head];
  for (const key of Object.keys(logs).sort()) {
    for (const meal of MEALS) {
      for (const it of logs[key][meal] || []) {
        rows.push([key, meal, it.name, it.serving, it.servings,
          ...NUTRIENTS.map(n => round(itemValue(it, n.key), n.dp === 0 ? 0 : 2))]);
      }
    }
  }
  if (rows.length === 1) return null;
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
