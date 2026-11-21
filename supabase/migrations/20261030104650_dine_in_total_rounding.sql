-- Freeze the final payable amount in whole rupees, in the customer's favour.
-- Absent roundOff means a historical bill: never recalculate saved invoices or settlements.
-- Base prices, discount allocations, GST and inclusive MRP snapshots remain unchanged.
create function public.hpa_order_round_off_valid(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare adjustment numeric; unrounded numeric;
begin
 if not (p_data ? 'roundOff') then return true; end if;
 if jsonb_typeof(p_data->'roundOff') is distinct from 'number'
   or not (p_data->>'roundOff') ~ '^-?[0-9]+$'
   or jsonb_typeof(p_data->'total') is distinct from 'number'
   or not (p_data->>'total') ~ '^[0-9]+$' then return false; end if;
 adjustment:=(p_data->>'roundOff')::numeric;
 unrounded:=(p_data->>'subtotal')::numeric+(p_data->>'deliveryFee')::numeric-(p_data->>'discount')::numeric
   +coalesce((p_data->'tax'->>'total')::numeric,0)-coalesce((p_data->'tax'->>'includedTotal')::numeric,0);
 return (adjustment between -99 and 0 and adjustment=-mod(unrounded,100)
   and (p_data->>'total')::numeric=unrounded+adjustment and (p_data->>'total')::numeric>0) is true;
exception when others then return false;
end $$;
revoke all on function public.hpa_order_round_off_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_order_round_off_valid(jsonb) to service_role;

-- Reuse the complete existing tax validator with its original unrounded total.
-- The new wrapper independently checks the signed adjustment before restoring that total.
alter function public.hpa_order_tax_valid(jsonb) rename to hpa_order_tax_before_round_off_valid;
revoke all on function public.hpa_order_tax_before_round_off_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_order_tax_before_round_off_valid(jsonb) to service_role;
create function public.hpa_order_tax_valid(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
 if not public.hpa_order_round_off_valid(p_data) then return false; end if;
 if p_data ? 'roundOff' then
   p_data:=jsonb_set(p_data,'{total}',to_jsonb((p_data->>'total')::bigint-(p_data->>'roundOff')::bigint));
 end if;
 return public.hpa_order_tax_before_round_off_valid(p_data-'roundOff');
exception when others then return false;
end $$;
revoke all on function public.hpa_order_tax_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_order_tax_valid(jsonb) to service_role;
alter table public.hpa_orders drop constraint hpa_order_tax_document;
alter table public.hpa_orders add constraint hpa_order_tax_document check(public.hpa_order_tax_valid(data));
-- Rebind the QR constraint to the new validator after the original function's rename.
alter table public.hpa_table_requests drop constraint hpa_table_request_gst_document;
alter table public.hpa_table_requests add constraint hpa_table_request_gst_document check ((
 case when data ? 'roundOff' or data->'tax' ?| array['version','includedTotal','groups']
   or jsonb_path_exists(data,'$.items[*].gstInclusive') then
   public.hpa_order_tax_valid(data||jsonb_build_object('deliveryFee',0,'discount',0))
 else true end
) is true);


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
  and (data->>'total')::bigint = (data->>'subtotal')::bigint + (data->>'deliveryFee')::bigint - (data->>'discount')::bigint + coalesce((data->'tax'->>'total')::bigint,0) - coalesce((data->'tax'->>'includedTotal')::bigint,0) + coalesce((data->>'roundOff')::bigint,0)
  and (
    (
      data->>'channel' = 'counter' and data->>'fulfillment' in ('dine_in','delivery')
      and data->>'paymentMode' = 'counter_manual'
      and data->>'environment' in ('development','production')
      and (data->>'total')::bigint between 1 and 4999999
      and data->>'paymentMethod' in ('cash','upi') and data->>'paymentStatus' in ('pending','paid')
      and (
        (data->>'fulfillment'='dine_in'
          and data->>'status' in ('confirmed','preparing','ready','served','closed','cancelled')
          and (data->>'deliveryFee')::bigint=0)
        or (data->>'fulfillment'='delivery'
          and data->>'status' in ('confirmed','preparing','ready','out_for_delivery','delivered','cancelled')
          and length(btrim(data->'customer'->>'name')) between 2 and 80
          and data->'customer'->>'phone' ~ '^[6-9][0-9]{9}$'
          and length(btrim(data->'customer'->>'address')) between 8 and 200
          and length(btrim(data->'customer'->>'locality')) between 2 and 100
          and data->'customer'->>'postalCode' ~ '^[0-9]{6}$'
          and length(coalesce(data->'customer'->>'landmark',''))<=120
          and length(coalesce(data->'customer'->>'instructions',''))<=300
          and (data->>'status' not in ('out_for_delivery','delivered') or data->>'paymentStatus'='paid')
          and (data->>'status'<>'delivered' or jsonb_typeof(data->'completedAt')='string'))
      ) and data ? 'tax'
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

create or replace function public.hpa_table_request_document(p_request public.hpa_table_requests)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'id',p_request.id,'number',(case when t.ordering_scope='branch' then 'QR-' else 'TBL-' end)||upper(left(replace(p_request.id::text,'-',''),8)),
   'branchId',p_request.branch_id,'tableLabel',t.table_label,'generation',p_request.generation,
   'status',case when p_request.status='pending' and (p_request.expires_at<=now() or not t.active or t.generation<>p_request.generation) then 'expired' else p_request.status end,
   'version',p_request.version,'createdAt',p_request.created_at,'expiresAt',p_request.expires_at,
   'items',p_request.data->'items','customerName',p_request.data->>'customerName',
   'customerPhone',p_request.data->>'customerPhone','notes',p_request.data->>'notes',
   'subtotal',p_request.data->'subtotal','tax',p_request.data->'tax','total',p_request.data->'total',
   'acceptedOrderNumber',(select o.data->>'number' from public.hpa_orders o where o.id=p_request.accepted_order_id)
 ) || case when p_request.data ? 'roundOff' then jsonb_build_object('roundOff',p_request.data->'roundOff') else '{}'::jsonb end from public.hpa_table_qr t where t.id=p_request.table_id;
$$;
revoke all on function public.hpa_table_request_document(public.hpa_table_requests) from public,anon,authenticated;
grant execute on function public.hpa_table_request_document(public.hpa_table_requests) to service_role;


-- Preserve refund reconciliation fields in the current report projection.
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
      'paymentStatus',data->'paymentStatus','paymentReviewRequired',data->'paymentReviewRequired','refund',data->'refund','refundSyncPending',data->'refundSyncPending',
      'subtotal',data->'subtotal','discount',data->'discount','deliveryFee',data->'deliveryFee','roundOff',data->'roundOff','total',data->'total',
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
