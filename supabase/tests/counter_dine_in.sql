-- Execute with the new migration inside BEGIN ... ROLLBACK. Fictional receipts only.
-- This file never contacts UPI/Razorpay, does not create an Auth user, and leaves no orders.
do $$
declare
 actor uuid; mode text; profile jsonb; rev bigint; id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid();
 key1 uuid:=gen_random_uuid(); key2 uuid:=gen_random_uuid(); settle_key uuid:=gen_random_uuid();
 document jsonb; result jsonb; current_doc jsonb; invoice_number text; old_version integer;
begin
 select m.user_id into actor from public.hpa_admin_memberships m join auth.users u on u.id=m.user_id
 where m.role='owner' and lower(u.email)='hotpizzaace@gmail.com' and u.email_confirmed_at is not null and u.is_anonymous is false limit 1;
 if actor is null then raise exception 'nominated_owner_fixture_unavailable'; end if;
 perform set_config('hpa.qa_actor',actor::text,true);
 perform set_config('hpa.qa_paid_order',id1::text,true);
 select s.mode,s.revision into mode,rev from public.hpa_commerce_state s where id=true;
 select data->'settings'->'billing' into profile from public.hpa_branches where id='barra';
 if profile is null then raise exception 'billing_profile_missing'; end if;
 update public.hpa_branches set data=jsonb_set(jsonb_set(data,'{settings,counterAcceptingOrders}','true'::jsonb),'{settings,temporarilyClosed}','false'::jsonb) where id='barra';
 document:=jsonb_build_object(
   'id',id1,'number','QA-COUNTER-'||id1::text,'createdAt',now(),'branchId','barra','environment',mode,
   'channel','counter','fulfillment','dine_in','paymentMode','counter_manual','paymentMethod','cash','paymentStatus','paid','status','confirmed',
   'customer',jsonb_build_object('name','Fictional counter QA','phone','','address','','locality','','postalCode','','landmark','','instructions',''),
   'counter',jsonb_build_object('tableLabel','QA-1','payLater',false,'createdBy',actor),
   'items',jsonb_build_array(jsonb_build_object('id','qa-item','productId','qa-only','name','Fictional QA pizza','quantity',1,'unitPrice',11000,'options','[]'::jsonb,'notes','')),
   'subtotal',11000,'deliveryFee',0,'discount',0,'coupon','','total',11550,
   'tax',jsonb_build_object('supplier',profile,'taxableValue',11000,'cgst',275,'sgst',275,'total',550)
 );
 result:=public.hpa_create_counter_order(document,actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
 if result->>'replayed'<>'false' or result->'order'->>'paymentStatus'<>'paid' or result->'order'->>'status'<>'confirmed' then raise exception 'counter_create_failed'; end if;
 if (result->'order'->'settlement'->>'amount')::integer<>11550 or (result->'order'->'settlement'->>'change')::integer<>450
   or result->'order'->'settlement'->>'source'<>'staff' or result->'order'->'settlement'->>'confirmedBy'<>actor::text then raise exception 'counter_payment_not_server_authored'; end if;
 invoice_number:=result->'order'->'invoice'->>'number';
 if invoice_number is null or length(invoice_number)>16 then raise exception 'counter_bill_missing'; end if;
 if exists(select 1 from public.hpa_orders where id=id1 and (user_id is not null or guest_session_hash is not null)) then raise exception 'counter_customer_ownership_leak'; end if;
 if (select count(*) from public.hpa_counter_settlements where order_id=id1)<>1 then raise exception 'counter_audit_missing'; end if;
 result:=public.hpa_create_counter_order(document,actor,key1,repeat('a',64),rev-1,jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
 if result->>'replayed'<>'true' or result->'order'->'invoice'->>'number'<>invoice_number then raise exception 'counter_create_not_idempotent'; end if;
 begin
   perform public.hpa_create_counter_order(document,actor,key1,repeat('b',64),rev,null);
   raise exception 'expected_idempotency_conflict';
 exception when others then if sqlerrm<>'idempotency_conflict' then raise; end if; end;
 begin
   perform public.hpa_create_counter_order(document,gen_random_uuid(),gen_random_uuid(),repeat('c',64),rev,null);
   raise exception 'expected_owner_denial';
 exception when others then if sqlerrm<>'counter_owner_required' then raise; end if; end;
 begin
   perform public.hpa_counter_payment_document(jsonb_build_object('method','cash','cashTendered',10000,'confirmedReceived',true),11550,actor);
   raise exception 'expected_cash_shortfall';
 exception when others then if sqlerrm<>'counter_cash_insufficient' then raise; end if; end;
 begin
   perform public.hpa_counter_payment_document(jsonb_build_object('method','upi','confirmedReceived',true),11550,actor);
   raise exception 'expected_upi_reference_required';
 exception when others then if sqlerrm<>'counter_payment_invalid' then raise; end if; end;
 begin
   perform public.hpa_update_counter_status(id1,1,actor,'cancelled');
   raise exception 'expected_refund_guard';
 exception when others then if sqlerrm<>'counter_paid_cancellation_requires_refund' then raise; end if; end;
 begin
   perform public.hpa_update_order(id1,1,document,actor,'status');
   raise exception 'expected_website_guard';
 exception when others then if sqlerrm<>'counter_operation_required' then raise; end if; end;

 document:=document||jsonb_build_object('id',id2,'number','QA-COUNTER-'||id2::text,'paymentStatus','pending',
   'counter',jsonb_build_object('tableLabel','QA-2','payLater',true,'payLaterReason','Customer requested payment after the meal','createdBy',actor));
 result:=public.hpa_create_counter_order(document,actor,key2,repeat('d',64),rev,null);
 if result->'order'->>'paymentStatus'<>'pending' or result->'order' ? 'settlement' or not result->'order' ? 'invoice' then raise exception 'pay_later_creation_failed'; end if;
 result:=public.hpa_update_counter_status(id2,(result->'order'->>'version')::integer,actor,'preparing');
 result:=public.hpa_update_counter_status(id2,(result->>'version')::integer,actor,'ready');
 result:=public.hpa_update_counter_status(id2,(result->>'version')::integer,actor,'served');
 if not result ? 'completedAt' or not result->'counter' ? 'servedAt' then raise exception 'counter_completion_clock_missing'; end if;
 begin
   perform public.hpa_update_counter_status(id2,(result->>'version')::integer,actor,'closed');
   raise exception 'expected_unpaid_close_denial';
 exception when others then if sqlerrm<>'counter_payment_required' then raise; end if; end;
 old_version:=(result->>'version')::integer;
 result:=public.hpa_settle_counter_order(id2,old_version,actor,settle_key,repeat('e',64),jsonb_build_object('method','upi','upiReference','QA123456789012','confirmedReceived',true));
 current_doc:=result->'order';
 if current_doc->>'paymentMethod'<>'upi' or current_doc->>'paymentStatus'<>'paid' or current_doc->'settlement'->>'upiReference'<>'QA123456789012' then raise exception 'counter_collection_failed'; end if;
 result:=public.hpa_update_counter_status(id2,(current_doc->>'version')::integer,actor,'closed');
 if not result->'counter' ? 'closedAt' then raise exception 'counter_close_clock_missing'; end if;
 result:=public.hpa_settle_counter_order(id2,old_version,actor,settle_key,repeat('e',64),jsonb_build_object('method','upi','upiReference','QA123456789012','confirmedReceived',true));
 if result->>'replayed'<>'true' or result->'order'->>'status'<>'closed' then raise exception 'settlement_retry_failed_after_close'; end if;
 begin
   perform public.hpa_settle_counter_order(id2,(result->'order'->>'version')::integer,actor,gen_random_uuid(),repeat('f',64),jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
   raise exception 'expected_closed_collection_denial';
 exception when others then if sqlerrm<>'counter_order_not_payable' then raise; end if; end;
 begin
   perform public.hpa_counter_payment_document(jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',false),11550,actor);
   raise exception 'expected_receipt_confirmation';
 exception when others then if sqlerrm<>'counter_payment_invalid' then raise; end if; end;
 if (select count(*) from public.hpa_counter_settlements where order_id in (id1,id2))<>2 then raise exception 'duplicate_counter_settlement'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('hpa_create_counter_order','hpa_settle_counter_order','hpa_update_counter_status','hpa_counter_payment_document','hpa_record_counter_settlement','hpa_require_counter_owner') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'public_counter_rpc'; end if;
 if has_table_privilege('anon','public.hpa_counter_settlements','SELECT') or has_table_privilege('authenticated','public.hpa_counter_settlements','INSERT') then raise exception 'public_counter_ledger'; end if;
end $$;

-- Run the actual transaction APIs with the same service role used by the Edge handler.
-- Auth tables are deliberately not readable by this role; only fixture IDs are carried over.
set local role service_role;
do $$
declare actor uuid:=current_setting('hpa.qa_actor')::uuid; document jsonb; paid jsonb; result jsonb;
 id3 uuid:=gen_random_uuid(); id4 uuid:=gen_random_uuid(); website_id uuid:=gen_random_uuid(); rev bigint;
begin
 select data-array['invoice','settlement','completedAt'] into document from public.hpa_orders where id=current_setting('hpa.qa_paid_order')::uuid;
 select revision into rev from public.hpa_commerce_state where id=true;
 document:=document||jsonb_build_object('id',id3,'number','QA-COUNTER-'||id3::text,'paymentStatus','paid');
 paid:=public.hpa_create_counter_order(document,actor,gen_random_uuid(),repeat('8',64),rev,jsonb_build_object('method','upi','upiReference','QA234567890123','confirmedReceived',true));
 if paid->'order'->'settlement'->>'method'<>'upi' then raise exception 'service_role_upi_create_failed'; end if;
 document:=document||jsonb_build_object('id',id4,'number','QA-COUNTER-'||id4::text);
 begin
   perform public.hpa_create_counter_order(document,actor,gen_random_uuid(),repeat('9',64),rev,jsonb_build_object('method','upi','upiReference','qa234567890123','confirmedReceived',true));
   raise exception 'expected_duplicate_upi_denial';
 exception when unique_violation then null; end;
 if exists(select 1 from public.hpa_orders where id=id4) then raise exception 'duplicate_upi_created_order'; end if;
 begin
   perform public.hpa_update_counter_status(id3,999,actor,'preparing');
   raise exception 'expected_stale_version_denial';
 exception when others then if sqlerrm<>'version_conflict' then raise; end if; end;
 begin
   perform public.hpa_create_counter_order(document||jsonb_build_object('branchId','qa-missing-branch'),actor,gen_random_uuid(),repeat('0',64),rev,null);
   raise exception 'expected_branch_denial';
 exception when others then if sqlerrm<>'counter_unavailable' then raise; end if; end;
 -- The audit is immutable even to the role permitted to append it.
 begin
   update public.hpa_counter_settlements set amount=1 where order_id=id3;
   raise exception 'expected_audit_update_denial';
 exception when insufficient_privilege then null; end;

 -- A website order keeps the established transaction and receives a server-authored
 -- handover clock, regardless of any clock supplied in a status request.
 document:=(document-array['counter','settlement','environment','completedAt'])||jsonb_build_object(
   'id',website_id,'number','QA-WEB-'||website_id::text,'channel','website','fulfillment','pickup',
   'paymentMode','simulation','paymentMethod','cash','paymentStatus','pending','status','pending');
 result:=public.hpa_create_order(document,actor,null,repeat('4',64),'user:'||actor::text,website_id::text,repeat('5',64),rev);
 result:=result->'order';
 result:=public.hpa_update_order(website_id,(result->>'version')::integer,result||jsonb_build_object('status','confirmed','completedAt','2000-01-01T00:00:00Z'),actor,'status');
 if result ? 'completedAt' then raise exception 'early_website_completion_clock'; end if;
 result:=public.hpa_update_order(website_id,(result->>'version')::integer,result||jsonb_build_object('status','preparing'),actor,'status');
 result:=public.hpa_update_order(website_id,(result->>'version')::integer,result||jsonb_build_object('status','ready'),actor,'status');
 result:=public.hpa_update_order(website_id,(result->>'version')::integer,result||jsonb_build_object('status','picked_up','completedAt','2000-01-01T00:00:00Z'),actor,'status');
 if not result ? 'completedAt' or (result->>'completedAt')::timestamptz<now()-interval '1 minute' then raise exception 'website_clock_not_server_authored'; end if;
 document:=result;
 result:=public.hpa_update_order(website_id,(result->>'version')::integer,result||jsonb_build_object('status','picked_up','completedAt','2000-01-01T00:00:00Z'),actor,'status');
 if result->>'completedAt'<>document->>'completedAt' then raise exception 'website_clock_mutated'; end if;
end $$;
reset role;

set local role authenticated;
do $$
begin
 begin
   perform public.hpa_update_counter_status(gen_random_uuid(),1,gen_random_uuid(),'preparing');
   raise exception 'expected_browser_rpc_denial';
 exception when insufficient_privilege then null; end;
 begin
   perform 1 from public.hpa_counter_settlements;
   raise exception 'expected_browser_ledger_denial';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Counter create/replay, service-role privileges, private ownership, cash/change, UPI duplicate protection, pay-later preparation, collection/closure, website clocks, immutable audit and browser-denial checks passed' as result;
