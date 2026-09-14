// Nutrition estimates from Claude. Called straight from the browser with the user's own key,
// so this is only suitable for a personal app — the key never leaves this device except to Anthropic.
import { cleanBase } from './core.js';

export const MODELS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — better with mixed plates' },
];

// Structured outputs guarantee the reply matches this shape, so no regex-scraping JSON out of prose.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'name', 'serving', 'satFat', 'transFat', 'addedSugar', 'sodium', 'fiber', 'omega3', 'ala',
    'cholesterol', 'solubleFiber', 'sterols', 'nuts', 'confidence'],
  properties: {
    found: { type: 'boolean', description: 'false if no food can be identified' },
    name: { type: 'string', description: 'Specific dish name, e.g. "Char kway teow"' },
    serving: { type: 'string', description: 'The portion the numbers describe, e.g. "1 plate"' },
    satFat: { type: 'number', description: 'Saturated fat, grams' },
    transFat: { type: 'number', description: 'Trans fat, grams' },
    addedSugar: { type: 'number', description: 'Added sugar, grams' },
    sodium: { type: 'number', description: 'Sodium, milligrams, including sauces, gravy and soup' },
    fiber: { type: 'number', description: 'Dietary fiber, grams' },
    omega3: { type: 'number', description: 'EPA+DHA omega-3 from fish and seafood only, milligrams' },
    ala: { type: 'number', description: 'Plant omega-3 (ALA) from seeds, nuts, oils and vegetables, milligrams' },
    cholesterol: { type: 'number', description: 'Dietary cholesterol, milligrams (eggs, organ meat, shellfish, squid, animal fat)' },
    solubleFiber: { type: 'number', description: 'Soluble (viscous) fiber, grams (oats, barley, psyllium, beans, okra, aubergine, fruit pectin)' },
    sterols: { type: 'number', description: 'Plant sterols and stanols, milligrams; natural foods give tens of mg, fortified products far more' },
    nuts: { type: 'number', description: 'Grams of tree nuts or peanuts in the serving (0 if none)' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

// Anchors from Singapore Health Promotion Board figures keep hawker estimates from drifting low.
const GUIDE = `You are a nutritionist who knows Singapore hawker and wider Asian food well, as well as Western food.
Estimate nutrients for one serving of the portion described. Hawker portions are large and cooked with lard, ghee,
coconut milk, palm oil and salty sauces, so do not underestimate. For scale, Health Promotion Board figures per plate/bowl:
char kway teow 29 g saturated fat, 1,460 mg sodium, 234 mg cholesterol; laksa 18 g, 1,590 mg, 81 mg;
roasted chicken rice 8.7 g, 1,290 mg, 47 mg; nasi lemak 7.6 g, 840 mg, 76 mg; fishball noodle soup 2.4 g, 2,910 mg, 40 mg;
mee siam 8.6 g, 2,660 mg, 138 mg; kway chap 11.6 g, 2,300 mg, 348 mg.
Only count EPA+DHA as omega3 (fish, seafood); count plant omega-3 as ala.
If the input is not a food, set found to false and use 0 for every number.`;

async function call({ apiKey, model, content }) {
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  if (location.protocol === 'file:') throw new Error('Open WellTrack from its web address — browsers block API calls from local files.');

  const body = {
    model,
    max_tokens: 2048,
    system: GUIDE,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  };
  // Sonnet 5 thinks by default; low effort keeps a quick estimate quick. Haiku 4.5 rejects effort.
  if (model !== 'claude-haiku-4-5') body.output_config.effort = 'low';

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error — check your connection.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = {
      401: 'That API key was rejected — check it in Settings.',
      403: 'This API key isn’t allowed to use that model.',
      429: 'Rate limited — wait a moment and try again.',
      529: 'Claude is busy — try again shortly.',
    }[res.status];
    throw new Error(msg || err.error?.message || `Claude API error ${res.status}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declined to analyse this.');
  if (data.stop_reason === 'max_tokens') throw new Error('The reply was cut off — try again.');
  const text = data.content?.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('Empty reply from Claude.');

  const r = JSON.parse(text);
  if (!r.found) throw new Error('Couldn’t spot a food there — try entering it by hand.');
  return { name: r.name, serving: r.serving, base: cleanBase(r), confidence: r.confidence, source: 'ai' };
}

export function estimateByName(name, settings) {
  return call({
    apiKey: settings.apiKey, model: settings.model,
    content: `Food: ${JSON.stringify(name)}\nUse the typical serving for this food.`,
  });
}

export function estimateFromPhoto(dataUrl, settings) {
  const [, mediaType, data] = dataUrl.match(/^data:([^;]+);base64,(.+)$/) || [];
  if (!data) throw new Error('Unreadable image.');
  return call({
    apiKey: settings.apiKey, model: settings.model,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: 'Identify the main dish in this photo and estimate nutrients for the portion shown.' },
    ],
  });
}

// Downscale before storing or sending: phone photos are 3–8 MB.
export function resizeImage(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image.')); };
    img.src = url;
  });
}
