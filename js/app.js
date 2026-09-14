import {
  NUTRIENT_KEYS, limitRatio, nutrient, MEALS, CHECKLIST, todayKey, addDays, parseDateKey, toDateKey, fmt, num, round,
  cleanBase, itemValue, emptyDay, dayItems, dayTotals, totals, computeStreak, sumRange, series, summarize,
  searchFoods, recentFoods, foodKey, normalizeBackup, toCSV, mealForTime,
} from './core.js';
import { FOODS } from './foods.js';
import { loadAll, save, upsertFood, photos, extractPhotos, migrateFromV1IfPresent } from './store.js';
import { MODELS, estimateByName, estimateFromPhoto, resizeImage } from './ai.js';

const APP_VERSION = '2.2.0';
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dp = key => nutrient(key).dp;
const unitOf = key => nutrient(key).unit;
const labelOf = key => nutrient(key).label;

let S;

// ── Persistence helpers ───────────────────────────────────────
function persist(...keys) {
  const failed = keys.filter(k => !save[k](S[k]));
  if (failed.length) toast('Couldn’t save — this device’s storage is full. Export a backup in Settings.');
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" data-act="toast:action">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  toast.action = action?.run;
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3500);
}

// ── Shared bits ───────────────────────────────────────────────
function meter(key, value, target) {
  const { unit: u, dp: d, kind } = nutrient(key);
  const avoid = kind === 'limit' && target === 0; // "none": over once it reaches a label-visible 0.5 g
  const pct = avoid ? (limitRatio(value, 0) ? 1.01 : 0) : target ? value / target : 0;
  const state = kind === 'limit' ? (pct > 1 ? 'over' : pct > 0.75 ? 'close' : 'good') : (pct >= 1 ? 'met' : 'progress');
  const note = avoid ? (pct > 1 ? 'Avoid' : 'None ✓')
    : kind === 'limit'
      ? (pct > 1 ? `${fmt(value - target, d)}${u} over` : `${fmt(target - value, d)}${u} left`)
      : (pct >= 1 ? 'Goal met ✓' : `${fmt(target - value, d)}${u} to go`) + (kind === 'weekly' ? ' · 7 days' : '');
  const of = avoid ? 'none' : key === 'solubleFiber' ? `${target}–${Math.max(target, 20)}${u}` : `${target}${u}`;
  return `
    <div class="meter ${state}">
      <div class="meter-top"><span>${labelOf(key)}</span><span class="note">${note}</span></div>
      <div class="bar" role="progressbar" aria-label="${labelOf(key)}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${round(value, d)}"><i style="width:${Math.min(pct, 1) * 100}%"></i></div>
      <div class="meter-val"><b>${fmt(value, d)}${avoid ? u : ''}</b> / ${of}</div>
    </div>`;
}

// Short per-food line, LDL levers first; nuts, sterols and fish omega-3 only when present.
const foodSummary = (get) => {
  const extra = [
    get('nuts') >= 1 && `${fmt(get('nuts'), 0)}g nuts`,
    get('sterols') >= 300 && `${fmt(get('sterols'), 0)}mg sterols`,
    get('omega3') >= 100 && `${fmt(get('omega3'), 0)}mg fish ω-3`,
  ].filter(Boolean);
  return [`${fmt(get('satFat'))}g sat`, `${fmt(get('solubleFiber'))}g soluble fiber`, `${fmt(get('cholesterol'), 0)}mg chol`,
    `${fmt(get('sodium'), 0)}mg sodium`, ...extra].join(' · ');
};
const itemSummary = it => foodSummary(k => itemValue(it, k));

function dayLabel(key) {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, -1)) return 'Yesterday';
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: 'long' });
}

