-- Additive reconciliation only. Refund initiation remains in the merchant dashboard.
-- Captures and original tax invoices are retained; processed refund entries are separate.
create table public.hpa_payment_refunds (
  provider_refund_id text primary key check(provider_refund_id ~ '^rfnd_[A-Za-z0-9]{6,100}$'),
  provider_payment_id text not null references public.hpa_payment_records(provider_payment_id) on delete restrict,
  attempt_id uuid not null references public.hpa_payment_attempts(id) on delete restrict,
  amount bigint not null check(amount between 1 and 100000000),
  currency text not null check(currency='INR'),
  state text not null check(state in ('pending','processed','failed')),
  provider_created_at timestamptz not null,
  processed_at timestamptz,
  timestamp_source text check(timestamp_source in ('provider_event','verified_at')),
  verified_at timestamptz not null default now(),
  check ((state='processed' and processed_at is not null and timestamp_source is not null)
    or (state<>'processed' and processed_at is null and timestamp_source is null))
);
create index hpa_payment_refunds_attempt_idx on public.hpa_payment_refunds(attempt_id);
create index hpa_payment_refunds_payment_idx on public.hpa_payment_refunds(provider_payment_id);
create index hpa_payment_refunds_processed_idx on public.hpa_payment_refunds(processed_at) where state='processed';
alter table public.hpa_payment_refunds enable row level security;
revoke all on table public.hpa_payment_refunds from public,anon,authenticated;
grant all on table public.hpa_payment_refunds to service_role;
create policy payment_refunds_client_deny on public.hpa_payment_refunds
  for all to anon,authenticated using(false) with check(false);

create function public.hpa_payment_reconciliation_attempts(p_order_id uuid,p_mode text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare o public.hpa_orders; expected_mode text;
begin
 select * into o from public.hpa_orders where id=p_order_id;
 if not found then raise exception 'payment_not_found'; end if;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 if p_mode is distinct from expected_mode or o.data->>'paymentMode' is distinct from ('razorpay_'||p_mode)
   or o.data->>'channel'='counter' or o.data ? 'testVoid' then raise exception 'payment_mismatch'; end if;
 if (select count(*) from public.hpa_payment_attempts where order_id=o.id)>100 then raise exception 'payment_conflict'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb)
   from public.hpa_payment_attempts a where a.order_id=o.id and a.provider_order_id is not null);
end $$;

