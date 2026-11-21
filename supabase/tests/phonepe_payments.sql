-- Run inside a transaction and ROLLBACK. Fictional PhonePe identifiers only; no provider API or real payment.
begin;
do $$
declare id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid(); id3 uuid:=gen_random_uuid();
 a1 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); a3 uuid:=gen_random_uuid(); a4 uuid:=gen_random_uuid(); a5 uuid:=gen_random_uuid();
 actor uuid; document jsonb; result jsonb; attempt jsonb; before_version integer; profile jsonb; url text:='https://mercury-uat.phonepe.com/transact/uat_v2?token=qa';
begin
 select user_id into actor from public.hpa_admin_memberships where role='owner' limit 1;
 if actor is null then raise exception 'owner_fixture_unavailable'; end if;
 select data->'settings'->'billing' into profile from public.hpa_branches where id='barra';
 document:=jsonb_build_object('id',id1,'number','QA-'||id1::text,'createdAt',now(),'branchId','barra',
 'customer',jsonb_build_object('name','Fictional PhonePe QA','phone','9000000001','address','12 Test Road','locality','Barra','postalCode','208027'),
 'items',jsonb_build_array(jsonb_build_object('id','qa-line','name','QA pizza','quantity',1,'unitPrice',10000,'options','[]'::jsonb)),
 'fulfillment','delivery','paymentMethod','upi','paymentMode','phonepe_test','paymentStatus','initiated','status','pending',
 'subtotal',10000,'deliveryFee',4900,'discount',0,'coupon','','total',15646,
 'tax',jsonb_build_object('supplier',profile,'taxableValue',14900,'cgst',373,'sgst',373,'total',746));
 perform public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),id1::text,repeat('c',64),(select revision from public.hpa_commerce_state where id=true));

 -- Reservation records the provider and a PhonePe-safe merchantOrderId (letters, digits, _ only).
 result:=public.hpa_payment_reserve(id1,a1,'test');
 attempt:=result->'attempt';
 if result->>'create'<>'true' or attempt->>'provider'<>'phonepe' or (attempt->>'amount')::integer<>15646 then raise exception 'bad_reservation'; end if;
 if attempt->>'receipt' !~ '^hpa_[a-f0-9]{32}$' then raise exception 'unsafe_merchant_order_id'; end if;
 if public.hpa_payment_reserve(id1,a1,'test')->>'create'<>'false' then raise exception 'duplicate_create'; end if;
 begin perform public.hpa_payment_reserve(id1,a2,'test'); raise exception 'expected_conflict_not_raised'; exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
 begin perform public.hpa_payment_reserve(id1,a2,'live'); raise exception 'expected_mode_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;

 -- The Razorpay binder and pattern cannot bind a PhonePe attempt, and expiry must be near.
 begin perform public.hpa_payment_bind_checkout(a1,'OMO1234567890',url,now()+interval '1 day'); raise exception 'expected_expiry_rejected'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_bind_checkout(a1,'OMO1234567890','https://evil.example.com/pay',now()+interval '20 minutes'); raise exception 'expected_url_rejected'; exception when others then if sqlerrm not like '%hpa_payment_attempts_provider_ids%' then raise; end if; end;
 attempt:=public.hpa_payment_bind_checkout(a1,'OMO1234567890',url,now()+interval '20 minutes');
 if attempt->>'state'<>'ready' or attempt->>'checkout_url'<>url then raise exception 'bind_failed'; end if;
 if public.hpa_payment_bind_checkout(a1,'OMO1234567890',url,now()+interval '20 minutes')->>'state'<>'ready' then raise exception 'rebind_not_idempotent'; end if;
 begin perform public.hpa_payment_bind_checkout(a1,'OMO9999999999',url,now()+interval '20 minutes'); raise exception 'expected_rebind_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;

 -- Amount mismatch, Razorpay-style replay and capture.
 begin perform public.hpa_payment_apply(a1,'OMO1234567890','OM1234567890','captured',100,'INR',null); raise exception 'expected_amount_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_apply(a1,'OMO1234567890','pay bad id','captured',15646,'INR',null); raise exception 'expected_id_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 result:=public.hpa_payment_apply(a1,'OMO1234567890','OM1234567890','captured',15646,'INR',md5(a1::text)||md5(id1::text));
 if result->>'paymentStatus'<>'paid' then raise exception 'missing_capture'; end if;
 before_version:=(result->>'version')::integer;
 result:=public.hpa_payment_apply(a1,'OMO1234567890','OM1234567890','captured',15646,'INR',md5(a1::text)||md5(id1::text));
 if (result->>'version')::integer<>before_version then raise exception 'replay_mutated_order'; end if;
 result:=public.hpa_payment_mark_failed(a1,'OMO1234567890',15646,null);
 if result->>'paymentStatus'<>'paid' then raise exception 'capture_downgraded'; end if;
 if not public.hpa_kitchen_order_eligible(result||jsonb_build_object('status','confirmed')) then raise exception 'paid_phonepe_not_kitchen_eligible'; end if;
 result:=public.hpa_update_order(id1,(result->>'version')::integer,result||jsonb_build_object('status','confirmed'),actor,'status');
 if result->>'status'<>'confirmed' then raise exception 'owner_cannot_confirm_paid_order'; end if;
 if not exists(select 1 from public.hpa_order_events where order_id=id1 and kind='phonepe_captured') then raise exception 'missing_event'; end if;

 -- A verified failure allows exactly one fresh PhonePe attempt; an unresolved one never does.
 document:=document||jsonb_build_object('id',id2,'number','QA-'||id2::text);
 perform public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),id2::text,repeat('e',64),(select revision from public.hpa_commerce_state where id=true));
 perform public.hpa_payment_reserve(id2,a3,'test');
 perform public.hpa_payment_bind_checkout(a3,'OMO2234567890',url,now()+interval '20 minutes');
 begin perform public.hpa_payment_reserve(id2,a4,'test'); raise exception 'retry_before_failure'; exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
 result:=public.hpa_payment_mark_failed(a3,'OMO2234567890',15646,md5(a3::text)||md5(id2::text));
 if result->>'paymentStatus'<>'failed' then raise exception 'failure_not_recorded'; end if;
 if public.hpa_payment_reserve(id2,a4,'test')->>'create'<>'true' then raise exception 'retry_after_failure_blocked'; end if;
 begin perform public.hpa_payment_reserve(id2,a5,'test'); raise exception 'second_unresolved_retry'; exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
 if public.hpa_kitchen_order_eligible(result||jsonb_build_object('status','confirmed')) then raise exception 'failed_payment_reached_kitchen'; end if;

 -- Lost create responses recover only terminal status for the stored receipt/amount.
 perform public.hpa_payment_mark_unknown(a4);
 if not exists(select 1 from jsonb_array_elements(public.hpa_payment_reconciliation_attempts(id2,'test')) a where a->>'id'=a4::text and a->>'provider_order_id' is null) then raise exception 'unknown_attempt_hidden_from_reconciliation'; end if;
 begin perform public.hpa_payment_recover_phonepe(a4,'wrong_receipt','OMO3234567890',15646,'failed',null,null); raise exception 'expected_receipt_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_recover_phonepe(a4,'hpa_'||replace(a4::text,'-',''),'OMO3234567890',100,'failed',null,null); raise exception 'expected_recovery_amount_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_recover_phonepe(a4,'hpa_'||replace(a4::text,'-',''),'OMO3234567890',15646,'pending',null,null); raise exception 'expected_pending_recovery_rejected'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_reserve(id2,a5,'test'); raise exception 'unknown_released_before_terminal_status'; exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
 result:=public.hpa_payment_recover_phonepe(a4,'hpa_'||replace(a4::text,'-',''),'OMO3234567890',15646,'failed',null,null);
 if result->>'paymentStatus'<>'failed' then raise exception 'unknown_failure_not_recovered'; end if;
 if not exists(select 1 from public.hpa_payment_attempts where id=a4 and provider_order_id='OMO3234567890' and checkout_url is null and state='failed') then raise exception 'unsafe_recovered_checkout'; end if;
 if public.hpa_payment_reserve(id2,a5,'test')->>'create'<>'true' then raise exception 'recovered_failure_not_retryable'; end if;

 -- A refund can precede local capture/binding. Persist its hold before acknowledging,
 -- preserve the hold through later capture, and never put this order in the kitchen.
 result:=public.hpa_payment_flag_refund_review(a5,null,null,15646,'INR','test',5000);
 if result->>'paymentReviewRequired'<>'true' or result->>'refundSyncPending'<>'true' then raise exception 'early_refund_hold_missing'; end if;
 result:=public.hpa_payment_recover_phonepe(a5,'hpa_'||replace(a5::text,'-',''),'OMO4234567890',15646,'captured','OM4234567890',null);
 if result->>'paymentStatus'<>'paid' or result->>'paymentReviewRequired'<>'true' or result->>'refundSyncPending'<>'true' then raise exception 'capture_lost_refund_hold'; end if;
 if public.hpa_kitchen_order_eligible(result||jsonb_build_object('status','confirmed')) then raise exception 'early_refund_reached_kitchen'; end if;
 before_version:=(result->>'version')::integer;
 result:=public.hpa_payment_recover_phonepe(a5,'hpa_'||replace(a5::text,'-',''),'OMO4234567890',15646,'captured','OM4234567890',null);
 if (result->>'version')::integer<>before_version then raise exception 'recovery_replay_mutated_order'; end if;
 begin perform public.hpa_payment_recover_phonepe(a5,'hpa_'||replace(a5::text,'-',''),'OMO9999999999',15646,'captured','OM4234567890',null); raise exception 'expected_recovery_rebind_mismatch'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;

 -- A verified PhonePe refund pauses fulfilment for owner review instead of posting money.
 result:=public.hpa_payment_flag_refund_review(a1,'OMO1234567890','OM1234567890',15646,'INR','test',15646);
 if result->>'paymentReviewRequired'<>'true' or result->>'refundSyncPending'<>'true' then raise exception 'refund_review_missing'; end if;
 if public.hpa_kitchen_order_eligible(result) then raise exception 'refunded_order_in_kitchen'; end if;

 -- Razorpay history keeps its exact identifier rules.
 document:=document||jsonb_build_object('id',id3,'number','QA-'||id3::text,'paymentMode','razorpay_test');
 perform public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),id3::text,repeat('9',64),(select revision from public.hpa_commerce_state where id=true));
 result:=public.hpa_payment_reserve(id3,gen_random_uuid(),'test');
 if result->'attempt'->>'provider'<>'razorpay' or result->'attempt'->>'receipt' !~ '^hpa_[a-f0-9-]{36}$' then raise exception 'razorpay_reservation_changed'; end if;
 begin perform public.hpa_payment_bind((result->'attempt'->>'id')::uuid,'OMO1234567899'); raise exception 'razorpay_accepted_phonepe_id'; exception when others then if sqlerrm not like '%hpa_payment_attempts_provider_ids%' then raise; end if; end;
 begin perform public.hpa_payment_bind_checkout((result->'attempt'->>'id')::uuid,'order_QA1234567',url,now()+interval '20 minutes'); raise exception 'phonepe_binder_on_razorpay'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_flag_refund_review((result->'attempt'->>'id')::uuid,null,null,15646,'INR','test',5000); raise exception 'razorpay_accepted_missing_payment_id'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;

 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hpa_payment_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'public_payment_rpc'; end if;
end $$;
select 'PhonePe reservation, binding, capture/replay, verified-failure retry, unknown recovery, early refund review and Razorpay compatibility checks passed' as result;
rollback;
