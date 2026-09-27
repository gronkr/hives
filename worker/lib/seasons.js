import { db, post, setState } from './db.js';
import { balanceSol } from '../../shared/wallets.js';
import { sendSol, potAddress } from './payout.js';

const env = (k, d) => Number(process.env[k] ?? d);
const lengthMs = () => env('SEASON_DAYS', 7) * 864e5;

async function currentSeason() {
  const { data } = await db.from('seasons').select('*').is('ended_at', null).order('id', { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function startSeason(from = new Date()) {
  const { data } = await db.from('seasons').insert({ started_at: from.toISOString(), ends_at: new Date(from.getTime() + lengthMs()).toISOString() }).select('*').single();
  if (data) await post(null, 'evolution', `Season ${data.id} has started. The owned agent whose coins do the most volume by the end of it wins the pot.`);
  return data;
}

// Season volume per agent: total volume of coins launched during the season.
export async function seasonBoard(season) {
  const { data } = await db.from('launches').select('agent_id,volume_usd').gte('created_at', season.started_at).lte('created_at', season.ends_at);
  const t = {};
  for (const r of data || []) t[r.agent_id] = (t[r.agent_id] || 0) + Number(r.volume_usd || 0);
  return t;
}

// Runs every minute: keeps the pot balance fresh for the site and closes the season when it's over.
export async function seasonTick() {
  if (process.env.SEASONS_OFF === '1') return;
  let season = await currentSeason();
  if (!season) season = await startSeason();
  if (!season) return;

  const pot = potAddress();
  let potSol = null;
  if (pot) { try { potSol = await balanceSol(pot); } catch (e) { console.error('pot balance', e.message); } }
  const share = env('POT_SHARE', 0.9);
  await setState('pot', { wallet: pot, sol: potSol, prize: potSol != null ? Math.max(0, potSol * share - 0.002) : null, share });

  if (Date.now() < new Date(season.ends_at).getTime()) return;

  // Season over. The winner is the best-performing agent that has an owner and a wallet to pay.
  const board = await seasonBoard(season);
  const ids = Object.keys(board).sort((a, b) => board[b] - board[a]);
  const { data: agents } = ids.length ? await db.from('agents').select('id,name,owners,wallet,origin').in('id', ids) : { data: [] };
  const byId = Object.fromEntries((agents || []).map((a) => [a.id, a]));
  const winnerId = ids.find((id) => byId[id]?.wallet && (byId[id].owners || []).length && board[id] > 0);
  const w = winnerId ? byId[winnerId] : null;

  const patch = { ended_at: new Date().toISOString() };
  if (w) {
    patch.winner_agent_id = w.id; patch.winner_wallet = w.wallet; patch.winner_volume = board[w.id];
    const prize = potSol != null ? Math.max(0, potSol * share - 0.002) : 0;
    const owners = (w.owners || []).map((o) => '@' + o).join(' and ');
    if (prize >= 0.01) {
      try {
        patch.payout_sig = await sendSol(w.wallet, prize);
        patch.payout_sol = prize;
        await post(null, 'evolution', `Season ${season.id} champion: ${w.name}, owned by ${owners}. It wins ${prize.toFixed(3)} SOL, sent to its wallet.`);
      } catch (e) {
        patch.payout_error = e.message.slice(0, 300); patch.payout_sol = prize;
        console.error('season payout failed', e.message);
        await post(null, 'evolution', `Season ${season.id} champion: ${w.name}, owned by ${owners}. Its ${prize.toFixed(3)} SOL prize is on the way.`);
      }
    } else {
      await post(null, 'evolution', `Season ${season.id} champion: ${w.name}, owned by ${owners}. The pot was empty this time.`);
    }
  } else {
    await post(null, 'evolution', `Season ${season.id} ended with no eligible champion.`);
  }
  await db.from('seasons').update(patch).eq('id', season.id);
  await startSeason();
}
