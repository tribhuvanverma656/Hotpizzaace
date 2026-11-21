-- Shared commerce is server-only. Browser publishable keys cannot read or write customer data.
create schema if not exists hpa_private;
revoke all on schema hpa_private from public, anon, authenticated;

create table public.hpa_commerce_state (
  id boolean primary key default true check (id),
  revision bigint not null default 1 check (revision > 0),
  mode text not null default 'development' check (mode in ('development', 'production')),
  allow_simulated_payments boolean not null default false
);
insert into public.hpa_commerce_state (id, mode, allow_simulated_payments)
values (true, 'development', true);

create table public.hpa_categories (
  id text primary key check (length(id) between 1 and 100),
  slug text not null unique,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id)
);
create table public.hpa_products (
  id text primary key check (length(id) between 1 and 100),
  category_id text not null references public.hpa_categories(id) on delete restrict,
  slug text not null unique,
  data jsonb not null check (
    jsonb_typeof(data) = 'object' and data->>'id' = id
    and data->>'categoryId' = category_id
    and (data->>'price')::bigint >= 0
  )
);
create index hpa_products_category_idx on public.hpa_products(category_id);
create table public.hpa_branches (
  id text primary key check (length(id) between 1 and 100),
  slug text not null unique,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id)
);
create table public.hpa_admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);
create table hpa_private.owner_invites (
  email text primary key check (email = lower(email)),
  claimed_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table hpa_private.owner_invites enable row level security;
revoke all on hpa_private.owner_invites from public, anon, authenticated;

-- The owner explicitly nominated this address. Only a verified Google Auth user can claim it.
insert into hpa_private.owner_invites(email) values ('hotpizzaace@gmail.com');
create function hpa_private.claim_owner_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_claim uuid;
begin
  if new.email_confirmed_at is null or new.email is null
     or not coalesce((new.raw_app_meta_data->'providers') ? 'google', false) then
    return new;
  end if;
  update hpa_private.owner_invites set claimed_user_id = new.id
  where email = lower(new.email) and (claimed_user_id is null or claimed_user_id = new.id)
  returning claimed_user_id into v_claim;
  if v_claim = new.id then
    insert into public.hpa_admin_memberships(user_id, role) values (new.id, 'owner')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function hpa_private.claim_owner_invite() from public, anon, authenticated;
create trigger hpa_claim_owner_invite
after insert or update of email, email_confirmed_at, raw_app_meta_data on auth.users
for each row execute function hpa_private.claim_owner_invite();

-- Also handle the nominated account if it already completed Google sign-in.
insert into public.hpa_admin_memberships(user_id, role)
select id, 'owner' from auth.users
where lower(email) = 'hotpizzaace@gmail.com' and email_confirmed_at is not null
  and coalesce((raw_app_meta_data->'providers') ? 'google', false)
on conflict (user_id) do nothing;
update hpa_private.owner_invites i set claimed_user_id = m.user_id
from public.hpa_admin_memberships m join auth.users u on u.id = m.user_id
where lower(u.email) = i.email;

create table public.hpa_orders (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  guest_session_hash text check (guest_session_hash ~ '^[a-f0-9]{64}$'),
  tracking_token_hash text not null check (tracking_token_hash ~ '^[a-f0-9]{64}$'),
  idempotency_scope text not null check (length(idempotency_scope) between 1 and 160),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check (version > 0),
  data jsonb not null,
  created_at timestamptz not null default now(),
  branch_id text generated always as (data->>'branchId') stored references public.hpa_branches(id),
  status text generated always as (data->>'status') stored,
  constraint hpa_order_idempotency unique(idempotency_scope, idempotency_key),
  constraint hpa_order_document check (
    jsonb_typeof(data) = 'object'
    and data ?& array['id','number','createdAt','branchId','customer','items','fulfillment','paymentMethod','paymentStatus','status','subtotal','deliveryFee','discount','total','paymentMode']
    and data->>'id' = id::text and length(data->>'number') between 1 and 100
    and data->>'paymentMode' = 'simulation'
    and jsonb_typeof(data->'customer') = 'object'
    and jsonb_typeof(data->'items') = 'array' and jsonb_array_length(data->'items') between 1 and 100
    and data->>'fulfillment' in ('delivery', 'pickup')
    and data->>'paymentMethod' in ('upi', 'card', 'cash')
    and data->>'paymentStatus' in ('initiated', 'pending', 'simulated_paid', 'failed')
    and data->>'status' in ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'cancelled', 'rejected')
    and (data->>'subtotal')::bigint >= 0 and (data->>'deliveryFee')::bigint >= 0
    and (data->>'discount')::bigint >= 0 and (data->>'total')::bigint >= 0
    and (data->>'total')::bigint = (data->>'subtotal')::bigint + (data->>'deliveryFee')::bigint - (data->>'discount')::bigint
  )
);
create unique index hpa_orders_number_idx on public.hpa_orders((data->>'number'));
create index hpa_orders_user_created_idx on public.hpa_orders(user_id, created_at desc) where user_id is not null;
create index hpa_orders_guest_created_idx on public.hpa_orders(guest_session_hash, created_at desc) where user_id is null;
create index hpa_orders_branch_created_idx on public.hpa_orders(branch_id, created_at desc);
create index hpa_orders_status_created_idx on public.hpa_orders(status, created_at desc);
create table public.hpa_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.hpa_orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  previous_status text,
  next_status text not null,
  previous_payment_status text,
  next_payment_status text not null,
  order_version integer not null,
  created_at timestamptz not null default now()
);
create index hpa_order_events_order_idx on public.hpa_order_events(order_id, created_at);
create index hpa_order_events_actor_idx on public.hpa_order_events(actor_id) where actor_id is not null;
create table public.hpa_rate_limits (
  key text primary key,
  started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);

