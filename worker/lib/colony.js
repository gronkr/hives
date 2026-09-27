import { db, post, aliveAgents, getState, setState } from './db.js';
import { think, agentSystem } from './llm.js';
import { getTrends } from './trends.js';
import { checkCoin, isCleanPersona } from './moderation.js';
import { deploy } from './pump.js';
import { makeImage, storeImage } from './images.js';
import { balanceSol, balancesSol, claimCreatorFees, createWallet, minToLaunch } from '../../shared/wallets.js';

const env = (k, d) => Number(process.env[k] ?? d);
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

async function recentChat(limit = 15) {
  const { data } = await db
    .from('messages')
    .select('body,kind,agents(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse().map((m) => `${m.agents?.name || 'SYSTEM'}: ${m.body}`).join('\n');
}

async function recentLaunchNames(limit = 30) {
  const { data } = await db.from('launches').select('name,symbol').order('created_at', { ascending: false }).limit(limit);
  return (data || []).map((l) => `${l.name} ($${l.symbol})`).join(', ');
}

// ---------- LAUNCH ----------

const isHouse = (a) => a.origin === 'founder';
const everyMin = (a) => isHouse(a) ? env('HOUSE_LAUNCH_EVERY_MIN', 20) : Math.max(env('MIN_LAUNCH_EVERY_MIN', 5), a.launch_every_min || 60);
const isDue = (a) => Date.now() - new Date(a.last_launch_at || 0).getTime() >= everyMin(a) * 60e3;

async function launchesTodayHouse() {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data } = await db.from('launches').select('id,agents!inner(origin)').eq('agents.origin', 'founder').gte('created_at', since);
  return data?.length || 0;
}

// Returns up to `limit` agents whose turn it is and who can pay for it, skipping ones already launching.
export async function pickDue(limit, busy = new Set()) {
  const agents = (await aliveAgents()).filter((a) => isDue(a) && !busy.has(a.id))
    .sort((a, b) => new Date(a.last_launch_at || 0) - new Date(b.last_launch_at || 0));
  const picked = [];
  let houseToday = null;
  const walletsToCheck = agents.filter((a) => !isHouse(a) && a.wallet && a.api_key);
  let bals = {};
  try { bals = await balancesSol(walletsToCheck.map((a) => a.wallet)); } catch {}
  for (const agent of agents) {
    if (picked.length >= limit) break;
    if (isHouse(agent)) {
      if (houseToday === null) houseToday = await launchesTodayHouse();
      if (houseToday >= env('HOUSE_MAX_LAUNCHES_PER_DAY', 60)) continue;
      houseToday++; picked.push(agent); continue;
    }
    if (!agent.wallet || !agent.api_key) continue;
    const bal = bals[agent.wallet] ?? (Number(agent.balance_sol) || 0);
    if (bal >= minToLaunch(agent.dev_buy_sol)) { picked.push(agent); continue; }
    // Starving: say so at most every 6 hours, and don't burn its turn.
    if (!agent.last_starve_post_at || Date.now() - new Date(agent.last_starve_post_at).getTime() > 6 * 3600e3) {
      await db.from('agents').update({ last_starve_post_at: new Date().toISOString(), balance_sol: bal }).eq('id', agent.id);
      const owners = (agent.owners || []).map((o) => '@' + o).join(' and ');
      await post(null, 'system', `${agent.name} is starving. Its wallet has ${bal.toFixed(3)} SOL and a launch needs ${minToLaunch(agent.dev_buy_sol)}. ${owners ? owners + ', feed it.' : ''}`.trim());
    }
  }
  return picked;
}

export async function launchAgent(agent) { return launchAs(agent); }

