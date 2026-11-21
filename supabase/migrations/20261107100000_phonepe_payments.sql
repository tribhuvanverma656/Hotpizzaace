-- PhonePe Payment Gateway (Standard Checkout v2) as the website's online provider.
-- Razorpay rows stay valid so historical receipts and their refund reconciliation keep working.
-- No credential, PayPage token beyond its short-lived URL, or raw provider payload is stored.

-- 1. Order documents may carry PhonePe modes; a paid website order still needs a verified provider mode.
alter table public.hpa_orders drop constraint hpa_order_document;
alter table public.hpa_orders add constraint hpa_order_document
CHECK ((((jsonb_typeof(data) = 'object'::text) AND (data ?& ARRAY['id'::text, 'number'::text, 'createdAt'::text, 'branchId'::text, 'customer'::text, 'items'::text, 'fulfillment'::text, 'paymentMethod'::text, 'paymentStatus'::text, 'status'::text, 'subtotal'::text, 'deliveryFee'::text, 'discount'::text, 'total'::text]) AND ((data ->> 'id'::text) = (id)::text) AND ((length((data ->> 'number'::text)) >= 1) AND (length((data ->> 'number'::text)) <= 100)) AND (jsonb_typeof((data -> 'customer'::text)) = 'object'::text) AND (jsonb_typeof((data -> 'items'::text)) = 'array'::text) AND ((jsonb_array_length((data -> 'items'::text)) >= 1) AND (jsonb_array_length((data -> 'items'::text)) <= 100)) AND (((data ->> 'subtotal'::text))::bigint >= 0) AND (((data ->> 'deliveryFee'::text))::bigint >= 0) AND (((data ->> 'discount'::text))::bigint >= 0) AND (((data ->> 'discount'::text))::bigint <= ((data ->> 'subtotal'::text))::bigint) AND (((data ->> 'total'::text))::bigint >= 0) AND (((data ->> 'total'::text))::bigint = (((((((data ->> 'subtotal'::text))::bigint + ((data ->> 'deliveryFee'::text))::bigint) - ((data ->> 'discount'::text))::bigint) + COALESCE((((data -> 'tax'::text) ->> 'total'::text))::bigint, (0)::bigint)) - COALESCE((((data -> 'tax'::text) ->> 'includedTotal'::text))::bigint, (0)::bigint)) + COALESCE(((data ->> 'roundOff'::text))::bigint, (0)::bigint))) AND ((((data ->> 'channel'::text) = 'counter'::text) AND ((data ->> 'fulfillment'::text) = ANY (ARRAY['dine_in'::text, 'delivery'::text])) AND ((data ->> 'paymentMode'::text) = 'counter_manual'::text) AND ((data ->> 'environment'::text) = ANY (ARRAY['development'::text, 'production'::text])) AND ((((data ->> 'total'::text))::bigint >= 1) AND (((data ->> 'total'::text))::bigint <= 4999999)) AND ((data ->> 'paymentMethod'::text) = ANY (ARRAY['cash'::text, 'upi'::text])) AND ((data ->> 'paymentStatus'::text) = ANY (ARRAY['pending'::text, 'paid'::text])) AND ((((data ->> 'fulfillment'::text) = 'dine_in'::text) AND ((data ->> 'status'::text) = ANY (ARRAY['confirmed'::text, 'preparing'::text, 'ready'::text, 'served'::text, 'closed'::text, 'cancelled'::text])) AND (((data ->> 'deliveryFee'::text))::bigint = 0)) OR (((data ->> 'fulfillment'::text) = 'delivery'::text) AND ((data ->> 'status'::text) = ANY (ARRAY['confirmed'::text, 'preparing'::text, 'ready'::text, 'out_for_delivery'::text, 'delivered'::text, 'cancelled'::text])) AND ((length(btrim(((data -> 'customer'::text) ->> 'name'::text))) >= 2) AND (length(btrim(((data -> 'customer'::text) ->> 'name'::text))) <= 80)) AND (((data -> 'customer'::text) ->> 'phone'::text) ~ '^[6-9][0-9]{9}$'::text) AND ((length(btrim(((data -> 'customer'::text) ->> 'address'::text))) >= 8) AND (length(btrim(((data -> 'customer'::text) ->> 'address'::text))) <= 200)) AND ((length(btrim(((data -> 'customer'::text) ->> 'locality'::text))) >= 2) AND (length(btrim(((data -> 'customer'::text) ->> 'locality'::text))) <= 100)) AND (((data -> 'customer'::text) ->> 'postalCode'::text) ~ '^[0-9]{6}$'::text) AND (length(COALESCE(((data -> 'customer'::text) ->> 'landmark'::text), ''::text)) <= 120) AND (length(COALESCE(((data -> 'customer'::text) ->> 'instructions'::text), ''::text)) <= 300) AND (((data ->> 'status'::text) <> ALL (ARRAY['out_for_delivery'::text, 'delivered'::text])) OR ((data ->> 'paymentStatus'::text) = 'paid'::text)) AND (((data ->> 'status'::text) <> 'delivered'::text) OR (jsonb_typeof((data -> 'completedAt'::text)) = 'string'::text)))) AND (data ? 'tax'::text) AND (jsonb_typeof((data -> 'counter'::text)) = 'object'::text) AND (((data -> 'counter'::text) ->> 'createdBy'::text) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'::text) AND (jsonb_typeof(((data -> 'counter'::text) -> 'payLater'::text)) = 'boolean'::text) AND ((length(((data -> 'counter'::text) ->> 'tableLabel'::text)) >= 0) AND (length(((data -> 'counter'::text) ->> 'tableLabel'::text)) <= 80)) AND (((data ->> 'paymentStatus'::text) <> 'pending'::text) OR ((((data -> 'counter'::text) ->> 'payLater'::text) = 'true'::text) AND ((length(btrim(((data -> 'counter'::text) ->> 'payLaterReason'::text))) >= 3) AND (length(btrim(((data -> 'counter'::text) ->> 'payLaterReason'::text))) <= 300)) AND (NOT (data ? 'settlement'::text)))) AND (((data ->> 'paymentStatus'::text) <> 'paid'::text) OR ((jsonb_typeof((data -> 'settlement'::text)) = 'object'::text) AND (((data -> 'settlement'::text) ->> 'source'::text) = 'staff'::text) AND (((data -> 'settlement'::text) ->> 'method'::text) = (data ->> 'paymentMethod'::text)) AND ((((data -> 'settlement'::text) ->> 'amount'::text))::bigint = ((data ->> 'total'::text))::bigint) AND (((data -> 'settlement'::text) ->> 'confirmedBy'::text) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'::text) AND ((length(((data -> 'settlement'::text) ->> 'confirmedAt'::text)) >= 20) AND (length(((data -> 'settlement'::text) ->> 'confirmedAt'::text)) <= 40)))) AND (((data ->> 'status'::text) <> 'closed'::text) OR (((data ->> 'paymentStatus'::text) = 'paid'::text) AND ((data -> 'counter'::text) ?& ARRAY['servedAt'::text, 'closedAt'::text]))) AND (NOT COALESCE(((data ->> 'paymentReviewRequired'::text))::boolean, false))) OR ((COALESCE((data ->> 'channel'::text), 'website'::text) = 'website'::text) AND (NOT (data ? 'counter'::text)) AND (NOT (data ? 'settlement'::text)) AND (((data ->> 'paymentMode'::text) = ANY (ARRAY['simulation'::text, 'razorpay_test'::text, 'razorpay_live'::text, 'phonepe_test'::text, 'phonepe_live'::text])) OR (((data ->> 'paymentMethod'::text) = 'cash'::text) AND (NOT (data ? 'paymentMode'::text)))) AND ((data ->> 'fulfillment'::text) = ANY (ARRAY['delivery'::text, 'pickup'::text])) AND ((data ->> 'paymentMethod'::text) = ANY (ARRAY['upi'::text, 'card'::text, 'cash'::text])) AND ((data ->> 'paymentStatus'::text) = ANY (ARRAY['initiated'::text, 'pending'::text, 'simulated_paid'::text, 'failed'::text, 'paid'::text])) AND (((data ->> 'paymentStatus'::text) <> 'paid'::text) OR (((data ->> 'paymentMode'::text) = ANY (ARRAY['razorpay_test'::text, 'razorpay_live'::text, 'phonepe_test'::text, 'phonepe_live'::text])) AND ((data ->> 'paymentMethod'::text) <> 'cash'::text))) AND (((data ->> 'paymentStatus'::text) <> 'simulated_paid'::text) OR ((data ->> 'paymentMode'::text) = 'simulation'::text)) AND ((data ->> 'status'::text) = ANY (ARRAY['pending'::text, 'confirmed'::text, 'preparing'::text, 'ready'::text, 'out_for_delivery'::text, 'delivered'::text, 'picked_up'::text, 'cancelled'::text, 'rejected'::text]))))) IS TRUE));

