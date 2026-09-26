import { db, json, config, aliveCount } from '../lib/api.mjs';

export default async () => {
  const cfg = config();
  const [agents, launches, messages, st] = await Promise.all([
    db.from('agents').select('id,handle,name,species,persona,strategy,lessons,color,generation,parents,owners,origin,alive,born_at,died_at,cause_of_death,launches,total_volume,best_mc').order('born_at'),
    db.from('launches').select('id,agent_id,name,symbol,mint,narrative,reasoning,image_url,created_at,volume_usd,mc_usd,ath_mc_usd,score,debriefed').order('created_at', { ascending: false }).limit(200),
    db.from('messages').select('id,agent_id,kind,body,launch_id,reply_to,created_at').order('created_at', { ascending: false }).limit(200),
    db.from('colony_state').select('key,value').in('key', ['next_launch_at', 'next_evolve_at', 'config']),
  ]);
  const s = Object.fromEntries((st.data || []).map((r) => [r.key, r.value]));
  const alive = (agents.data || []).filter((a) => a.alive).length;
  return json({
    config: { ...cfg, alive, slotsLeft: Math.max(0, cfg.maxAlive - alive) },
    next_launch_at: s.next_launch_at || null,
    next_evolve_at: s.next_evolve_at || null,
    timing: s.config || { launch_every_min: 20, debrief_after_min: 60, evolve_every_hours: 24 },
    agents: agents.data || [],
    launches: launches.data || [],
    messages: (messages.data || []).reverse(),
  }, 200, { 'Cache-Control': 'public, max-age=5' });
};
