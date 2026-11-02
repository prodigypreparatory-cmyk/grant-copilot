-- ============================================================
-- Grant Copilot — Supabase schema
-- Run once in Supabase → SQL Editor → New query → Run.
-- Creates: workspaces (all app data as JSON), members with roles,
-- snapshots for recovery, and a private "documents" storage bucket.
-- ============================================================

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Grant Copilot',
  data        jsonb not null default '{}'::jsonb,
  rev         integer not null default 1,          -- optimistic concurrency
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,                        -- stored lower-case
  role         text not null check (role in ('owner','writer','reviewer','director')),
  added_at     timestamptz not null default now(),
  primary key (workspace_id, email)
);

create table if not exists public.workspace_snapshots (
  id           bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  data         jsonb not null,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists snapshots_ws_idx on public.workspace_snapshots (workspace_id, created_at desc);

-- The caller's role in a workspace (null if not a member).
create or replace function public.my_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.workspace_members
  where workspace_id = ws and email = lower(coalesce(auth.jwt() ->> 'email',''))
$$;

-- Create a workspace and make the caller its owner, in one step.
create or replace function public.create_workspace(p_name text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid; me text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  if auth.uid() is null or me = '' then raise exception 'not signed in'; end if;
  insert into public.workspaces(name, data, updated_by) values (coalesce(p_name,'Grant Copilot'), coalesce(p_data,'{}'::jsonb), me)
    returning id into new_id;
  insert into public.workspace_members(workspace_id, email, role) values (new_id, me, 'owner');
  return new_id;
end $$;
revoke all on function public.create_workspace(text, jsonb) from public, anon;
grant execute on function public.create_workspace(text, jsonb) to authenticated;
grant execute on function public.my_role(uuid) to authenticated;

alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.workspace_snapshots enable row level security;

drop policy if exists ws_select on public.workspaces;
drop policy if exists ws_update on public.workspaces;
drop policy if exists ws_delete on public.workspaces;
create policy ws_select on public.workspaces for select to authenticated using (public.my_role(id) is not null);
create policy ws_update on public.workspaces for update to authenticated using (public.my_role(id) is not null) with check (public.my_role(id) is not null);
create policy ws_delete on public.workspaces for delete to authenticated using (public.my_role(id) = 'owner');

drop policy if exists mem_select on public.workspace_members;
drop policy if exists mem_write  on public.workspace_members;
create policy mem_select on public.workspace_members for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email','')) or public.my_role(workspace_id) is not null);
create policy mem_write on public.workspace_members for all to authenticated
  using (public.my_role(workspace_id) = 'owner') with check (public.my_role(workspace_id) = 'owner' and email = lower(email));

drop policy if exists snap_select on public.workspace_snapshots;
drop policy if exists snap_insert on public.workspace_snapshots;
create policy snap_select on public.workspace_snapshots for select to authenticated using (public.my_role(workspace_id) is not null);
create policy snap_insert on public.workspace_snapshots for insert to authenticated with check (public.my_role(workspace_id) is not null);

-- Keep only the newest 200 snapshots per workspace.
create or replace function public.trim_snapshots() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.workspace_snapshots
  where workspace_id = new.workspace_id
    and id not in (select id from public.workspace_snapshots where workspace_id = new.workspace_id order by created_at desc limit 200);
  return new;
end $$;
drop trigger if exists trim_snapshots on public.workspace_snapshots;
create trigger trim_snapshots after insert on public.workspace_snapshots for each row execute function public.trim_snapshots();

-- ---------- private file storage for the Document Library ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;

-- Files live under <workspace_id>/<doc_id>/<file>; members of that workspace can use them.
drop policy if exists docs_select on storage.objects;
drop policy if exists docs_insert on storage.objects;
drop policy if exists docs_update on storage.objects;
drop policy if exists docs_delete on storage.objects;
create policy docs_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.my_role(((storage.foldername(name))[1])::uuid) is not null);
create policy docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.my_role(((storage.foldername(name))[1])::uuid) is not null);
create policy docs_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.my_role(((storage.foldername(name))[1])::uuid) is not null);
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.my_role(((storage.foldername(name))[1])::uuid) in ('owner','writer','director'));
