-- TEST ONLY. A minimal imitation of the parts of a Supabase database that the
-- DRIVEO migrations depend on, so they can run in PGlite (real PostgreSQL in WASM).
-- It is NOT a migration and must never be applied to a real project.
--
-- Imitated: the anon / authenticated / service_role roles (service_role bypasses RLS),
-- auth.users, auth.uid() / auth.jwt() reading request.jwt.claims, and Supabase's broad
-- default privileges on schema public (which the migrations must explicitly revoke).
-- Not imitated: GoTrue, PostgREST, schema exposure, the real JWT verification.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
