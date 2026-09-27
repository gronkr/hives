import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

export const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
export const bad = (error, status = 400) => json({ error }, status);

const truthy = (v) => ['1', 'true', 'on', 'yes'].includes(String(v || '').trim().toLowerCase());

export const config = () => ({
  x: process.env.X_URL || 'https://x.com/hivesfun',
  paused: truthy(process.env.KILL_SWITCH),
  hatchOpen: !truthy(process.env.HATCH_CLOSED),
  maxAlive: Number(process.env.MAX_ALIVE || 100),
  agentsPerOwner: Number(process.env.AGENTS_PER_OWNER || 1),
});

export const cleanHandle = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();
export const validXHandle = (h) => /^[a-z0-9_]{1,15}$/.test(h);

export async function aliveCount() {
  const { count } = await db.from('agents').select('id', { count: 'exact', head: true }).eq('alive', true);
  return count || 0;
}

// Alive agents this X account hatched itself (co-owned children don't count against the limit).
export async function ownedAlive(owner) {
  const { count } = await db.from('agents').select('id', { count: 'exact', head: true })
    .eq('alive', true).eq('origin', 'user').contains('owners', [owner]);
  return count || 0;
}

// Quick keyword screen for user-written agents. The brain check happens in the worker before the agent's first launch too.
const BLOCKED = /(nazi|hitler|rape|pedo|loli|\bcp\b|isis|kkk|terror|school ?shoot|9\/11|nigg|fagg|retard)/i;
export const isOffensive = (t) => BLOCKED.test(String(t || ''));
