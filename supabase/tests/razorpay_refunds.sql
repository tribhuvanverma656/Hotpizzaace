-- Run only against development after migration review. All fixtures and invoice allocations roll back.
begin;
do $$
declare oid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid(); second_aid uuid:=gen_random_uuid();
 actor uuid; profile jsonb; document jsonb; result jsonb; captured jsonb; rows jsonb; partial jsonb; remaining jsonb;
 provider_order text:='order_QA'||replace(oid::text,'-',''); payment text:='pay_QA'||replace(oid::text,'-','');
 refund1 text:='rfnd_QA'||replace(oid::text,'-',''); refund2 text:='rfnd_QB'||replace(oid::text,'-','');
 v integer; day_start timestamptz:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
 if (select mode from public.hpa_commerce_state where id=true)<>'development' then raise exception 'development_only_fixture'; end if;
 select user_id into actor from public.hpa_admin_memberships where role='owner' limit 1;
 if actor is null then raise exception 'owner_fixture_unavailable'; end if;
 select data->'settings'->'billing' into profile from public.hpa_branches where id='barra';
 document:=jsonb_build_object('id',oid,'number','QA-REFUND-'||oid::text,'createdAt',now()-interval '3 days','branchId','barra',
  'customer',jsonb_build_object('name','Fictional Refund QA','phone','9000000001','address','12 Test Road','locality','Barra','postalCode','208027'),
  'items',jsonb_build_array(jsonb_build_object('id','qa-refund-line','name','QA pizza','quantity',1,'unitPrice',10000,'options','[]'::jsonb)),
  'fulfillment','pickup','paymentMethod','upi','paymentMode','razorpay_test','paymentStatus','initiated','status','pending',
  'subtotal',10000,'deliveryFee',0,'discount',0,'coupon','','total',10500,
  'tax',jsonb_build_object('supplier',profile,'taxableValue',10000,'cgst',250,'sgst',250,'total',500));
 perform public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),oid::text,repeat('c',64),(select revision from public.hpa_commerce_state where id=true));
 update public.hpa_orders set created_at=now()-interval '3 days' where id=oid;
 perform public.hpa_payment_reserve(oid,aid,'test');
 perform public.hpa_payment_bind(aid,provider_order);
 captured:=public.hpa_payment_apply(aid,provider_order,payment,'captured',10500,'INR',null);
 -- A verified pending refund can pause preparation before any processed amount exists.
 result:=public.hpa_payment_flag_refund_review(aid,provider_order,payment,10500,'INR','test',1000);
 if result->>'refundSyncPending'<>'true' or result->>'paymentReviewRequired'<>'true' or result ? 'refund'
   or exists(select 1 from public.hpa_payment_refunds where attempt_id=aid)
 then raise exception 'refund_evidence_guard_fabricated_money_or_failed_to_hold'; end if;
 v:=(result->>'version')::integer;
 result:=public.hpa_payment_flag_refund_review(aid,provider_order,payment,10500,'INR','test',1000);
 if (result->>'version')::integer<>v then raise exception 'duplicate_evidence_changed_order'; end if;
 begin perform public.hpa_payment_flag_refund_review(aid,provider_order,payment,10500,'INR','test',0);
   raise exception 'expected_evidence_error'; exception when others then if sqlerrm<>'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_flag_refund_review(aid,provider_order,payment,10500,'INR','live',1000);
   raise exception 'expected_evidence_mode_error'; exception when others then if sqlerrm<>'payment_mismatch' then raise; end if; end;
 partial:=jsonb_build_object('id',refund1,'amount',1000,'status','pending','createdAt',now()-interval '1 hour','processedAt',null,'timestampSource',null);
 result:=public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(partial),repeat('1',64));
 if result ? 'refund' or result->>'paymentStatus'<>'paid' or result->>'paymentReviewRequired'<>'true'
   or result->>'refundSyncPending'<>'false' then raise exception 'pending_refund_counted_or_fulfillment_unprotected'; end if;
 partial:=partial||jsonb_build_object('status','failed');
 result:=public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(partial),repeat('2',64));
 if result ? 'refund' then raise exception 'failed_refund_counted'; end if;
 partial:=partial||jsonb_build_object('status','processed','processedAt',now()-interval '20 minutes','timestampSource','provider_event');
 result:=public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(partial),repeat('3',64));
 if result->'refund'->>'amount'<>'1000' or result->'refund'->>'status'<>'partial' then raise exception 'missing_partial_refund'; end if;
 v:=(result->>'version')::integer;
 result:=public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(partial),repeat('3',64));
 if (result->>'version')::integer<>v then raise exception 'duplicate_event_changed_order'; end if;
 remaining:=jsonb_build_object('id',refund2,'amount',9500,'status','processed','createdAt',now()-interval '1 hour','processedAt',now(),'timestampSource','verified_at');
 result:=public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(partial,remaining),repeat('4',64));
 if result->'refund'->>'amount'<>'10500' or result->'refund'->>'status'<>'full' or jsonb_array_length(result->'refund'->'entries')<>2 then raise exception 'missing_full_refund'; end if;
 if result->'invoice' is distinct from captured->'invoice' or result->'tax' is distinct from captured->'tax'
  or result->'total' is distinct from captured->'total' or result->'items' is distinct from captured->'items'
  or result->>'paymentStatus'<>'paid' or result->>'status'<>'pending' then raise exception 'original_capture_invoice_or_fulfillment_changed'; end if;
 if (select state from public.hpa_payment_records where provider_payment_id=payment)<>'captured' then raise exception 'gross_capture_lost'; end if;
 v:=(result->>'version')::integer;
 result:=public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(
   partial||jsonb_build_object('status','pending','processedAt',null,'timestampSource',null),
   remaining||jsonb_build_object('status','failed','processedAt',null,'timestampSource',null)),repeat('5',64));
 if result->'refund'->>'amount'<>'10500' or (result->>'version')::integer<>v then raise exception 'stale_event_downgraded_money'; end if;
 begin perform public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(partial||jsonb_build_object('amount',1001)),null);
  raise exception 'expected_binding_error'; exception when others then if sqlerrm<>'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','test',jsonb_build_array(
  remaining||jsonb_build_object('id','rfnd_QC'||replace(oid::text,'-',''),'amount',1)),null);
  raise exception 'expected_bound_error'; exception when others then if sqlerrm<>'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_sync_refunds(aid,provider_order,payment,10500,'INR','live','[]'::jsonb,null);
  raise exception 'expected_mode_error'; exception when others then if sqlerrm<>'payment_mismatch' then raise; end if; end;
 begin perform public.hpa_payment_reserve(oid,second_aid,'test'); raise exception 'expected_payable_error';
  exception when others then if sqlerrm<>'payment_not_payable' then raise; end if; end;
 begin perform public.hpa_update_order(oid,v,result||jsonb_build_object('status','confirmed'),actor,'status'); raise exception 'expected_fulfillment_error';
  exception when others then if sqlerrm<>'payment_not_complete' then raise; end if; end;
 rows:=public.hpa_sales_report_snapshot(actor,'barra',day_start,day_start+interval '1 day');
 if not exists(select 1 from jsonb_array_elements(rows->'orders') r where r->>'id'=oid::text and r->'refund'->>'amount'='10500')
 then raise exception 'refund_day_omitted_older_invoice'; end if;
 if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('hpa_payment_sync_refunds','hpa_payment_reconciliation_attempts','hpa_payment_flag_refund_review')
  and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'public_refund_rpc'; end if;
 if not (select c.relrowsecurity from pg_class c where c.oid='public.hpa_payment_refunds'::regclass) then raise exception 'missing_refund_rls'; end if;
 if has_table_privilege('anon','public.hpa_payment_refunds','INSERT') or has_table_privilege('authenticated','public.hpa_payment_refunds','UPDATE') then raise exception 'client_refund_write'; end if;
end $$;
select 'Refund binding, partial/full, monotonic replay, preserved invoice/gross, review guard, financial-day projection and client denial passed' as result;
rollback;
