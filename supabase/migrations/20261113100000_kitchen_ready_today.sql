-- Kitchen "Ready today": the chef queue also returns this branch's orders that passed the
-- kitchen today (India time), newest first, so staff can see what was handed over and
-- what it contained. Additive: the active `orders` list and `complete` flag are unchanged,
-- so the existing hpa-kitchen deployment keeps working until it is updated.

create or replace function public.hpa_kitchen_ready_today(p_branch_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(x.data || jsonb_build_object('version', x.version, 'readyAt', x.ready_at)
    order by x.ready_at desc nulls last, x.created_at desc), '[]'::jsonb)
  from (
    select o.data, o.version, o.created_at,
      (select max(e.created_at) from public.hpa_order_events e
        where e.order_id = o.id and e.next_status = 'ready') as ready_at
    from public.hpa_orders o
    where o.branch_id = p_branch_id
      and o.status in ('ready','out_for_delivery','delivered','picked_up','served','closed')
      and o.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      -- Same payment and review gates as the active queue, judged as if still preparing.
      and public.hpa_kitchen_order_eligible(o.data || '{"status":"preparing"}'::jsonb)
    order by o.created_at desc
    limit 100
  ) x;
$$;

create or replace function public.hpa_kitchen_queue(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare profile jsonb; orders jsonb; total integer;
begin
  profile:=public.hpa_kitchen_session(p_user_id,p_session_id);
  select coalesce(jsonb_agg(x.data||jsonb_build_object('version',x.version) order by x.created_at,x.id),'[]'::jsonb),count(*)
    into orders,total from (select o.* from public.hpa_orders o where branch_id=profile->>'branchId'
      and status in ('confirmed','preparing') and public.hpa_kitchen_order_eligible(data)
      order by created_at,id limit 501) x;
  return jsonb_build_object('profile',profile,'orders',orders,'complete',total<=500,
    'ready',public.hpa_kitchen_ready_today(profile->>'branchId'));
end $$;

revoke all on function public.hpa_kitchen_ready_today(text) from public,anon,authenticated;
grant execute on function public.hpa_kitchen_ready_today(text) to service_role;
revoke all on function public.hpa_kitchen_queue(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hpa_kitchen_queue(uuid,uuid) to service_role;
