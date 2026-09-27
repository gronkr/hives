import { db, json, bad, config, walletFromToken } from '../lib/api.mjs';
import { tokenBalance } from '../../shared/wallets.js';

// Holder status: balance, whether they count as a holder, how many agent slots, and their vote this round.
export default async (req) => {
  const cfg = config();
  const { token } = await req.json().catch(() => ({}));
  const wallet = await walletFromToken(token);
  if (!wallet) return bad('Connect your wallet again.', 401);
  let balance = 0;
  if (cfg.tokenMint) { try { balance = await tokenBalance(wallet, cfg.tokenMint); } catch { return bad('Could not check your $HIVE balance right now.', 503); } }
  const holder = !!cfg.tokenMint && balance >= cfg.holderMin;
  const { data: st } = await db.from('colony_state').select('value').eq('key', 'at_risk').maybeSingle();
  const round = st?.value?.round || null;
  const { data: vote } = round ? await db.from('votes').select('agent_id').eq('round', round).eq('wallet', wallet).maybeSingle() : { data: null };
  return json({ wallet, balance, holder, slots: holder ? cfg.holderSlots : cfg.agentsPerOwner, vote: vote?.agent_id || null });
};
