import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { db, json, bad, isWallet } from '../lib/api.mjs';

// Holder sign-in step 2: check the signature, then hand back a session token.
export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const { wallet, signature } = await req.json().catch(() => ({}));
  if (!isWallet(wallet) || typeof signature !== 'string') return bad('Missing wallet or signature.');
  const { data: n } = await db.from('nonces').select('*').eq('wallet', wallet).maybeSingle();
  if (!n || new Date(n.expires_at) < new Date()) return bad('Sign-in expired. Connect again.');
  const message = `Sign in to Hives\nWallet: ${wallet}\nCode: ${n.nonce}\n\nThis only proves you own this wallet. It costs nothing and moves no funds.`;
  let ok = false;
  try { ok = nacl.sign.detached.verify(new TextEncoder().encode(message), Buffer.from(signature, 'base64'), bs58.decode(wallet)); } catch { ok = false; }
  if (!ok) return bad('Signature did not match this wallet.', 401);
  await db.from('nonces').delete().eq('wallet', wallet);
  const token = crypto.randomBytes(24).toString('hex');
  await db.from('sessions').insert({ token, wallet, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
  return json({ token, wallet });
};
