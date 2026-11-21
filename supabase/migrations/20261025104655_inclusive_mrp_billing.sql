-- Explicit GST-inclusive catalogue prices (for example packaged products sold at MRP).
-- Existing order, bill, settlement and invoice documents are never rewritten.
-- All amounts are integer paise. Group discount ties use the same bytewise key order
-- as the TypeScript billing helper, independent of the database locale.
create function public.hpa_gst_inclusive_valid(p_config jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
 return (jsonb_typeof(p_config)='object'
   and p_config ?& array['rateBps','code']
   and (select count(*) from jsonb_object_keys(p_config))=2
   and jsonb_typeof(p_config->'rateBps')='number'
   and (p_config->>'rateBps') ~ '^[0-9]+$'
   and (p_config->>'rateBps')::numeric between 2 and 4000
   and mod((p_config->>'rateBps')::numeric,2)=0
   and jsonb_typeof(p_config->'code')='string'
   and p_config->>'code' ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'
 ) is true;
exception when others then return false;
end $$;
revoke all on function public.hpa_gst_inclusive_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_gst_inclusive_valid(jsonb) to service_role;

-- Snapshot validation is pure: never compare an old receipt with a mutable catalogue.
-- The Edge handler is responsible for copying this classification from trusted products.
create function public.hpa_order_tax_valid(p_data jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
 tax jsonb:=p_data->'tax'; item jsonb; has_inclusive boolean:=false;
 item_subtotal numeric:=0; listed_subtotal numeric; delivery numeric; discount_amount numeric;
 expected_groups jsonb:='[]'::jsonb; group_row record; group_base numeric;
 group_cgst numeric; group_sgst numeric; group_taxable numeric;
 total_cgst numeric:=0; total_sgst numeric:=0; total_taxable numeric:=0; included_tax numeric:=0;
begin
 if jsonb_typeof(p_data->'items') is distinct from 'array' then return false; end if;
 select exists(select 1 from jsonb_array_elements(p_data->'items') line where line ? 'gstInclusive') into has_inclusive;
 if not (p_data ? 'tax') then return not has_inclusive; end if;
 if jsonb_typeof(tax) is distinct from 'object' then return false; end if;
 -- Keep the confirmed UP supplier profile requirements for every tax document.
 if not ((tax->'supplier'->>'stateCode'='09'
   and tax->'supplier'->>'sac'='996331'
   and tax->'supplier'->>'cgstRate'='2.5' and tax->'supplier'->>'sgstRate'='2.5'
   and tax->'supplier'->>'gstin' ~ '^09[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'
   and tax->'supplier'->>'fssaiNumber' ~ '^[0-9]{14}$') is true) then return false; end if;
 if not has_inclusive then
   -- Legacy all-exclusive bills retain their exact original formula and shape.
   -- New version markers cannot disguise an inconsistent inclusive calculation.
   if tax ?| array['version','includedTotal','groups'] then return false; end if;
   return ((tax->>'taxableValue')::bigint = (p_data->>'subtotal')::bigint+(p_data->>'deliveryFee')::bigint-(p_data->>'discount')::bigint
     and (tax->>'cgst')::bigint = floor(((tax->>'taxableValue')::bigint+20)::numeric/40)
     and (tax->>'sgst')::bigint = (tax->>'cgst')::bigint
     and (tax->>'total')::bigint = (tax->>'cgst')::bigint+(tax->>'sgst')::bigint
   ) is true;
 end if;
 if tax->'version' is distinct from '2'::jsonb
   or jsonb_typeof(tax->'groups') is distinct from 'array'
   or jsonb_array_length(tax->'groups') not between 1 and 101
 then return false; end if;
 foreach item in array array[p_data->'subtotal',p_data->'deliveryFee',p_data->'discount',p_data->'total',
   tax->'taxableValue',tax->'cgst',tax->'sgst',tax->'total',tax->'includedTotal'] loop
   if jsonb_typeof(item) is distinct from 'number' or not (item #>> '{}') ~ '^[0-9]+$'
     or (item #>> '{}')::numeric > 100000000 then return false; end if;
 end loop;
 listed_subtotal:=(p_data->>'subtotal')::numeric;
 delivery:=(p_data->>'deliveryFee')::numeric;
 discount_amount:=(p_data->>'discount')::numeric;
 if discount_amount>listed_subtotal or listed_subtotal+delivery-discount_amount>100000000 then return false; end if;
 for item in select value from jsonb_array_elements(p_data->'items') loop
   if jsonb_typeof(item) is distinct from 'object'
     or jsonb_typeof(item->'unitPrice') is distinct from 'number'
     or not (item->>'unitPrice') ~ '^[0-9]+$'
     or (item->>'unitPrice')::numeric > 100000000
     or jsonb_typeof(item->'quantity') is distinct from 'number'
     or not (item->>'quantity') ~ '^[0-9]+$'
     or (item->>'quantity')::numeric not between 1 and 20
   then return false; end if;
   if item ? 'gstInclusive' and not public.hpa_gst_inclusive_valid(item->'gstInclusive') then return false; end if;
   item_subtotal:=item_subtotal+(item->>'unitPrice')::numeric*(item->>'quantity')::numeric;
 end loop;
 if item_subtotal<>listed_subtotal or item_subtotal>100000000 then return false; end if;
 -- Numeric arithmetic prevents overflow in discount * group gross. Largest
 -- remainders allocate every discount paise once, excluding the delivery fee.
 for group_row in
   with lines as (
     select case when line ? 'gstInclusive' then 'inclusive' else 'exclusive' end as pricing,
       case when line ? 'gstInclusive' then (line->'gstInclusive'->>'rateBps')::integer else 500 end as rate_bps,
       case when line ? 'gstInclusive' then line->'gstInclusive'->>'code' else '996331' end as code,
       (line->>'unitPrice')::numeric*(line->>'quantity')::numeric as gross
     from jsonb_array_elements(p_data->'items') line
   ), grouped as (
     select pricing,rate_bps,code,sum(gross) as gross_value from lines group by pricing,rate_bps,code
     union all
     select 'exclusive',500,'996331',0::numeric where delivery>0 and not exists(select 1 from lines where pricing='exclusive')
   ), keyed as (
     select *,pricing||':'||rate_bps::text||':'||code as group_key from grouped
   ), allocation as (
     select *,floor(discount_amount*gross_value/greatest(listed_subtotal,1)) as floor_discount,
       mod(discount_amount*gross_value,greatest(listed_subtotal,1)) as remainder from keyed
   ), ranked as (
     select *,row_number() over(order by remainder desc,group_key collate "C") as remainder_rank,
       sum(floor_discount) over() as allocated from allocation
   )
   select *,floor_discount+case when remainder_rank<=discount_amount-allocated then 1 else 0 end as group_discount
   from ranked order by group_key collate "C"
 loop
   group_base:=group_row.gross_value-group_row.group_discount;
   if group_row.pricing='inclusive' then
     group_cgst:=floor((group_base*group_row.rate_bps+(10000+group_row.rate_bps))/(2*(10000+group_row.rate_bps)));
     group_sgst:=group_cgst;
     group_taxable:=group_base-group_cgst-group_sgst;
     included_tax:=included_tax+group_cgst+group_sgst;
   else
     group_base:=group_base+delivery;
     group_cgst:=floor((group_base*group_row.rate_bps+10000)/20000);
     group_sgst:=group_cgst;
     group_taxable:=group_base;
   end if;
   expected_groups:=expected_groups||jsonb_build_array(jsonb_build_object(
     'pricing',group_row.pricing,'rateBps',group_row.rate_bps,'code',group_row.code,
     'grossValue',group_row.gross_value,'deliveryFee',case when group_row.pricing='exclusive' then delivery else 0 end,
     'discount',group_row.group_discount,'taxableValue',group_taxable,
     'cgst',group_cgst,'sgst',group_sgst,'total',group_cgst+group_sgst));
   total_cgst:=total_cgst+group_cgst; total_sgst:=total_sgst+group_sgst; total_taxable:=total_taxable+group_taxable;
 end loop;
 return (tax->'groups'=expected_groups
   and (tax->>'includedTotal')::numeric=included_tax
   and (tax->>'taxableValue')::numeric=total_taxable
   and (tax->>'cgst')::numeric=total_cgst and (tax->>'sgst')::numeric=total_sgst
   and (tax->>'total')::numeric=total_cgst+total_sgst
   and (p_data->>'total')::numeric=listed_subtotal+delivery-discount_amount+total_cgst+total_sgst-included_tax
 ) is true;
exception when others then return false;
end $$;
revoke all on function public.hpa_order_tax_valid(jsonb) from public,anon,authenticated;
grant execute on function public.hpa_order_tax_valid(jsonb) to service_role;

alter table public.hpa_products add constraint hpa_product_gst_inclusive_document check ((
 not (data ? 'gstInclusive') or (
   public.hpa_gst_inclusive_valid(data->'gstInclusive')
   and coalesce(jsonb_array_length(data->'crusts'),0)=0
   and coalesce(jsonb_array_length(data->'toppings'),0)=0
 )
) is true);

alter table public.hpa_orders drop constraint hpa_order_tax_document;
alter table public.hpa_orders add constraint hpa_order_tax_document check(public.hpa_order_tax_valid(data));

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
  and (data->>'total')::bigint = (data->>'subtotal')::bigint + (data->>'deliveryFee')::bigint - (data->>'discount')::bigint + coalesce((data->'tax'->>'total')::bigint,0) - coalesce((data->'tax'->>'includedTotal')::bigint,0)
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

-- Pending QR previews use the same classification, but legacy request history stays valid.
-- Only documents carrying inclusive snapshots/versioned tax need the new validation.
alter table public.hpa_table_requests add constraint hpa_table_request_gst_document check ((
 case when data->'tax' ?| array['version','includedTotal','groups']
   or jsonb_path_exists(data,'$.items[*].gstInclusive') then
   public.hpa_order_tax_valid(data||jsonb_build_object('deliveryFee',0,'discount',0))
 else true end
) is true);

-- Read-only, owner-only financial reports. Nothing here deletes or archives orders.
-- A bounded projection avoids returning customer, kitchen-note or bank-reference data.
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
    where o.branch_id = p_branch_id and (
      (o.created_at >= p_from and o.created_at < p_to)
      or (
        coalesce(nullif(o.data->>'completedAt',''),nullif(o.data->'counter'->>'servedAt',''))::timestamptz >= p_from
        and coalesce(nullif(o.data->>'completedAt',''),nullif(o.data->'counter'->>'servedAt',''))::timestamptz < p_to
      )
      or (
        nullif(o.data->'settlement'->>'confirmedAt','')::timestamptz >= p_from
        and nullif(o.data->'settlement'->>'confirmedAt','')::timestamptz < p_to
      )
    )
    order by o.created_at,o.id
    limit 10001
  ), projected as (
    select id,created_at,jsonb_strip_nulls(jsonb_build_object(
      'id',id,'version',version,'number',data->'number','createdAt',data->'createdAt',
      'completedAt',data->'completedAt','branchId',p_branch_id,'branchName',data->'branchName',
      'channel',data->'channel','environment',data->'environment','fulfillment',data->'fulfillment',
      'status',data->'status','paymentMethod',data->'paymentMethod','paymentMode',data->'paymentMode',
      'paymentStatus',data->'paymentStatus','paymentReviewRequired',data->'paymentReviewRequired',
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
comment on function public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz) is
  'Read-only branch report copy: one MVCC snapshot, IST day boundaries, 10,000-record/8-MiB fail-closed limit. No order deletion.';

-- Two owner-requested plain-water price choices; no brand/volume was supplied.
-- HSN 2201 is in Schedule I (2.5% central tax) of Notification 9/2025-CT(R),
-- effective 22 September 2025. The selling prices already include both components.
-- Never overwrite an existing product, including an owner's later edits.
do $$
declare added integer;
begin
 insert into public.hpa_products(id,category_id,slug,data)
 select p->>'id',p->>'categoryId',p->>'slug',p from (values
  ($water${"id":"hpa-water-bottle-10","slug":"water-bottle-10","name":"Water Bottle ₹10","description":"Plain packaged drinking water. Price includes applicable GST.","image":"/images/menu/photo-coming-soon.svg","categoryId":"beverages","vegetarian":true,"price":1000,"available":true,"featured":false,"bestseller":false,"sizes":[],"crusts":[],"toppings":[],"gstInclusive":{"rateBps":500,"code":"2201"}}$water$::jsonb),
  ($water${"id":"hpa-water-bottle-20","slug":"water-bottle-20","name":"Water Bottle ₹20","description":"Plain packaged drinking water. Price includes applicable GST.","image":"/images/menu/photo-coming-soon.svg","categoryId":"beverages","vegetarian":true,"price":2000,"available":true,"featured":false,"bestseller":false,"sizes":[],"crusts":[],"toppings":[],"gstInclusive":{"rateBps":500,"code":"2201"}}$water$::jsonb)) as requested(p)
 where exists(select 1 from public.hpa_categories c where c.id=p->>'categoryId')
   and not exists(select 1 from public.hpa_products old where old.id=p->>'id' or old.slug=p->>'slug')
 on conflict do nothing;
 get diagnostics added=row_count;
 if added>0 then update public.hpa_commerce_state set revision=revision+1 where id=true; end if;
end $$;
