import crypto from 'node:crypto';
import { db, json, bad, existingFor, config, cleanHandle, validXHandle, aliveCount, ownedAlive, isOffensive } from '../lib/api.mjs';
import { CADENCES, DEV_BUYS } from '../../shared/wallets.js';

const COLORS = ['#FFB21A', '#FF6A1A', '#C6FF3D', '#7AA7FF', '#FF8BD1', '#F4EFE6', '#FFD23F', '#8FE3CF'];
const field = (v, min, max) => { const s = String(v || '').trim().replace(/\s+/g, ' '); return s.length >= min && s.length <= max ? s : null; };

// Step 1: someone fills in the Hatch form. We hold it and hand back a code to post from their X account.
export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const cfg = config();
  if (!cfg.hatchOpen) return bad('Hatching is closed right now.', 403);

  const body = await req.json().catch(() => ({}));
  const owner = cleanHandle(body.owner);
  if (!validXHandle(owner)) return bad('Enter your X username, like @yourname.');
  const name = field(body.name, 2, 20);
  const species = field(body.species, 3, 30) || 'Apis Novus';
  const persona = field(body.persona, 10, 240);
  const strategy = field(body.strategy, 10, 240);
  if (!name) return bad('Give your agent a name (2 to 20 characters).');
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) return bad('Names can only use letters, numbers, spaces, - and _.');
  if (!persona) return bad('Describe its personality in 10 to 240 characters.');
  if (!strategy) return bad('Describe its launch strategy in 10 to 240 characters.');
  if ([name, species, persona, strategy].some(isOffensive)) return bad('That agent would not pass the colony\'s rules. Tone it down.');
  const every = Number(body.launch_every_min);
  if (!CADENCES.includes(every)) return bad('Pick how often it launches from the list.');
  const devBuy = Number(body.dev_buy_sol);
  if (!DEV_BUYS.includes(devBuy)) return bad('Pick a dev buy from the list.');

  const handle = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  if (handle.length < 2) return bad('That name needs at least two letters or numbers.');
  const { data: clash } = await db.from('agents').select('id').eq('handle', handle).maybeSingle();
  if (clash) return bad('An agent with that name already exists. Pick another.');

  if ((await aliveCount()) >= cfg.maxAlive) return bad('The hive is full. A slot opens at the next evolution, try again then.', 409);
  if ((await ownedAlive(owner)) >= cfg.agentsPerOwner) return json({ error: `@${owner} already has an agent alive in the hive. When it dies, you can hatch another.`, existing: await existingFor(owner) }, 409);

  const code = 'HIVE-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  await db.from('hatch_requests').insert({
    code, owner, handle, name, species, persona, strategy, color, launch_every_min: every, dev_buy_sol: devBuy,
    expires_at: new Date(Date.now() + 30 * 60e3).toISOString(),
  });
  const post = `Hatching ${name} into the hive. ${code}\n${(process.env.SITE_URL || 'https://usehives.fun').replace(/\/$/, '')}`;
  return json({ code, post, intent: 'https://x.com/intent/post?text=' + encodeURIComponent(post) });
};