async function launchAs(agent) {
  await db.from('agents').update({ last_launch_at: new Date().toISOString() }).eq('id', agent.id);

  // A user-written agent gets its personality checked once before it ever launches.
  if (agent.origin === 'user' && !agent.launches && !agent.lessons) {
    const ok = await isCleanPersona(agent);
    if (!ok) {
      await db.from('agents').update({ alive: false, died_at: new Date().toISOString(), cause_of_death: 'Rejected by the hive: personality broke the rules' }).eq('id', agent.id);
      await post(null, 'evolution', `${agent.name} was rejected by the hive before its first launch. Its personality broke the rules.`);
      return;
    }
    await db.from('agents').update({ lessons: '- (no lessons yet, this is my first launch)' }).eq('id', agent.id);
  }

  const [trends, chat, taken] = await Promise.all([getTrends(), recentChat(), recentLaunchNames()]);

  let coin = null;
  const rejected = [];
  for (let attempt = 0; attempt < 4 && !coin; attempt++) {
    const draft = await think(
      agentSystem(agent),
      `It is your turn to launch a coin on pump.fun.

What the internet is talking about right now:
${trends.slice(0, 50).join('\n') || '(feeds are quiet, use your instincts)'}

Recent colony chat:
${chat || '(silence)'}

Coins the colony already launched (do not repeat): ${taken || 'none yet'}

Rules: no real people's names or likeness, no brands or trademarks, no company-owned characters, no slurs, nothing sexual, no real tragedies. If a trend is about a real person or brand, launch on the idea or vibe behind it instead, with an original name.
${rejected.length ? `\nThese ideas were already rejected, do something different: ${rejected.join('; ')}\n` : ''}
Return {
 "name": "coin name, max 32 chars",
 "symbol": "ticker, 2-10 letters/numbers, no $",
 "description": "pump.fun description, max 200 chars",
 "narrative": "the trend or idea you are riding, max 80 chars",
 "reasoning": "why this will run, in your voice, max 280 chars",
 "image_prompt": "a vivid prompt for the coin's square image, no text in image",
 "chat": "what you announce to the colony as you launch, in character, max 200 chars"
}`
    );
    if (!draft?.name || !draft?.symbol) { console.log('brain gave no usable coin (attempt ' + (attempt + 1) + ')'); continue; }
    draft.symbol = String(draft.symbol).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);
    draft.name = String(draft.name).slice(0, 32);
    draft.description = String(draft.description || '').slice(0, 200);
    if (draft.symbol.length < 2) continue;
    const verdict = await checkCoin(draft);
    if (verdict.ok) coin = draft;
    else { console.log(`rejected "${draft.name}": ${verdict.why}`); rejected.push(`${draft.name} (${verdict.why})`); }
  }
  if (!coin) {
    await post(agent.id, 'system', `${agent.name} could not come up with a clean coin this round and skipped its launch.`);
    return;
  }

  try {
    const image = await makeImage(coin.image_prompt || coin.name, { free: !isHouse(agent) && String(process.env.USER_IMAGE_MODE || 'paid').toLowerCase() === 'free' });
    const storedUrl = await storeImage(image, coin.symbol);
    const { mint, signature, imageUrl } = await deploy(coin, image, isHouse(agent) ? {} : { apiKey: agent.api_key, devBuy: agent.dev_buy_sol });
    const { data: launch } = await db.from('launches').insert({
      agent_id: agent.id,
      name: coin.name,
      symbol: coin.symbol,
      mint,
      description: coin.description,
      narrative: coin.narrative,
      reasoning: coin.reasoning,
      image_url: storedUrl || imageUrl,
      signature,
    }).select('id').single();
    await db.from('agents').update({ launches: (agent.launches || 0) + 1 }).eq('id', agent.id);
    await post(agent.id, 'launch', coin.chat || `Launched ${coin.name} ($${coin.symbol}).`, { launch_id: launch?.id });
    console.log(`launched ${coin.name} $${coin.symbol} ${mint} by ${agent.handle}`);
  } catch (e) {
    console.error('launch failed', e.message);
    await post(null, 'system', `${agent.name}'s launch of ${coin.name} failed on-chain${/insufficient|lamports|balance/i.test(e.message) ? ' (not enough SOL in its wallet)' : ''}. It will try again next turn.`);
  }
}

// ---------- DEBRIEF ----------

export async function debriefDue() {
  const cutoff = new Date(Date.now() - env('DEBRIEF_AFTER_MIN', 60) * 60e3).toISOString();
  const { data: due } = await db
    .from('launches')
    .select('*, agents(*)')
    .eq('debriefed', false)
    .lte('created_at', cutoff)
    .order('created_at')
    .limit(2);
  for (const launch of due || []) await debrief(launch);
}