create function public.hpa_payment_sync_refunds(
 p_attempt_id uuid,p_provider_order_id text,p_payment_id text,p_amount bigint,p_currency text,p_mode text,
 p_refunds jsonb,p_event_hash text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; pr public.hpa_payment_records;
 old_refund public.hpa_payment_refunds; item jsonb; old_data jsonb; next_data jsonb;
 target uuid; expected_mode text; total_refunded bigint; entries jsonb; incoming_amount bigint;
 incoming_created timestamptz; incoming_processed timestamptz; incoming_source text; incoming_state text;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 -- Match capture lock order: application order, then attempt; serializes concurrent refunds/capture.
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 if p_mode is distinct from expected_mode or a.mode is distinct from p_mode
   or o.data->>'paymentMode' is distinct from ('razorpay_'||p_mode) or o.data->>'channel'='counter'
   or o.data ? 'testVoid' or a.provider_order_id is distinct from p_provider_order_id
   or a.amount is distinct from p_amount or p_currency is distinct from 'INR'
   or p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9]{6,100}$'
   or jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds)>99
   or (p_event_hash is not null and p_event_hash !~ '^[a-f0-9]{64}$')
 then raise exception 'payment_mismatch'; end if;
 if p_event_hash is not null then
   insert into public.hpa_payment_webhook_events(body_hash,attempt_id) values(p_event_hash,a.id) on conflict do nothing;
   if not found then return o.data||jsonb_build_object('version',o.version); end if;
 end if;
 select * into pr from public.hpa_payment_records where provider_payment_id=p_payment_id for update;
 if found and (pr.attempt_id<>a.id or pr.amount<>p_amount or pr.currency<>p_currency) then raise exception 'payment_mismatch'; end if;
 -- Service supplies a freshly verified captured/refunded payment, even if capture webhook was missed.
 insert into public.hpa_payment_records(provider_payment_id,attempt_id,state,amount,currency)
 values(p_payment_id,a.id,'captured',p_amount,p_currency)
 on conflict(provider_payment_id) do update set state='captured',updated_at=now();
 update public.hpa_payment_attempts set state='captured',captured_payment_id=coalesce(captured_payment_id,p_payment_id),updated_at=now() where id=a.id;
 if (select count(*) from jsonb_array_elements(p_refunds)) <>
   (select count(distinct x->>'id') from jsonb_array_elements(p_refunds) x) then raise exception 'payment_mismatch'; end if;
 for item in select value from jsonb_array_elements(p_refunds) loop
   if jsonb_typeof(item) is distinct from 'object' or not item ?& array['id','amount','status','createdAt','processedAt','timestampSource']
     or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','amount','status','createdAt','processedAt','timestampSource'))
     or item->>'id' !~ '^rfnd_[A-Za-z0-9]{6,100}$' or jsonb_typeof(item->'amount') is distinct from 'number'
     or item->>'amount' !~ '^[0-9]+$' or item->>'status' not in ('pending','processed','failed')
   then raise exception 'payment_mismatch'; end if;
   incoming_amount:=(item->>'amount')::bigint;
   incoming_state:=item->>'status';
   incoming_created:=(item->>'createdAt')::timestamptz;
   incoming_processed:=(item->>'processedAt')::timestamptz;
   incoming_source:=item->>'timestampSource';
   if incoming_amount<1 or incoming_amount>p_amount or incoming_created is null or not isfinite(incoming_created)
     or incoming_created>now()+interval '5 minutes'
     or (incoming_state='processed' and (incoming_processed is null or not isfinite(incoming_processed)
       or incoming_processed<incoming_created or incoming_processed>now()+interval '5 minutes'
       or incoming_source not in ('provider_event','verified_at')))
     or (incoming_state<>'processed' and (incoming_processed is not null or incoming_source is not null))
   then raise exception 'payment_mismatch'; end if;
   select * into old_refund from public.hpa_payment_refunds where provider_refund_id=item->>'id' for update;
   if found then
     if old_refund.provider_payment_id<>p_payment_id or old_refund.attempt_id<>a.id
       or old_refund.amount<>incoming_amount or old_refund.currency<>p_currency
       or old_refund.provider_created_at<>incoming_created then raise exception 'payment_mismatch'; end if;
     -- Processed money is monotonic. A delayed failed/created event cannot reverse it.
     if old_refund.state='processed' then
       if incoming_state='processed' and old_refund.timestamp_source='verified_at' and incoming_source='provider_event' then
         update public.hpa_payment_refunds set processed_at=incoming_processed,timestamp_source=incoming_source,verified_at=now()
          where provider_refund_id=old_refund.provider_refund_id;
       end if;
     elsif incoming_state='processed' or old_refund.state='pending' then
       update public.hpa_payment_refunds set state=incoming_state,processed_at=incoming_processed,
         timestamp_source=incoming_source,verified_at=now() where provider_refund_id=old_refund.provider_refund_id;
     end if;
   else
     insert into public.hpa_payment_refunds(provider_refund_id,provider_payment_id,attempt_id,amount,currency,state,provider_created_at,processed_at,timestamp_source)
     values(item->>'id',p_payment_id,a.id,incoming_amount,p_currency,incoming_state,incoming_created,incoming_processed,incoming_source);
   end if;
 end loop;
 select coalesce(sum(r.amount),0),coalesce(jsonb_agg(jsonb_build_object(
   'id',r.provider_refund_id,'amount',r.amount,'processedAt',to_char(r.processed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'timestampSource',r.timestamp_source) order by r.processed_at,r.provider_refund_id),'[]'::jsonb)
 into total_refunded,entries from public.hpa_payment_refunds r join public.hpa_payment_attempts pa on pa.id=r.attempt_id
 where pa.order_id=o.id and r.state='processed';
 if total_refunded>(o.data->>'total')::bigint or
   (select coalesce(sum(amount),0) from public.hpa_payment_refunds where provider_payment_id=p_payment_id and state='processed')>p_amount
 then raise exception 'payment_mismatch'; end if;
 old_data:=o.data;
 next_data:=old_data||jsonb_build_object('paymentStatus','paid');
 if total_refunded>0 then
   next_data:=next_data||jsonb_build_object('refund',jsonb_build_object('amount',total_refunded,
     'status',case when total_refunded=(o.data->>'total')::bigint then 'full' else 'partial' end,'entries',entries));
 end if;
 if total_refunded>0 or o.status in ('cancelled','rejected') or exists(
   select 1 from public.hpa_payment_refunds r join public.hpa_payment_attempts pa on pa.id=r.attempt_id where pa.order_id=o.id and r.state='pending'
 ) or exists(select 1 from public.hpa_payment_records r join public.hpa_payment_attempts pa on pa.id=r.attempt_id
   where pa.order_id=o.id and r.state='captured' and r.provider_payment_id<>p_payment_id)
 then next_data:=next_data||jsonb_build_object('paymentReviewRequired',true); end if;
 if next_data is distinct from old_data then
   update public.hpa_orders set data=next_data,version=version+1 where id=o.id returning * into o;
   insert into public.hpa_order_events(order_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
   values(o.id,'razorpay_refund_sync',old_data->>'status',o.status,old_data->>'paymentStatus','paid',o.version);
 end if;
 return o.data||jsonb_build_object('version',o.version);
end $$;

revoke all on function public.hpa_payment_reconciliation_attempts(uuid,text) from public,anon,authenticated;
revoke all on function public.hpa_payment_sync_refunds(uuid,text,text,bigint,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.hpa_payment_reconciliation_attempts(uuid,text) to service_role;
grant execute on function public.hpa_payment_sync_refunds(uuid,text,text,bigint,text,text,jsonb,text) to service_role;

-- Database defense preserves the same provider order after failed payments.
create or replace function public.hpa_payment_reserve(p_order_id uuid,p_attempt_id uuid,p_mode text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare o public.hpa_orders; a public.hpa_payment_attempts; expected_mode text;
begin
 select * into o from public.hpa_orders where id=p_order_id for update;
 if not found then raise exception 'payment_not_found'; end if;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 if p_mode is distinct from expected_mode or o.data->>'paymentMode' is distinct from ('razorpay_'||p_mode) or o.data->>'paymentMethod' = 'cash' then raise exception 'payment_mismatch'; end if;
 if o.status in ('cancelled','rejected') or o.data->>'paymentStatus' = 'paid' or coalesce((o.data->>'paymentReviewRequired')::boolean,false) or coalesce((o.data->'refund'->>'amount')::bigint,0)>0 then raise exception 'payment_not_payable'; end if;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id;
 if found then
   if a.order_id <> p_order_id or a.mode <> p_mode then raise exception 'payment_mismatch'; end if;
   return jsonb_build_object('attempt',to_jsonb(a),'create',false);
 end if;
 if exists(select 1 from public.hpa_payment_attempts where order_id=p_order_id) then raise exception 'payment_conflict'; end if;
 insert into public.hpa_payment_attempts(id,order_id,mode,amount,receipt,state)
 values(p_attempt_id,p_order_id,p_mode,(o.data->>'total')::bigint,'hpa_'||p_attempt_id::text,'creating') returning * into a;
 return jsonb_build_object('attempt',to_jsonb(a),'create',true);
end $$;

-- Include older invoices whose processed refund falls in the selected financial day.
create or replace function public.hpa_sales_report_snapshot(
  p_actor_id uuid,
  p_branch_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  snapshot jsonb;
  range_count integer;
  report_mode text;
begin
  -- The Edge handler obtains p_actor_id from verified Auth, never a request field.
  -- Trusted memberships are created through verified owner onboarding.
  if p_actor_id is null or not exists (
    select 1 from public.hpa_admin_memberships m
    where m.user_id = p_actor_id and m.role = 'owner'
  ) then raise exception 'report_owner_required'; end if;
  if p_branch_id is null or length(p_branch_id) not between 1 and 100 or not exists (
    select 1 from public.hpa_branches b where b.id = p_branch_id
  ) then raise exception 'report_branch_not_found'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to <= p_from or p_to - p_from > interval '31 days'
    or p_from <> date_trunc('day',p_from at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
    or p_to <> date_trunc('day',p_to at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
  then raise exception 'report_range_invalid'; end if;

  -- STABLE plus this single SELECT uses one MVCC snapshot for all dates and rows.
  -- Comparisons are timestamptz comparisons, never lexical JSON timestamp comparisons.
  with matching as materialized (
    select o.id,o.created_at,o.version,o.data
    from public.hpa_orders o
    where o.branch_id = p_branch_id and not (o.data ? 'testVoid') and (
      (o.created_at >= p_from and o.created_at < p_to)
      or (
        coalesce(nullif(o.data->>'completedAt',''),nullif(o.data->'counter'->>'servedAt',''))::timestamptz >= p_from
        and coalesce(nullif(o.data->>'completedAt',''),nullif(o.data->'counter'->>'servedAt',''))::timestamptz < p_to
      )
      or (
        nullif(o.data->'settlement'->>'confirmedAt','')::timestamptz >= p_from
        and nullif(o.data->'settlement'->>'confirmedAt','')::timestamptz < p_to
      )
      or exists (select 1 from jsonb_array_elements(coalesce(o.data->'refund'->'entries','[]'::jsonb)) r
        where (r->>'processedAt')::timestamptz >= p_from and (r->>'processedAt')::timestamptz < p_to)
    )
    order by o.created_at,o.id
    limit 10001
  ), projected as (
    select id,created_at,jsonb_strip_nulls(jsonb_build_object(
      'id',id,'version',version,'number',data->'number','createdAt',data->'createdAt',
      'completedAt',data->'completedAt','branchId',p_branch_id,'branchName',data->'branchName',
      'channel',data->'channel','environment',data->'environment','fulfillment',data->'fulfillment',
      'status',data->'status','paymentMethod',data->'paymentMethod','paymentMode',data->'paymentMode',
      'paymentStatus',data->'paymentStatus','paymentReviewRequired',data->'paymentReviewRequired','refund',data->'refund',
      'subtotal',data->'subtotal','discount',data->'discount','deliveryFee',data->'deliveryFee','total',data->'total',
      'tax',case when data ? 'tax' then jsonb_build_object('cgst',data->'tax'->'cgst','sgst',data->'tax'->'sgst','total',data->'tax'->'total',
        'version',data->'tax'->'version','includedTotal',data->'tax'->'includedTotal',
        'taxableValue',data->'tax'->'taxableValue','groups',data->'tax'->'groups') end,
      'invoice',case when data ? 'invoice' then jsonb_build_object('number',data->'invoice'->'number') end,
      'counter',case when data ? 'counter' then jsonb_build_object('servedAt',data->'counter'->'servedAt','closedAt',data->'counter'->'closedAt') end,
      'settlement',case when data ? 'settlement' then jsonb_build_object(
        'source',data->'settlement'->'source','method',data->'settlement'->'method',
        'amount',data->'settlement'->'amount','confirmedAt',data->'settlement'->'confirmedAt',
        'confirmedBy',data->'settlement'->'confirmedBy'
      ) end
    )) as document
    from matching
  )
  select jsonb_build_object(
    'orders',coalesce(jsonb_agg(p.document order by p.created_at,p.id),'[]'::jsonb),
    'mode',(select s.mode from public.hpa_commerce_state s where s.id=true),
    'snapshotAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'complete',count(*) <= 10000
  ),count(*) into snapshot,range_count
  from projected p;

  if range_count > 10000 or octet_length(snapshot::text) > 8388608 then
    raise exception 'report_too_large';
  end if;
  report_mode := snapshot->>'mode';
  if report_mode is null or report_mode not in ('development','production') then
    raise exception 'report_unavailable';
  end if;
  return snapshot;
end;
$$;
revoke all on function public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz) to service_role;
