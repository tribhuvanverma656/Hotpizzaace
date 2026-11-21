-- Run with the numbering migration inside a transaction; all fixtures roll back.
-- No provider requests, payments or real food orders are created.
begin;
do $daily_numbers$
declare
 first_number text; next_number text; result jsonb; document jsonb; saved jsonb;
 prefix text:='HPA-'||to_char(clock_timestamp() at time zone 'Asia/Kolkata','DDMMYY')||'-';
 today date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;
 before_counter bigint; actor uuid; mode text; rev bigint; source_branch public.hpa_branches;
 branch_two text:='qa-number-'||gen_random_uuid()::text; profile jsonb;
 website_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); counter_id uuid:=gen_random_uuid();
 website_key text:=gen_random_uuid()::text; counter_key uuid:=gen_random_uuid(); invoice_number text;
 old_id uuid; old_reference text; old_invoice jsonb; q public.hpa_table_qr;
 request_id uuid:=gen_random_uuid(); accepted_id uuid:=gen_random_uuid(); accept_key uuid:=gen_random_uuid();
 request_doc jsonb; selections jsonb; request_result jsonb; accepted_number text;
begin
 -- Independent future dates exercise midnight and padding without consuming today's counter.
 first_number:=public.hpa_next_order_number('2096-02-28T18:29:59Z');
 if first_number<>'HPA-280296-0001' then raise exception 'first_daily_number_wrong: %',first_number; end if;
 next_number:=public.hpa_next_order_number('2096-02-28T18:30:00Z');
 if next_number<>'HPA-290296-0001' then raise exception 'IST_midnight_reset_failed: %',next_number; end if;
 if public.hpa_next_order_number('2096-02-28T18:29:59Z')<>'HPA-280296-0002' then raise exception 'daily_counter_not_independent'; end if;
 insert into public.hpa_order_number_counters(business_date,last_value) values('2096-03-01',9998);
 first_number:=public.hpa_next_order_number('2096-03-01T00:00:00Z');
 next_number:=public.hpa_next_order_number('2096-03-01T00:00:00Z');
 if first_number<>'HPA-010396-9999' or next_number<>'HPA-010396-10000' then raise exception 'large_sequence_truncated'; end if;
 begin
   perform public.hpa_next_order_number('infinity');
   raise exception 'invalid_clock_accepted';
 exception when others then if sqlerrm<>'order_number_clock_invalid' then raise; end if; end;

 select id,data->>'number',data->'invoice' into old_id,old_reference,old_invoice from public.hpa_orders order by created_at limit 1;
 select * into source_branch from public.hpa_branches where data->'settings' ? 'billing' order by id limit 1;
 if not found then raise exception 'billing_branch_fixture_missing'; end if;
 select user_id into actor from public.hpa_admin_memberships where role='owner' limit 1;
 if actor is null then raise exception 'owner_fixture_missing'; end if;
 select s.mode,s.revision into mode,rev from public.hpa_commerce_state s where id=true;
 -- Exercise the trigger and RPCs with the same non-owner role as the commerce Edge.
 perform set_config('role','service_role',true);
 select coalesce(max(last_value),0) into before_counter from public.hpa_order_number_counters where business_date=today;

 document:=jsonb_build_object('id',website_id,'number','CLIENT-NUMBER-MUST-BE-REPLACED','createdAt','2000-01-01T00:00:00Z',
   'branchId',source_branch.id,'customer',jsonb_build_object('name','QA numbering only','phone','9876543210'),
   'items',jsonb_build_array(jsonb_build_object('id','qa-line','productId','qa-number-only','name','QA ONLY','unitPrice',10000,'quantity',1,'notes','','options','[]'::jsonb)),
   'fulfillment','pickup','paymentMethod','cash','paymentStatus','pending','status','pending',
   'subtotal',10000,'deliveryFee',0,'discount',0,'roundOff',0,'total',10000,'coupon','');
 result:=public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),website_key,repeat('c',64),rev);
 first_number:=result->'order'->>'number';
 if result->>'created'<>'true' or first_number<>prefix||lpad((before_counter+1)::text,greatest(4,length((before_counter+1)::text)),'0')
   or result->'order'->>'id'<>website_id::text then raise exception 'website_did_not_return_saved_daily_number'; end if;
 select data into saved from public.hpa_orders where id=website_id;
 if saved->>'number'<>first_number then raise exception 'website_response_and_saved_number_differ'; end if;
 result:=public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),website_key,repeat('c',64),rev-1);
 if result->>'created'<>'false' or result->'order'->>'number'<>first_number then raise exception 'website_retry_renumbered'; end if;
 update public.hpa_orders set version=version+1 where id=website_id;
 if (select last_value from public.hpa_order_number_counters where business_date=today)<>before_counter+1 then raise exception 'retry_or_update_consumed_number'; end if;

 -- The same daily sequence spans branches and staff/customer channels.
 insert into public.hpa_branches(id,slug,data) values(branch_two,branch_two,source_branch.data||jsonb_build_object('id',branch_two,'slug',branch_two));
 document:=document||jsonb_build_object('id',second_id,'branchId',branch_two);
 result:=public.hpa_create_order(document,null,repeat('a',64),repeat('b',64),'guest:'||repeat('a',64),gen_random_uuid()::text,repeat('d',64),rev);
 next_number:=result->'order'->>'number';
 if substring(next_number from length(prefix)+1)::bigint<>before_counter+2 then raise exception 'branch_sequence_not_global'; end if;

 profile:=source_branch.data->'settings'->'billing';
 update public.hpa_branches set data=jsonb_set(jsonb_set(data,'{settings,counterAcceptingOrders}','true'),'{settings,temporarilyClosed}','false') where id=branch_two;
 document:=document||jsonb_build_object('id',counter_id,'createdAt',now(),'channel','counter','environment',mode,
   'fulfillment','dine_in','paymentMode','counter_manual','status','confirmed','total',10500,
   'counter',jsonb_build_object('tableLabel','','payLater',true,'payLaterReason','QA rollback only','createdBy',actor),
   'tax',jsonb_build_object('supplier',profile,'taxableValue',10000,'cgst',250,'sgst',250,'total',500));
 result:=public.hpa_create_counter_order(document,actor,counter_key,repeat('e',64),rev,null);
 invoice_number:=result->'order'->'invoice'->>'number';
 next_number:=result->'order'->>'number';
 if substring(next_number from length(prefix)+1)::bigint<>before_counter+3 or invoice_number is null then raise exception 'counter_number_or_invoice_missing'; end if;
 result:=public.hpa_create_counter_order(document,actor,counter_key,repeat('e',64),rev-1,null);
 if result->>'replayed'<>'true' or result->'order'->>'number'<>next_number or result->'order'->'invoice'->>'number'<>invoice_number then raise exception 'counter_retry_changed_reference_or_invoice'; end if;

 -- A QR request allocates nothing; acceptance uses the same insert trigger once.
 result:=public.hpa_manage_table_qr(actor,'create',branch_two);
 select * into q from public.hpa_table_qr where branch_id=branch_two and ordering_scope='branch';
 selections:=jsonb_build_array(jsonb_build_object('id','qa-line','productId','qa-number-only','quantity',1,'notes','','toppingIds','[]'::jsonb));
 request_doc:=jsonb_build_object('branchId',branch_two,'tableLabel',q.table_label,'customerName','QA numbering only','customerPhone','9876543210','notes','',
   'selections',selections,'items',document->'items','subtotal',10000,'tax',document->'tax','roundOff',0,'total',10500);
 request_result:=public.hpa_create_table_request(q.token_hash,repeat('f',64),gen_random_uuid(),repeat('1',64),rev,request_id,request_doc);
 if (select last_value from public.hpa_order_number_counters where business_date=today)<>before_counter+3 then raise exception 'QR_request_consumed_order_number'; end if;
 document:=document||jsonb_build_object('id',accepted_id,'counter',(document->'counter')||jsonb_build_object('entry','table_qr','sourceRequestId',request_id),
   'customer',jsonb_build_object('name','QA numbering only','phone','9876543210','instructions',''));
 result:=public.hpa_decide_table_request(request_id,1,actor,'accept',document,accept_key,repeat('2',64),rev,null);
 accepted_number:=result->'order'->>'number';
 if substring(accepted_number from length(prefix)+1)::bigint<>before_counter+4 then raise exception 'QR_acceptance_number_not_sequential'; end if;
 result:=public.hpa_decide_table_request(request_id,1,actor,'accept',null,accept_key,repeat('2',64),rev-1,null);
 if result->>'replayed'<>'true' or result->'order'->>'number'<>accepted_number then raise exception 'QR_retry_renumbered'; end if;
 select public.hpa_table_request_document(r) into request_result from public.hpa_table_requests r where id=request_id;
 if request_result->>'acceptedOrderNumber'<>accepted_number then raise exception 'QR_public_projection_has_stale_number'; end if;
 if (select last_value from public.hpa_order_number_counters where business_date=today)<>before_counter+4 then raise exception 'QR_retry_consumed_number'; end if;

 if old_id is not null and exists(select 1 from public.hpa_orders where id=old_id and (data->>'number' is distinct from old_reference or data->'invoice' is distinct from old_invoice)) then raise exception 'historical_reference_or_invoice_changed'; end if;
 if has_table_privilege('anon','public.hpa_order_number_counters','SELECT') or has_table_privilege('authenticated','public.hpa_order_number_counters','UPDATE')
   or has_function_privilege('anon','public.hpa_next_order_number(timestamptz)','EXECUTE') or has_function_privilege('authenticated','public.hpa_next_order_number(timestamptz)','EXECUTE') then raise exception 'daily_counter_exposed_to_browser'; end if;
 if not exists(select 1 from pg_indexes where schemaname='public' and indexname='hpa_orders_number_idx' and indexdef like 'CREATE UNIQUE INDEX%') then raise exception 'global_order_number_uniqueness_lost'; end if;
end $daily_numbers$;
reset role;
rollback;
