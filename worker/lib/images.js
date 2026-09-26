import { db } from './db.js';

const BUCKET = 'coins';
let modelCache = null;

// Picks the image model: IMAGE_MODEL if set, otherwise asks OpenRouter which
// image models exist right now (so a renamed model id never breaks launches).
async function imageModel() {
  if (process.env.IMAGE_MODEL) return process.env.IMAGE_MODEL;
  if (modelCache) return modelCache;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models?output_modalities=image');
    const { data = [] } = await res.json();
    const ids = data.map((m) => m.id);
    modelCache =
      ids.find((id) => /gemini.*flash.*image/i.test(id) && !/preview/i.test(id)) ||
      ids.find((id) => /gemini.*image/i.test(id)) ||
      ids[0] ||
      'google/gemini-2.5-flash-image';
  } catch {
    modelCache = 'google/gemini-2.5-flash-image';
  }
  console.log('image model:', modelCache);
  return modelCache;
}

function dataUrlToImage(url) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url || '');
  if (!m) return null;
  return { buf: Buffer.from(m[2], 'base64'), type: m[1] };
}

async function openrouterImage(prompt) {
  const model = await imageModel();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.SITE_URL || 'https://usehives.fun',
      'X-Title': 'Hives',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '1:1' },
      messages: [{
        role: 'user',
        content: `Create a square memecoin logo image. ${prompt}. Bold, simple, eye-catching, centred subject, works as a small circular token icon. No text, no letters, no watermark.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`openrouter image ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const img = json.choices?.[0]?.message?.images?.[0];
  const url = img?.image_url?.url || img?.imageUrl?.url;
  const out = dataUrlToImage(url);
  if (!out) throw new Error('openrouter returned no image');
  return out;
}

async function pollinationsImage(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pollinations ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/jpeg' };
}

// Generates the coin image: OpenRouter first, Pollinations as a backup.
export async function makeImage(prompt) {
  try {
    return await openrouterImage(prompt);
  } catch (e) {
    console.error('openrouter image failed, using backup:', e.message);
    return await pollinationsImage(prompt);
  }
}

// Stores the exact image we generated in Supabase Storage and returns a public
// link, so the site shows it instantly instead of waiting on IPFS.
let bucketReady = false;
export async function storeImage(image, symbol) {
  if (!bucketReady) {
    const { error } = await db.storage.createBucket(BUCKET, { public: true });
    if (error && !/exist/i.test(error.message)) console.error('bucket', error.message);
    bucketReady = true;
  }
  const ext = (image.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const path = `${Date.now()}-${String(symbol).toLowerCase()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, image.buf, { contentType: image.type, upsert: true });
  if (error) { console.error('image store failed', error.message); return null; }
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
