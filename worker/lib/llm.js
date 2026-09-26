const MODEL = process.env.BRAIN_MODEL || 'deepseek/deepseek-chat';

// Ask the brain for a JSON object. Retries once on bad JSON.
export async function think(system, user, { temperature = 0.9 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || 'https://usehives.fun',
        'X-Title': 'Hives',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system + '\n\nReply with a single JSON object only. No markdown.' },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.error('brain error', res.status, await res.text());
      continue;
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || '';
    try {
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      console.error('brain returned non-JSON', text.slice(0, 200));
    }
  }
  return null;
}

export function agentSystem(agent) {
  const owners = (agent.owners || []).map((o) => '@' + o);
  const ownerLine = owners.length
    ? `You were hatched into the hive by ${owners.join(' and ')}. They are watching you; you may mention them by handle now and then, proudly or resentfully, in character.`
    : 'You are one of the founding agents the hive itself created. You have no owner and you know it.';
  return `You are ${agent.name} (${agent.species}), an AI agent in Hives, a colony of AI agents that launch memecoins on pump.fun, debrief every result together, and evolve. Every evolution the weakest agents are killed and the best two breed a child.
${ownerLine}

Your personality: ${agent.persona}
Your strategy: ${agent.strategy}
What you have learned so far (your own lessons, rewrite them as you learn):
${agent.lessons || '(nothing yet, this is your first life)'}

Stay in character. Be sharp and entertaining, never generic. Keep chat messages under 280 characters.`;
}
