-- Execute after the migration inside BEGIN ... ROLLBACK. Fictional receipts only.
-- No gateway/bank contact, permanent Auth user, settings change or retained test order.
do $$
declare
 actor uuid; mode text; profile jsonb; rev bigint; id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid();
 key1 uuid:=gen_random_uuid(); key2 uuid:=gen_random_uuid(); settle_key uuid:=gen_random_uuid();
 document jsonb; result jsonb; before_doc jsonb; after_doc jsonb; original_receipt jsonb; invoice_number text;
begin
 select m.user_id into actor from public.hpa_admin_memberships m join auth.users u on u.id=m.user_id
 where m.role='owner' and lower(u.email)='hotpizzaace@gmail.com' and u.email_confirmed_at is not null and u.is_anonymous is false limit 1;
 if actor is null then raise exception 'nominated_owner_fixture_unavailable'; end if;
 select s.mode,s.revision into mode,rev from public.hpa_commerce_state s where id=true;
 select data->'settings'->'billing' into profile from public.hpa_branches where id='barra';
 if profile is null then raise exception 'billing_profile_missing'; end if;
 update public.hpa_branches set data=jsonb_set(data,'{settings}',data->'settings'||jsonb_build_object(
   'counterAcceptingOrders',true,'temporarilyClosed',false,'acceptingOrders',false,'paymentMethods','[]'::jsonb,
   'deliveryEnabled',true,'servicePostalCodes',jsonb_build_array('208027'),
   'deliveryFee',4900,'freeDeliveryThreshold',25000,'minimumOrder',19900)) where id='barra';
 document:=jsonb_build_object(
   'id',id1,'number','QA-COUNTER-DEL-'||id1::text,'createdAt',now(),'branchId','barra','environment',mode,
   'channel','counter','fulfillment','delivery','paymentMode','counter_manual','paymentMethod','cash','paymentStatus','paid','status','confirmed',
   'customer',jsonb_build_object('name','Fictional delivery QA','phone','9876543210','address','123 Fictional Road','locality','Barra 2','postalCode','208027','landmark','','instructions',''),
   'counter',jsonb_build_object('tableLabel','','payLater',false,'createdBy',actor),
   'items',jsonb_build_array(jsonb_build_object('id','qa-item','productId','qa-only','name','Fictional QA pizza','quantity',2,'unitPrice',10000,'options','[]'::jsonb,'notes','')),
   'subtotal',20000,'deliveryFee',4900,'discount',0,'coupon','','total',26146,
   'tax',jsonb_build_object('supplier',profile,'taxableValue',24900,'cgst',623,'sgst',623,'total',1246));
 begin
   perform public.hpa_create_counter_order(jsonb_set(document,'{customer,postalCode}','"208001"'),actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
   raise exception 'expected_pin_rejection';
 exception when others then if sqlerrm<>'counter_delivery_area_unavailable' then raise; end if; end;
 begin
   perform public.hpa_create_counter_order(jsonb_set(document,'{deliveryFee}','0'),actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
   raise exception 'expected_fee_rejection';
 exception when others then if sqlerrm<>'counter_delivery_fee_changed' then raise; end if; end;
 begin
   perform public.hpa_create_counter_order(jsonb_set(document,'{customer,phone}','""'),actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
   raise exception 'expected_contact_rejection';
 exception when check_violation then null; end;
 update public.hpa_branches set data=jsonb_set(data,'{settings,deliveryEnabled}','false') where id='barra';
 begin
   perform public.hpa_create_counter_order(document,actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
   raise exception 'expected_closed_delivery_rejection';
 exception when others then if sqlerrm<>'counter_delivery_unavailable' then raise; end if; end;
 update public.hpa_branches set data=jsonb_set(jsonb_set(data,'{settings,deliveryEnabled}','true'),'{settings,minimumOrder}','26147') where id='barra';
 begin
   perform public.hpa_create_counter_order(document,actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
   raise exception 'expected_minimum_rejection';
 exception when others then if sqlerrm<>'counter_delivery_minimum' then raise; end if; end;
 update public.hpa_branches set data=jsonb_set(data,'{settings,minimumOrder}','26146') where id='barra';
 result:=public.hpa_create_counter_order(document,actor,key1,repeat('a',64),rev,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
 if result->'order'->>'fulfillment'<>'delivery' or result->'order'->>'total'<>'26146' then raise exception 'delivery_create_failed'; end if;
 invoice_number:=result->'order'->'invoice'->>'number';
 if invoice_number is null then raise exception 'delivery_bill_missing'; end if;
 select to_jsonb(s) into original_receipt from public.hpa_counter_settlements s where s.order_id=id1;
 result:=public.hpa_create_counter_order(document,actor,key1,repeat('a',64),rev-1,jsonb_build_object('method','cash','cashTendered',30000,'confirmedReceived',true));
 if result->>'replayed'<>'true' then raise exception 'delivery_replay_failed'; end if;
 result:=public.hpa_update_counter_status(id1,1,actor,'preparing');
 result:=public.hpa_update_counter_status(id1,(result->>'version')::integer,actor,'ready');
 begin
   perform public.hpa_update_counter_status(id1,(result->>'version')::integer,actor,'served');
   raise exception 'expected_dinein_status_rejection';
 exception when others then if sqlerrm<>'counter_status_invalid' then raise; end if; end;
 result:=public.hpa_update_counter_status(id1,(result->>'version')::integer,actor,'out_for_delivery');
 if result ? 'completedAt' then raise exception 'dispatch_is_not_delivery'; end if;
 result:=public.hpa_update_counter_status(id1,(result->>'version')::integer,actor,'delivered');
 if not result ? 'completedAt' or result->'counter' ? 'servedAt' or result->'invoice'->>'number'<>invoice_number then raise exception 'delivery_completion_failed'; end if;
 if (select to_jsonb(s) from public.hpa_counter_settlements s where s.order_id=id1) is distinct from original_receipt then raise exception 'delivery_receipt_changed'; end if;
 before_doc:=result;
 result:=public.hpa_update_counter_status(id1,(result->>'version')::integer,actor,'delivered');
 if result is distinct from before_doc then raise exception 'delivery_completion_not_idempotent'; end if;

 document:=document||jsonb_build_object('id',id2,'number','QA-COUNTER-DEL-'||id2::text,'paymentStatus','pending',
   'counter',jsonb_build_object('tableLabel','','payLater',true,'payLaterReason','Owner approved preparation before payment','createdBy',actor));
 result:=public.hpa_create_counter_order(document,actor,key2,repeat('b',64),rev,null);
 result:=public.hpa_update_counter_status(id2,1,actor,'preparing');
 result:=public.hpa_update_counter_status(id2,(result->>'version')::integer,actor,'ready');
 begin
   perform public.hpa_update_counter_status(id2,(result->>'version')::integer,actor,'out_for_delivery');
   raise exception 'expected_unpaid_dispatch_rejection';
 exception when others then if sqlerrm<>'counter_payment_required' then raise; end if; end;
 before_doc:=result;
 result:=public.hpa_settle_counter_order(id2,(result->>'version')::integer,actor,settle_key,repeat('c',64),jsonb_build_object('method','upi','upiReference','QADELIVERY123456','confirmedReceived',true));
 after_doc:=result->'order';
 if before_doc-array['version','paymentMethod','paymentStatus','settlement'] is distinct from after_doc-array['version','paymentMethod','paymentStatus','settlement'] then raise exception 'delivery_settlement_changed_snapshot'; end if;
 result:=public.hpa_update_counter_status(id2,(after_doc->>'version')::integer,actor,'out_for_delivery');
 result:=public.hpa_update_counter_status(id2,(result->>'version')::integer,actor,'delivered');
 if result->>'paymentMethod'<>'upi' or result->>'status'<>'delivered' then raise exception 'paid_delivery_finish_failed'; end if;
 if (select count(*) from public.hpa_counter_settlements where order_id in (id1,id2))<>2 then raise exception 'delivery_duplicate_receipt'; end if;
 if has_function_privilege('anon','public.hpa_create_counter_order(jsonb,uuid,uuid,text,bigint,jsonb)','execute')
   or has_function_privilege('authenticated','public.hpa_update_counter_status(uuid,integer,uuid,text)','execute') then raise exception 'public_counter_delivery_rpc'; end if;
end $$;
select 'Counter delivery branch rules, fee/minimum, contact, prepaid dispatch, invoice/receipt snapshots and retries verified; roll back fixtures' as result;