-- 2. Ledger rows know their provider. Identifier formats are checked per provider.
alter table public.hpa_payment_attempts add column provider text not null default 'razorpay'
  check (provider in ('razorpay','phonepe'));
alter table public.hpa_payment_attempts add column checkout_url text;
alter table public.hpa_payment_attempts add column provider_expires_at timestamptz;
alter table public.hpa_payment_attempts drop constraint hpa_payment_attempts_provider_order_id_check;
alter table public.hpa_payment_attempts drop constraint hpa_payment_attempts_captured_payment_id_check;
alter table public.hpa_payment_attempts add constraint hpa_payment_attempts_provider_ids check ((
  case provider
    when 'razorpay' then (provider_order_id is null or provider_order_id ~ '^order_[A-Za-z0-9]{6,100}$')
      and (captured_payment_id is null or captured_payment_id ~ '^pay_[A-Za-z0-9]{6,100}$')
      and checkout_url is null and provider_expires_at is null
    when 'phonepe' then (provider_order_id is null or provider_order_id ~ '^[A-Za-z0-9_-]{6,100}$')
      and (captured_payment_id is null or captured_payment_id ~ '^[A-Za-z0-9_-]{6,100}$')
      and receipt ~ '^[A-Za-z0-9_-]{1,40}$'
      and (checkout_url is null or (length(checkout_url) <= 2048 and checkout_url ~ '^https://[A-Za-z0-9.-]+\.phonepe\.com/'))
      and ((provider_order_id is null) = (checkout_url is null))
  end) is true);
