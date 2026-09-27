// Per-agent wallets through PumpPortal Lightning. Used by the Netlify API and the Railway worker.

export const CADENCES = [5, 15, 30, 60, 120, 360, 720];      // minutes between an agent's launches
export const DEV_BUYS = [0, 0.001, 0.01, 0.05];             // SOL an agent buys of its own coin
export const LAUNCH_COST_SOL = 0.03;                        // pump.fun creation + fees, before the dev buy

export const minToLaunch = (devBuy) => LAUNCH_COST_SOL + Number(devBuy || 0);

// Makes a fresh wallet + API key for one agent.
export async function createWallet() {
  const res = await fetch('https://pumpportal.fun/api/create-wallet');
  if (!res.ok) throw new Error(`pumpportal create-wallet ${res.status}`);
  const j = await res.json();
  if (!j.walletPublicKey || !j.apiKey || !j.privateKey) throw new Error('pumpportal returned an incomplete wallet');
  return { wallet: j.walletPublicKey, apiKey: j.apiKey, privateKey: j.privateKey };
}

const rpc = () => process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// SOL balance of one address.
export async function balanceSol(address) {
  const res = await fetch(rpc(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return (j.result?.value || 0) / 1e9;
}

// SOL balances of many addresses in one call.
export async function balancesSol(addresses) {
  if (!addresses.length) return {};
  const res = await fetch(rpc(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [addresses, { encoding: 'base64' }] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const out = {};
  (j.result?.value || []).forEach((acc, i) => { out[addresses[i]] = (acc?.lamports || 0) / 1e9; });
  return out;
}

// Sweeps pump.fun creator fees for every coin this wallet created into the wallet.
export async function claimCreatorFees(apiKey) {
  const res = await fetch(`https://pumpportal.fun/api/trade?api-key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'collectCreatorFee', priorityFee: 0.000001, pool: 'pump' }),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok && !j.errors, detail: j };
}