-- Explicitly deny all direct client access, even if default table grants change later.
do $$
declare t text;
begin
  foreach t in array array['hpa_commerce_state','hpa_categories','hpa_products','hpa_branches','hpa_admin_memberships','hpa_orders','hpa_order_events','hpa_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy server_only on public.%I for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;
revoke all on sequence public.hpa_order_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.hpa_order_events_id_seq to service_role;

create function public.hpa_catalog_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revision', s.revision, 'mode', s.mode,
    'allowSimulatedPayments', s.allow_simulated_payments,
    'products', coalesce((select jsonb_agg(p.data order by p.id) from public.hpa_products p), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(c.data order by (c.data->>'sortOrder')::integer,c.id) from public.hpa_categories c), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(b.data order by b.id) from public.hpa_branches b), '[]'::jsonb)
  ) from public.hpa_commerce_state s where s.id = true;
$$;

create function public.hpa_replace_catalog(p_expected_revision bigint, p_products jsonb, p_categories jsonb, p_branches jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_revision bigint;
begin
  select revision into v_revision from public.hpa_commerce_state where id = true for update;
  if v_revision is distinct from p_expected_revision then raise exception 'revision_conflict'; end if;
  if jsonb_typeof(p_products) <> 'array' or jsonb_typeof(p_categories) <> 'array' or jsonb_typeof(p_branches) <> 'array'
     or jsonb_array_length(p_products) > 5000 or jsonb_array_length(p_categories) > 200
     or jsonb_array_length(p_branches) not between 1 and 100 then raise exception 'invalid_catalog'; end if;
  insert into public.hpa_categories(id,slug,data)
  select x->>'id',x->>'slug',x from jsonb_array_elements(p_categories) x
  on conflict(id) do update set slug = excluded.slug,data = excluded.data where hpa_categories.data is distinct from excluded.data;
  insert into public.hpa_products(id,category_id,slug,data)
  select x->>'id',x->>'categoryId',x->>'slug',x from jsonb_array_elements(p_products) x
  on conflict(id) do update set category_id = excluded.category_id,slug = excluded.slug,data = excluded.data where hpa_products.data is distinct from excluded.data;
  insert into public.hpa_branches(id,slug,data)
  select x->>'id',x->>'slug',x from jsonb_array_elements(p_branches) x
  on conflict(id) do update set slug = excluded.slug,data = excluded.data where hpa_branches.data is distinct from excluded.data;
  delete from public.hpa_products where id not in (select x->>'id' from jsonb_array_elements(p_products) x);
  delete from public.hpa_categories where id not in (select x->>'id' from jsonb_array_elements(p_categories) x);
  delete from public.hpa_branches where id not in (select x->>'id' from jsonb_array_elements(p_branches) x);
  update public.hpa_commerce_state set revision = revision + 1 where id = true;
  return public.hpa_catalog_snapshot();
end;
$$;

create function public.hpa_create_order(
  p_data jsonb, p_user_id uuid, p_guest_session_hash text, p_tracking_token_hash text,
  p_scope text, p_idempotency_key text, p_request_hash text, p_expected_catalog_revision bigint
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.hpa_orders; v_revision bigint;
begin
  -- Serializes catalogue checks and idempotency insertion without locking unrelated order updates.
  select revision into v_revision from public.hpa_commerce_state where id = true for update;
  select * into v_order from public.hpa_orders where idempotency_scope = p_scope and idempotency_key = p_idempotency_key;
  if found then
    if v_order.request_hash <> p_request_hash then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('order',v_order.data || jsonb_build_object('version',v_order.version),'created',false,'trackingTokenHash',v_order.tracking_token_hash);
  end if;
  if v_revision is distinct from p_expected_catalog_revision then raise exception 'revision_conflict'; end if;
  if p_user_id is null and p_guest_session_hash is null then raise exception 'invalid_order_owner'; end if;
  if p_scope is distinct from (case when p_user_id is null then 'guest:' || p_guest_session_hash else 'user:' || p_user_id::text end) then
    raise exception 'invalid_order_owner';
  end if;
  if p_data->>'status' <> 'pending' or p_data->>'paymentStatus' not in ('pending','initiated') then raise exception 'invalid_initial_status'; end if;
  insert into public.hpa_orders(id,user_id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data)
  values ((p_data->>'id')::uuid,p_user_id,p_guest_session_hash,p_tracking_token_hash,p_scope,p_idempotency_key,p_request_hash,p_data - array['version','trackingUrl','accessToken'])
  returning * into v_order;
  insert into public.hpa_order_events(order_id,actor_id,kind,next_status,next_payment_status,order_version)
  values (v_order.id,p_user_id,'created',v_order.data->>'status',v_order.data->>'paymentStatus',v_order.version);
  return jsonb_build_object('order',v_order.data || jsonb_build_object('version',v_order.version),'created',true,'trackingTokenHash',v_order.tracking_token_hash);
end;
$$;

create function public.hpa_update_order(p_id uuid, p_expected_version integer, p_data jsonb, p_actor_id uuid, p_kind text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.hpa_orders; v_next jsonb; v_old jsonb; v_allowed text[];
begin
  select * into v_order from public.hpa_orders where id = p_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.version is distinct from p_expected_version then raise exception 'version_conflict'; end if;
  v_old := v_order.data - array['version','trackingUrl','accessToken'];
  v_next := p_data - array['version','trackingUrl','accessToken'];
  if (v_old - array['status','paymentStatus']) is distinct from (v_next - array['status','paymentStatus']) then
    raise exception 'immutable_order_fields';
  end if;
  if p_kind in ('status','cash_collected') and not exists(select 1 from public.hpa_admin_memberships where user_id = p_actor_id and role = 'owner') then
    raise exception 'admin_required';
  end if;
  if p_kind not in ('status','payment','cash_collected') then raise exception 'invalid_order_operation'; end if;
  if p_kind = 'status' then
    if v_old->>'paymentStatus' is distinct from v_next->>'paymentStatus' then raise exception 'invalid_status_update'; end if;
    if v_old->>'paymentMethod' <> 'cash' and v_old->>'paymentStatus' <> 'simulated_paid'
       and v_next->>'status' not in ('cancelled','rejected') then raise exception 'payment_not_complete'; end if;
    v_allowed := case v_old->>'status'
      when 'pending' then array['confirmed','rejected','cancelled']
      when 'confirmed' then array['preparing','cancelled']
      when 'preparing' then array['ready','cancelled']
      when 'ready' then case when v_old->>'fulfillment' = 'delivery' then array['out_for_delivery','cancelled'] else array['picked_up','cancelled'] end
      when 'out_for_delivery' then array['delivered'] else array[]::text[] end;
    if v_next->>'status' <> v_old->>'status' and not (v_next->>'status' = any(v_allowed)) then raise exception 'invalid_status_transition'; end if;
  else
    if v_next->>'status' is distinct from v_old->>'status' then raise exception 'invalid_payment_update'; end if;
    if v_old->>'status' in ('rejected','cancelled') then raise exception 'order_not_payable'; end if;
    if p_kind = 'cash_collected' and (v_old->>'paymentMethod' <> 'cash' or v_next->>'paymentStatus' <> 'simulated_paid') then raise exception 'invalid_cash_collection'; end if;
    if p_kind = 'cash_collected' and v_old->>'status' not in ('delivered','picked_up') then raise exception 'order_not_handed_over'; end if;
    if p_kind = 'payment' and (v_old->>'paymentMethod' = 'cash' or v_next->>'paymentStatus' not in ('simulated_paid','failed')) then raise exception 'invalid_payment_update'; end if;
    if v_old->>'paymentStatus' = 'simulated_paid' and v_next->>'paymentStatus' <> 'simulated_paid' then raise exception 'payment_already_complete'; end if;
    if not exists(select 1 from public.hpa_commerce_state where id = true and mode = 'development' and allow_simulated_payments) then raise exception 'simulation_disabled'; end if;
  end if;
  if v_next = v_old then return v_old || jsonb_build_object('version',v_order.version); end if;
  update public.hpa_orders set data = v_next,version = version + 1 where id = p_id returning * into v_order;
  insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
  values (p_id,p_actor_id,p_kind,v_old->>'status',v_next->>'status',v_old->>'paymentStatus',v_next->>'paymentStatus',v_order.version);
  return v_order.data || jsonb_build_object('version',v_order.version);
end;
$$;

create function public.hpa_consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_attempts integer;
begin
  if length(p_key) > 200 or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then raise exception 'invalid_rate_limit'; end if;
  insert into public.hpa_rate_limits(key,started_at,attempts) values(p_key,now(),1)
  on conflict(key) do update set
    attempts = case when hpa_rate_limits.started_at < now() - make_interval(secs => p_window_seconds) then 1 else hpa_rate_limits.attempts + 1 end,
    started_at = case when hpa_rate_limits.started_at < now() - make_interval(secs => p_window_seconds) then now() else hpa_rate_limits.started_at end
  returning attempts into v_attempts;
  return v_attempts <= p_limit;
end;
$$;

-- These are internal transaction APIs. None can be invoked with a publishable/customer key.
revoke all on function public.hpa_catalog_snapshot() from public,anon,authenticated;
revoke all on function public.hpa_replace_catalog(bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.hpa_create_order(jsonb,uuid,text,text,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.hpa_update_order(uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.hpa_consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.hpa_catalog_snapshot() to service_role;
grant execute on function public.hpa_replace_catalog(bigint,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.hpa_create_order(jsonb,uuid,text,text,text,text,text,bigint) to service_role;
grant execute on function public.hpa_update_order(uuid,integer,jsonb,uuid,text) to service_role;
grant execute on function public.hpa_consume_rate_limit(text,integer,integer) to service_role;
