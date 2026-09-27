import { db, json, bad, config, walletFromToken } from '../lib/api.mjs';
import { tokenBalance } from '../../shared/wallets.js';

// A $HIVE holder votes for which at-risk agent dies at the next evolution. Weighted by holdings; can change it.
export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const cfg = config();
  if (!cfg.tokenMint) return bad('Voting opens once $HIVE is live.', 403);
  const { token, agent_id } = await req.json().catch(() => ({}));
  const wallet = await walletFromToken(token);
  if (!wallet) return bad('Connect your wallet again.', 401);

  const { data: st } = await db.from('colony_state').select('value').eq('key', 'at_risk').maybeSingle();
  const round = st?.value?.round;
  const risk = (st?.value?.agents || []).map((a) => a.id);
  if (!round || !risk.includes(agent_id)) return bad('That agent is not up for a vote right now.', 409);

  let balance = 0;
  try { balance = await tokenBalance(wallet, cfg.tokenMint); } catch { return bad('Could not check your $HIVE balance right now.', 503); }
  if (balance < cfg.holderMin) return bad(`You need at least ${cfg.holderMin.toLocaleString('en-US')} $HIVE to vote.`, 403);

  await db.from('votes').upsert({ round, wallet, agent_id, weight: balance });
  return json({ ok: true, weight: balance });
};
