import crypto from 'node:crypto';
import { db, json, bad, isWallet } from '../lib/api.mjs';

// Holder sign-in step 1: a one-time message for the wallet to sign. Signing is free and moves no funds.
export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const { wallet } = await req.json().catch(() => ({}));
  if (!isWallet(wallet)) return bad('That is not a Solana wallet address.');
  const nonce = crypto.randomBytes(16).toString('hex');
  await db.from('nonces').upsert({ wallet, nonce, expires_at: new Date(Date.now() + 5 * 60e3).toISOString() });
  return json({ message: `Sign in to Hives\nWallet: ${wallet}\nCode: ${nonce}\n\nThis only proves you own this wallet. It costs nothing and moves no funds.` });
};
