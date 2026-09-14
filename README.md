# WellTrack

A phone-first food tracker for heart health. It sets daily limits for saturated fat, trans fat, added sugar and sodium, and goals for fiber, plant omega-3 (ALA) and fish omega-3 (EPA+DHA, weekly). It also has a daily checklist of heart-healthy foods. The food list covers Singapore hawker dishes, with saturated fat, sodium and fiber from Health Promotion Board figures where published, and Claude can estimate nutrients from a photo or a dish name.

It's a static web app with no build step and no server. Your data stays in your browser.

## Features

- **Log any day.** Step back through past days to add, edit or delete entries. You can also copy yesterday's meal.
- **Fast adding.** Favourites, recent foods and your saved foods show at the top, and search needs only a few letters of each word.
- **Photo or name → nutrients** with Claude, using your own Anthropic API key. You can review and edit the numbers before saving.
- **History.** A 7- or 30-day chart for each nutrient, averages, the share of days within limits, and a calendar with a status dot for each day.
- **Your targets.** Set every limit and goal yourself.
- **Offline and installable.** Add it to your home screen, and updates arrive with a "Reload" prompt.
- **Backup and restore** as JSON, plus CSV export. Backup files from the old WellTrack import directly.
- Dark mode, large tap targets, screen-reader labels.

## Run locally

```bash
python -m http.server 8080
```

Then open http://localhost:8080 (or double-click `serve.bat`).

## Tests

```bash
node --test "tests/*.test.js"
```

GitHub Actions runs these on every push.

## Deploy to GitHub Pages

1. Create an empty repository on GitHub (for example `welltrack`) and push this folder to `main`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Each push to `main` runs the tests and then deploys to `https://<username>.github.io/welltrack/`.

The deploy stamps the commit SHA into `sw.js`, so each release gets a fresh offline cache.

## Moving from the old WellTrack

Browser storage belongs to one web address, so the new address starts out empty:

1. In the old app, open **⚙️ Settings → Export backup**.
2. In the new app, open **Settings → Restore backup** and pick that file.

This brings over your logs, photos, checklist ticks, favourites and saved foods. Then enter your API key again, because backups never include it.

## Layout

```
index.html            app shell
css/app.css           styles (light + dark)
js/core.js            pure logic: totals, streaks, search, migration, CSV (unit-tested)
js/foods.js           built-in food database
js/store.js           localStorage + IndexedDB (photos)
js/ai.js              Claude API calls with structured JSON output
js/app.js             UI rendering and events
sw.js                 offline cache
tests/core.test.js    node:test suite
tools/mark.py         draws every icon in icons/ (python tools/mark.py; needs Pillow)
```

## Privacy

Your logs and photos never leave the device. A photo or dish name goes to Anthropic only when you ask for an estimate. The API key is stored in this browser and sent only to `api.anthropic.com`.
