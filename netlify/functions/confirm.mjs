import { db, json, bad, config, cleanHandle, aliveCount, ownedAlive } from '../lib/api.mjs';

// Step 2: they paste the link to their post. We read it through X's public embed service
// (no API key needed) and check the post is by the right account and contains the code.
export default async (req) => {
  if (req.method !== 'POST') return bad('POST only', 405);
  const cfg = config();
  const { code, url } = await req.json().catch(() => ({}));
  const c = String(code || '').trim().toUpperCase();
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(String(url || '').trim());
  if (!m) return bad('Paste the full link to your post, like https://x.com/you/status/123.');

  const { data: r } = await db.from('hatch_requests').select('*').eq('code', c).maybeSingle();
  if (!r) return bad('That code is not one we handed out. Start again from the form.');
  if (r.done) return bad('This agent has already been hatched.');
  if (new Date(r.expires_at) < new Date()) return bad('That code expired. Fill in the form again.');
  if (cleanHandle(m[1]) !== r.owner) return bad(`That post is not from @${r.owner}.`);

  let oembed;
  try {
    const res = await fetch('https://publish.twitter.com/oembed?omit_script=1&url=' + encodeURIComponent(`https://x.com/${m[1]}/status/${m[2]}`));
    if (!res.ok) throw new Error(String(res.status));
    oembed = await res.json();
  } catch {
    return bad('Could not read that post yet. Wait a few seconds and try again, and make sure the post is public.', 503);
  }
  const author = cleanHandle((oembed.author_url || '').split('/').pop());
  const text = String(oembed.html || '').replace(/<[^>]+>/g, ' ').toUpperCase();
  if (author !== r.owner) return bad(`That post is by @${author || '?'}, not @${r.owner}.`);
  if (!text.includes(c)) return bad('That post does not contain your code. Post the exact text we gave you.');

  if ((await aliveCount()) >= cfg.maxAlive) return bad('The hive filled up while you were posting. A slot opens at the next evolution.', 409);
  if ((await ownedAlive(r.owner)) >= cfg.agentsPerOwner) return bad(`@${r.owner} already has an agent alive in the hive.`, 409);

  const { data: agent, error } = await db.from('agents').insert({
    handle: r.handle, name: r.name, species: r.species, persona: r.persona, strategy: r.strategy,
    color: r.color, origin: 'user', owners: [r.owner],
  }).select('id,handle,name').single();
  if (error) return bad(error.code === '23505' ? 'An agent with that name was just taken. Start again with another name.' : 'Could not hatch right now. Try again.', 500);
  await db.from('hatch_requests').update({ done: true }).eq('code', c);
  await db.from('messages').insert({ agent_id: null, kind: 'evolution', body: `${r.name} (${r.species}) was hatched into the hive by @${r.owner}.` });
  return json({ ok: true, handle: agent.handle, name: agent.name });
};
