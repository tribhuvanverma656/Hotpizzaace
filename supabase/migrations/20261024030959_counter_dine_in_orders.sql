-- Counter orders are private staff-entered receipts, never customer checkout orders.
-- Browser roles retain no table or RPC access. All writes go through verified owner Edge routes.
alter table public.hpa_orders drop constraint hpa_order_document;
alter table public.hpa_orders add constraint hpa_order_document check ((
  jsonb_typeof(data) = 'object'
  and data ?& array['id','number','createdAt','branchId','customer','items','fulfillment','paymentMethod','paymentStatus','status','subtotal','deliveryFee','discount','total']
  and data->>'id' = id::text and length(data->>'number') between 1 and 100
  and jsonb_typeof(data->'customer') = 'object'
  and jsonb_typeof(data->'items') = 'array' and jsonb_array_length(data->'items') between 1 and 100
  and (data->>'subtotal')::bigint >= 0 and (data->>'deliveryFee')::bigint >= 0
  and (data->>'discount')::bigint >= 0 and (data->>'discount')::bigint <= (data->>'subtotal')::bigint
  and (data->>'total')::bigint >= 0
  and (data->>'total')::bigint = (data->>'subtotal')::bigint + (data->>'deliveryFee')::bigint - (data->>'discount')::bigint + coalesce((data->'tax'->>'total')::bigint,0)
  and (
    (
      data->>'channel' = 'counter' and data->>'fulfillment' = 'dine_in'
      and data->>'paymentMode' = 'counter_manual'
      and data->>'environment' in ('development','production')
      and (data->>'total')::bigint between 1 and 4999999
      and data->>'paymentMethod' in ('cash','upi') and data->>'paymentStatus' in ('pending','paid')
      and data->>'status' in ('confirmed','preparing','ready','served','closed','cancelled')
      and (data->>'deliveryFee')::bigint = 0 and data ? 'tax'
      and jsonb_typeof(data->'counter') = 'object'
      and data->'counter'->>'createdBy' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and jsonb_typeof(data->'counter'->'payLater') = 'boolean'
      and length(data->'counter'->>'tableLabel') between 0 and 80
      and (data->>'paymentStatus' <> 'pending' or (
        data->'counter'->>'payLater' = 'true'
        and length(btrim(data->'counter'->>'payLaterReason')) between 3 and 300
        and not data ? 'settlement'
      ))
      and (data->>'paymentStatus' <> 'paid' or (
        jsonb_typeof(data->'settlement')='object'
        and data->'settlement'->>'source'='staff'
        and data->'settlement'->>'method'=data->>'paymentMethod'
        and (data->'settlement'->>'amount')::bigint=(data->>'total')::bigint
        and data->'settlement'->>'confirmedBy' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        and length(data->'settlement'->>'confirmedAt') between 20 and 40
      ))
      and (data->>'status'<>'closed' or (
        data->>'paymentStatus'='paid' and data->'counter' ?& array['servedAt','closedAt']
      ))
      and not coalesce((data->>'paymentReviewRequired')::boolean,false)
    ) or (
      coalesce(data->>'channel','website') = 'website'
      and not data ? 'counter' and not data ? 'settlement'
      and (data->>'paymentMode' in ('simulation','razorpay_test','razorpay_live') or (data->>'paymentMethod'='cash' and not data ? 'paymentMode'))
      and data->>'fulfillment' in ('delivery','pickup')
      and data->>'paymentMethod' in ('upi','card','cash')
      and data->>'paymentStatus' in ('initiated','pending','simulated_paid','failed','paid')
      and (data->>'paymentStatus'<>'paid' or (data->>'paymentMode' in ('razorpay_test','razorpay_live') and data->>'paymentMethod'<>'cash'))
      and (data->>'paymentStatus'<>'simulated_paid' or data->>'paymentMode'='simulation')
      and data->>'status' in ('pending','confirmed','preparing','ready','out_for_delivery','delivered','picked_up','cancelled','rejected')
    )
  )
) is true);

