alter table public.hpa_orders drop constraint hpa_order_document;
alter table public.hpa_orders add constraint hpa_order_document check ((
  jsonb_typeof(data) = 'object'
  and data ?& array['id','number','createdAt','branchId','customer','items','fulfillment','paymentMethod','paymentStatus','status','subtotal','deliveryFee','discount','total']
  and data->>'id' = id::text and length(data->>'number') between 1 and 100
  and (data->>'paymentMode' in ('simulation','razorpay_test','razorpay_live') or (data->>'paymentMethod' = 'cash' and not data ? 'paymentMode'))
  and jsonb_typeof(data->'customer') = 'object'
  and jsonb_typeof(data->'items') = 'array' and jsonb_array_length(data->'items') between 1 and 100
  and data->>'fulfillment' in ('delivery','pickup')
  and data->>'paymentMethod' in ('upi','card','cash')
  and data->>'paymentStatus' in ('initiated','pending','simulated_paid','failed','paid')
  and (data->>'paymentStatus' <> 'paid' or (data->>'paymentMode' in ('razorpay_test','razorpay_live') and data->>'paymentMethod' <> 'cash'))
  and (data->>'paymentStatus' <> 'simulated_paid' or data->>'paymentMode' = 'simulation')
  and data->>'status' in ('pending','confirmed','preparing','ready','out_for_delivery','delivered','picked_up','cancelled','rejected')
  and (data->>'subtotal')::bigint >= 0 and (data->>'deliveryFee')::bigint >= 0 and (data->>'discount')::bigint >= 0 and (data->>'total')::bigint >= 0
  and (data->>'total')::bigint = (data->>'subtotal')::bigint + (data->>'deliveryFee')::bigint - (data->>'discount')::bigint + coalesce((data->'tax'->>'total')::bigint,0)
) is true);

alter table public.hpa_orders add constraint hpa_order_tax_document check ((
 not (data ? 'tax') or (
  jsonb_typeof(data->'tax')='object'
  and (data->'tax'->>'taxableValue')::bigint = (data->>'subtotal')::bigint+(data->>'deliveryFee')::bigint-(data->>'discount')::bigint
  and (data->'tax'->>'cgst')::bigint = floor(((data->'tax'->>'taxableValue')::bigint+20)::numeric/40)
  and (data->'tax'->>'sgst')::bigint = (data->'tax'->>'cgst')::bigint
  and (data->'tax'->>'total')::bigint = (data->'tax'->>'cgst')::bigint+(data->'tax'->>'sgst')::bigint
  and data->'tax'->'supplier'->>'stateCode'='09'
  and data->'tax'->'supplier'->>'sac'='996331'
  and data->'tax'->'supplier'->>'cgstRate'='2.5' and data->'tax'->'supplier'->>'sgstRate'='2.5'
  and data->'tax'->'supplier'->>'gstin' ~ '^09[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$'
  and data->'tax'->'supplier'->>'fssaiNumber' ~ '^[0-9]{14}$'
 )
) is true);

-- Only the confirmed UP outlet receives this registration. Additional branches require their own profile.
update public.hpa_branches set data=jsonb_set(data,'{settings,billing}',jsonb_build_object(
 'businessName','HOT PIZZA ACE','address','ME 346, Near Ram Janki Mandir, Barra 2, Kanpur, Uttar Pradesh 208027',
 'gstin','09ANCPV1491R1Z3','fssaiNumber','12721045000614','stateName','Uttar Pradesh','stateCode','09',
 'sac','996331','cgstRate',2.5,'sgstRate',2.5
)) where id='barra';
update public.hpa_commerce_state set revision=revision+1 where id=true;

create table public.hpa_invoice_counters (
 mode text not null check(mode in ('development','production')),
 financial_year integer not null check(financial_year between 2026 and 2200),
 last_value integer not null check(last_value between 1 and 999999),
 primary key(mode,financial_year)
);
alter table public.hpa_invoice_counters enable row level security;
revoke all on public.hpa_invoice_counters from public,anon,authenticated;
grant all on public.hpa_invoice_counters to service_role;
create unique index hpa_invoice_number_idx on public.hpa_orders((data->'invoice'->>'number')) where data ? 'invoice';

create function public.hpa_assign_invoice(p_order_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare o public.hpa_orders; m text; fy integer; n integer; issued timestamptz := now(); inv text;
begin
 select * into o from public.hpa_orders where id=p_order_id for update;
 if not found or o.status <> 'ready' or not (o.data ? 'tax') or o.data ? 'invoice' then return; end if;
 if coalesce((o.data->>'paymentReviewRequired')::boolean,false) then raise exception 'payment_review_required'; end if;
 if o.data->>'paymentMethod'<>'cash' and o.data->>'paymentStatus' not in ('paid','simulated_paid') then raise exception 'payment_not_complete'; end if;
 select mode into m from public.hpa_commerce_state where id=true;
 fy := extract(year from issued at time zone 'Asia/Kolkata')::integer - case when extract(month from issued at time zone 'Asia/Kolkata') < 4 then 1 else 0 end;
 insert into public.hpa_invoice_counters(mode,financial_year,last_value) values(m,fy,1)
 on conflict(mode,financial_year) do update set last_value=hpa_invoice_counters.last_value+1 returning last_value into n;
 inv := case when m='production' then 'HPA/' else 'TST/' end||right(fy::text,2)||'-'||right((fy+1)::text,2)||'/'||lpad(n::text,6,'0');
 update public.hpa_orders set data=data||jsonb_build_object('invoice',jsonb_build_object(
  'number',inv,'issuedAt',issued,'kind',case when m='production' then 'tax_invoice' else 'test_bill' end
 )) where id=o.id;
end $$;
revoke all on function public.hpa_assign_invoice(uuid) from public,anon,authenticated;
grant execute on function public.hpa_assign_invoice(uuid) to service_role;

create or replace function public.hpa_update_order(p_id uuid, p_expected_version integer, p_data jsonb, p_actor_id uuid, p_kind text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
    if v_old->>'paymentMethod' <> 'cash' and not ((v_old->>'paymentStatus' = 'simulated_paid' and coalesce(v_old->>'paymentMode','simulation') = 'simulation') or (v_old->>'paymentStatus' = 'paid' and v_old->>'paymentMode' in ('razorpay_test','razorpay_live') and not coalesce((v_old->>'paymentReviewRequired')::boolean,false)))
       and v_next->>'status' not in ('cancelled','rejected') then raise exception 'payment_not_complete'; end if;
    v_allowed := case v_old->>'status'
      when 'pending' then array['confirmed','rejected','cancelled']
      when 'confirmed' then array['preparing','cancelled']
      when 'preparing' then array['ready','cancelled']
      when 'ready' then case when v_old->>'fulfillment' = 'delivery' then array['out_for_delivery','cancelled'] else array['picked_up','cancelled'] end
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
$$;
