import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, todayKey, round, dayTotals, dayStatus, computeStreak, series, summarize,
  searchFoods, recentFoods, migrateV1Item, migrateLogs, migrateFavs, normalizeBackup, toCSV, emptyDay, DEFAULT_TARGETS,
  CHECKLIST, mealForTime, upgradeBase, upgradeSettings,
} from '../js/core.js';
import { FOODS, LEGACY } from '../js/foods.js';

const item = (name, base, servings = 1) => ({ id: name, name, serving: '1 plate', servings, base: { satFat: 0, transFat: 0, addedSugar: 0, sodium: 0, fiber: 0, omega3: 0, ala: 0, ...base } });
const food = name => FOODS.find(f => f.name === name);
const day = (meals) => ({ ...emptyDay(), ...meals });

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('todayKey uses local date', () => {
  assert.equal(todayKey(new Date(2026, 8, 14, 23, 59)), '2026-09-14');
});

test('totals multiply per-serving values by servings', () => {
  const t = dayTotals(day({ Lunch: [item('laksa', { satFat: 8, fiber: 2 }, 1.5)], Dinner: [item('egg', { satFat: 1.6 })] }));
  assert.equal(round(t.satFat, 2), 13.6);
  assert.equal(t.fiber, 3);
});

test('dayStatus uses the worst limit ratio', () => {
  assert.equal(dayStatus(undefined), 'empty');
  assert.equal(dayStatus(day({ Lunch: [item('a', { satFat: 10 })] })), 'good');
  assert.equal(dayStatus(day({ Lunch: [item('a', { satFat: 16 })] })), 'close');
  assert.equal(dayStatus(day({ Lunch: [item('a', { transFat: 2.5 })] })), 'over');
  assert.equal(dayStatus(day({ Lunch: [item('soup', { sodium: 2400 })] })), 'over');
});

test('streak counts consecutive in-limit days and skips an empty today', () => {
  const ok = day({ Lunch: [item('a', { satFat: 5 })] });
  const over = day({ Lunch: [item('a', { satFat: 30 })] });
  const logs = { '2026-09-13': ok, '2026-09-12': ok, '2026-09-11': over, '2026-09-10': ok };
  assert.equal(computeStreak(logs, DEFAULT_TARGETS, '2026-09-14'), 2);
  assert.equal(computeStreak({ ...logs, '2026-09-14': over }, DEFAULT_TARGETS, '2026-09-14'), 0);
});

test('series and summarize report averages over logged days only', () => {
  const logs = { '2026-09-14': day({ Lunch: [item('a', { satFat: 10 })] }), '2026-09-12': day({ Lunch: [item('b', { satFat: 30 })] }) };
  const pts = series(logs, '2026-09-14', 7);
  assert.equal(pts.length, 7);
  assert.equal(pts.at(-1).key, '2026-09-14');
  const s = summarize(pts);
  assert.equal(s.loggedDays, 2);
  assert.equal(s.withinLimits, 1);
  assert.equal(s.avg.satFat, 20);
});

test('search needs every word and ranks prefix matches first', () => {
  const names = searchFoods(FOODS, 'rice').map(f => f.name);
  assert.ok(names.includes('Hainanese chicken rice'));
  assert.ok(names.indexOf('Brown rice, cooked') > -1);
  assert.deepEqual(searchFoods(FOODS, 'chicken rice').map(f => f.name), ['Hainanese chicken rice']);
  assert.equal(searchFoods(FOODS, 'KAYA')[0].name, 'Kaya toast with butter');
});

test('recentFoods returns newest distinct foods', () => {
  const logs = {
    '2026-09-13': day({ Lunch: [item('Laksa', {})] }),
    '2026-09-14': day({ Breakfast: [item('Oats', {})], Lunch: [item('laksa', {})] }),
  };
  assert.deepEqual(recentFoods(logs).map(f => f.name), ['laksa', 'Oats']);
});

test('v1 items convert multiplied totals back to per-serving', () => {
  const v1 = { id: 1700000000000, name: '🇸🇬 Laksa (1 bowl)', serving: '1 bowl', servings: 2, satFat: 16, transFat: 0.4, addedSugar: 8, fiber: 4, omega3: 400, photo: 'data:image/jpeg;base64,xx' };
  const v2 = migrateV1Item(v1);
  assert.equal(v2.id, '1700000000000');
  assert.equal(v2.servings, 2);
  assert.deepEqual(v2.base, { satFat: 8, transFat: 0.2, addedSugar: 4, fiber: 2, omega3: 200 });
  assert.equal(v2.photo, v1.photo);
  assert.equal(round(dayTotals(day({ Lunch: [v2] })).satFat), 16);
});

test('migrateLogs drops empty days and leaves v2 items alone', () => {
  const v2 = item('Oats', { fiber: 4 });
  const out = migrateLogs({
    '2026-03-01': { Breakfast: [], Lunch: [], Dinner: [], Snacks: [] },
    '2026-03-02': { Breakfast: [v2], Lunch: [{ id: 2, name: 'Egg', satFat: 1.6 }] },
    'junk': { Breakfast: [v2] },
  });
  assert.deepEqual(Object.keys(out), ['2026-03-02']);
  assert.equal(out['2026-03-02'].Breakfast[0], v2);
  assert.equal(out['2026-03-02'].Lunch[0].base.satFat, 1.6);
  assert.deepEqual(out['2026-03-02'].Snacks, []);
});

test('v1 favourites map onto v2 food keys', () => {
  assert.deepEqual(migrateFavs(['🇸🇬 Laksa (1 bowl)', 'Butter (1 tbsp)']), ['laksa', 'butter']);
});

