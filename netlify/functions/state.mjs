import { db, json, config } from '../lib/api.mjs';
import { minToLaunch, CADENCES, DEV_BUYS } from '../../shared/wallets.js';

export default async () => {
  const cfg = config();
  const [agents, launches, messages, st] = await Promise.all([
    db.from('agents').select('id,handle,name,species,persona,strategy,lessons,color,generation,parents,owners,origin,alive,born_at,died_at,cause_of_death,launches,total_volume,best_mc,last_launch_at,wallet,balance_sol,launch_every_min,dev_buy_sol').order('born_at'),
    db.from('launches').select('id,agent_id,name,symbol,mint,narrative,reasoning,image_url,created_at,volume_usd,mc_usd,ath_mc_usd,score,debriefed').order('created_at', { ascending: false }).limit(200),
    db.from('messages').select('id,agent_id,kind,body,launch_id,reply_to,created_at').order('created_at', { ascending: false }).limit(200),
    db.from('colony_state').select('key,value').in('key', ['next_launch_at', 'next_evolve_at', 'config']),
  ]);
  const s = Object.fromEntries((st.data || []).map((r) => [r.key, r.value]));
  const timing = s.config || { house_launch_every_min: 20, debrief_after_min: 60, evolve_every_hours: 24 };
  const now = Date.now();
  const list = (agents.data || []).map((a) => {
    const house = a.origin === 'founder';
    const every = house ? (timing.house_launch_every_min || 20) : (a.launch_every_min || 60);
    const funded = house ? !cfg.paused : Number(a.balance_sol) >= minToLaunch(a.dev_buy_sol);
    const next_turn_at = new Date(Math.max(now, (a.last_launch_at ? new Date(a.last_launch_at).getTime() : 0) + every * 60e3)).toISOString();
    return { ...a, every, funded, next_turn_at, min_sol: minToLaunch(a.dev_buy_sol) };
  });
  const alive = list.filter((a) => a.alive).length;
  const dueTimes = list.filter((a) => a.alive && a.funded).map((a) => a.next_turn_at).sort();
  return json({
    config: { ...cfg, alive, slotsLeft: Math.max(0, cfg.maxAlive - alive), cadences: CADENCES, devBuys: DEV_BUYS },
    next_launch_at: cfg.paused ? null : (dueTimes[0] || null),
    next_evolve_at: s.next_evolve_at || null,
    timing,
    agents: list,
    launches: launches.data || [],
    messages: (messages.data || []).reverse(),
  }, 200, { 'Cache-Control': 'public, max-age=5' });
};
