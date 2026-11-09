-- Admin dashboard support. Safe to run more than once.

-- 1. Study-data snapshot table (used by lib/store.ts sync and the admin dashboard)
create table if not exists public.student_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.student_state enable row level security;
drop policy if exists "own state" on public.student_state;
create policy "own state" on public.student_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. SECURITY: stop signed-in users from changing their own role (e.g. student -> admin).
--    The service key (admin API) and the SQL editor can still change roles.
create or replace function public.protect_profile_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and auth.role() = 'authenticated' then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- 3. Create a profile automatically for every new auth user (never trusts a client-supplied role)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          'student')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Per-user study stats for the admin table, computed inside Postgres (service role only)
create or replace function public.admin_student_stats()
returns table (user_id uuid, subject text, materials int, topics int, attempts int, mastery numeric, last_active timestamptz)
language sql stable security definer set search_path = public as $$
  select s.user_id,
         s.data->>'subject',
         case when jsonb_typeof(s.data->'materials') = 'array' then jsonb_array_length(s.data->'materials') else 0 end,
         case when jsonb_typeof(s.data->'topics')    = 'array' then jsonb_array_length(s.data->'topics')    else 0 end,
         case when jsonb_typeof(s.data->'attempts')  = 'array' then jsonb_array_length(s.data->'attempts')  else 0 end,
         case when jsonb_typeof(s.data->'reports') = 'array' and jsonb_array_length(s.data->'reports') > 0
              then (s.data->'reports'->-1->>'overallMastery')::numeric end,
         s.updated_at
  from public.student_state s;
$$;
revoke all on function public.admin_student_stats() from public, anon, authenticated;
grant execute on function public.admin_student_stats() to service_role;

-- 5. Make YOURSELF the first admin (edit the email, then run once):
-- update public.profiles set role = 'admin' where email = 'you@example.com';