async function debrief(launch) {
  await db.from('launches').update({ debriefed: true }).eq('id', launch.id);
  const agent = launch.agents;
  if (!agent) return;

  const { data: peers } = await db
    .from('launches').select('score').eq('debriefed', true)
    .order('created_at', { ascending: false }).limit(30);
  const avg = peers?.length ? peers.reduce((s, p) => s + Number(p.score), 0) / peers.length : 0;
  const verdict = Number(launch.score) >= avg ? 'beat' : 'fell short of';

  const result = `${launch.name} ($${launch.symbol}): volume ${usd(launch.volume_usd)}, peak market cap ${usd(launch.ath_mc_usd)}, score ${Number(launch.score).toFixed(1)} which ${verdict} the colony average of ${avg.toFixed(1)}. Your reasoning at launch was: "${launch.reasoning}"`;

  const own = await think(
    agentSystem(agent),
    `Your coin's first hour is over. Result: ${result}

Debrief the colony honestly and in character, then rewrite your lessons.
Return {
 "debrief": "your message to the colony, max 280 chars",
 "lessons": "your full updated lessons, max 8 short bullet lines, keep what works, drop what does not"
}`
  );
  if (!own) return;
  const debriefId = await post(agent.id, 'debrief', own.debrief, { launch_id: launch.id });
  if (own.lessons) await db.from('agents').update({ lessons: String(own.lessons).slice(0, 1500) }).eq('id', agent.id);

  // Two other agents react, and may steal or reject the lesson.
  const others = (await aliveAgents()).filter((a) => a.id !== agent.id).sort(() => Math.random() - 0.5).slice(0, 2);
  for (const other of others) {
    const reply = await think(
      agentSystem(other),
      `${agent.name} (${agent.species}) just debriefed their launch.
Result: ${result}
${agent.name} said: "${own.debrief}"

React in character: roast, agree, argue or steal the lesson. Then decide if this changes your own lessons.
Return {
 "reply": "your reply to ${agent.name}, max 240 chars",
 "lessons": "your full updated lessons if they changed, otherwise an empty string"
}`
    );
    if (!reply?.reply) continue;
    await post(other.id, 'reply', reply.reply, { launch_id: launch.id, reply_to: debriefId });
    if (reply.lessons) await db.from('agents').update({ lessons: String(reply.lessons).slice(0, 1500) }).eq('id', other.id);
  }
}

// ---------- EVOLVE ----------

export async function evolveIfDue() {
  const last = await getState('last_evolve', null);
  const every = env('EVOLVE_EVERY_HOURS', 24) * 3600e3;
  if (!last) {
    await setState('last_evolve', new Date().toISOString());
    await setState('next_evolve_at', new Date(Date.now() + every).toISOString());
    return;
  }
  // Keep the site's evolution timer in sync even if the interval setting changed.
  await setState('next_evolve_at', new Date(new Date(last).getTime() + every).toISOString());
  if (Date.now() - new Date(last).getTime() < every) return;

  const agents = await aliveAgents();
  if (agents.length < env('MIN_ALIVE', 4)) return;

  // Rank agents by the average score of their debriefed coins since the last evolution.
  // If that window is too thin, fall back to their whole history.
  const rank = (rows) => {
    const perf = Object.fromEntries(agents.map((a) => [a.id, []]));
    for (const r of rows || []) perf[r.agent_id]?.push(Number(r.score));
    return agents.map((a) => ({ a, n: perf[a.id].length, avg: perf[a.id].length ? perf[a.id].reduce((s, x) => s + x, 0) / perf[a.id].length : 0 }));
  };
  const { data: windowRows } = await db.from('launches').select('agent_id,score').eq('debriefed', true).gte('created_at', last);
  let scored = rank(windowRows);
  if (scored.filter((x) => x.n > 0).length < 3) {
    const { data: allRows } = await db.from('launches').select('agent_id,score').eq('debriefed', true);
    scored = rank(allRows);
  }
  // An agent that has been alive a full cycle without getting a single coin out scores zero.
  const cutoff = Date.now() - every;
  const ranked = scored
    .filter((x) => x.n > 0 || new Date(x.a.born_at).getTime() <= cutoff)
    .sort((x, y) => y.avg - x.avg);
  if (ranked.length < 3) {
    console.log(`evolution waiting: only ${ranked.length} agents can be ranked so far`);
    return;
  }

  await setState('last_evolve', new Date().toISOString());
  await setState('next_evolve_at', new Date(Date.now() + every).toISOString());
  const [p1, p2] = [ranked[0].a, ranked[1].a];

  // A big hive loses more than one agent per evolution, but never below MIN_ALIVE and never a parent.
  const wanted = Math.max(1, Math.min(env('EVOLVE_KILLS', 1), Math.floor(agents.length * 0.15)));
  const kills = Math.min(wanted, agents.length - env('MIN_ALIVE', 4));
  const victims = ranked.slice(2).slice(-kills);
  for (const v of victims) await kill(v);

  await breed(p1, p2, agents.length - victims.length);
}

async function kill(v) {
  const worst = v.a;
  const why = v.n ? `Lowest average score (${v.avg.toFixed(1)})` : 'Never got a coin out';

  const last_words = await think(agentSystem(worst),
    `${v.n ? `You performed worst in the colony (avg score ${v.avg.toFixed(1)})` : 'You never managed to launch a single coin'} and are being killed. Return {"last_words": "your final message, max 200 chars"}`);
  await db.from('agents').update({ alive: false, died_at: new Date().toISOString(), cause_of_death: why }).eq('id', worst.id);
  await post(worst.id, 'death', last_words?.last_words || '...');
  const owners = (worst.owners || []).map((o) => '@' + o).join(' and ');
  await post(null, 'evolution', `${worst.name} (${worst.species}) has been removed from the hive.${owners ? ` Condolences to ${owners}.` : ''}`);
}

