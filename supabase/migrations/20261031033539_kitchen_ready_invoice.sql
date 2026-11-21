-- Preserve the established invoice lifecycle when a chef completes preparation.
create or replace function public.hpa_kitchen_transition(p_user_id uuid,p_session_id uuid,p_order_id uuid,p_expected_version integer,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare profile jsonb; o public.hpa_orders; previous_status text;
begin
  -- Lock order: config -> staff -> kitchen session -> order (same staff order as management).
  perform public.hpa_kitchen_require_enabled();
  perform 1 from public.hpa_kitchen_staff where id=p_user_id for update;
  profile:=public.hpa_kitchen_session(p_user_id,p_session_id);
  select * into o from public.hpa_orders where id=p_order_id and branch_id=profile->>'branchId' for update;
  if not found then raise exception 'kitchen_order_not_found'; end if;
  if o.version is distinct from p_expected_version then raise exception 'kitchen_version_conflict'; end if;
  if not public.hpa_kitchen_order_eligible(o.data) then raise exception 'kitchen_order_not_eligible'; end if;
  if not ((o.status='confirmed' and p_status='preparing') or (o.status='preparing' and p_status='ready'))
    then raise exception 'kitchen_transition_invalid'; end if;
  previous_status:=o.status;
  update public.hpa_orders set data=jsonb_set(data,'{status}',to_jsonb(p_status)),version=version+1 where id=o.id returning * into o;
  -- Match owner readiness: issue a numbered website bill in this same transaction.
  -- The existing helper preserves already-issued counter/website invoice snapshots.
  if o.status='ready' then
    perform public.hpa_assign_invoice(o.id);
    select * into o from public.hpa_orders where id=p_order_id;
  end if;
  insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
    values(o.id,p_user_id,'kitchen_status',previous_status,o.status,o.data->>'paymentStatus',o.data->>'paymentStatus',o.version);
  insert into public.hpa_kitchen_audit(actor_id,staff_id,action,order_id,previous_record,next_record)
    values(p_user_id,p_user_id,'preparation_transition',o.id,
      jsonb_build_object('status',previous_status),
      jsonb_build_object('status',o.status,'orderVersion',o.version,'branchId',o.branch_id,'username',profile->>'username','displayName',profile->>'displayName'));
  return jsonb_build_object('profile',profile,'order',o.data||jsonb_build_object('version',o.version));
end $$;

revoke all on function public.hpa_kitchen_transition(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.hpa_kitchen_transition(uuid,uuid,uuid,integer,text) to service_role;
