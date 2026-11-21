-- Run after the counter, QR and branch-QR migrations inside BEGIN ... ROLLBACK. Fictional requests only.
do $$
declare actor uuid; profile jsonb; mode text; rev bigint; t jsonb; raw_token text; token_hash text; initial_generation integer; legacy_label text;
 request_id uuid:=gen_random_uuid(); request2 uuid:=gen_random_uuid(); request3 uuid:=gen_random_uuid(); request4 uuid:=gen_random_uuid();
 accept_key uuid:=gen_random_uuid(); quote jsonb; order_data jsonb; result jsonb; duplicate jsonb; count_before bigint;
begin
 select m.user_id into actor from public.hpa_admin_memberships m join auth.users u on u.id=m.user_id
 where m.role='owner' and lower(u.email)='hotpizzaace@gmail.com' and u.email_confirmed_at is not null and u.is_anonymous is false limit 1;
 if actor is null then raise exception 'nominated_owner_fixture_unavailable'; end if;
 perform set_config('hpa.qr_actor',actor::text,true);
 select s.mode,s.revision into mode,rev from public.hpa_commerce_state s where id=true;
 select data->'settings'->'billing' into profile from public.hpa_branches where id='barra';
 update public.hpa_branches set data=jsonb_set(jsonb_set(data,'{settings,counterAcceptingOrders}','true'::jsonb),'{settings,temporarilyClosed}','false'::jsonb) where id='barra';
 -- Keep a legacy default label. The canonical QR safely chooses a different
 -- internal label without dropping its unique index or changing historical rows.
 legacy_label:='Branch ordering QR';
 if exists(select 1 from public.hpa_table_qr where branch_id='barra' and ordering_scope='branch' and table_label=legacy_label) then
   legacy_label:='QA retained legacy '||left(request_id::text,8);
 end if;
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.hpa_table_qr(branch_id,table_label,ordering_scope,active,token,token_hash,created_by)
 values('barra',legacy_label,'legacy_table',false,raw_token,encode(extensions.digest(raw_token,'sha256'),'hex'),actor)
 on conflict do nothing;
 t:=public.hpa_manage_table_qr(actor,'create','barra');
 if t->>'active'='false' then
   t:=public.hpa_manage_table_qr(actor,'rotate',null,null,(t->>'id')::uuid,(t->>'version')::integer);
 end if;
 initial_generation:=(t->>'generation')::integer;
 raw_token:=t->>'token'; token_hash:=encode(extensions.digest(raw_token,'sha256'),'hex');
 perform set_config('hpa.qr_table',(t->>'id'),true);
 perform set_config('hpa.qr_hash',token_hash,true);
 if length(raw_token)<>64 or t->>'branchId'<>'barra' then raise exception 'qr_create_failed'; end if;
 if not exists(select 1 from public.hpa_table_qr where branch_id='barra' and ordering_scope='legacy_table' and table_label=legacy_label and not active)
 then raise exception 'legacy_label_not_preserved'; end if;
 quote:=jsonb_build_object('branchId','barra','tableLabel',t->>'tableLabel','customerName','Fictional QR guest','customerPhone','9876543210','notes','QA no real food',
   'selections',jsonb_build_array(jsonb_build_object('id','qr-line','productId','qa-only','quantity',1,'toppingIds','[]'::jsonb,'notes','QA item')),
   'items',jsonb_build_array(jsonb_build_object('id','qr-line','productId','qa-only','name','Fictional QA pizza','quantity',1,'unitPrice',11000,'options','[]'::jsonb,'notes','QA item')),
   'subtotal',11000,'total',11550,'tax',jsonb_build_object('supplier',profile,'taxableValue',11000,'cgst',275,'sgst',275,'total',550));

 -- Neither stale callers nor concurrent creates can generate another QR. The
 -- branch row lock serializes RPC creators; unique indexes also guard direct writes.
 duplicate:=public.hpa_manage_table_qr(actor,'create','barra');
 if duplicate->>'id'<>t->>'id' or duplicate->>'token'<>raw_token then raise exception 'duplicate_branch_qr'; end if;
 begin
   insert into public.hpa_table_qr(branch_id,table_label,ordering_scope,token,token_hash,created_by)
   values('barra','QA second QR '||left(request_id::text,8),'branch',repeat('d',64),encode(extensions.digest(repeat('d',64),'sha256'),'hex'),actor);
   raise exception 'expected_singleton_index_denial';
 exception when unique_violation then null; end;
 begin
   perform public.hpa_manage_table_qr(actor,'create','barra','Table 2');
   raise exception 'expected_table_label_denial';
 exception when others then if sqlerrm<>'table_invalid' then raise; end if; end;
 begin
   perform public.hpa_create_table_request(token_hash,repeat('a',64),gen_random_uuid(),repeat('1',64),rev,gen_random_uuid(),quote-'customerPhone');
   raise exception 'expected_missing_phone_denial';
 exception when others then if sqlerrm<>'branch_qr_contact_required' then raise; end if; end;
 begin
   perform public.hpa_create_table_request(token_hash,repeat('a',64),gen_random_uuid(),repeat('2',64),rev,gen_random_uuid(),jsonb_set(quote,'{customerPhone}','"1234567890"'::jsonb));
   raise exception 'expected_invalid_phone_denial';
 exception when others then if sqlerrm<>'branch_qr_contact_required' then raise; end if; end;
 begin
   perform public.hpa_create_table_request(token_hash,repeat('a',64),gen_random_uuid(),repeat('3',64),rev,gen_random_uuid(),quote-'customerName');
   raise exception 'expected_missing_name_denial';
 exception when others then if sqlerrm<>'branch_qr_contact_required' then raise; end if; end;
 select count(*) into count_before from public.hpa_orders;
 result:=public.hpa_create_table_request(token_hash,repeat('a',64),request_id,repeat('b',64),rev,request_id,quote);
 if result->>'replayed'<>'false' or result->'request'->>'status'<>'pending'
   or result->'request'->>'customerPhone'<>'9876543210' or result->'request'->>'number' not like 'QR-%' then raise exception 'request_create_failed'; end if;
 if (select count(*) from public.hpa_orders)<>count_before then raise exception 'customer_request_created_kitchen_order'; end if;
 if result->'request' ?| array['guest_session_hash','token','selections','acceptance_key'] then raise exception 'private_request_fields_leaked'; end if;
 if public.hpa_get_table_request(request_id,(t->>'id')::uuid,initial_generation,repeat('c',64)) is not null then raise exception 'cross_guest_request_read'; end if;
 result:=public.hpa_create_table_request(token_hash,repeat('a',64),request_id,repeat('b',64),rev-1,gen_random_uuid(),quote);
 if result->>'replayed'<>'true' or result->'request'->>'id'<>request_id::text then raise exception 'request_retry_failed'; end if;
 begin
   perform public.hpa_create_table_request(token_hash,repeat('a',64),request_id,repeat('c',64),rev,gen_random_uuid(),quote);
   raise exception 'expected_request_payload_conflict';
 exception when others then if sqlerrm<>'idempotency_conflict' then raise; end if; end;

 result:=public.hpa_list_table_requests(actor,'barra');
 if not exists(select 1 from jsonb_array_elements(result->'requests') q
   where q->>'id'=request_id::text and q->>'customerName'='Fictional QR guest'
     and q->>'customerPhone'='9876543210' and q->>'status'='pending') then
   raise exception 'pending_qr_not_visible_to_counter';
 end if;

 order_data:=jsonb_build_object('id',gen_random_uuid(),'number','QA-TABLE-'||request_id::text,'createdAt',now(),'branchId','barra','environment',mode,
   'channel','counter','fulfillment','dine_in','paymentMode','counter_manual','paymentMethod','cash','paymentStatus','paid','status','confirmed',
   'counter',jsonb_build_object('tableLabel','','payLater',false,'createdBy',actor,'entry','table_qr','sourceRequestId',request_id),
   'customer',jsonb_build_object('name','Fictional QR guest','phone','9876543210','address','','locality','','postalCode','','landmark','','instructions','QA no real food'),
   'items',quote->'items','subtotal',11000,'deliveryFee',0,'discount',0,'coupon','','total',11550,'tax',quote->'tax');
 begin
   perform public.hpa_decide_table_request(request_id,1,actor,'accept',jsonb_set(order_data,'{branchId}','"wrong-branch"'::jsonb),accept_key,repeat('d',64),rev,jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
   raise exception 'expected_request_branch_mismatch';
 exception when others then if sqlerrm<>'table_request_mismatch' then raise; end if; end;
 begin
   perform public.hpa_decide_table_request(request_id,1,actor,'accept',jsonb_set(order_data,'{items,0,quantity}','2'::jsonb),accept_key,repeat('d',64),rev,jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
   raise exception 'expected_request_item_mismatch';
 exception when others then if sqlerrm<>'table_request_mismatch' then raise; end if; end;

 begin
   perform public.hpa_decide_table_request(request_id,1,actor,'accept',jsonb_set(order_data,'{customer,phone}','"9999999999"'::jsonb),accept_key,repeat('d',64),rev,jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
   raise exception 'expected_request_contact_mismatch';
 exception when others then if sqlerrm<>'table_request_mismatch' then raise; end if; end;
 result:=public.hpa_decide_table_request(request_id,1,actor,'accept',order_data,accept_key,repeat('d',64),rev,jsonb_build_object('method','cash','cashTendered',12000,'confirmedReceived',true));
 if result->'order'->>'status'<>'confirmed' or result->'order'->>'paymentStatus'<>'paid' or not result->'order' ? 'invoice'
   or result->'order'->'counter'->>'entry'<>'table_qr' then raise exception 'staff_accept_did_not_create_counter_bill'; end if;
 duplicate:=public.hpa_decide_table_request(request_id,1,actor,'accept',null,accept_key,repeat('d',64),rev,null);
 if duplicate->>'replayed'<>'true' or duplicate->'order'->>'id'<>result->'order'->>'id' then raise exception 'request_accept_not_idempotent'; end if;
 if (select count(*) from public.hpa_orders)<>count_before+1 then raise exception 'request_accept_created_duplicate_orders'; end if;
 begin
   perform public.hpa_decide_table_request(request_id,1,actor,'accept',order_data,gen_random_uuid(),repeat('e',64),rev,null);
   raise exception 'expected_different_acceptance_denial';
 exception when others then if sqlerrm<>'idempotency_conflict' then raise; end if; end;

 perform public.hpa_create_table_request(token_hash,repeat('a',64),request2,repeat('f',64),rev,request2,quote);
 order_data:=(order_data||jsonb_build_object('id',gen_random_uuid(),'number','QA-TABLE-'||request2::text,'paymentStatus','pending'))
   ||jsonb_build_object('counter',jsonb_build_object('tableLabel','','payLater',true,'payLaterReason','Owner allows payment after meal','createdBy',actor,'entry','table_qr','sourceRequestId',request2));
 result:=public.hpa_decide_table_request(request2,1,actor,'accept',order_data,gen_random_uuid(),repeat('1',64),rev,null);
 if result->'order'->>'status'<>'confirmed' or result->'order'->>'paymentStatus'<>'pending' then raise exception 'table_pay_later_exception_failed'; end if;

 perform public.hpa_create_table_request(token_hash,repeat('a',64),request3,repeat('2',64),rev,request3,quote);
 t:=public.hpa_manage_table_qr(actor,'rotate',null,null,(t->>'id')::uuid,(t->>'version')::integer);
 if t->>'token'=raw_token or (t->>'generation')::integer<>initial_generation+1 then raise exception 'table_rotation_failed'; end if;
 result:=public.hpa_get_table_request(request3,(t->>'id')::uuid,initial_generation,repeat('a',64));
 if result->>'status'<>'expired' then raise exception 'rotated_request_not_expired'; end if;
 begin
   perform public.hpa_create_table_request(token_hash,repeat('a',64),request4,repeat('3',64),rev,request4,quote);
   raise exception 'expected_old_qr_denial';
 exception when others then if sqlerrm<>'table_not_found' then raise; end if; end;
 begin
   perform public.hpa_decide_table_request(request3,1,actor,'accept',order_data,gen_random_uuid(),repeat('4',64),rev,null);
   raise exception 'expected_rotated_request_denial';
 exception when others then if sqlerrm<>'table_request_expired' then raise; end if; end;
 token_hash:=encode(extensions.digest(t->>'token','sha256'),'hex');
 perform public.hpa_create_table_request(token_hash,repeat('a',64),request4,repeat('5',64),rev,request4,quote);
 update public.hpa_table_requests set expires_at=now()-interval '1 second' where id=request4;
 begin
   perform public.hpa_decide_table_request(request4,1,actor,'accept',order_data,gen_random_uuid(),repeat('6',64),rev,null);
   raise exception 'expected_expiry_denial';
 exception when others then if sqlerrm<>'table_request_expired' then raise; end if; end;
 result:=public.hpa_list_table_requests(actor,'barra');
 if exists(select 1 from jsonb_array_elements(result->'requests') q where q->>'id' in (request3::text,request4::text)) then raise exception 'invalidated_request_still_queued'; end if;

 t:=public.hpa_manage_table_qr(actor,'disable',null,null,(t->>'id')::uuid,(t->>'version')::integer);
 duplicate:=public.hpa_manage_table_qr(actor,'create','barra');
 if duplicate->>'id'<>t->>'id' or duplicate->>'active'<>'false' then raise exception 'create_reenabled_disabled_qr'; end if;
 t:=public.hpa_manage_table_qr(actor,'rotate',null,null,(t->>'id')::uuid,(t->>'version')::integer);
 if t->>'active'<>'true' then raise exception 'explicit_reenable_failed'; end if;
 if exists(select 1 from public.hpa_table_qr where ordering_scope='legacy_table' and active) then raise exception 'legacy_table_link_active'; end if;
 if (select count(*) from public.hpa_table_qr where branch_id='barra' and ordering_scope='branch')<>1 then raise exception 'branch_qr_not_singleton'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('hpa_manage_table_qr','hpa_get_table_request','hpa_create_table_request','hpa_list_table_requests','hpa_decide_table_request','hpa_table_request_document') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'public_table_rpc'; end if;
end $$;

set local role service_role;
do $$ declare t jsonb;
begin
 t:=public.hpa_manage_table_qr(current_setting('hpa.qr_actor')::uuid,'create','barra');
 if t->>'token' is null or t->>'id'<>current_setting('hpa.qr_table') then raise exception 'service_role_canonical_qr_failed'; end if;
end $$;
reset role;
set local role anon;
do $$
begin
 begin perform 1 from public.hpa_table_qr; raise exception 'expected_public_token_denial'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.hpa_table_requests; raise exception 'expected_public_request_denial'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Branch QR singleton, required contact, request-only creation, guest isolation, staff acceptance/pay-later, atomic replay, contact/item mismatch checks, rotation/expiry and browser denial checks passed' as result;