test('normalizeBackup reads v1 and v2 files and rejects others', () => {
  const v1 = normalizeBackup({ version: 1, allLogs: { '2026-03-02': { Lunch: [{ id: 1, name: 'Egg', satFat: 1.6 }] } }, allChecks: { '2026-03-02': { nuts: true } }, favs: [], foodCache: { egg: { name: 'Egg', satFat: 1.6, source: 'user' } } });
  assert.equal(v1.logs['2026-03-02'].Lunch[0].base.satFat, 1.6);
  assert.equal(v1.foods[0].source, 'user');
  assert.equal(v1.checks['2026-03-02'].nuts, true);

  const v2 = normalizeBackup({ app: 'welltrack', version: 2, logs: {}, checks: {}, foods: [], favs: ['laksa'], settings: { model: 'x' }, photos: {} });
  assert.deepEqual(v2.favs, ['laksa']);
  assert.throws(() => normalizeBackup({ hello: 1 }));
});

test('CSV escapes quotes and returns null when empty', () => {
  assert.equal(toCSV({}), null);
  const csv = toCSV({ '2026-09-14': day({ Lunch: [item('Kopi "O"', { addedSugar: 6 }, 2)] }) });
  const [, row] = csv.split('\r\n');
  assert.match(row, /"Kopi ""O"""/);
  assert.match(row, /"12"/);
});

test('mealForTime follows the breakfast/lunch/dinner/snack windows', () => {
  const at = (h, m = 0) => mealForTime(new Date(2026, 8, 14, h, m));
  assert.equal(at(0), 'Breakfast'); // anything before 11am, including just after midnight
  assert.equal(at(10, 59), 'Breakfast');
  assert.equal(at(11), 'Lunch');
  assert.equal(at(14, 59), 'Lunch');
  assert.equal(at(15), 'Snacks');
  assert.equal(at(16, 59), 'Snacks');
  assert.equal(at(17), 'Dinner');
  assert.equal(at(20, 59), 'Dinner');
  assert.equal(at(21), 'Snacks');
  assert.equal(at(23, 30), 'Snacks');
});

test('every checklist item maps to a built-in food', () => {
  for (const c of CHECKLIST) assert.ok(FOODS.some(f => f.name === c.food), c.id);
});

test('untouched old built-in entries get the corrected values, including v1 names', () => {
  const [v1Laksa] = migrateLogs({ '2026-03-02': { Lunch: [{ id: 1, name: '🇸🇬 Laksa (1 bowl)', serving: '1 bowl', servings: 2, satFat: 16, transFat: 0.4, addedSugar: 8, fiber: 4, omega3: 400 }] } })['2026-03-02'].Lunch;
  assert.deepEqual(v1Laksa.base, food('Laksa').base);
  assert.equal(v1Laksa.servings, 2);
  assert.equal(dayTotals(day({ Lunch: [v1Laksa] })).sodium, 3176);

  assert.deepEqual(upgradeBase('Char kway teow', { satFat: 6, transFat: 0.5, addedSugar: 5, fiber: 2.5, omega3: 30 }), food('Char kway teow').base);
  assert.deepEqual(upgradeBase('Satay, chicken (4 sticks)', { satFat: 2, transFat: 0.1, addedSugar: 4, fiber: 0.5, omega3: 50 }), food('Chicken satay, with sauce').base);
});

test('edited or custom entries keep their numbers and split omega-3 by food type', () => {
  // Same name as a built-in but the user changed sat fat, so it is not overwritten.
  const edited = upgradeBase('Laksa', { satFat: 12, transFat: 0.2, addedSugar: 4, fiber: 2, omega3: 200 });
  assert.equal(edited.satFat, 12);
  assert.equal(edited.sodium, 0);
  assert.equal(edited.omega3, 0);
  assert.equal(edited.ala, 200);

  const fish = upgradeBase('Grilled saba fish', { satFat: 3, transFat: 0, addedSugar: 0, fiber: 0, omega3: 1800 });
  assert.equal(fish.omega3, 1800);
  assert.equal(fish.ala, 0);

  const already = { ...food('Apple').base };
  assert.equal(upgradeBase('Apple', already), already);
});

test('old settings move fiber 15 → 30 but keep custom targets', () => {
  assert.equal(upgradeSettings({ targets: { satFat: 20, fiber: 15, omega3Weekly: 3500 } }).targets.fiber, 30);
  assert.equal(upgradeSettings({ targets: { satFat: 13, fiber: 25 } }).targets.fiber, 25);
  assert.equal(upgradeSettings({ targets: { satFat: 13, fiber: 25 } }).targets.satFat, 13);
  assert.equal(upgradeSettings({ targets: { fiber: 15 } }).targets.sodium, 2000);
  const nuts = upgradeSettings({ checkFoods: { nuts: { name: 'Walnuts', serving: '28g', servings: 1, base: { satFat: 1.7, transFat: 0, addedSugar: 0, fiber: 1.9, omega3: 2500 } } } });
  assert.equal(nuts.checkFoods.nuts.base.ala, 2500);
  assert.equal(nuts.checkFoods.nuts.base.omega3, 0);
});

test('every legacy row points at a food that exists', () => {
  for (const row of LEGACY) assert.ok(food(row[6]), row[6]);
});

test('food database rows are complete', () => {
  assert.equal(new Set(FOODS.map(f => f.name)).size, FOODS.length, 'duplicate food names');
  for (const f of FOODS) {
    assert.ok(f.name && f.serving, f.name);
    assert.equal(Object.keys(f.base).length, 7, f.name);
    for (const v of Object.values(f.base)) assert.ok(Number.isFinite(v) && v >= 0, f.name);
  }
});
