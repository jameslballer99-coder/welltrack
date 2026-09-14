// Persistence: small JSON in localStorage, photos in IndexedDB (localStorage caps out around 5 MB).
import { DEFAULT_TARGETS, migrateLogs, migrateFoodCache, migrateFavs, foodKey, upgradeFoods, upgradeSettings } from './core.js';

const K = { logs: 'wt2.logs', checks: 'wt2.checks', foods: 'wt2.foods', favs: 'wt2.favs', settings: 'wt2.settings', schema: 'wt2.schema' };
const V1 = { logs: 'welltrack_v4', backup: 'welltrack_v4_backup', checks: 'welltrack_checklist_v1', apiKey: 'welltrack_apikey', cache: 'welltrack_food_cache_v2', favs: 'welltrack_favs_v1' };

export const DEFAULT_SETTINGS = {
  targets: { ...DEFAULT_TARGETS },
  apiKey: '',
  model: 'claude-haiku-4-5',
  reminder: { enabled: false, time: '18:00' },
  checkFoods: {}, // checklist id → food a tick logs, set when the user edits a ticked entry
};

const read = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

// Returns false when the write failed (usually quota), so the UI can say so instead of silently losing data.
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { console.error('WellTrack save failed', e); return false; }
};

export function loadAll() {
  let settings = read(K.settings, {});
  let logs = read(K.logs, {});
  let foods = read(K.foods, []);

  // One-time upgrade to schema 2 (sodium, split omega-3, corrected hawker values).
  // The pre-upgrade data is kept alongside in case anything needs recovering.
  if (localStorage.getItem(K.schema) !== '2') {
    try { localStorage.setItem(`${K.logs}.before-schema2`, localStorage.getItem(K.logs) || '{}'); } catch { /* storage full: upgrade anyway */ }
    logs = migrateLogs(logs);
    foods = upgradeFoods(foods);
    if (settings.targets || settings.checkFoods) settings = upgradeSettings(settings);
    if (write(K.logs, logs) && write(K.foods, foods) && write(K.settings, settings)) localStorage.setItem(K.schema, '2');
  }

  return {
    logs,
    checks: read(K.checks, {}),
    foods,
    favs: read(K.favs, []),
    settings: { ...DEFAULT_SETTINGS, ...settings, targets: { ...DEFAULT_TARGETS, ...settings.targets }, reminder: { ...DEFAULT_SETTINGS.reminder, ...settings.reminder } },
  };
}

export const save = {
  logs: v => write(K.logs, v),
  checks: v => write(K.checks, v),
  foods: v => write(K.foods, v),
  favs: v => write(K.favs, v),
  settings: v => write(K.settings, v),
};

// Upsert a food into "My foods", keyed by normalised name.
export function upsertFood(foods, food) {
  const k = foodKey(food.name);
  const rest = foods.filter(f => foodKey(f.name) !== k);
  return [{ ...food, updatedAt: Date.now() }, ...rest];
}

// ── Photos (IndexedDB) ────────────────────────────────────────
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('welltrack', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('photos', mode);
    const result = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
  });
}
const photoCache = new Map();
export const photos = {
  async put(id, dataUrl) { photoCache.set(id, dataUrl); await tx('readwrite', s => s.put(dataUrl, id)); },
  async get(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    const v = await tx('readonly', s => s.get(id)).catch(() => null);
    if (v) photoCache.set(id, v);
    return v;
  },
  async del(id) { photoCache.delete(id); await tx('readwrite', s => s.delete(id)).catch(() => {}); },
  async all() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const out = {};
      const req = d.transaction('photos').objectStore('photos').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
      req.onerror = () => reject(req.error);
    });
  },
};

// Pull inline photos out of migrated items into IndexedDB.
export async function extractPhotos(logs) {
  for (const day of Object.values(logs)) {
    for (const items of Object.values(day)) {
      for (const it of items) {
        if (!it.photo) continue;
        const id = `p${it.id}`;
        await photos.put(id, it.photo);
        it.photoId = id;
        delete it.photo;
      }
    }
  }
  return logs;
}

// One-time import of v1 data if it lives on this same origin.
export async function migrateFromV1IfPresent() {
  if (localStorage.getItem(K.logs) !== null) return false;
  const oldLogs = read(V1.logs, null) || read(V1.backup, null);
  if (!oldLogs) return false;
  const logs = await extractPhotos(migrateLogs(oldLogs));
  save.logs(logs);
  save.checks(read(V1.checks, {}));
  save.foods(migrateFoodCache(read(V1.cache, {})));
  save.favs(migrateFavs(read(V1.favs, [])));
  const apiKey = localStorage.getItem(V1.apiKey) || '';
  save.settings({ ...DEFAULT_SETTINGS, apiKey });
  return true;
}
