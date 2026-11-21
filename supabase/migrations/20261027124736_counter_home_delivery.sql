-- Staff-entered Home delivery reuses branch delivery rules and manual counter receipts.
-- Website ordering, gateway availability, guest QR scope, and frozen historical bills are unchanged.
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


create or replace function public.hpa_create_counter_order(p_data jsonb,p_actor_id uuid,p_idempotency_key uuid,p_request_hash text,p_expected_catalog_revision bigint,p_payment jsonb)
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
 if p_data->>'channel' is distinct from 'counter' or not coalesce(p_data->>'fulfillment' in ('dine_in','delivery'),false)
   or p_data->>'paymentMode' is distinct from 'counter_manual' or p_data->>'status' is distinct from 'confirmed'
   or p_data->>'environment' is distinct from (select mode from public.hpa_commerce_state where id=true)
   or p_data->'counter'->>'createdBy' is distinct from p_actor_id::text
   or p_data->'tax'->'supplier' is distinct from b.data->'settings'->'billing'
   or not p_data ? 'tax' or p_data ?| array['invoice','completedAt']
   or p_data->'counter' ?| array['servedAt','closedAt'] then raise exception 'counter_order_invalid'; end if;
 if p_data->>'fulfillment'='delivery' then
   if b.data->'settings'->>'deliveryEnabled' is distinct from 'true' then raise exception 'counter_delivery_unavailable'; end if;
   if not coalesce((b.data->'settings'->'servicePostalCodes') ? (p_data->'customer'->>'postalCode'),false)
     then raise exception 'counter_delivery_area_unavailable'; end if;
   if (p_data->>'deliveryFee')::bigint is distinct from (case
     when (b.data->'settings'->>'freeDeliveryThreshold')::bigint is not null
       and (p_data->>'subtotal')::bigint >= (b.data->'settings'->>'freeDeliveryThreshold')::bigint then 0
     else (b.data->'settings'->>'deliveryFee')::bigint end)
     then raise exception 'counter_delivery_fee_changed'; end if;
   if (p_data->>'total')::bigint < (b.data->'settings'->>'minimumOrder')::bigint
     then raise exception 'counter_delivery_minimum'; end if;
 end if;
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


create or replace function public.hpa_update_counter_status(p_id uuid,p_expected_version integer,p_actor_id uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.hpa_orders; previous_status text; allowed text[]; next_data jsonb;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 select * into o from public.hpa_orders where id=p_id for update;
 if not found or o.data->>'channel' is distinct from 'counter' then raise exception 'counter_order_not_found'; end if;
 if o.data ? 'testVoid' then raise exception 'counter_order_removed'; end if;
 if o.version is distinct from p_expected_version then raise exception 'version_conflict'; end if;
 if p_status=o.status then return o.data||jsonb_build_object('version',o.version); end if;
 allowed:=case o.status
   when 'confirmed' then array['preparing','cancelled']
   when 'preparing' then array['ready','cancelled']
   when 'ready' then case when o.data->>'fulfillment'='delivery' then array['out_for_delivery','cancelled'] else array['served','cancelled'] end
   when 'out_for_delivery' then case when o.data->>'fulfillment'='delivery' then array['delivered'] else array[]::text[] end
   when 'served' then case when o.data->>'fulfillment'='dine_in' then array['closed'] else array[]::text[] end else array[]::text[] end;
 if p_status is null or not p_status=any(allowed) then raise exception 'counter_status_invalid'; end if;
 if p_status in ('closed','out_for_delivery','delivered') and o.data->>'paymentStatus'<>'paid' then raise exception 'counter_payment_required'; end if;
 if p_status='cancelled' and o.data->>'paymentStatus'='paid' then raise exception 'counter_paid_cancellation_requires_refund'; end if;
 if o.data->>'paymentStatus'<>'paid' and (o.data->'counter'->>'payLater' is distinct from 'true'
   or length(btrim(coalesce(o.data->'counter'->>'payLaterReason',''))) < 3) then raise exception 'counter_pay_later_reason_required'; end if;
 next_data:=jsonb_set(o.data,'{status}',to_jsonb(p_status));
 if p_status='served' then
   next_data:=jsonb_set(next_data,'{counter,servedAt}',to_jsonb(now()))||jsonb_build_object('completedAt',now());
 end if;
 if p_status='delivered' then next_data:=next_data||jsonb_build_object('completedAt',now()); end if;
 if p_status='closed' then next_data:=jsonb_set(next_data,'{counter,closedAt}',to_jsonb(now())); end if;
 previous_status:=o.status;
 update public.hpa_orders set data=next_data,version=version+1 where id=p_id returning * into o;
 insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
 values(o.id,p_actor_id,'counter_status',previous_status,o.status,o.data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 return o.data||jsonb_build_object('version',o.version);
end $$;
revoke all on function public.hpa_update_counter_status(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.hpa_update_counter_status(uuid,integer,uuid,text) to service_role;

