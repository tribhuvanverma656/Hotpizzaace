-- Run within BEGIN/ROLLBACK after the voided-software-test migration. No permanent fixtures.
do $$
declare
 actor uuid; mode text; profile jsonb; rev bigint; id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid();
 key1 uuid:=gen_random_uuid(); key2 uuid:=gen_random_uuid(); settle_key uuid:=gen_random_uuid();
 document jsonb; result jsonb; current_doc jsonb; invoice_number text; old_version integer; original_receipt jsonb; original_order jsonb; marker jsonb; snapshot jsonb;
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

 select data into original_order from public.hpa_orders where id=id1;
 select to_jsonb(s) into original_receipt from public.hpa_counter_settlements s where s.order_id=id1;
 -- A test cannot be removed by quietly changing its frozen bill or claiming a refund.
 marker:=jsonb_build_object('kind','no_money_software_test','recordedAt',now(),
   'reason','Fictional no-money test; user requested removal.');
 begin
   update public.hpa_orders set data=data||jsonb_build_object('status','cancelled','total',1,'testVoid',marker),version=version+1 where id=id1;
   raise exception 'expected_snapshot_protection';
 exception when others then if sqlerrm<>'test_void_snapshot_changed' then raise; end if; end;
 update public.hpa_orders set data=data||jsonb_build_object('status','cancelled','testVoid',marker),version=version+1 where id=id1;
 select data into current_doc from public.hpa_orders where id=id1;
 if current_doc-array['status','testVoid'] is distinct from original_order-array['status','testVoid'] then raise exception 'void_changed_bill'; end if;
 if (select to_jsonb(s) from public.hpa_counter_settlements s where s.order_id=id1) is distinct from original_receipt then raise exception 'void_changed_receipt'; end if;
 if (select count(*) from public.hpa_order_events where order_id=id1 and kind='removed_software_test_no_money')<>1 then raise exception 'void_event_missing'; end if;
 if exists(select 1 from public.hpa_orders where id=id1 and not(data ? 'testVoid')) then raise exception 'void_visible_in_operational_filter'; end if;
 snapshot:=public.hpa_sales_report_snapshot(actor,'barra',date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata',
   (date_trunc('day',now() at time zone 'Asia/Kolkata')+interval '1 day') at time zone 'Asia/Kolkata');
 if exists(select 1 from jsonb_array_elements(snapshot->'orders') o where o->>'id'=id1::text) then raise exception 'void_counted_as_sales'; end if;
 begin
   update public.hpa_orders set data=data-'testVoid',version=version+1 where id=id1;
   raise exception 'expected_void_immutable';
 exception when others then if sqlerrm<>'test_void_immutable' then raise; end if; end;
 begin
   perform public.hpa_update_counter_status(id1,2,actor,'preparing');
   raise exception 'expected_void_transition_denied';
 exception when others then if sqlerrm not in ('counter_status_invalid','counter_invalid_transition','invalid_status_transition','test_void_immutable') then raise; end if; end;
 if has_function_privilege('anon','public.hpa_guard_test_void()','execute') or has_function_privilege('authenticated','public.hpa_guard_test_void()','execute') then raise exception 'public_void_function'; end if;
end $$;
select 'No-money test removal preserves receipt/invoice, hides report/operational rows, records audit, and rejects later mutation; rolled back' as result;