// ── Log view ──────────────────────────────────────────────────
function viewLog() {
  const t = S.settings.targets, key = S.date, day = S.logs[key] || emptyDay();
  const tot = dayTotals(day), isToday = key === todayKey();
  const omega = sumRange(S.logs, key, 7, 'omega3');
  const streak = computeStreak(S.logs, t);
  const checks = S.checks[key] || {};
  const yesterday = S.logs[addDays(key, -1)];

  return `
    <header class="daynav">
      <button type="button" class="icon" data-act="day:prev" aria-label="Previous day">‹</button>
      <div class="daynav-title">
        <h1>${dayLabel(key)}</h1>
        <p>${parseDateKey(key).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <button type="button" class="icon" data-act="day:next" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </header>
    ${isToday ? '' : '<button type="button" class="pill center" data-act="day:today">Jump to today</button>'}

    <section class="card">
      <h2 class="eyebrow">Cholesterol (LDL) levers</h2>
      <div class="grid3">
        ${['satFat', 'cholesterol', 'transFat', 'solubleFiber', 'sterols', 'nuts'].map(k => meter(k, tot[k], t[k])).join('')}
      </div>
      <h2 class="eyebrow gap">Also important</h2>
      <div class="grid2">
        ${['sodium', 'addedSugar', 'fiber'].map(k => meter(k, tot[k], t[k])).join('')}
        ${meter('omega3', omega, t.omega3Weekly)}
      </div>
    </section>

    ${isToday ? `<p class="streak ${streak ? 'on' : ''}">${streak
      ? `🔥 <b>${streak}-day streak</b> within all limits`
      : 'Log meals and stay within limits to start a streak'}</p>` : ''}

    <section class="card">
      <div class="row-between">
        <h2 class="eyebrow">Heart-healthy foods</h2>
        <span class="count">${CHECKLIST.filter(c => checks[c.id]).length}/${CHECKLIST.length}</span>
      </div>
      <div class="chips">
        ${CHECKLIST.map(c => `<button type="button" class="chip ${checks[c.id] ? 'on' : ''}" data-act="check" data-id="${c.id}" aria-pressed="${!!checks[c.id]}">${c.emoji} ${c.label}</button>`).join('')}
      </div>
      <p class="hint">Tap to log it to ${mealForTime().toLowerCase()} · tap again to remove</p>
    </section>

    ${MEALS.map(meal => {
      const items = day[meal] || [];
      const mt = totals(items);
      const canCopy = !items.length && (yesterday?.[meal] || []).length;
      return `
      <section class="card meal">
        <header class="row-between">
          <div><h2>${meal}</h2>${items.length ? `<span class="sub">${fmt(mt.satFat)}g sat · ${fmt(mt.sodium, 0)}mg sodium · ${fmt(mt.fiber)}g fiber</span>` : ''}</div>
          <button type="button" class="btn small" data-act="meal:add" data-meal="${meal}">+ Add</button>
        </header>
        ${items.length ? `<ul class="items">${items.map(it => `
          <li>
            <button type="button" class="item" data-act="item:edit" data-meal="${meal}" data-id="${esc(it.id)}">
              ${it.photoId ? `<img alt="" data-photo="${esc(it.photoId)}">` : ''}
              <span class="item-text">
                <span class="name">${esc(it.name)}</span>
                <span class="sub">${esc(it.serving)}${it.servings !== 1 ? ` × ${fmt(it.servings, 2)}` : ''} · ${itemSummary(it)}</span>
              </span>
            </button>
            <button type="button" class="icon del" data-act="item:del" data-meal="${meal}" data-id="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">×</button>
          </li>`).join('')}</ul>`
        : `<p class="empty">Nothing logged${canCopy ? ` · <button type="button" class="link" data-act="meal:copy" data-meal="${meal}">Copy yesterday’s ${meal.toLowerCase()}</button>` : ''}</p>`}
      </section>`;
    }).join('')}
  `;
}

// ── History view ──────────────────────────────────────────────
function chart(points, metric, target) {
  const W = 320, H = 120, pad = 4, n = points.length, bw = (W - pad * 2) / n;
  const max = Math.max(target * 1.5, ...points.map(p => p.totals[metric]));
  const y = v => H - (v / max) * H;
  const kind = nutrient(metric).kind;
  const cls = v => (kind === 'limit' ? (v > target ? 'over' : v > target * 0.75 ? 'close' : 'good') : (v >= target ? 'good' : 'progress'));
  return `
    <svg viewBox="0 0 ${W} ${H + 18}" class="chart" role="img" aria-label="${labelOf(metric)} over the last ${n} days">
      ${points.map((p, i) => {
        const v = p.totals[metric];
        const h = p.logged ? Math.max(H - y(v), 2) : 2;
        const x = pad + i * bw + bw * 0.15;
        const label = n <= 7 ? parseDateKey(p.key).toLocaleDateString(undefined, { weekday: 'narrow' })
          : (i % 5 === 4 || i === n - 1) ? String(parseDateKey(p.key).getDate()) : '';
        return `<g data-act="cal:day" data-key="${p.key}" class="bar-g">
          <title>${p.key}: ${fmt(v, dp(metric))}${unitOf(metric)}</title>
          <rect x="${pad + i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>
          <rect x="${x}" y="${H - h}" width="${bw * 0.7}" height="${h}" rx="2" class="${p.logged ? cls(v) : 'none'}"/>
          ${label ? `<text x="${x + bw * 0.35}" y="${H + 14}" text-anchor="middle">${label}</text>` : ''}
        </g>`;
      }).join('')}
      <line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" class="target"/>
    </svg>`;
}

// Everything with a target except trans fat, whose target is "none" and so has no useful bar chart.
const HISTORY_METRICS = ['satFat', 'cholesterol', 'solubleFiber', 'sterols', 'nuts', 'sodium', 'addedSugar', 'fiber', 'omega3'];