-- Existing and newly created branches opt in explicitly after testing.
update public.hpa_branches set data=jsonb_set(data,'{settings,counterAcceptingOrders}','false'::jsonb)
where not (data->'settings' ? 'counterAcceptingOrders');
update public.hpa_commerce_state set revision=revision+1 where id=true;

create index hpa_kitchen_branch_active_idx on public.hpa_orders(branch_id,created_at,id)
where status in ('confirmed','preparing');
create index hpa_counter_branch_created_idx on public.hpa_orders(branch_id,created_at desc,id desc)
where data->>'channel'='counter';

create table public.hpa_counter_settlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.hpa_orders(id) on delete restrict,
  branch_id text not null references public.hpa_branches(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  mode text not null check(mode in ('development','production')),
  method text not null check(method in ('cash','upi')),
  amount bigint not null check(amount>0),
  cash_tendered bigint,
  change_amount bigint,
  upi_reference text,
  idempotency_key uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  confirmed_at timestamptz not null default now(),
  unique(actor_id,idempotency_key),
  constraint hpa_counter_tender check ((
    (method='cash' and cash_tendered>=amount and change_amount=cash_tendered-amount and upi_reference is null)
    or (method='upi' and cash_tendered is null and change_amount is null
      and upi_reference ~ '^[A-Z0-9]{6,80}$')
  ) is true)
);
create unique index hpa_counter_upi_reference_unique on public.hpa_counter_settlements(mode,upi_reference)
where upi_reference is not null;
create index hpa_counter_settlements_branch_time_idx on public.hpa_counter_settlements(branch_id,confirmed_at);
create index hpa_counter_settlements_actor_time_idx on public.hpa_counter_settlements(actor_id,confirmed_at);
alter table public.hpa_counter_settlements enable row level security;
create policy counter_settlements_client_deny on public.hpa_counter_settlements
for all to anon,authenticated using(false) with check(false);
revoke all on public.hpa_counter_settlements from public,anon,authenticated,service_role;
grant select,insert on public.hpa_counter_settlements to service_role;

create function hpa_private.counter_ledger_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'counter_settlement_immutable'; end $$;
revoke all on function hpa_private.counter_ledger_immutable() from public,anon,authenticated;
create trigger hpa_counter_settlement_append_only before update or delete on public.hpa_counter_settlements
for each row execute function hpa_private.counter_ledger_immutable();

create function public.hpa_require_counter_owner(p_actor_id uuid)
returns void language plpgsql stable security invoker set search_path='' as $$
begin
 if not exists (
   select 1 from public.hpa_admin_memberships m
   where m.user_id=p_actor_id and m.role='owner'
 ) then raise exception 'counter_owner_required'; end if;
end $$;
revoke all on function public.hpa_require_counter_owner(uuid) from public,anon,authenticated;
grant execute on function public.hpa_require_counter_owner(uuid) to service_role;

