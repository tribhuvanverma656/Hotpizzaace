-- New bills round the final payable amount to the nearest whole rupee: 50 paise
-- rounds up. The explicit policy marker distinguishes them from historical floor
-- rounding and historical exact-paise bills. No order, invoice, GST, settlement,
-- refund, request or sequence is rewritten by this migration.
create or replace function public.hpa_order_round_off_valid(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
 adjustment numeric; unrounded numeric; expected_total numeric;
 subtotal numeric; delivery numeric; discount_amount numeric; amount jsonb;
 mrp_only boolean:=false;
begin
 if not (p_data ? 'roundOff') then return not (p_data ? 'roundOffPolicy'); end if;
 if p_data ? 'roundOffPolicy' and p_data->'roundOffPolicy' is distinct from '"nearest_rupee"'::jsonb then
   return false;
 end if;
 if jsonb_typeof(p_data->'roundOff') is distinct from 'number'
   or not (p_data->>'roundOff') ~ '^-?[0-9]+$' then return false; end if;
 foreach amount in array array[p_data->'subtotal',p_data->'deliveryFee',p_data->'discount',p_data->'total'] loop
   if jsonb_typeof(amount) is distinct from 'number' or not (amount #>> '{}') ~ '^[0-9]+$' then return false; end if;
 end loop;
 if p_data ? 'tax' then
   if jsonb_typeof(p_data->'tax') is distinct from 'object' then return false; end if;
   foreach amount in array array[p_data->'tax'->'taxableValue',p_data->'tax'->'cgst',p_data->'tax'->'sgst',p_data->'tax'->'total'] loop
     if jsonb_typeof(amount) is distinct from 'number' or not (amount #>> '{}') ~ '^[0-9]+$' then return false; end if;
   end loop;
   if p_data->'tax' ? 'includedTotal' and (jsonb_typeof(p_data->'tax'->'includedTotal') is distinct from 'number'
     or not (p_data->'tax'->>'includedTotal') ~ '^[0-9]+$') then return false; end if;
 end if;
 adjustment:=(p_data->>'roundOff')::numeric;
 subtotal:=(p_data->>'subtotal')::numeric;
 delivery:=(p_data->>'deliveryFee')::numeric;
 discount_amount:=(p_data->>'discount')::numeric;
 if discount_amount>subtotal then return false; end if;
 unrounded:=subtotal+delivery-discount_amount
   +coalesce((p_data->'tax'->>'total')::numeric,0)-coalesce((p_data->'tax'->>'includedTotal')::numeric,0);
 if unrounded<0 then return false; end if;
 if p_data ? 'roundOffPolicy' then
   expected_total:=floor((unrounded+50)/100)*100;
   -- Never round an MRP-only, no-delivery basket above its printed-price sum.
   -- Classification comes from every saved item, never a caller-supplied flag.
   -- The enclosing tax validator also recomputes every inclusive tax group.
   if delivery=0 and jsonb_typeof(p_data->'items')='array' and jsonb_array_length(p_data->'items')>0 then
     select not exists (
       select 1 from jsonb_array_elements(p_data->'items') item
       where jsonb_typeof(item) is distinct from 'object' or not (item ? 'gstInclusive')
         or not public.hpa_gst_inclusive_valid(item->'gstInclusive')
     ) into mrp_only;
   end if;
   if mrp_only and expected_total>subtotal then expected_total:=floor(subtotal/100)*100; end if;
 else
   -- A missing marker means the previously issued customer-favour floor policy.
   expected_total:=unrounded-mod(unrounded,100);
 end if;
 return (adjustment=expected_total-unrounded and (p_data->>'total')::numeric=expected_total and expected_total>0) is true;
exception when others then return false;
end $$;
revoke all on function public.hpa_order_round_off_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_order_round_off_valid(jsonb) to service_role;

-- Validate the exact signed adjustment, then give the original complete GST
-- validator its original unrounded total. Rounding never changes CGST or SGST.
create or replace function public.hpa_order_tax_valid(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
 if not public.hpa_order_round_off_valid(p_data) then return false; end if;
 if p_data ? 'roundOff' then
   p_data:=jsonb_set(p_data,'{total}',to_jsonb((p_data->>'total')::bigint-(p_data->>'roundOff')::bigint));
 end if;
 return public.hpa_order_tax_before_round_off_valid(p_data-'roundOff'-'roundOffPolicy');
exception when others then return false;
end $$;
revoke all on function public.hpa_order_tax_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_order_tax_valid(jsonb) to service_role;

-- Marker-only requests must not bypass validation. Existing request history is
-- still accepted by the legacy branches of the same validator.
alter table public.hpa_table_requests drop constraint hpa_table_request_gst_document;
alter table public.hpa_table_requests add constraint hpa_table_request_gst_document check ((
 case when data ?| array['roundOff','roundOffPolicy'] or data->'tax' ?| array['version','includedTotal','groups']
   or jsonb_path_exists(data,'$.items[*].gstInclusive') then
   public.hpa_order_tax_valid(data||jsonb_build_object('deliveryFee',0,'discount',0))
 else true end
) is true);

-- Public request and private owner-report projections preserve the billing policy
-- used at issue time; historical records continue to omit the marker.
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
 ) || case when p_request.data ? 'roundOff' then jsonb_build_object('roundOff',p_request.data->'roundOff') else '{}'::jsonb end
   || case when p_request.data ? 'roundOffPolicy' then jsonb_build_object('roundOffPolicy',p_request.data->'roundOffPolicy') else '{}'::jsonb end from public.hpa_table_qr t where t.id=p_request.table_id;
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
      'subtotal',data->'subtotal','discount',data->'discount','deliveryFee',data->'deliveryFee','roundOff',data->'roundOff','roundOffPolicy',data->'roundOffPolicy','total',data->'total',
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