function viewHistory() {
  const t = S.settings.targets, today = todayKey();
  const metric = S.histMetric, range = S.histRange;
  const target = metric === 'omega3' ? t.omega3Weekly / 7 : t[metric];
  const points = series(S.logs, today, range, t);
  const sum = summarize(points);

  const [cy, cm] = S.calMonth.split('-').map(Number);
  const first = new Date(cy, cm - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(cy, cm, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => toDateKey(new Date(cy, cm - 1, i + 1)))];
  const statusOf = k => series(S.logs, k, 1, t)[0].status;

  return `
    <header class="page-head"><h1>History</h1></header>
    <section class="card">
      <div class="row-between">
        <select class="metric-pick" data-hist-metric aria-label="Nutrient">
          ${HISTORY_METRICS.map(k => `<option value="${k}" ${metric === k ? 'selected' : ''}>${labelOf(k)}</option>`).join('')}
        </select>
        <div class="seg" role="group" aria-label="Range">
          ${[7, 30].map(r => `<button type="button" data-act="hist:range" data-range="${r}" aria-pressed="${range === r}">${r}d</button>`).join('')}
        </div>
      </div>
      ${chart(points, metric, target)}
      <div class="stats">
        <div><b>${sum.loggedDays}</b><span>days logged</span></div>
        <div><b>${sum.loggedDays ? Math.round((sum.withinLimits / sum.loggedDays) * 100) : 0}%</b><span>within limits</span></div>
        <div><b>${fmt(sum.avg[metric], dp(metric))}${unitOf(metric)}</b><span>daily avg ${labelOf(metric).toLowerCase()}</span></div>
      </div>
      <p class="hint">Dashed line: ${metric === 'omega3' ? 'weekly fish omega-3 target ÷ 7' : 'your daily target'}. Tap a bar to open that day.</p>
    </section>

    <section class="card">
      <div class="row-between">
        <button type="button" class="icon" data-act="cal:month" data-dir="-1" aria-label="Previous month">‹</button>
        <h2>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button type="button" class="icon" data-act="cal:month" data-dir="1" aria-label="Next month" ${S.calMonth >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal">
        ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="dow">${d}</span>`).join('')}
        ${cells.map(k => {
          if (!k) return '<span></span>';
          const future = k > today;
          return `<button type="button" class="calday ${k === today ? 'today' : ''} s-${statusOf(k)}" data-act="cal:day" data-key="${k}" ${future ? 'disabled' : ''}
            aria-label="${parseDateKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}">${Number(k.slice(8))}<i></i></button>`;
        }).join('')}
      </div>
      <div class="legend"><span class="s-good"><i></i>On track</span><span class="s-close"><i></i>Near limit</span><span class="s-over"><i></i>Over</span></div>
    </section>
    <button type="button" class="btn block ghost" data-act="export:csv">Export all logs as CSV</button>
  `;
}

// ── Settings view ─────────────────────────────────────────────
function viewSettings() {
  const st = S.settings, t = st.targets;
  const field = ([k, label]) => `<label class="field"><span>${label}</span><input type="number" inputmode="decimal" min="0" step="any" data-setting="targets.${k}" value="${t[k]}"></label>`;
  return `
    <header class="page-head"><h1>Settings</h1></header>

    <section class="card">
      <h2>Targets</h2>
      <h3 class="eyebrow gap">Cholesterol (LDL) levers</h3>
      <div class="fields">
        ${[['satFat', 'Saturated fat (g, max/day)'], ['cholesterol', 'Dietary cholesterol (mg, max/day)'],
          ['transFat', 'Trans fat (g, max/day; 0 = avoid, flags from 0.5 g)'], ['solubleFiber', 'Soluble fiber (g, min/day; 10–20 useful)'],
          ['sterols', 'Plant sterols/stanols (mg, min/day)'], ['nuts', 'Nuts (g, min/day)']].map(field).join('')}
      </div>
      <h3 class="eyebrow gap">Also important</h3>
      <div class="fields">
        ${[['sodium', 'Sodium (mg, max/day)'], ['addedSugar', 'Added sugar (g, max/day)'], ['fiber', 'Total fiber (g, min/day)'],
          ['omega3Weekly', 'Fish omega-3, EPA+DHA (mg, min/week)']].map(field).join('')}
      </div>
    </section>

    <section class="card">
      <h2>AI food recognition</h2>
      <p class="hint">Snap a meal or type a dish name and Claude estimates the nutrients. Uses your own Anthropic API key (console.anthropic.com → API Keys); each estimate costs a fraction of a cent.</p>
      <label class="field"><span>Anthropic API key</span>
        <span class="with-btn">
          <input type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" data-setting="apiKey" value="${esc(st.apiKey)}" id="apikey">
          <button type="button" class="btn small ghost" data-act="key:toggle">Show</button>
        </span>
      </label>
      <label class="field"><span>Model</span>
        <select data-setting="model">${MODELS.map(m => `<option value="${m.id}" ${m.id === st.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      </label>
      <p class="hint">The key is stored only on this device and sent only to Anthropic. It is never included in backups.</p>
    </section>

    <section class="card">
      <h2>Evening reminder</h2>
      <label class="toggle"><input type="checkbox" data-setting="reminder.enabled" ${st.reminder.enabled ? 'checked' : ''}><span>Remind me about unticked heart-healthy foods</span></label>
      <label class="field"><span>Time</span><input type="time" data-setting="reminder.time" value="${st.reminder.time}"></label>
      <p class="hint">Web apps can only notify while WellTrack is open or recently used, so treat this as a nudge, not an alarm.</p>
    </section>

    <section class="card">
      <h2>Your data</h2>
      <p class="hint">Everything lives on this device. Export a backup now and then — it’s also how you move to a new phone. Backups from the old WellTrack import too.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-act="export:json">Export backup</button>
        <label class="btn ghost">Restore backup<input type="file" accept="application/json,.json" data-act-change="import" hidden></label>
      </div>
      <button type="button" class="btn block ghost" data-act="export:csv">Export logs as CSV</button>
      <p class="hint" id="storage-info"></p>
    </section>

    <p class="footer">WellTrack ${APP_VERSION} · ${Object.keys(S.logs).length} days logged</p>
  `;
}

// ── Add / edit sheet ──────────────────────────────────────────
const allFoods = () => {
  const seen = new Set();
  return [...S.foods, ...FOODS].filter(f => { const k = foodKey(f.name); if (seen.has(k)) return false; seen.add(k); return true; });
};

function openAdd(meal) {
  S.sheet = { mode: 'add', meal, step: 'pick', query: '', list: [], draft: null, busy: '', error: '' };
  renderSheet();
  $('#sheet input[type=search]')?.focus();
}

function openEdit(meal, id) {
  const it = (S.logs[S.date]?.[meal] || []).find(x => String(x.id) === id);
  if (!it) return;
  S.sheet = {
    mode: 'edit', meal, itemId: it.id, step: 'form', busy: '', error: '',
    draft: { name: it.name, serving: it.serving, servings: it.servings, base: { ...it.base }, meal, photo: null, photoId: it.photoId || null, photoRemoved: false, source: 'user', saveFood: false, checkId: it.checkId },
  };
  renderSheet();
  if (it.photoId) photos.get(it.photoId).then(p => { if (S.sheet?.draft && p) { S.sheet.draft.photo = p; renderSheet(); } });
}

function startDraft(food, extra = {}) {
  S.sheet.draft = {
    name: food.name || '', serving: food.serving || '1 serving', servings: 1,
    base: { ...cleanBase(food.base) }, meal: S.sheet.meal, photo: null, photoId: null,
    source: food.source || 'user', saveFood: !!food.isNew, photoRemoved: false, ...extra,
  };
  S.sheet.step = 'form';
  S.sheet.error = '';
}

function pickRow(f, i) {
  const fav = S.favs.includes(foodKey(f.name));
  return `<li class="pick">
    <button type="button" class="pick-main" data-act="pick:food" data-i="${i}">
      <span class="name">${esc(f.name)}${f.tag ? ` <em class="tag">${f.tag}</em>` : ''}</span>
      <span class="sub">${esc(f.serving)} · ${foodSummary(k => f.base[k] || 0)}</span>
    </button>
    <button type="button" class="icon star ${fav ? 'on' : ''}" data-act="fav:toggle" data-key="${esc(foodKey(f.name))}" aria-pressed="${fav}" aria-label="Favourite ${esc(f.name)}">★</button>
  </li>`;
}

function renderPickList() {
  const sh = S.sheet, q = sh.query.trim();
  const groups = [];
  if (q) {
    groups.push(['Matches', searchFoods(allFoods(), q).slice(0, 60)]);
  } else {
    const favs = allFoods().filter(f => S.favs.includes(foodKey(f.name)));
    if (favs.length) groups.push(['Favourites', favs]);
    const recent = recentFoods(S.logs, 8).filter(f => !S.favs.includes(foodKey(f.name)));
    if (recent.length) groups.push(['Recent', recent]);
    if (S.foods.length) groups.push(['My foods', S.foods.slice(0, 15)]);
    groups.push(['Food list', FOODS]);
  }
  sh.list = [];
  const html = groups.map(([title, foods]) => `
    <h3 class="eyebrow">${title}</h3>
    <ul class="picks">${foods.map(f => { sh.list.push(f); return pickRow(f, sh.list.length - 1); }).join('')}</ul>`).join('');
  $('#pick-list').innerHTML = html + (q && !sh.list.length ? `<p class="empty">No match for “${esc(q)}”.</p>` : '') +
    (q ? `<button type="button" class="btn block ghost" data-act="pick:custom">Add “${esc(q)}” as a new food${S.settings.apiKey ? ' (AI can estimate it)' : ''}</button>` : '');
}

function previewText(d) {
  const s = num(d.servings) || 0;
  return `This adds ${NUTRIENT_KEYS.map(k => `${fmt(num(d.base[k]) * s, dp(k))}${unitOf(k)} ${labelOf(k).toLowerCase()}`).join(' · ')}`;
}

function renderSheet() {
  const root = $('#sheet');
  const sh = S.sheet;
  document.body.classList.toggle('locked', !!sh);
  if (!sh) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  const hasKey = !!S.settings.apiKey;
  const title = sh.mode === 'edit' ? 'Edit entry' : `Add to ${sh.meal}`;

  let body;
  if (sh.step === 'pick') {
    body = `
      <div class="sheet-tools">
        <input type="search" placeholder="Search foods — laksa, salmon, oats…" value="${esc(sh.query)}" data-input="query" aria-label="Search foods" enterkeyhint="search">
        <div class="btn-row">
          <label class="btn ghost">📷 ${hasKey ? 'Photo → AI' : 'Photo'}<input type="file" accept="image/*" data-act-change="photo" hidden></label>
          <button type="button" class="btn ghost" data-act="pick:custom">✏️ New food</button>
        </div>
      </div>
      <div id="pick-list" class="sheet-scroll"></div>`;
  } else {
    const d = sh.draft;
    body = `
      <form class="sheet-scroll form" data-form="item" novalidate>
        ${sh.busy ? `<p class="banner busy" role="status"><span class="spin" aria-hidden="true"></span>${esc(sh.busy)}</p>` : ''}
        ${sh.error ? `<p class="banner error" role="alert">${esc(sh.error)}</p>` : ''}
        ${d.confidence ? `<p class="banner ai">✨ Claude’s estimate (${d.confidence} confidence) — check the numbers before saving.</p>` : ''}
        ${d.photo ? `<div class="photo-row"><img src="${d.photo}" alt="Meal photo"><button type="button" class="link" data-act="photo:remove">Remove photo</button></div>` : ''}
        <label class="field"><span>Food</span>
          <span class="with-btn">
            <input type="text" data-field="name" value="${esc(d.name)}" placeholder="e.g. Fish soup" required>
            ${hasKey ? `<button type="button" class="btn small" data-act="form:estimate" ${sh.busy ? 'disabled' : ''}>✨ Estimate</button>` : ''}
          </span>
        </label>
        <div class="grid2">
          <label class="field"><span>Serving</span><input type="text" data-field="serving" value="${esc(d.serving)}"></label>
          <label class="field"><span>Servings</span>
            <span class="stepper">
              <button type="button" class="icon" data-act="form:step" data-dir="-1" aria-label="Fewer servings">−</button>
              <input type="number" inputmode="decimal" min="0" step="0.25" data-field="servings" value="${d.servings}">
              <button type="button" class="icon" data-act="form:step" data-dir="1" aria-label="More servings">+</button>
            </span>
          </label>
        </div>
        <h3 class="eyebrow">Per serving</h3>
        <div class="grid2">
          ${NUTRIENT_KEYS.map(k => `<label class="field"><span>${labelOf(k)} (${unitOf(k)})</span><input type="number" inputmode="decimal" min="0" step="any" data-field="base.${k}" value="${d.base[k]}"></label>`).join('')}
          <label class="field"><span>Meal</span><select data-field="meal">${MEALS.map(m => `<option ${m === d.meal ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        </div>
        <p class="preview" id="preview">${previewText(d)}</p>
        <label class="toggle"><input type="checkbox" data-field="saveFood" ${d.saveFood ? 'checked' : ''}><span>Save to My foods for next time</span></label>
      </form>`;
  }

  const footer = sh.step === 'form' ? `
    <footer class="sheet-foot">
      ${sh.mode === 'edit' ? '<button type="button" class="btn ghost danger" data-act="form:delete">Delete</button>' : '<button type="button" class="btn ghost" data-act="form:back">Back</button>'}
      <button type="button" class="btn primary" data-act="form:submit" ${sh.busy ? 'disabled' : ''}>${sh.mode === 'edit' ? 'Save' : 'Add'}</button>
    </footer>` : '';

  root.innerHTML = `
    <div class="scrim" data-act="sheet:close"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header class="sheet-head"><h2 id="sheet-title">${title}</h2><button type="button" class="icon" data-act="sheet:close" aria-label="Close">×</button></header>
      ${body}
      ${footer}
    </div>`;
  if (sh.step === 'pick') renderPickList();
}

async function runEstimate(promise, busyMsg) {
  const sh = S.sheet;
  sh.busy = busyMsg; sh.error = '';
  renderSheet();
  try {
    const r = await promise();
    if (S.sheet !== sh) return;
    Object.assign(sh.draft, { name: r.name, serving: r.serving, base: r.base, confidence: r.confidence, source: 'ai', saveFood: true });
  } catch (e) {
    if (S.sheet !== sh) return;
    sh.error = e.message;
  }
  sh.busy = '';
  renderSheet();
}

async function handlePhoto(file) {
  if (!file) return;
  const sh = S.sheet;
  let thumb, big;
  try {
    [thumb, big] = await Promise.all([resizeImage(file, 480, 0.6), resizeImage(file, 1024, 0.82)]);
  } catch (e) { toast(e.message); return; }
  if (sh.step === 'pick') startDraft({ name: '', serving: '1 serving', base: {}, source: 'user', isNew: true });
  Object.assign(sh.draft, { photo: thumb, photoId: null, photoRemoved: false });
  if (S.settings.apiKey) runEstimate(() => estimateFromPhoto(big, S.settings), 'Claude is looking at your photo…');
  else { sh.error = ''; renderSheet(); }
}

async function submitItem() {
  const sh = S.sheet, d = sh.draft;
  if (!d.name.trim()) { sh.error = 'Give the food a name.'; renderSheet(); return; }
  const servings = num(d.servings);
  if (!servings) { sh.error = 'Servings must be more than 0.'; renderSheet(); return; }

  const id = sh.mode === 'edit' ? sh.itemId : `${Date.now()}`;
  let photoId = d.photoId;
  if (d.photo && !photoId) {
    photoId = `p${id}-${Date.now()}`;
    try { await photos.put(photoId, d.photo); } catch { photoId = null; toast('Photo couldn’t be saved on this device.'); }
  }
  if (d.photoRemoved) photoId = null; // in edit mode the photo may still be loading, so don't key off d.photo

  const item = { id, name: d.name.trim(), serving: d.serving.trim() || '1 serving', servings, base: cleanBase(d.base), ...(photoId ? { photoId } : {}), ...(d.checkId ? { checkId: d.checkId } : {}) };
  const day = structuredClone(S.logs[S.date] || emptyDay());
  if (sh.mode === 'edit') {
    const idx = day[sh.meal].findIndex(x => x.id === id);
    if (d.meal === sh.meal && idx >= 0) day[sh.meal][idx] = item;
    else { day[sh.meal] = day[sh.meal].filter(x => x.id !== id); day[d.meal].push(item); }
  } else {
    day[d.meal].push(item);
  }
  S.logs = { ...S.logs, [S.date]: day };

  // Editing an entry made by a checklist tick makes that the food the tick logs from now on.
  if (item.checkId) {
    const { name, serving, servings: n, base } = item;
    S.settings = { ...S.settings, checkFoods: { ...S.settings.checkFoods, [item.checkId]: { name, serving, servings: n, base } } };
    persist('settings');
  }

  if (d.saveFood) {
    S.foods = upsertFood(S.foods, { name: item.name, serving: item.serving, base: item.base, source: d.source === 'ai' ? 'ai' : 'user' });
    persist('logs', 'foods');
  } else {
    persist('logs');
  }
  S.sheet = null;
  renderSheet();
  render();
  toast(sh.mode === 'edit' ? 'Saved' : `Added ${item.name} to ${d.meal}`);
}

function removeItem(meal, id) {
  const before = S.logs[S.date];
  if (!before) return;
  const date = S.date, checksBefore = S.checks[date];
  const it = before[meal].find(x => String(x.id) === id);
  const day = { ...before, [meal]: before[meal].filter(x => String(x.id) !== id) };
  const logs = { ...S.logs, [date]: day };
  if (!dayItems(day).length) delete logs[date];
  S.logs = logs;
  // Deleting the entry a checklist tick created also unticks it, unless another entry for it remains.
  if (it?.checkId && !dayItems(day).some(x => x.checkId === it.checkId)) {
    S.checks = { ...S.checks, [date]: { ...checksBefore, [it.checkId]: false } };
  }
  persist('logs', 'checks');
  render();
  toast(`Removed ${it?.name || 'item'}`, {
    label: 'Undo',
    run: () => { S.logs = { ...S.logs, [date]: before }; S.checks = { ...S.checks, [date]: checksBefore }; persist('logs', 'checks'); render(); },
  });
}

// Ticking a heart-healthy food logs it to the meal for the current time; unticking removes that entry.
function toggleChecklist(checkId) {
  const date = S.date;
  const wasOn = !!S.checks[date]?.[checkId];
  S.checks = { ...S.checks, [date]: { ...(S.checks[date] || {}), [checkId]: !wasOn } };
  const day = structuredClone(S.logs[date] || emptyDay());
  const c = CHECKLIST.find(x => x.id === checkId);

  if (wasOn) {
    // Remove the latest entry this tick created, wherever the user may have moved it.
    const meal = [...MEALS].reverse().find(m => day[m].some(x => x.checkId === checkId));
    if (meal) {
      const idx = day[meal].map(x => x.checkId).lastIndexOf(checkId);
      const [gone] = day[meal].splice(idx, 1);
      toast(`Removed ${gone.name} from ${meal}`);
    }
  } else {
    const meal = mealForTime();
    const src = S.settings.checkFoods?.[checkId] || { ...FOODS.find(f => f.name === c.food), servings: 1 };
    day[meal].push({
      id: `${Date.now()}`, name: src.name, serving: src.serving, servings: src.servings,
      base: cleanBase(src.base), checkId,
    });
    toast(`Added ${src.name} to ${meal} — tap it to change`);
  }

  S.logs = { ...S.logs, [date]: day };
  if (!dayItems(day).length) delete S.logs[date];
  persist('logs', 'checks');
  render();
}

// ── Import / export ───────────────────────────────────────────
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup() {
  const { apiKey, ...settings } = S.settings;
  const data = { app: 'welltrack', version: 2, exportedAt: new Date().toISOString(), logs: S.logs, checks: S.checks, foods: S.foods, favs: S.favs, settings, photos: await photos.all().catch(() => ({})) };
  download(`welltrack-backup-${todayKey()}.json`, JSON.stringify(data), 'application/json');
}

async function importBackup(file) {
  if (!file) return;
  let b;
  try { b = normalizeBackup(JSON.parse(await file.text())); } catch (e) { toast(`Couldn’t read that file: ${e.message}`); return; }
  const days = Object.keys(b.logs).length;
  if (!confirm(`Import ${days} day${days === 1 ? '' : 's'} of logs? Days in the backup replace the same days here; other days are kept.`)) return;
  for (const [id, p] of Object.entries(b.photos)) await photos.put(id, p).catch(() => {});
  await extractPhotos(b.logs);
  S.logs = { ...S.logs, ...b.logs };
  S.checks = { ...S.checks, ...b.checks };
  for (const f of b.foods.slice().reverse()) S.foods = upsertFood(S.foods, f);
  S.favs = [...new Set([...S.favs, ...b.favs])];
  if (b.settings) S.settings = { ...S.settings, ...b.settings, apiKey: S.settings.apiKey };
  persist('logs', 'checks', 'foods', 'favs', 'settings');
  render();
  toast(`Imported ${days} day${days === 1 ? '' : 's'}`);
}

function exportCSV() {
  const csv = toCSV(S.logs);
  if (!csv) { toast('Nothing logged yet.'); return; }
  download(`welltrack-${todayKey()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

// ── Reminder ──────────────────────────────────────────────────
let reminderTimer;
function scheduleReminder() {
  clearTimeout(reminderTimer);
  const r = S.settings.reminder;
  if (!r.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const [h, m] = r.time.split(':').map(Number);
  const now = new Date(), at = new Date();
  at.setHours(h, m, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  reminderTimer = setTimeout(async () => {
    const checks = S.checks[todayKey()] || {};
    const missing = CHECKLIST.filter(c => !checks[c.id]).map(c => c.label.toLowerCase());
    if (missing.length) {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: `Still to go today: ${missing.join(', ')}`, icon: 'icons/icon-192.png', tag: 'welltrack-daily' };
      // Android Chrome only allows notifications through the service worker.
      if (reg) reg.showNotification('WellTrack 💚', opts); else new Notification('WellTrack 💚', opts);
    }
    scheduleReminder();
  }, at - now);
}

// ── Main render ───────────────────────────────────────────────
function render() {
  const main = $('#main');
  main.innerHTML = S.view === 'history' ? viewHistory() : S.view === 'settings' ? viewSettings() : viewLog();
  document.querySelectorAll('#nav [data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === S.view ? 'page' : 'false'));
  main.querySelectorAll('img[data-photo]').forEach(async img => { const p = await photos.get(img.dataset.photo); if (p) img.src = p; else img.remove(); });
  if (S.view === 'settings' && navigator.storage?.estimate) {
    navigator.storage.estimate().then(async ({ usage, quota }) => {
      const persisted = await navigator.storage.persisted?.();
      const el = $('#storage-info');
      if (el) el.textContent = `Using ${(usage / 1048576).toFixed(1)} MB of ${(quota / 1048576).toFixed(0)} MB${persisted ? ' · protected from automatic clearing' : ''}.`;
    });
  }
}

// ── Events ────────────────────────────────────────────────────
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

const actions = {
  'nav': el => { S.view = el.dataset.view; if (S.view === 'log') S.date = S.date > todayKey() ? todayKey() : S.date; render(); scrollTo(0, 0); },
  'day:prev': () => { S.date = addDays(S.date, -1); render(); },
  'day:next': () => { if (S.date < todayKey()) { S.date = addDays(S.date, 1); render(); } },
  'day:today': () => { S.date = todayKey(); render(); },
  'check': el => toggleChecklist(el.dataset.id),
  'meal:add': el => openAdd(el.dataset.meal),
  'meal:copy': el => {
    const meal = el.dataset.meal, src = S.logs[addDays(S.date, -1)]?.[meal] || [];
    const day = structuredClone(S.logs[S.date] || emptyDay());
    day[meal] = src.map((it, i) => ({ ...structuredClone(it), id: `${Date.now()}-${i}` }));
    S.logs = { ...S.logs, [S.date]: day };
    // Copied checklist foods tick their buttons too, so the two stay in step.
    const ticks = Object.fromEntries(src.filter(it => it.checkId).map(it => [it.checkId, true]));
    S.checks = { ...S.checks, [S.date]: { ...(S.checks[S.date] || {}), ...ticks } };
    persist('logs', 'checks'); render(); toast(`Copied ${src.length} item${src.length === 1 ? '' : 's'}`);
  },
  'item:edit': el => openEdit(el.dataset.meal, el.dataset.id),
  'item:del': el => removeItem(el.dataset.meal, el.dataset.id),
  'sheet:close': () => { S.sheet = null; renderSheet(); },
  'pick:food': el => { startDraft(S.sheet.list[Number(el.dataset.i)]); renderSheet(); },
  'pick:custom': () => {
    const name = S.sheet.query.trim();
    startDraft({ name, serving: '1 serving', base: {}, source: 'user', isNew: true });
    if (name && S.settings.apiKey) runEstimate(() => estimateByName(name, S.settings), `Estimating ${name}…`);
    else renderSheet();
  },
  'fav:toggle': el => {
    const k = el.dataset.key;
    S.favs = S.favs.includes(k) ? S.favs.filter(x => x !== k) : [...S.favs, k];
    persist('favs'); renderPickList();
  },
  'form:back': () => { S.sheet.step = 'pick'; S.sheet.draft = null; renderSheet(); },
  'form:step': el => {
    const d = S.sheet.draft;
    d.servings = Math.max(0.25, round(num(d.servings) + 0.25 * Number(el.dataset.dir), 2));
    $('#sheet [data-field=servings]').value = d.servings;
    $('#preview').textContent = previewText(d);
  },
  'form:estimate': () => {
    const name = S.sheet.draft.name.trim();
    if (!name) { S.sheet.error = 'Type a food name first.'; renderSheet(); return; }
    runEstimate(() => estimateByName(name, S.settings), `Estimating ${name}…`);
  },
  'form:submit': () => submitItem(),
  'form:delete': () => { const { meal, itemId } = S.sheet; S.sheet = null; renderSheet(); removeItem(meal, String(itemId)); },
  'photo:remove': () => { Object.assign(S.sheet.draft, { photo: null, photoId: null, photoRemoved: true }); renderSheet(); },
  'hist:range': el => { S.histRange = Number(el.dataset.range); render(); },
  'cal:month': el => {
    const [y, m] = S.calMonth.split('-').map(Number);
    S.calMonth = toDateKey(new Date(y, m - 1 + Number(el.dataset.dir), 1)).slice(0, 7);
    render();
  },
  'cal:day': el => { if (el.dataset.key <= todayKey()) { S.date = el.dataset.key; S.view = 'log'; render(); scrollTo(0, 0); } },
  'export:csv': () => exportCSV(),
  'export:json': () => exportBackup(),
  'key:toggle': el => { const i = $('#apikey'); i.type = i.type === 'password' ? 'text' : 'password'; el.textContent = i.type === 'password' ? 'Show' : 'Hide'; },
  'toast:action': () => { $('#toast').hidden = true; toast.action?.(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.input === 'query') { S.sheet.query = el.value; renderPickList(); return; }
  if (el.dataset.field && S.sheet?.draft) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    setPath(S.sheet.draft, el.dataset.field, v);
    const p = $('#preview');
    if (p) p.textContent = previewText(S.sheet.draft);
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if ('histMetric' in el.dataset) { S.histMetric = el.value; render(); return; }
  if (el.dataset.actChange === 'photo') { await handlePhoto(el.files[0]); el.value = ''; return; }
  if (el.dataset.actChange === 'import') { await importBackup(el.files[0]); el.value = ''; return; }
  if (el.dataset.setting) {
    const path = el.dataset.setting;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (path.startsWith('targets.')) v = num(v);
    if (path === 'apiKey') v = v.trim();
    if (path === 'reminder.enabled' && v && 'Notification' in window && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { v = false; el.checked = false; toast('Notifications are blocked for this site.'); }
    }
    const settings = structuredClone(S.settings);
    setPath(settings, path, v);
    S.settings = settings;
    persist('settings');
    scheduleReminder();
    toast('Saved');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderSheet(); }
  if (e.key === 'Enter' && e.target.closest?.('[data-form=item]') && e.target.tagName === 'INPUT') { e.preventDefault(); submitItem(); }
});

// Midnight rollover: if the app was left on "today", move to the new today.
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = todayKey();
  if (t !== lastToday) { if (S.date === lastToday) S.date = t; lastToday = t; if (!S.sheet) render(); }
});

// Remove photos no entry points to any more (e.g. after deletes).
async function collectPhotoGarbage() {
  const used = new Set(Object.values(S.logs).flatMap(dayItems).map(it => it.photoId).filter(Boolean));
  const all = await photos.all().catch(() => ({}));
  for (const id of Object.keys(all)) if (!used.has(id)) await photos.del(id);
}

// ── Service worker & updates ──────────────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of WellTrack is ready', { label: 'Reload', run: () => sw.postMessage('skipWaiting') });
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// ── Boot ──────────────────────────────────────────────────────
async function boot() {
  const migrated = await migrateFromV1IfPresent().catch(() => false);
  S = { ...loadAll(), view: 'log', date: todayKey(), histMetric: 'satFat', histRange: 7, calMonth: todayKey().slice(0, 7), sheet: null };
  render();
  window.hideSplash?.(); // the splash has already painted, so the fade still runs
  registerSW();
  scheduleReminder();
  navigator.storage?.persist?.().catch(() => {});
  if (migrated) toast('Your WellTrack history was carried over');
  setTimeout(collectPhotoGarbage, 5000);
}
boot();
