-- Read-only, owner-only financial reports. Nothing here deletes or archives orders.
-- A bounded projection avoids returning customer, kitchen-note or bank-reference data.
create function public.hpa_sales_report_snapshot(
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
      'tax',case when data ? 'tax' then jsonb_build_object('cgst',data->'tax'->'cgst','sgst',data->'tax'->'sgst','total',data->'tax'->'total') end,
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
