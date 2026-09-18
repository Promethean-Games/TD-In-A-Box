create extension if not exists pgcrypto;

create type public.user_role as enum ('PLATFORM_ADMIN', 'VENUE_ADMIN', 'TD', 'USER');
create type public.subscription_tier as enum ('BASIC', 'PRO', 'PRO_PLUS', 'VENUE');
create type public.account_status as enum ('ACTIVE', 'INACTIVE', 'SUSPENDED');
create type public.broadcast_status as enum ('LIVE', 'STANDBY', 'UP_NEXT');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  role public.user_role not null default 'USER',
  tier public.subscription_tier not null default 'BASIC',
  status public.account_status not null default 'ACTIVE',
  verified boolean not null default false,
  venue_ids text[] not null default '{}',
  permissions text[] not null default '{}',
  td_profile_id text,
  td_channel_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contact_email text,
  status public.account_status not null default 'ACTIVE',
  region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  number integer not null,
  name text not null,
  status public.broadcast_status not null default 'STANDBY',
  owner_type text not null default 'VENUE',
  owner_id uuid references public.venues(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  format text not null default 'SINGLE_ELIMINATION',
  status text not null default 'DRAFT',
  seeding_method text not null default 'ENTERED',
  table_count integer not null default 0,
  is_template boolean not null default false,
  venue_id uuid references public.venues(id) on delete set null,
  entry_fee numeric(10,2) not null default 0,
  green_fee numeric(10,2) not null default 0,
  payout_positions integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  display_name text not null,
  seed integer not null default 1,
  wins integer not null default 0,
  losses integer not null default 0,
  eliminated boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_configs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  featured_channel_id uuid references public.channels(id) on delete set null,
  camera_preset text,
  overlay_duration_seconds integer not null default 8,
  sponsor_rotation boolean not null default true,
  stream_mode text not null default 'STANDBY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  duration_seconds integer not null default 8,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.channels enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.broadcast_configs enable row level security;
alter table public.sponsors enable row level security;

create policy "profiles_are_private_to_owner" on public.profiles
  for all using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "platform_admin_can_manage_profiles" on public.profiles
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'PLATFORM_ADMIN' and p.verified = true
    )
  );

create policy "platform_admin_can_manage_venues" on public.venues
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'PLATFORM_ADMIN' and p.verified = true
    )
  );

create policy "owners_and_platform_admins_can_manage_tournaments" on public.tournaments
  for all using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'PLATFORM_ADMIN' and p.verified = true
    )
  );

create policy "owners_and_platform_admins_can_manage_players" on public.tournament_players
  for all using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'PLATFORM_ADMIN' and p.verified = true
        )
      )
    )
  );

create policy "owners_and_admins_can_manage_broadcast_config" on public.broadcast_configs
  for all using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'PLATFORM_ADMIN' and p.verified = true
        )
      )
    )
  );

create policy "public_read_sponsors" on public.sponsors
  for select using (true);

create policy "platform_admin_can_manage_sponsors" on public.sponsors
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'PLATFORM_ADMIN' and p.verified = true
    )
  );

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role, tier, status, verified)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    'USER',
    'BASIC',
    'ACTIVE',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