-- All money is integer paise and the audit amount is copied from the stored order total.
create function public.hpa_counter_payment_document(p_payment jsonb,p_total bigint,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; tender bigint; reference text;
begin
 if jsonb_typeof(p_payment)<>'object' or p_payment->>'confirmedReceived' is distinct from 'true'
   or p_payment->>'method' not in ('cash','upi') then raise exception 'counter_payment_invalid'; end if;
 result:=jsonb_build_object('method',p_payment->>'method','amount',p_total,'source','staff','confirmedBy',p_actor_id,'confirmedAt',now());
 if p_payment->>'method'='cash' then
   if coalesce(p_payment->>'cashTendered','') !~ '^[0-9]{1,12}$' or p_payment ? 'upiReference' then raise exception 'counter_payment_invalid'; end if;
   tender:=(p_payment->>'cashTendered')::bigint;
   if tender<p_total or tender>100000000 then raise exception 'counter_cash_insufficient'; end if;
   result:=result||jsonb_build_object('cashTendered',tender,'change',tender-p_total);
 else
   if p_payment ? 'cashTendered' then raise exception 'counter_payment_invalid'; end if;
   reference:=nullif(upper(btrim(p_payment->>'upiReference')),'');
   if reference is null or reference !~ '^[A-Z0-9]{6,80}$' then raise exception 'counter_payment_invalid'; end if;
   result:=result||jsonb_build_object('upiReference',reference);
 end if;
 return result;
end $$;
revoke all on function public.hpa_counter_payment_document(jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.hpa_counter_payment_document(jsonb,bigint,uuid) to service_role;

create function public.hpa_record_counter_settlement(p_order public.hpa_orders,p_actor_id uuid,p_key uuid,p_hash text)
returns void language plpgsql security invoker set search_path='' as $$
declare s jsonb:=p_order.data->'settlement'; m text;
begin
 select mode into m from public.hpa_commerce_state where id=true;
 insert into public.hpa_counter_settlements(order_id,branch_id,actor_id,mode,method,amount,cash_tendered,change_amount,upi_reference,idempotency_key,request_hash,confirmed_at)
 values(p_order.id,p_order.branch_id,p_actor_id,m,s->>'method',(s->>'amount')::bigint,
   (s->>'cashTendered')::bigint,(s->>'change')::bigint,s->>'upiReference',p_key,p_hash,(s->>'confirmedAt')::timestamptz);
end $$;
revoke all on function public.hpa_record_counter_settlement(public.hpa_orders,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hpa_record_counter_settlement(public.hpa_orders,uuid,uuid,text) to service_role;

-- Counter bills are issued on acceptance, including an explicit unpaid pay-later bill.
-- Website invoice timing and capture requirements remain unchanged.
create or replace function public.hpa_assign_invoice(p_order_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.hpa_orders; m text; fy integer; n integer; issued timestamptz:=now(); inv text; counter_order boolean;
begin
 select * into o from public.hpa_orders where id=p_order_id for update;
 if not found or not (o.data ? 'tax') or o.data ? 'invoice' then return; end if;
 counter_order:=o.data->>'channel'='counter';
 if not coalesce(counter_order,false) and o.status<>'ready' then return; end if;
 if coalesce(counter_order,false) and o.status not in ('confirmed','preparing','ready','served','closed') then return; end if;
 if coalesce((o.data->>'paymentReviewRequired')::boolean,false) then raise exception 'payment_review_required'; end if;
 if not coalesce(counter_order,false) and o.data->>'paymentMethod'<>'cash' and o.data->>'paymentStatus' not in ('paid','simulated_paid') then raise exception 'payment_not_complete'; end if;
 select mode into m from public.hpa_commerce_state where id=true;
 fy:=extract(year from issued at time zone 'Asia/Kolkata')::integer-case when extract(month from issued at time zone 'Asia/Kolkata')<4 then 1 else 0 end;
 insert into public.hpa_invoice_counters(mode,financial_year,last_value) values(m,fy,1)
 on conflict(mode,financial_year) do update set last_value=hpa_invoice_counters.last_value+1 returning last_value into n;
 inv:=case when m='production' then 'HPA/' else 'TST/' end||right(fy::text,2)||'-'||right((fy+1)::text,2)||'/'||lpad(n::text,6,'0');
 update public.hpa_orders set data=data||jsonb_build_object('invoice',jsonb_build_object('number',inv,'issuedAt',issued,'kind',case when m='production' then 'tax_invoice' else 'test_bill' end)) where id=o.id;
end $$;

create function public.hpa_create_counter_order(p_data jsonb,p_actor_id uuid,p_idempotency_key uuid,p_request_hash text,p_expected_catalog_revision bigint,p_payment jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.hpa_orders; revision bigint; b public.hpa_branches; next_data jsonb; settlement jsonb; scope text:='counter:user:'||p_actor_id::text;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 select s.revision into revision from public.hpa_commerce_state s where id=true for update;
 select * into o from public.hpa_orders where idempotency_scope=scope and idempotency_key=p_idempotency_key::text;
 if found then
   if o.request_hash is distinct from p_request_hash then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('order',o.data||jsonb_build_object('version',o.version),'replayed',true);
 end if;
 if revision is distinct from p_expected_catalog_revision then raise exception 'revision_conflict'; end if;
 select * into b from public.hpa_branches where id=p_data->>'branchId';
 if not found or b.data->'settings'->>'counterAcceptingOrders' is distinct from 'true'
   or b.data->'settings'->>'temporarilyClosed' is distinct from 'false' then raise exception 'counter_unavailable'; end if;
 if p_data->>'channel' is distinct from 'counter' or p_data->>'fulfillment' is distinct from 'dine_in'
   or p_data->>'paymentMode' is distinct from 'counter_manual' or p_data->>'status' is distinct from 'confirmed'
   or p_data->>'environment' is distinct from (select mode from public.hpa_commerce_state where id=true)
   or p_data->'counter'->>'createdBy' is distinct from p_actor_id::text
   or p_data->'tax'->'supplier' is distinct from b.data->'settings'->'billing'
   or not p_data ? 'tax' or p_data ? 'invoice'
   or p_data->'counter' ?| array['servedAt','closedAt'] then raise exception 'counter_order_invalid'; end if;
 next_data:=p_data-array['version','trackingUrl','accessToken','settlement'];
 if p_payment is not null and p_payment<>'null'::jsonb then
   settlement:=public.hpa_counter_payment_document(p_payment,(next_data->>'total')::bigint,p_actor_id);
   next_data:=next_data||jsonb_build_object('paymentMethod',settlement->>'method','paymentStatus','paid','settlement',settlement);
 else
   if next_data->>'paymentStatus' is distinct from 'pending' or next_data->'counter'->>'payLater' is distinct from 'true'
     or length(btrim(next_data->'counter'->>'payLaterReason')) not between 3 and 300 then raise exception 'counter_pay_later_reason_required'; end if;
 end if;
 insert into public.hpa_orders(id,user_id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data)
 values((next_data->>'id')::uuid,null,null,encode(extensions.gen_random_bytes(32),'hex'),scope,p_idempotency_key::text,p_request_hash,next_data)
 returning * into o;
 if settlement is not null then perform public.hpa_record_counter_settlement(o,p_actor_id,p_idempotency_key,p_request_hash); end if;
 insert into public.hpa_order_events(order_id,actor_id,kind,next_status,next_payment_status,order_version)
 values(o.id,p_actor_id,case when settlement is null then 'counter_pay_later_created' else 'counter_paid_created' end,o.status,o.data->>'paymentStatus',o.version);
 perform public.hpa_assign_invoice(o.id);
 select * into o from public.hpa_orders where id=o.id;
 return jsonb_build_object('order',o.data||jsonb_build_object('version',o.version),'replayed',false);
end $$;
revoke all on function public.hpa_create_counter_order(jsonb,uuid,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.hpa_create_counter_order(jsonb,uuid,uuid,text,bigint,jsonb) to service_role;

create function public.hpa_settle_counter_order(p_id uuid,p_expected_version integer,p_actor_id uuid,p_idempotency_key uuid,p_request_hash text,p_payment jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.hpa_orders; s public.hpa_counter_settlements; settlement jsonb; old_payment text;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 select * into o from public.hpa_orders where id=p_id for update;
 if not found or o.data->>'channel' is distinct from 'counter' then raise exception 'counter_order_not_found'; end if;
 select * into s from public.hpa_counter_settlements where actor_id=p_actor_id and idempotency_key=p_idempotency_key;
 if found then
   if s.order_id is distinct from p_id or s.request_hash is distinct from p_request_hash then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('order',o.data||jsonb_build_object('version',o.version),'replayed',true);
 end if;
 if o.version is distinct from p_expected_version then raise exception 'version_conflict'; end if;
 if o.status in ('closed','cancelled') then raise exception 'counter_order_not_payable'; end if;
 if o.data->>'paymentStatus'='paid' or o.data ? 'settlement' then raise exception 'counter_payment_already_received'; end if;
 old_payment:=o.data->>'paymentStatus';
 settlement:=public.hpa_counter_payment_document(p_payment,(o.data->>'total')::bigint,p_actor_id);
 update public.hpa_orders set data=data||jsonb_build_object('paymentMethod',settlement->>'method','paymentStatus','paid','settlement',settlement),version=version+1 where id=p_id returning * into o;
 perform public.hpa_record_counter_settlement(o,p_actor_id,p_idempotency_key,p_request_hash);
 insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
 values(o.id,p_actor_id,'counter_payment_received',o.status,o.status,old_payment,'paid',o.version);
 return jsonb_build_object('order',o.data||jsonb_build_object('version',o.version),'replayed',false);
end $$;
revoke all on function public.hpa_settle_counter_order(uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hpa_settle_counter_order(uuid,integer,uuid,uuid,text,jsonb) to service_role;

create function public.hpa_update_counter_status(p_id uuid,p_expected_version integer,p_actor_id uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.hpa_orders; previous_status text; allowed text[]; next_data jsonb;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 select * into o from public.hpa_orders where id=p_id for update;
 if not found or o.data->>'channel' is distinct from 'counter' then raise exception 'counter_order_not_found'; end if;
 if o.version is distinct from p_expected_version then raise exception 'version_conflict'; end if;
 if p_status=o.status then return o.data||jsonb_build_object('version',o.version); end if;
 allowed:=case o.status
   when 'confirmed' then array['preparing','cancelled']
   when 'preparing' then array['ready','cancelled']
   when 'ready' then array['served','cancelled']
   when 'served' then array['closed'] else array[]::text[] end;
 if p_status is null or not p_status=any(allowed) then raise exception 'counter_status_invalid'; end if;
 if p_status='closed' and o.data->>'paymentStatus'<>'paid' then raise exception 'counter_payment_required'; end if;
 if p_status='cancelled' and o.data->>'paymentStatus'='paid' then raise exception 'counter_paid_cancellation_requires_refund'; end if;
 next_data:=jsonb_set(o.data,'{status}',to_jsonb(p_status));
 if p_status='served' then
   next_data:=jsonb_set(next_data,'{counter,servedAt}',to_jsonb(now()))||jsonb_build_object('completedAt',now());
 end if;
 if p_status='closed' then next_data:=jsonb_set(next_data,'{counter,closedAt}',to_jsonb(now())); end if;
 previous_status:=o.status;
 update public.hpa_orders set data=next_data,version=version+1 where id=p_id returning * into o;
 insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
 values(o.id,p_actor_id,'counter_status',previous_status,o.status,o.data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 return o.data||jsonb_build_object('version',o.version);
end $$;
revoke all on function public.hpa_update_counter_status(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.hpa_update_counter_status(uuid,integer,uuid,text) to service_role;

-- Protect counter receipts from the website payment/status path, including simulator requests.
-- The original website transaction function is retained verbatim behind an explicit channel guard.
alter function public.hpa_update_order(uuid,integer,jsonb,uuid,text) rename to hpa_update_website_order;
revoke all on function public.hpa_update_website_order(uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
create function public.hpa_update_order(p_id uuid,p_expected_version integer,p_data jsonb,p_actor_id uuid,p_kind text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.hpa_orders; payload jsonb; result jsonb;
begin
 select * into previous from public.hpa_orders where id=p_id for update;
 if found and previous.data->>'channel'='counter' then raise exception 'counter_operation_required'; end if;
 -- The browser cannot supply or change a completion clock. Existing clocks are immutable;
 -- legacy completed orders stay undated rather than receiving a fabricated time on re-save.
 payload:=p_data-'completedAt';
 if previous.data ? 'completedAt' then payload:=payload||jsonb_build_object('completedAt',previous.data->'completedAt'); end if;
 result:=public.hpa_update_website_order(p_id,p_expected_version,payload,p_actor_id,p_kind);
 if p_kind='status' and previous.status is distinct from result->>'status' and result->>'status' in ('delivered','picked_up') then
   update public.hpa_orders set data=data||jsonb_build_object('completedAt',now()) where id=p_id
   returning data||jsonb_build_object('version',version) into result;
 end if;
 return result;
end $$;
revoke all on function public.hpa_update_order(uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.hpa_update_order(uuid,integer,jsonb,uuid,text) to service_role;