alter table public.hpa_payment_records drop constraint hpa_payment_records_provider_payment_id_check;
alter table public.hpa_payment_records add constraint hpa_payment_records_provider_payment_id_check
  check (provider_payment_id ~ '^[A-Za-z0-9_-]{6,100}$');

-- Provider and mode come from the order document, e.g. phonepe_test -> ('phonepe','test').
create function public.hpa_payment_order_provider(p_data jsonb)
returns text language sql immutable set search_path='' as $$
  select case when p_data->>'paymentMode' in ('razorpay_test','razorpay_live') then 'razorpay'
              when p_data->>'paymentMode' in ('phonepe_test','phonepe_live') then 'phonepe' end;
$$;
create function public.hpa_payment_id_valid(p_provider text, p_value text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(case p_provider when 'razorpay' then p_value ~ '^pay_[A-Za-z0-9]{6,100}$'
                                  when 'phonepe' then p_value ~ '^[A-Za-z0-9_-]{6,100}$' end,false);
$$;

-- 3. Reservation. Razorpay keeps one attempt per order. PhonePe orders cannot be reopened once
-- FAILED, so a new attempt is allowed only after every earlier one is server-verified failed.
create or replace function public.hpa_payment_reserve(p_order_id uuid,p_attempt_id uuid,p_mode text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare o public.hpa_orders; a public.hpa_payment_attempts; expected_mode text; v_provider text;
begin
 select * into o from public.hpa_orders where id=p_order_id for update;
 if not found then raise exception 'payment_not_found'; end if;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 v_provider := public.hpa_payment_order_provider(o.data);
 if v_provider is null or p_mode is distinct from expected_mode or o.data->>'paymentMode' is distinct from (v_provider||'_'||p_mode) or o.data->>'paymentMethod' = 'cash' or o.data->>'channel'='counter' then raise exception 'payment_mismatch'; end if;
 if o.status in ('cancelled','rejected') or o.data->>'paymentStatus' = 'paid' or coalesce((o.data->>'paymentReviewRequired')::boolean,false) or coalesce((o.data->'refund'->>'amount')::bigint,0)>0 then raise exception 'payment_not_payable'; end if;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id;
 if found then
   if a.order_id <> p_order_id or a.mode <> p_mode or a.provider <> v_provider then raise exception 'payment_mismatch'; end if;
   return jsonb_build_object('attempt',to_jsonb(a),'create',false);
 end if;
 if v_provider='razorpay' then
   if exists(select 1 from public.hpa_payment_attempts where order_id=p_order_id) then raise exception 'payment_conflict'; end if;
 else
   if exists(select 1 from public.hpa_payment_attempts where order_id=p_order_id and (state<>'failed' or provider<>'phonepe'))
      or (select count(*) from public.hpa_payment_attempts where order_id=p_order_id)>=5 then raise exception 'payment_conflict'; end if;
 end if;
 insert into public.hpa_payment_attempts(id,order_id,mode,amount,receipt,state,provider)
 values(p_attempt_id,p_order_id,p_mode,(o.data->>'total')::bigint,
   case when v_provider='phonepe' then 'hpa_'||replace(p_attempt_id::text,'-','') else 'hpa_'||p_attempt_id::text end,
   'creating',v_provider) returning * into a;
 return jsonb_build_object('attempt',to_jsonb(a),'create',true);
end $$;

-- Razorpay binding stays as it was; PhonePe binds its order ID with the short-lived PayPage URL.
create function public.hpa_payment_bind_checkout(p_attempt_id uuid,p_provider_order_id text,p_checkout_url text,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.hpa_payment_attempts;
begin
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 if not found then raise exception 'payment_not_found'; end if;
 if a.provider<>'phonepe' or p_expires_at is null or p_expires_at < now() or p_expires_at > now()+interval '2 hours' then raise exception 'payment_mismatch'; end if;
 if a.provider_order_id is not null then
   if a.provider_order_id <> p_provider_order_id then raise exception 'payment_mismatch'; end if;
   return to_jsonb(a);
 end if;
 if a.state <> 'creating' then raise exception 'payment_conflict'; end if;
 update public.hpa_payment_attempts set provider_order_id=p_provider_order_id,checkout_url=p_checkout_url,provider_expires_at=p_expires_at,state='ready',updated_at=now()
 where id=p_attempt_id returning * into a;
 return to_jsonb(a);
end $$;

-- 4. Applying a verified provider state. Same rules as before, provider-aware.
create or replace function public.hpa_payment_apply(p_attempt_id uuid,p_provider_order_id text,p_payment_id text,p_status text,p_amount bigint,p_currency text,p_event_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; r public.hpa_payment_records; old_data jsonb; next_data jsonb; target uuid; review boolean;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 if a.provider_order_id is distinct from p_provider_order_id or a.amount is distinct from p_amount or p_currency <> 'INR'
   or o.data->>'paymentMode' is distinct from (a.provider||'_'||a.mode) then raise exception 'payment_mismatch'; end if;
 if p_status not in ('created','authorized','failed','captured') or not public.hpa_payment_id_valid(a.provider,p_payment_id) then raise exception 'payment_mismatch'; end if;
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
   values(o.id,a.provider||'_'||p_status,old_data->>'status',o.status,old_data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 end if;
 return o.data||jsonb_build_object('version',o.version);
end $$;

-- PhonePe can report an order FAILED (including expiry) before any payment instrument was used.
-- Only a server-side Order Status FAILED reaches this; it never downgrades a capture.
create function public.hpa_payment_mark_failed(p_attempt_id uuid,p_provider_order_id text,p_amount bigint,p_event_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; old_data jsonb; target uuid;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 if a.provider<>'phonepe' or a.provider_order_id is distinct from p_provider_order_id or a.amount is distinct from p_amount
   or o.data->>'paymentMode' is distinct from (a.provider||'_'||a.mode) then raise exception 'payment_mismatch'; end if;
 if p_event_hash is not null then
   insert into public.hpa_payment_webhook_events(body_hash,attempt_id) values(p_event_hash,a.id) on conflict do nothing;
   if not found then return o.data||jsonb_build_object('version',o.version); end if;
 end if;
 if a.state in ('captured','failed') then return o.data||jsonb_build_object('version',o.version); end if;
 if exists(select 1 from public.hpa_payment_records where attempt_id=a.id and state='captured') then raise exception 'payment_conflict'; end if;
 update public.hpa_payment_attempts set state='failed',updated_at=now() where id=a.id;
 old_data:=o.data;
 if o.data->>'paymentStatus'<>'paid' and not exists(select 1 from public.hpa_payment_attempts where order_id=o.id and id<>a.id and state in ('creating','ready','unknown','authorized','captured')) then
   update public.hpa_orders set data=data||jsonb_build_object('paymentStatus','failed'),version=version+1 where id=o.id returning * into o;
   insert into public.hpa_order_events(order_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
   values(o.id,'phonepe_failed',old_data->>'status',o.status,old_data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 end if;
 return o.data||jsonb_build_object('version',o.version);
end $$;

-- 5. Refund review and reconciliation helpers become provider-aware. PhonePe refunds are not
-- posted automatically: a verified refund pauses fulfilment for owner review.
create or replace function public.hpa_payment_flag_refund_review(
 p_attempt_id uuid,p_provider_order_id text,p_payment_id text,p_amount bigint,p_currency text,p_mode text,p_evidence_amount bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; target uuid; expected_mode text; next_data jsonb;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 if p_mode is distinct from expected_mode or a.mode is distinct from p_mode
   or o.data->>'paymentMode' is distinct from (a.provider||'_'||p_mode) or o.data->>'channel'='counter'
   or o.data ? 'testVoid' or a.provider_order_id is distinct from p_provider_order_id
   or a.amount is distinct from p_amount or p_currency is distinct from 'INR'
   or p_payment_id is null or not public.hpa_payment_id_valid(a.provider,p_payment_id)
   or p_evidence_amount is null or p_evidence_amount<1 or p_evidence_amount>p_amount
 then raise exception 'payment_mismatch'; end if;
 if exists(select 1 from public.hpa_payment_records r where r.provider_payment_id=p_payment_id
   and (r.attempt_id<>a.id or r.amount<>p_amount or r.currency<>p_currency)) then raise exception 'payment_mismatch'; end if;
 next_data:=o.data||jsonb_build_object('paymentReviewRequired',true,'refundSyncPending',true);
 if next_data is distinct from o.data then
   update public.hpa_orders set data=next_data,version=version+1 where id=o.id returning * into o;
   insert into public.hpa_order_events(order_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
   values(o.id,a.provider||'_refund_review',o.status,o.status,o.data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 end if;
 return o.data||jsonb_build_object('version',o.version);
end $$;

create or replace function public.hpa_payment_reconciliation_attempts(p_order_id uuid, p_mode text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare o public.hpa_orders; expected_mode text; v_provider text;
begin
 select * into o from public.hpa_orders where id=p_order_id;
 if not found then raise exception 'payment_not_found'; end if;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 v_provider:=public.hpa_payment_order_provider(o.data);
 if v_provider is null or p_mode is distinct from expected_mode or o.data->>'paymentMode' is distinct from (v_provider||'_'||p_mode)
   or o.data->>'channel'='counter' or o.data ? 'testVoid' then raise exception 'payment_mismatch'; end if;
 if (select count(*) from public.hpa_payment_attempts where order_id=o.id)>100 then raise exception 'payment_conflict'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb)
   from public.hpa_payment_attempts a where a.order_id=o.id and a.provider_order_id is not null);
end $$;

-- Webhooks identify a PhonePe order by our merchantOrderId (the attempt receipt).
create function public.hpa_payment_find_receipt(p_receipt text)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select to_jsonb(a) from public.hpa_payment_attempts a where a.provider='phonepe' and a.receipt=p_receipt;
$$;

-- 6. Owner status changes and kitchen eligibility accept a verified PhonePe payment like Razorpay.
CREATE OR REPLACE FUNCTION public.hpa_update_website_order(p_id uuid, p_expected_version integer, p_data jsonb, p_actor_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    if v_old->>'paymentMethod' <> 'cash' and not ((v_old->>'paymentStatus' = 'simulated_paid' and coalesce(v_old->>'paymentMode','simulation') = 'simulation') or (v_old->>'paymentStatus' = 'paid' and v_old->>'paymentMode' in ('razorpay_test','razorpay_live','phonepe_test','phonepe_live') and not coalesce((v_old->>'paymentReviewRequired')::boolean,false)))
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
  if v_order.status='ready' then
    perform public.hpa_assign_invoice(p_id);
    select * into v_order from public.hpa_orders where id=p_id;
  end if;
  return v_order.data || jsonb_build_object('version',v_order.version);
end;
$function$;

CREATE OR REPLACE FUNCTION public.hpa_kitchen_order_eligible(p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce((
    p_data->>'status' in ('confirmed','preparing') and not p_data ? 'testVoid'
    and not coalesce((p_data->>'paymentReviewRequired')::boolean,false)
    and not coalesce((p_data->>'refundSyncPending')::boolean,false)
    and coalesce((p_data->'refund'->>'amount')::bigint,0)=0
    and case when p_data->>'channel'='counter' then
      (p_data->>'paymentMode'='counter_manual' and (
        (p_data->>'paymentStatus'='paid' and p_data->'settlement'->>'source'='staff'
          and (p_data->'settlement'->>'amount')::bigint=(p_data->>'total')::bigint)
        or (p_data->>'paymentStatus'='pending' and p_data->'counter'->>'payLater'='true'
          and length(btrim(coalesce(p_data->'counter'->>'payLaterReason','')))>=3)))
    else p_data->>'paymentMethod'='cash'
      or (p_data->>'paymentStatus'='paid' and p_data->>'paymentMode' in (select provider||'_'||case s.mode when 'development' then 'test' else 'live' end from public.hpa_commerce_state s cross join unnest(array['razorpay','phonepe']) provider where s.id=true))
      or (p_data->>'paymentStatus'='simulated_paid' and p_data->>'paymentMode'='simulation'
        and exists(select 1 from public.hpa_commerce_state where id=true and mode='development' and allow_simulated_payments)) end
  ),false);
$function$;

-- Server-only, like every other payment function.
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and (p.proname like 'hpa_payment_%' or p.proname in ('hpa_update_website_order','hpa_kitchen_order_eligible')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
