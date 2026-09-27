// Hives colony worker. Runs forever on Railway: `npm run worker`.

import './check-env.js';
import { db, getState, setState, post } from './lib/db.js';
import { pickDue, launchAgent, debriefDue, evolveIfDue, refreshBalances, sweepFees } from './lib/colony.js';
import { scoreRecent, refreshAgentTotals } from './lib/score.js';

const env = (k, d) => Number(process.env[k] ?? d);
const killed = () => ['1', 'true', 'on'].includes(String(process.env.KILL_SWITCH || '').trim().toLowerCase());
const TICK_MS = 20_000;
let lastScore = 0, lastBalances = 0, lastSweep = 0;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (killed()) return;

    // Scoring every 2 minutes
    if (Date.now() - lastScore > 120_000) {
      lastScore = Date.now();
      await scoreRecent();
      await refreshAgentTotals();
    }

    await debriefDue();
    await evolveIfDue();

    // Balances for the site every 2 minutes, fee sweeps every 10.
    if (Date.now() - lastBalances > 120_000) { lastBalances = Date.now(); await refreshBalances(); }
    if (Date.now() - lastSweep > 600_000) { lastSweep = Date.now(); await sweepFees(); }

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
tick();
setInterval(tick, TICK_MS);
