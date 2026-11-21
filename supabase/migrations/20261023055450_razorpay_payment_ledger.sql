-- Server-only Razorpay ledger. No secret or raw provider/customer payment payload is stored here.
alter table public.hpa_orders drop constraint hpa_order_document;
alter table public.hpa_orders add constraint hpa_order_document check ((
  jsonb_typeof(data) = 'object'
  and data ?& array['id','number','createdAt','branchId','customer','items','fulfillment','paymentMethod','paymentStatus','status','subtotal','deliveryFee','discount','total']
  and data->>'id' = id::text and length(data->>'number') between 1 and 100
  and (data->>'paymentMode' in ('simulation','razorpay_test','razorpay_live') or (data->>'paymentMethod' = 'cash' and not data ? 'paymentMode'))
  and jsonb_typeof(data->'customer') = 'object'
  and jsonb_typeof(data->'items') = 'array' and jsonb_array_length(data->'items') between 1 and 100
  and data->>'fulfillment' in ('delivery','pickup')
  and data->>'paymentMethod' in ('upi','card','cash')
  and data->>'paymentStatus' in ('initiated','pending','simulated_paid','failed','paid')
  and (data->>'paymentStatus' <> 'paid' or (data->>'paymentMode' in ('razorpay_test','razorpay_live') and data->>'paymentMethod' <> 'cash'))
  and (data->>'paymentStatus' <> 'simulated_paid' or data->>'paymentMode' = 'simulation')
  and data->>'status' in ('pending','confirmed','preparing','ready','out_for_delivery','delivered','picked_up','cancelled','rejected')
  and (data->>'subtotal')::bigint >= 0 and (data->>'deliveryFee')::bigint >= 0 and (data->>'discount')::bigint >= 0 and (data->>'total')::bigint >= 0
  and (data->>'total')::bigint = (data->>'subtotal')::bigint + (data->>'deliveryFee')::bigint - (data->>'discount')::bigint
) is true);

