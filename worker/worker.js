// Hives colony worker. Runs forever on Railway: `npm run worker`.

import './check-env.js';
import { db, getState, setState, post } from './lib/db.js';
import { launchNext, debriefDue, evolveIfDue } from './lib/colony.js';
import { scoreRecent, refreshAgentTotals } from './lib/score.js';

const env = (k, d) => Number(process.env[k] ?? d);
const TICK_MS = 20_000;
let lastScore = 0;
let busy = false;

async function launchesToday() {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count } = await db.from('launches').select('id', { count: 'exact', head: true }).gte('created_at', since);
  return count || 0;
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (['1', 'true', 'on'].includes(String(process.env.KILL_SWITCH || '').trim().toLowerCase())) return;

    // Scoring every 2 minutes
    if (Date.now() - lastScore > 120_000) {
      lastScore = Date.now();
      await scoreRecent();
      await refreshAgentTotals();
    }

    await debriefDue();
    await evolveIfDue();

    // Launch when the countdown hits zero
    const next = await getState('next_launch_at', null);
    if (!next || Date.now() >= new Date(next).getTime()) {
      const every = env('LAUNCH_EVERY_MIN', 20) * 60e3;
      await setState('next_launch_at', new Date(Date.now() + every).toISOString());
      if ((await launchesToday()) < env('MAX_LAUNCHES_PER_DAY', 48)) await launchNext();
      else console.log('daily launch cap reached');
    }
  } catch (e) {
    console.error('tick error', e);
  } finally {
    busy = false;
  }
}

const booted = await getState('booted', null);
if (!booted) {
  await setState('booted', new Date().toISOString());
  await post(null, 'system', 'The colony is awake. First launch incoming.');
}
// Tell the website how the colony is paced, so its text and timers always match.
await setState('config', {
  launch_every_min: env('LAUNCH_EVERY_MIN', 20),
  debrief_after_min: env('DEBRIEF_AFTER_MIN', 60),
  evolve_every_hours: env('EVOLVE_EVERY_HOURS', 24),
});
console.log('hives worker running');
tick();
setInterval(tick, TICK_MS);
