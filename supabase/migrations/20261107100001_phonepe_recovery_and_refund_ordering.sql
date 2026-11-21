-- Forward fix for the already-deployed PhonePe integration. Terminal Order Status
-- can recover a lost create response without issuing another /pay request. A
-- verified refund holds fulfilment even when its capture callback arrives later.

alter table public.hpa_payment_attempts drop constraint hpa_payment_attempts_provider_ids;
alter table public.hpa_payment_attempts add constraint hpa_payment_attempts_provider_ids check ((
  case provider
    when 'razorpay' then (provider_order_id is null or provider_order_id ~ '^order_[A-Za-z0-9]{6,100}$')
      and (captured_payment_id is null or captured_payment_id ~ '^pay_[A-Za-z0-9]{6,100}$')
      and checkout_url is null and provider_expires_at is null
    when 'phonepe' then (provider_order_id is null or provider_order_id ~ '^[A-Za-z0-9_-]{6,100}$')
      and (captured_payment_id is null or captured_payment_id ~ '^[A-Za-z0-9_-]{6,100}$')
      and receipt ~ '^[A-Za-z0-9_-]{1,40}$'
      and (checkout_url is null or (length(checkout_url) <= 2048 and checkout_url ~ '^https://[A-Za-z0-9.-]+\.phonepe\.com/'))
      and (checkout_url is null or provider_order_id is not null)
      and (state <> 'ready' or (provider_order_id is not null and checkout_url is not null and provider_expires_at is not null))
      and (provider_order_id is null or checkout_url is not null or state in ('unknown','failed','captured'))
  end) is true);

-- Called only after an authenticated GET for the stored receipt returns a terminal
-- state with the exact reserved amount. Binding and applying are one transaction.
-- A pending/absent upstream order never releases the reservation for another create.
create function public.hpa_payment_recover_phonepe(
 p_attempt_id uuid,p_receipt text,p_provider_order_id text,p_amount bigint,
 p_status text,p_payment_id text,p_event_hash text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; target uuid; expected_mode text;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode
   from public.hpa_commerce_state where id=true;
 if a.provider<>'phonepe' or a.mode is distinct from expected_mode
   or a.receipt is distinct from p_receipt or a.amount is distinct from p_amount
   or o.data->>'paymentMode' is distinct from ('phonepe_'||a.mode)
   or (o.data->>'total')::bigint is distinct from p_amount
   or p_provider_order_id is null or p_provider_order_id !~ '^[A-Za-z0-9_-]{6,100}$'
   or p_status is null or p_status not in ('captured','failed')
   or (p_status='captured' and (p_payment_id is null or not public.hpa_payment_id_valid('phonepe',p_payment_id)))
   or (p_payment_id is not null and not public.hpa_payment_id_valid('phonepe',p_payment_id))
 then raise exception 'payment_mismatch'; end if;
 if a.provider_order_id is not null and a.provider_order_id is distinct from p_provider_order_id then
   raise exception 'payment_mismatch';
 end if;
 if a.provider_order_id is null then
   if a.state not in ('creating','unknown') then raise exception 'payment_conflict'; end if;
   update public.hpa_payment_attempts set provider_order_id=p_provider_order_id,state='unknown',updated_at=now()
     where id=a.id;
 end if;
 if p_status='failed' and p_payment_id is null then
   return public.hpa_payment_mark_failed(a.id,p_provider_order_id,p_amount,p_event_hash);
 end if;
 return public.hpa_payment_apply(a.id,p_provider_order_id,p_payment_id,p_status,p_amount,'INR',p_event_hash);
end $$;

create or replace function public.hpa_payment_reconciliation_attempts(p_order_id uuid, p_mode text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare o public.hpa_orders; expected_mode text; v_provider text;
begin
 select * into o from public.hpa_orders where id=p_order_id;
 if not found then raise exception 'payment_not_found'; end if;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 v_provider:=public.hpa_payment_order_provider(o.data);
 if v_provider is null or p_mode is distinct from expected_mode or o.data->>'paymentMode' is distinct from (v_provider||'_'||p_mode)
   or o.data->>'channel'='counter' or o.data ? 'testVoid' then raise exception 'payment_mismatch'; end if;
 if (select count(*) from public.hpa_payment_attempts where order_id=o.id)>100 then raise exception 'payment_conflict'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb)
   from public.hpa_payment_attempts a where a.order_id=o.id
     and (a.provider_order_id is not null or (a.provider='phonepe' and a.state in ('creating','unknown'))));
end $$;

create or replace function public.hpa_payment_flag_refund_review(
 p_attempt_id uuid,p_provider_order_id text,p_payment_id text,p_amount bigint,p_currency text,p_mode text,p_evidence_amount bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.hpa_payment_attempts; o public.hpa_orders; target uuid; expected_mode text; next_data jsonb;
begin
 select order_id into target from public.hpa_payment_attempts where id=p_attempt_id;
 if not found then raise exception 'payment_not_found'; end if;
 select * into o from public.hpa_orders where id=target for update;
 select * into a from public.hpa_payment_attempts where id=p_attempt_id for update;
 select case mode when 'development' then 'test' when 'production' then 'live' end into expected_mode from public.hpa_commerce_state where id=true;
 if p_mode is distinct from expected_mode or a.mode is distinct from p_mode
   or o.data->>'paymentMode' is distinct from (a.provider||'_'||p_mode) or o.data->>'channel'='counter'
   or o.data ? 'testVoid' or a.provider_order_id is distinct from p_provider_order_id
   or a.amount is distinct from p_amount or p_currency is distinct from 'INR'
   -- PhonePe refund status is bound to the stored merchantOrderId and exact
   -- order amount by the server. Its callback may precede our local capture.
   or (p_payment_id is null and a.provider<>'phonepe')
   or (p_payment_id is not null and not public.hpa_payment_id_valid(a.provider,p_payment_id))
   or p_evidence_amount is null or p_evidence_amount<1 or p_evidence_amount>p_amount
 then raise exception 'payment_mismatch'; end if;
 if exists(select 1 from public.hpa_payment_records r where r.provider_payment_id=p_payment_id
   and (r.attempt_id<>a.id or r.amount<>p_amount or r.currency<>p_currency)) then raise exception 'payment_mismatch'; end if;
 next_data:=o.data||jsonb_build_object('paymentReviewRequired',true,'refundSyncPending',true);
 if next_data is distinct from o.data then
   update public.hpa_orders set data=next_data,version=version+1 where id=o.id returning * into o;
   insert into public.hpa_order_events(order_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
   values(o.id,a.provider||'_refund_review',o.status,o.status,o.data->>'paymentStatus',o.data->>'paymentStatus',o.version);
 end if;
 return o.data||jsonb_build_object('version',o.version);
end $$;

revoke all on function public.hpa_payment_recover_phonepe(uuid,text,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.hpa_payment_recover_phonepe(uuid,text,text,bigint,text,text,text) to service_role;
-- CREATE OR REPLACE preserves the existing server-only grants on the other two functions.
