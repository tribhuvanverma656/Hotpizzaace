-- Run inside a transaction and ROLLBACK. Fictional receipts only; no provider API or real payment.
do $$
declare id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid(); a1 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid();
 actor uuid; document jsonb; result jsonb; before_version integer; current_order public.hpa_orders; profile jsonb; counter_before bigint;
begin
 select user_id into actor from public.hpa_admin_memberships where role='owner' limit 1;
 select data->'settings'->'billing' into profile from public.hpa_branches where id='barra';
 if profile->>'gstin'<>'09ANCPV1491R1Z3' then raise exception 'missing_profile'; end if;
 document:=jsonb_build_object('id',id1,'number','QA-'||id1::text,'createdAt',now(),'branchId','barra',
 'customer',jsonb_build_object('name','Fictional GST QA','phone','9000000001','address','12 Test Road','locality','Barra','postalCode','208027'),
 'items',jsonb_build_array(jsonb_build_object('id','qa-line','name','QA pizza','quantity',1,'unitPrice',10000,'options','[]'::jsonb)),
 'fulfillment','delivery','paymentMethod','upi','paymentMode','razorpay_test','paymentStatus','initiated','status','pending',
 'subtotal',10000,'deliveryFee',4900,'discount',0,'coupon','','total',15646,
 'tax',jsonb_build_object('supplier',profile,'taxableValue',14900,'cgst',373,'sgst',373,'total',746));
 perform public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),id1::text,repeat('c',64),(select revision from public.hpa_commerce_state where id=true));
 result:=public.hpa_payment_reserve(id1,a1,'test');
 if result->>'create'<>'true' or (result->'attempt'->>'amount')::integer<>15646 then raise exception 'bad_reservation'; end if;
 result:=public.hpa_payment_reserve(id1,a1,'test');
 if result->>'create'<>'false' then raise exception 'duplicate_create'; end if;
 begin perform public.hpa_payment_reserve(id1,a2,'test'); raise exception 'expected_conflict_not_raised'; exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
 perform public.hpa_payment_bind(a1,'order_QA'||replace(id1::text,'-',''));
 begin perform public.hpa_payment_apply(a1,'order_QA'||replace(id1::text,'-',''),'pay_QA'||replace(id1::text,'-',''),'captured',100,'INR',null); raise exception 'expected_mismatch_not_raised'; exception when others then if sqlerrm <> 'payment_mismatch' then raise; end if; end;
 result:=public.hpa_payment_apply(a1,'order_QA'||replace(id1::text,'-',''),'pay_QA'||replace(id1::text,'-',''),'authorized',15646,'INR',null);
 if result->>'paymentStatus'='paid' then raise exception 'authorization_is_not_capture'; end if;
 result:=public.hpa_payment_apply(a1,'order_QA'||replace(id1::text,'-',''),'pay_QA'||replace(id1::text,'-',''),'captured',15646,'INR',repeat('d',64));
 if result->>'paymentStatus'<>'paid' then raise exception 'missing_capture'; end if;
 before_version:=(result->>'version')::integer;
 result:=public.hpa_payment_apply(a1,'order_QA'||replace(id1::text,'-',''),'pay_QA'||replace(id1::text,'-',''),'failed',15646,'INR',repeat('e',64));
 if result->>'paymentStatus'<>'paid' or (result->>'version')::integer<>before_version then raise exception 'capture_downgraded'; end if;
 result:=public.hpa_payment_apply(a1,'order_QA'||replace(id1::text,'-',''),'pay_QA'||replace(id1::text,'-',''),'captured',15646,'INR',repeat('d',64));
 if (result->>'version')::integer<>before_version then raise exception 'replay_mutated_order'; end if;
 if actor is null then raise exception 'owner_fixture_unavailable'; end if;
 result:=public.hpa_update_order(id1,(result->>'version')::integer,result||jsonb_build_object('status','confirmed'),actor,'status');
 result:=public.hpa_update_order(id1,(result->>'version')::integer,result||jsonb_build_object('status','preparing'),actor,'status');
 result:=public.hpa_update_order(id1,(result->>'version')::integer,result||jsonb_build_object('status','ready'),actor,'status');
 if result->'invoice'->>'kind'<>'test_bill' or length(result->'invoice'->>'number')>16 then raise exception 'invoice_not_created'; end if;
 if (result->'tax'->>'cgst')::integer<>373 or result->'tax'->'supplier'->>'fssaiNumber'<>'12721045000614' then raise exception 'tax_snapshot_changed'; end if;
 document:=document||jsonb_build_object('id',id2,'number','QA-'||id2::text);
 perform public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),id2::text,repeat('c',64),(select revision from public.hpa_commerce_state where id=true));
 perform public.hpa_payment_reserve(id2,a2,'test');perform public.hpa_payment_bind(a2,'order_QA'||replace(id2::text,'-',''));
 select * into current_order from public.hpa_orders where id=id2;
 perform public.hpa_update_order(id2,current_order.version,current_order.data||jsonb_build_object('status','cancelled'),actor,'status');
 result:=public.hpa_payment_apply(a2,'order_QA'||replace(id2::text,'-',''),'pay_QA'||replace(id2::text,'-',''),'captured',15646,'INR',repeat('f',64));
 if result->>'status'<>'cancelled' or result->>'paymentReviewRequired'<>'true' then raise exception 'late_capture_revived_order'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hpa_payment_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'public_payment_rpc'; end if;
 if exists(select 1 from pg_class where relname in ('hpa_payment_attempts','hpa_payment_records','hpa_payment_webhook_events','hpa_invoice_counters') and not relrowsecurity) then raise exception 'missing_rls'; end if;
end $$;
select 'Payment binding, GST snapshot, capture/replay, late cancellation, invoice numbering and client-denial checks passed' as result;
