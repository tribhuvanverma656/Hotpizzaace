-- Private, bounded per-account address books. Publishable/customer keys have no direct access.
create function public.hpa_address_text_key(p_text text)
returns text language sql immutable strict security invoker set search_path = '' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.normalize(p_text, 'NFKC')), '[[:space:],]+', ' ', 'g'
  ));
$$;

-- This check never returns NULL: missing keys and JSON nulls must not bypass CHECK constraints.
create function public.hpa_address_documents_valid(p_addresses jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_address jsonb;
  v_customer jsonb;
  v_key text;
  v_id text;
  v_fingerprint text;
  v_ids text[] := array[]::text[];
  v_fingerprints text[] := array[]::text[];
  v_defaults integer := 0;
  v_count integer;
begin
  if p_addresses is null or pg_catalog.jsonb_typeof(p_addresses) is distinct from 'array' then
    return false;
  end if;
  v_count := pg_catalog.jsonb_array_length(p_addresses);
  if v_count > 10 or pg_catalog.octet_length(p_addresses::text) > 65536 then return false; end if;
  for v_address in select value from pg_catalog.jsonb_array_elements(p_addresses) loop
    if pg_catalog.jsonb_typeof(v_address) is distinct from 'object'
      or not (v_address ?& array['id','label','customer','isDefault'])
      or (v_address - array['id','label','customer','isDefault']) <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_address->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_address->'label') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_address->'isDefault') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(v_address->'customer') is distinct from 'object' then
      return false;
    end if;
    v_id := v_address->>'id';
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_id = any(v_ids)
      or pg_catalog.char_length(pg_catalog.btrim(v_address->>'label')) not between 1 and 40 then
      return false;
    end if;
    v_ids := pg_catalog.array_append(v_ids, v_id);
    v_customer := v_address->'customer';
    if not (v_customer ?& array['name','phone','address','locality','postalCode','landmark','instructions'])
      or (v_customer - array['name','phone','address','locality','postalCode','landmark','instructions']) <> '{}'::jsonb then
      return false;
    end if;
    foreach v_key in array array['name','phone','address','locality','postalCode','landmark','instructions'] loop
      if pg_catalog.jsonb_typeof(v_customer->v_key) is distinct from 'string'
        or (v_customer->>v_key) ~ '[[:cntrl:]]' then return false; end if;
    end loop;
    if pg_catalog.char_length(pg_catalog.btrim(v_customer->>'name')) not between 2 and 80
      or (v_customer->>'phone') !~ '^[6-9][0-9]{9}$'
      or pg_catalog.char_length(pg_catalog.btrim(v_customer->>'address')) not between 8 and 300
      or pg_catalog.char_length(pg_catalog.btrim(v_customer->>'locality')) not between 2 and 100
      or (v_customer->>'postalCode') !~ '^[1-9][0-9]{5}$'
      or pg_catalog.char_length(v_customer->>'landmark') > 150
      or pg_catalog.char_length(v_customer->>'instructions') > 300 then return false; end if;
    -- Phone identifies the recipient, not the account. Labels/instructions are deliberately excluded.
    v_fingerprint := pg_catalog.jsonb_build_array(
      public.hpa_address_text_key(v_customer->>'name'), v_customer->>'phone',
      public.hpa_address_text_key(v_customer->>'address'),
      public.hpa_address_text_key(v_customer->>'locality'), v_customer->>'postalCode',
      public.hpa_address_text_key(v_customer->>'landmark')
    )::text;
    if v_fingerprint = any(v_fingerprints) then return false; end if;
    v_fingerprints := pg_catalog.array_append(v_fingerprints, v_fingerprint);
    if (v_address->>'isDefault')::boolean then v_defaults := v_defaults + 1; end if;
  end loop;
  return v_defaults = case when v_count = 0 then 0 else 1 end;
end;
$$;

create table public.hpa_address_books (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  addresses jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint hpa_address_book_document check (public.hpa_address_documents_valid(addresses))
);
alter table public.hpa_address_books enable row level security;
revoke all on table public.hpa_address_books from public, anon, authenticated;
grant select, insert, update on table public.hpa_address_books to service_role;
create policy server_only on public.hpa_address_books for all to anon, authenticated
  using (false) with check (false);

create function public.hpa_get_address_book(p_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_book public.hpa_address_books;
begin
  if p_user_id is null then raise exception 'address_auth_required'; end if;
  select * into v_book from public.hpa_address_books where user_id = p_user_id;
  if not found then return jsonb_build_object('revision', 0, 'addresses', '[]'::jsonb); end if;
  return jsonb_build_object('revision', v_book.revision, 'addresses', v_book.addresses);
end;
$$;

create function public.hpa_replace_address_book(p_user_id uuid, p_expected_revision bigint, p_addresses jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_revision bigint;
begin
  if p_user_id is null then raise exception 'address_auth_required'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then
    raise exception 'address_revision_conflict';
  end if;
  if public.hpa_address_documents_valid(p_addresses) is not true then raise exception 'address_invalid'; end if;
  -- Concurrent first writes serialize on this account's PK, then share the same CAS below.
  insert into public.hpa_address_books(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select revision into v_revision from public.hpa_address_books where user_id = p_user_id for update;
  if v_revision is distinct from p_expected_revision then raise exception 'address_revision_conflict'; end if;
  update public.hpa_address_books set addresses = p_addresses, revision = revision + 1, updated_at = now()
  where user_id = p_user_id returning revision into v_revision;
  return jsonb_build_object('revision', v_revision, 'addresses', p_addresses);
end;
$$;

revoke all on function public.hpa_address_text_key(text) from public, anon, authenticated;
revoke all on function public.hpa_address_documents_valid(jsonb) from public, anon, authenticated;
revoke all on function public.hpa_get_address_book(uuid) from public, anon, authenticated;
revoke all on function public.hpa_replace_address_book(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.hpa_address_text_key(text) to service_role;
grant execute on function public.hpa_address_documents_valid(jsonb) to service_role;
grant execute on function public.hpa_get_address_book(uuid) to service_role;
grant execute on function public.hpa_replace_address_book(uuid,bigint,jsonb) to service_role;
