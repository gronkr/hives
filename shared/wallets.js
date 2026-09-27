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

// Tries your own RPC first (SOLANA_RPC_URL, e.g. a free Helius link), then public ones.
// The default public Solana RPC often blocks servers like Railway, so there are backups.
const RPCS = () => [process.env.SOLANA_RPC_URL, 'https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'].filter(Boolean);

async function rpcCall(method, params) {
  let last;
  for (const url of RPCS()) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
      const j = await res.json();
      if (j.error) throw new Error(`${j.error.message} from ${new URL(url).host}`);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('no RPC answered');
}

// SOL balance of one address.
export async function balanceSol(address) {
  const r = await rpcCall('getBalance', [address]);
  return (r?.value || 0) / 1e9;
}

// SOL balances of many addresses. One call when possible, one-by-one if the batch call is refused.
export async function balancesSol(addresses) {
  if (!addresses.length) return {};
  const out = {};
  try {
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const r = await rpcCall('getMultipleAccounts', [chunk, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
      (r?.value || []).forEach((acc, j) => { out[chunk[j]] = (acc?.lamports || 0) / 1e9; });
    }
    return out;
  } catch (e) {
    console.error('batch balance check failed, checking one by one:', e.message);
  }
  for (const a of addresses) { try { out[a] = await balanceSol(a); } catch (e) { console.error('balance check failed for', a, e.message); } }
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

// How many of a token (by mint) a wallet holds. Filtering by mint covers both SPL token programs.
export async function tokenBalance(owner, mint) {
  const r = await rpcCall('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
  return (r?.value || []).reduce((s, a) => s + Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
}

export const rpcUrl = () => RPCS()[0];
