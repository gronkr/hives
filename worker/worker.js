// Hives colony worker. Runs forever on Railway: `npm run worker`.

import './check-env.js';
import { db, getState, setState, post } from './lib/db.js';
import { pickDue, launchAgent, debriefDue, evolveIfDue, refreshBalances, sweepFees } from './lib/colony.js';
import { scoreRecent, refreshAgentTotals } from './lib/score.js';

const env = (k, d) => Number(process.env[k] ?? d);
const killed = () => ['1', 'true', 'on'].includes(String(process.env.KILL_SWITCH || '').trim().toLowerCase());
const TICK_MS = 20_000;
let lastScore = 0;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (killed()) return;

    // Scoring every 2 minutes
    if (Date.now() - lastScore > 120_000) {
      lastScore = Date.now();
      try { await scoreRecent(); await refreshAgentTotals(); } catch (e) { console.error('scoring error', e.message); }
    }

    try { await debriefDue(); } catch (e) { console.error('debrief error', e.message); }
    try { await evolveIfDue(); } catch (e) { console.error('evolve error', e.message); }


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
  house_launch_every_min: env('HOUSE_LAUNCH_EVERY_MIN', 20),
  debrief_after_min: env('DEBRIEF_AFTER_MIN', 60),
  evolve_every_hours: env('EVOLVE_EVERY_HOURS', 24),
});
console.log('hives worker running');

// Launches run in their own loop, several at a time, so 100 agents on fast schedules don't queue up.
const inFlight = new Set();
let picking = false;
async function launchLoop() {
  if (picking || killed()) return;
  picking = true;
  try {
    const room = env('LAUNCH_CONCURRENCY', 6) - inFlight.size;
    if (room <= 0) return;
    const due = await pickDue(room, inFlight);
    for (const agent of due) {
      inFlight.add(agent.id);
      launchAgent(agent).catch((e) => console.error('launch error', agent.handle, e.message)).finally(() => inFlight.delete(agent.id));
    }
  } catch (e) { console.error('launch loop', e.message); }
  finally { picking = false; }
}
setInterval(launchLoop, 8000);

// Balances and fee sweeps run on their own, so an error anywhere else can never stop them.
async function balancesLoop() { try { await refreshBalances(); } catch (e) { console.error('balances loop', e.message); } }
async function feesLoop() { if (killed()) return; try { await sweepFees(); } catch (e) { console.error('fee sweep loop', e.message); } }
balancesLoop();
setInterval(balancesLoop, 60_000);
setInterval(feesLoop, 600_000);
tick();
setInterval(tick, TICK_MS);
