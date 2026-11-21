create or replace function public.hpa_counter_payment_document(p_payment jsonb,p_total bigint,p_actor_id uuid)
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
   if reference is not null then
     if reference !~ '^[A-Z0-9]{6,80}$' then raise exception 'counter_payment_invalid'; end if;
     result:=result||jsonb_build_object('upiReference',reference);
   end if;
 end if;
 return result;
end $$;
revoke all on function public.hpa_counter_payment_document(jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.hpa_counter_payment_document(jsonb,bigint,uuid) to service_role;

-- Preserve ready orders across midnight: use the ready event, not order creation time.
create or replace function public.hpa_kitchen_ready_today(p_branch_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(x.data || jsonb_build_object('version',x.version,'readyAt',x.ready_at)
    order by x.ready_at desc nulls last,x.created_at desc),'[]'::jsonb)
  from (
    select o.data,o.version,o.created_at,e.ready_at
    from public.hpa_orders o
    left join lateral (
      select max(ev.created_at) as ready_at from public.hpa_order_events ev
      where ev.order_id=o.id and ev.next_status='ready'
    ) e on true
    where o.branch_id=p_branch_id
      and o.status in ('ready','out_for_delivery','delivered','picked_up','served','closed')
      and (o.status='ready' or coalesce(e.ready_at,o.created_at) >=
        (date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'))
      and public.hpa_kitchen_order_eligible(o.data || '{"status":"preparing"}'::jsonb)
    order by e.ready_at desc nulls last,o.created_at desc
    limit 100
  ) x;
$$;
revoke all on function public.hpa_kitchen_ready_today(text) from public,anon,authenticated;
grant execute on function public.hpa_kitchen_ready_today(text) to service_role;

-- Atomic branch QR online checkout; payment verification remains in the existing gateway ledger.
create or replace function public.hpa_create_qr_online_order(
 p_token_hash text,p_generation integer,p_data jsonb,p_user_id uuid,p_guest_session_hash text,
 p_tracking_token_hash text,p_scope text,p_idempotency_key text,p_request_hash text,p_expected_catalog_revision bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.hpa_table_qr; b public.hpa_branches;
begin
 perform 1 from public.hpa_commerce_state where id=true for update;
 select * into t from public.hpa_table_qr where token_hash=p_token_hash and active=true and ordering_scope='branch' for share;
 if not found or t.generation is distinct from p_generation then raise exception 'table_not_found'; end if;
 select * into b from public.hpa_branches where id=t.branch_id;
 if b.data->'settings'->>'counterAcceptingOrders' is distinct from 'true' or b.data->'settings'->>'temporarilyClosed' is distinct from 'false' then raise exception 'counter_unavailable'; end if;
 if p_data->>'channel' is distinct from 'website' or p_data->>'fulfillment' is distinct from 'dine_in'
   or p_data->>'branchId' is distinct from t.branch_id or p_data->'qr'->>'tableId' is distinct from t.id::text
   or p_data->'qr'->>'tableLabel' is distinct from t.table_label
   or p_data->'qr'->>'generation' is distinct from t.generation::text
   or p_data->>'paymentMethod' not in ('upi','card') or p_data->>'paymentStatus' is distinct from 'initiated'
   or p_data->>'status' is distinct from 'pending' or p_data ? 'settlement' or p_data ? 'counter'
   or p_data->'tax'->'supplier' is distinct from b.data->'settings'->'billing'
 then raise exception 'table_request_invalid'; end if;
 return public.hpa_create_order(p_data,p_user_id,p_guest_session_hash,p_tracking_token_hash,
   p_scope,p_idempotency_key,p_request_hash,p_expected_catalog_revision);
end $$;
revoke all on function public.hpa_create_qr_online_order(text,integer,jsonb,uuid,text,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.hpa_create_qr_online_order(text,integer,jsonb,uuid,text,text,text,text,text,bigint) to service_role;

-- Online dine-in orders use the same owner acceptance and payment checks as website orders.
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
      when 'ready' then case when v_old->>'fulfillment' = 'delivery' then array['out_for_delivery','cancelled'] when v_old->>'fulfillment' = 'dine_in' then array['served'] else array['picked_up','cancelled'] end
      when 'served' then array['closed']
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

create or replace function public.hpa_update_order(p_id uuid,p_expected_version integer,p_data jsonb,p_actor_id uuid,p_kind text)
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
 if p_kind='status' and previous.status is distinct from result->>'status' and result->>'status' in ('delivered','picked_up','served','closed') and not previous.data ? 'completedAt' then
   update public.hpa_orders set data=data||jsonb_build_object('completedAt',now()) where id=p_id
   returning data||jsonb_build_object('version',version) into result;
 end if;
 return result;
end $$;
