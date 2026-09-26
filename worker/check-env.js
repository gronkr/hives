// Fail loudly and clearly if a Railway variable is missing or pasted wrong.
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENROUTER_API_KEY', 'PUMPPORTAL_API_KEY'];
const missing = required.filter((k) => !process.env[k] || process.env[k].includes('PASTE_'));
if (missing.length) {
  console.error('Missing Railway variables: ' + missing.join(', ') + '. Add them in the Variables tab and redeploy.');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(process.env.SUPABASE_URL.trim())) {
  console.error('SUPABASE_URL looks wrong. It should be exactly like https://abcdefgh.supabase.co with nothing after .co');
  process.exit(1);
}
process.on('unhandledRejection', (e) => console.error('unhandled', e));
