-- Only the trusted Edge service can invoke this operation. Recheck ownership and
-- eligibility under the same row lock used by payment/status updates.
create function public.hpa_cancel_unpaid_order(
  p_id uuid, p_expected_version integer, p_user_id uuid, p_guest_session_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.hpa_orders; v_old jsonb;
begin
  select * into v_order from public.hpa_orders where id = p_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if not coalesce((p_user_id is not null and v_order.user_id = p_user_id) or
    (p_user_id is null and v_order.user_id is null and
     p_guest_session_hash ~ '^[a-f0-9]{64}$' and v_order.guest_session_hash = p_guest_session_hash), false)
    then raise exception 'forbidden'; end if;
  if v_order.version is distinct from p_expected_version then raise exception 'version_conflict'; end if;
  v_old := v_order.data;
  if not coalesce(
    coalesce(v_old->>'channel','website') = 'website' and
    v_old->>'status' = 'pending' and v_old->>'paymentMethod' <> 'cash' and
    v_old->>'paymentStatus' in ('initiated','pending','failed') and
    not coalesce((v_old->>'paymentReviewRequired')::boolean,false) and
    not coalesce((v_old->>'refundSyncPending')::boolean,false) and
    (v_old->'refund' is null or v_old->'refund' = 'null'::jsonb) and
    (v_old->'testVoid' is null or v_old->'testVoid' = 'null'::jsonb), false)
    then raise exception 'order_not_cancellable'; end if;
  update public.hpa_orders set data = jsonb_set(data, '{status}', '"cancelled"'),
    version = version + 1 where id = p_id returning * into v_order;
  insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,
    previous_payment_status,next_payment_status,order_version)
  values(p_id,p_user_id,'customer_cancel',v_old->>'status','cancelled',
    v_old->>'paymentStatus',v_old->>'paymentStatus',v_order.version);
  return v_order.data || jsonb_build_object('version',v_order.version);
end;
$$;
revoke all on function public.hpa_cancel_unpaid_order(uuid,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.hpa_cancel_unpaid_order(uuid,integer,uuid,text) to service_role;