create table public.hpa_payment_attempts (
  id uuid primary key,
  order_id uuid not null references public.hpa_orders(id) on delete restrict,
  mode text not null check(mode in ('test','live')),
  amount bigint not null check(amount between 100 and 100000000),
  currency text not null default 'INR' check(currency = 'INR'),
  receipt text not null unique check(length(receipt) between 1 and 40),
  state text not null check(state in ('creating','ready','unknown','authorized','failed','captured')),
  provider_order_id text unique check(provider_order_id ~ '^order_[A-Za-z0-9]{6,100}$'),
  captured_payment_id text unique check(captured_payment_id ~ '^pay_[A-Za-z0-9]{6,100}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hpa_payment_attempts_order_idx on public.hpa_payment_attempts(order_id,created_at);
create table public.hpa_payment_records (
  provider_payment_id text primary key check(provider_payment_id ~ '^pay_[A-Za-z0-9]{6,100}$'),
  attempt_id uuid not null references public.hpa_payment_attempts(id) on delete restrict,
  state text not null check(state in ('created','authorized','failed','captured')),
  amount bigint not null check(amount between 100 and 100000000),
  currency text not null check(currency = 'INR'),
  updated_at timestamptz not null default now()
);
create index hpa_payment_records_attempt_idx on public.hpa_payment_records(attempt_id);
create table public.hpa_payment_webhook_events (
  body_hash text primary key check(body_hash ~ '^[a-f0-9]{64}$'),
  attempt_id uuid not null references public.hpa_payment_attempts(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index hpa_payment_events_attempt_idx on public.hpa_payment_webhook_events(attempt_id);
do $$ declare t text; begin
  foreach t in array array['hpa_payment_attempts','hpa_payment_records','hpa_payment_webhook_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;

create function public.hpa_payment_reserve(p_order_id uuid,p_attempt_id uuid,p_mode text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare o public.hpa_orders; a public.hpa_payment_attempts; expected_mode text;
begin
 select * into o from public.hpa_orders where id=p_order_id for update;
 if not found then raise exception 'payment_not_found'; end if;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 if p_mode is distinct from expected_mode or o.data->>'paymentMode' is distinct from ('razorpay_'||p_mode) or o.data->>'paymentMethod' = 'cash' then raise exception 'payment_mismatch'; end if;
 if o.status in ('cancelled','rejected') or o.data->>'paymentStatus' = 'paid' then raise exception 'payment_not_payable'; end if;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id;
 if found then
   if a.order_id <> p_order_id or a.mode <> p_mode then raise exception 'payment_mismatch'; end if;
   return jsonb_build_object('attempt',to_jsonb(a),'create',false);
 end if;
 if exists(select 1 from public.hpa_payment_attempts where order_id=p_order_id and state <> 'failed') then raise exception 'payment_conflict'; end if;
 insert into public.hpa_payment_attempts(id,order_id,mode,amount,receipt,state)
 values(p_attempt_id,p_order_id,p_mode,(o.data->>'total')::bigint,'hpa_'||p_attempt_id::text,'creating') returning * into a;
 return jsonb_build_object('attempt',to_jsonb(a),'create',true);
end $$;

create function public.hpa_payment_bind(p_attempt_id uuid,p_provider_order_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.hpa_payment_attempts;
begin
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 if not found then raise exception 'payment_not_found'; end if;
 if a.provider_order_id is not null then
   if a.provider_order_id <> p_provider_order_id then raise exception 'payment_mismatch'; end if;
   return to_jsonb(a);
 end if;
 if a.state <> 'creating' then raise exception 'payment_conflict'; end if;
 update public.hpa_payment_attempts set provider_order_id=p_provider_order_id,state='ready',updated_at=now() where id=p_attempt_id returning * into a;
 return to_jsonb(a);
end $$;

create function public.hpa_payment_mark_unknown(p_attempt_id uuid)
returns void language sql security invoker set search_path = '' as $$
 update public.hpa_payment_attempts set state='unknown',updated_at=now() where id=p_attempt_id and state='creating' and provider_order_id is null;
$$;
create function public.hpa_payment_find(p_attempt_id uuid,p_order_id uuid,p_provider_order_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select to_jsonb(a) from public.hpa_payment_attempts a
 where (p_attempt_id is null or a.id=p_attempt_id) and (p_order_id is null or a.order_id=p_order_id)
   and (p_provider_order_id is null or a.provider_order_id=p_provider_order_id)
   and (p_attempt_id is not null or p_provider_order_id is not null);
$$;

create function public.hpa_payment_apply(p_attempt_id uuid,p_provider_order_id text,p_payment_id text,p_status text,p_amount bigint,p_currency text,p_event_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; r public.hpa_payment_records; old_data jsonb; next_data jsonb; target uuid; review boolean;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 if a.provider_order_id is distinct from p_provider_order_id or a.amount is distinct from p_amount or p_currency <> 'INR' or a.mode is distinct from replace(o.data->>'paymentMode','razorpay_','') then raise exception 'payment_mismatch'; end if;
 if p_status not in ('created','authorized','failed','captured') or p_payment_id !~ '^pay_[A-Za-z0-9]{6,100}$' then raise exception 'payment_mismatch'; end if;
 if p_event_hash is not null then
   insert into public.hpa_payment_webhook_events(body_hash,attempt_id) values(p_event_hash,a.id) on conflict do nothing;
   if not found then return o.data||jsonb_build_object('version',o.version); end if;
 end if;
 select * into r from public.hpa_payment_records where provider_payment_id=p_payment_id for update;
 if found and (r.attempt_id<>a.id or r.amount<>p_amount or r.currency<>p_currency) then raise exception 'payment_mismatch'; end if;
 if found and r.state='captured' then return o.data||jsonb_build_object('version',o.version); end if;
 insert into public.hpa_payment_records(provider_payment_id,attempt_id,state,amount,currency)
 values(p_payment_id,a.id,p_status,p_amount,p_currency)
 on conflict(provider_payment_id) do update set state=excluded.state,updated_at=now()
 where hpa_payment_records.attempt_id=excluded.attempt_id and hpa_payment_records.amount=excluded.amount and hpa_payment_records.currency=excluded.currency;
 if not found then raise exception 'payment_mismatch'; end if;
 old_data := o.data;
 next_data := old_data;
 if p_status='captured' then
   review := o.status in ('cancelled','rejected') or coalesce((o.data->>'paymentReviewRequired')::boolean,false)
     or exists(select 1 from public.hpa_payment_records pr join public.hpa_payment_attempts pa on pa.id=pr.attempt_id where pa.order_id=o.id and pr.state='captured' and pr.provider_payment_id<>p_payment_id);
   next_data := next_data||jsonb_build_object('paymentStatus','paid');
   if review then next_data:=next_data||jsonb_build_object('paymentReviewRequired',true); end if;
   update public.hpa_payment_attempts set state='captured',captured_payment_id=coalesce(captured_payment_id,p_payment_id),updated_at=now() where id=a.id;
 elsif a.state <> 'captured' then
   if p_status='failed' then
     update public.hpa_payment_attempts set state='failed',updated_at=now() where id=a.id;
     if o.data->>'paymentStatus'<>'paid' and not exists(select 1 from public.hpa_payment_attempts where order_id=o.id and id<>a.id and state in ('creating','ready','unknown','authorized','captured')) then next_data:=next_data||jsonb_build_object('paymentStatus','failed'); end if;
   elsif p_status='authorized' then
     update public.hpa_payment_attempts set state='authorized',updated_at=now() where id=a.id;
   end if;
 end if;
 if next_data is distinct from old_data then
   update public.hpa_orders set data=next_data,version=version+1 where id=o.id returning * into o;
   insert into public.hpa_order_events(order_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
   values(o.id,'razorpay_'||p_status,old_data->>'status',o.status,old_data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 end if;
 return o.data||jsonb_build_object('version',o.version);
end $$;

create or replace function public.hpa_update_order(p_id uuid, p_expected_version integer, p_data jsonb, p_actor_id uuid, p_kind text)
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
    if v_old->>'paymentMethod' <> 'cash' and not ((v_old->>'paymentStatus' = 'simulated_paid' and coalesce(v_old->>'paymentMode','simulation') = 'simulation') or (v_old->>'paymentStatus' = 'paid' and v_old->>'paymentMode' in ('razorpay_test','razorpay_live') and not coalesce((v_old->>'paymentReviewRequired')::boolean,false)))
       and v_next->>'status' not in ('cancelled','rejected') then raise exception 'payment_not_complete'; end if;
    v_allowed := case v_old->>'status'
      when 'pending' then array['confirmed','rejected','cancelled']
      when 'confirmed' then array['preparing','cancelled']
      when 'preparing' then array['ready','cancelled']
      when 'ready' then case when v_old->>'fulfillment' = 'delivery' then array['out_for_delivery','cancelled'] else array['picked_up','cancelled'] end
      when 'out_for_delivery' then array['delivered'] else array[]::text[] end;
    if v_next->>'status' <> v_old->>'status' and not (v_next->>'status' = any(v_allowed)) then raise exception 'invalid_status_transition'; end if;
  else
    if coalesce(v_old->>'paymentMode','simulation') <> 'simulation' or v_old->>'paymentStatus' = 'paid' then raise exception 'provider_payment_immutable'; end if;
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

-- These transaction functions are callable only by the authenticated Edge service, never browser roles.
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hpa_payment_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
