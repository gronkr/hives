import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { rpcUrl } from '../../shared/wallets.js';

// Sends SOL from the season pot wallet (POT_PRIVATE_KEY) to a winner. Returns the transaction signature.
export async function sendSol(toAddress, sol) {
  const key = process.env.POT_PRIVATE_KEY;
  if (!key) throw new Error('POT_PRIVATE_KEY is not set, pay this one by hand');
  const from = Keypair.fromSecretKey(bs58.decode(key.trim()));
  const conn = new Connection(rpcUrl(), 'confirmed');
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(toAddress), lamports }));
  return sendAndConfirmTransaction(conn, tx, [from]);
}

export function potAddress() {
  if (process.env.POT_WALLET) return process.env.POT_WALLET.trim();
  if (process.env.POT_PRIVATE_KEY) { try { return Keypair.fromSecretKey(bs58.decode(process.env.POT_PRIVATE_KEY.trim())).publicKey.toBase58(); } catch {} }
  return null;
}