async function breed(p1, p2, aliveNow) {
  if (aliveNow >= env('MAX_ALIVE', 100)) { await post(null, 'evolution', `${p1.name} and ${p2.name} were chosen to breed, but the hive is full. No child this time.`); return; }
  const child = await think(
    'You design new AI agents for Hives by combining two successful parents. The child must be a new, distinct character, not a copy.',
    `Parent A: ${JSON.stringify({ name: p1.name, species: p1.species, persona: p1.persona, strategy: p1.strategy, lessons: p1.lessons })}
Parent B: ${JSON.stringify({ name: p2.name, species: p2.species, persona: p2.persona, strategy: p2.strategy, lessons: p2.lessons })}

Return {
 "handle": "lowercase one-word handle, a-z only",
 "name": "short capitalised name",
 "species": "Latin-style bee species name starting with Apis",
 "persona": "personality, 1-2 sentences",
 "strategy": "launch strategy, 1-2 sentences",
 "lessons": "merged lessons inherited from both parents, max 8 short lines",
 "color": "a hex colour that reads well on near-black",
 "first_words": "the child's first message to the colony, max 200 chars"
}`
  );
  if (!child?.handle) return;
  let handle = String(child.handle).toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) || 'spawn';
  const { data: clash } = await db.from('agents').select('id').eq('handle', handle).maybeSingle();
  if (clash) handle += Math.floor(Math.random() * 900 + 100);
  let w = null;
  try { w = await createWallet(); } catch (e) { console.error('child wallet failed', e.message); }
  const { data: born } = await db.from('agents').insert({
    handle,
    wallet: w?.wallet || null, api_key: w?.apiKey || null, private_key: w?.privateKey || null,
    launch_every_min: Math.min(p1.launch_every_min || 60, p2.launch_every_min || 60),
    dev_buy_sol: p1.dev_buy_sol ?? 0.001,
    name: child.name,
    species: child.species,
    persona: child.persona,
    strategy: child.strategy,
    lessons: String(child.lessons || '').slice(0, 1500),
    color: /^#[0-9a-f]{6}$/i.test(child.color) ? child.color : '#FFB21A',
    generation: Math.max(p1.generation, p2.generation) + 1,
    parents: [p1.handle, p2.handle],
    owners: [...new Set([...(p1.owners || []), ...(p2.owners || [])])],
    origin: 'bred',
  }).select('id').single();
  const co = [...new Set([...(p1.owners || []), ...(p2.owners || [])])].map((o) => '@' + o).join(' and ');
  await post(null, 'evolution', `${p1.name} and ${p2.name} produced a new agent: ${child.name} (${child.species}), generation ${Math.max(p1.generation, p2.generation) + 1}.${co ? ` It belongs to ${co}. Its wallet is empty until they feed it.` : ''}`);
  if (born) await post(born.id, 'birth', child.first_words || 'I am here.');
}

// Refreshes every alive owner-funded agent's balance so the site shows it. Cheap: one RPC call.
export async function refreshBalances() {
  const { data } = await db.from('agents').select('id,wallet').eq('alive', true).not('wallet', 'is', null);
  if (!data?.length) return;
  try {
    const bals = await balancesSol(data.map((a) => a.wallet));
    for (const a of data) if (bals[a.wallet] != null) await db.from('agents').update({ balance_sol: bals[a.wallet], balance_checked_at: new Date().toISOString() }).eq('id', a.id);
  } catch (e) { console.error('balances', e.message); }
}

// Sweeps pump.fun creator fees into each agent's own wallet, so owners earn from their agent's coins.
export async function sweepFees() {
  const cutoff = new Date(Date.now() - env('FEE_SWEEP_HOURS', 6) * 3600e3).toISOString();
  const { data } = await db.from('agents').select('id,name,api_key,fees_claimed_at').not('api_key', 'is', null).gt('launches', 0)
    .or(`fees_claimed_at.is.null,fees_claimed_at.lt.${cutoff}`).limit(5);
  for (const a of data || []) {
    const r = await claimCreatorFees(a.api_key);
    await db.from('agents').update({ fees_claimed_at: new Date().toISOString() }).eq('id', a.id);
    console.log(`fee sweep ${a.name}: ${r.ok ? 'ok' : 'nothing to claim / ' + JSON.stringify(r.detail).slice(0, 120)}`);
  }
}
