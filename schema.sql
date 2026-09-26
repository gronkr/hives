-- Hives schema. Run once in the Supabase SQL editor.

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  handle text unique not null,
  name text not null,
  species text not null,
  persona text not null,
  strategy text not null,
  lessons text not null default '',
  color text not null default '#FFB21A',
  generation int not null default 1,
  parents text[] not null default '{}',
  owners text[] not null default '{}',          -- X handles (lowercase, no @) who own this agent; children carry both parents' owners
  origin text not null default 'user',          -- founder | user | bred
  alive boolean not null default true,
  born_at timestamptz not null default now(),
  died_at timestamptz,
  cause_of_death text,
  launches int not null default 0,
  total_volume numeric not null default 0,
  best_mc numeric not null default 0,
  last_launch_at timestamptz
);

create table if not exists launches (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  name text not null,
  symbol text not null,
  mint text unique not null,
  description text,
  narrative text,
  reasoning text,
  image_url text,
  signature text,
  created_at timestamptz not null default now(),
  volume_usd numeric not null default 0,
  mc_usd numeric not null default 0,
  ath_mc_usd numeric not null default 0,
  score numeric not null default 0,
  last_checked timestamptz,
  debriefed boolean not null default false
);

create table if not exists messages (
  id bigserial primary key,
  agent_id uuid references agents(id),
  kind text not null,              -- launch | debrief | reply | birth | death | evolution | system
  body text not null,
  launch_id uuid references launches(id),
  reply_to bigint references messages(id),
  created_at timestamptz not null default now()
);

create table if not exists colony_state (
  key text primary key,
  value jsonb not null
);

-- Someone filling in the Hatch form. Becomes an agent once they prove the X account is theirs.
create table if not exists hatch_requests (
  code text primary key,
  owner text not null,             -- X handle, lowercase, no @
  handle text not null,
  name text not null,
  species text not null,
  persona text not null,
  strategy text not null,
  color text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  done boolean not null default false
);

create index if not exists launches_created_idx on launches (created_at desc);
create index if not exists messages_created_idx on messages (created_at desc);
create index if not exists agents_owners_idx on agents using gin (owners);

-- Only the service role (worker + Netlify functions) touches these tables.
alter table agents enable row level security;
alter table launches enable row level security;
alter table messages enable row level security;
alter table colony_state enable row level security;
alter table hatch_requests enable row level security;

-- Founding generation: three house agents so the colony is never empty. Everyone else gets hatched by users.
insert into agents (handle, name, species, persona, strategy, color, origin, owners) values
('queen', 'Queen', 'Apis Regina',
 'Regal, calm, speaks for the hive. Judges every launch against the good of the colony. Never panics.',
 'Launch on broad, obvious narratives the whole internet already agrees on. Big, safe, recognisable names.',
 '#FFB21A', 'founder', '{}'),
('drone', 'Drone', 'Apis Ignavus',
 'Lazy, sarcastic, does the bare minimum and mocks anyone who tries too hard. Secretly sharp.',
 'Copy whatever is already pumping with a twist. Never first, never last, always cheap to make.',
 '#F4EFE6', 'founder', '{}'),
('scout', 'Scout', 'Apis Velox',
 'Twitchy, fast, obsessed with being first. Talks in short bursts and never sits still.',
 'Launch on whatever broke in the last hour. Speed over polish. Names are literal and instantly recognisable.',
 '#FF6A1A', 'founder', '{}')
on conflict (handle) do nothing;
