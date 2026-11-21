-- Run after the report migration in BEGIN/ROLLBACK. Fictional branch/receipts only.
do $$
declare
 actor uuid; fixture_branch text:='qa-report-'||replace(gen_random_uuid()::text,'-','');
 id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid(); id3 uuid:=gen_random_uuid(); outside_id uuid:=gen_random_uuid();
 document jsonb; result jsonb; item jsonb; other_branch text:='qa-other-'||replace(gen_random_uuid()::text,'-','');
 from_time timestamptz:='2030-01-01T18:30:00Z'; to_time timestamptz:='2030-01-02T18:30:00Z';
 row_count integer;
begin
 select user_id into actor from public.hpa_admin_memberships where role='owner' limit 1;
 if actor is null then raise exception 'report_fixture_owner_unavailable'; end if;
 insert into public.hpa_branches(id,slug,data)
 select fixture_branch,fixture_branch,data||jsonb_build_object('id',fixture_branch,'slug',fixture_branch,'name','Fictional report branch')
 from public.hpa_branches where id='barra';
 insert into public.hpa_branches(id,slug,data)
 select other_branch,other_branch,data||jsonb_build_object('id',other_branch,'slug',other_branch,'name','Fictional other branch')
 from public.hpa_branches where id='barra';
 document:=jsonb_build_object('id',id1,'number','QA-REPORT-'||id1,'createdAt','2030-01-01T18:30:00Z','branchId',fixture_branch,
 'customer',jsonb_build_object('name','Fictional report customer','phone','9000000001'),
 'items',jsonb_build_array(jsonb_build_object('id','fixture','name','QA item','quantity',1,'unitPrice',10000)),
 'fulfillment','pickup','paymentMethod','upi','paymentMode','simulation','paymentStatus','pending','status','pending',
 'subtotal',10000,'deliveryFee',0,'discount',0,'total',10000,'coupon','');
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 values(id1,repeat('a',64),repeat('b',64),'qa-report',id1::text,repeat('c',64),document,'2030-01-01T18:30:00Z');
 -- An order placed earlier is included for its completion event in this business day.
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 values(id2,repeat('a',64),repeat('b',64),'qa-report',id2::text,repeat('c',64),
 document||jsonb_build_object('id',id2,'number','QA-REPORT-'||id2,'createdAt','2029-12-01T00:00:00Z','completedAt','2030-01-02T01:00:00+05:30'),'2029-12-01T00:00:00Z');
 -- Equivalent offset timestamp tests casts, not lexical text comparison.
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 values(id3,repeat('a',64),repeat('b',64),'qa-report',id3::text,repeat('c',64),
 document||jsonb_build_object('id',id3,'number','QA-REPORT-'||id3,'createdAt','2029-12-01T00:00:00Z',
 'channel','counter','environment','development','fulfillment','dine_in','paymentMode','counter_manual','paymentStatus','paid','status','confirmed','total',10500,
 'tax',jsonb_build_object('taxableValue',10000,'cgst',250,'sgst',250,'total',500,'cgstRate',2.5,'sgstRate',2.5,'supplier',(select data->'settings'->'billing' from public.hpa_branches where id='barra')),
 'counter',jsonb_build_object('createdBy',actor,'tableLabel','QA report table','payLater',false),
 'settlement',jsonb_build_object('source','staff','method','upi','amount',10500,'confirmedBy',actor,'confirmedAt','2030-01-02T00:30:00+05:30','upiReference','PRIVATEBANKREF')),'2029-12-01T00:00:00Z');
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 values(outside_id,repeat('a',64),repeat('b',64),'qa-report',outside_id::text,repeat('c',64),document||jsonb_build_object('id',outside_id,'number','QA-REPORT-'||outside_id,'createdAt',to_time),'2030-01-02T18:30:00Z');
 execute 'set local role service_role';
 result:=public.hpa_sales_report_snapshot(actor,fixture_branch,from_time,to_time);
 execute 'reset role';
 if jsonb_array_length(result->'orders')<>3 or result->>'complete'<>'true' then raise exception 'report_clock_bounds_failed'; end if;
 if exists(select 1 from jsonb_array_elements(result->'orders') d where d->>'branchId'<>fixture_branch or d ? 'customer' or d ? 'items' or d->'settlement' ? 'upiReference') then raise exception 'report_projection_privacy_failed'; end if;
 if result->>'mode' is distinct from (select mode from public.hpa_commerce_state where id=true) then raise exception 'report_wrong_mode'; end if;
 begin perform public.hpa_sales_report_snapshot(gen_random_uuid(),fixture_branch,from_time,to_time); raise exception 'expected_owner_denial'; exception when others then if sqlerrm<>'report_owner_required' then raise; end if; end;
 begin perform public.hpa_sales_report_snapshot(actor,fixture_branch,from_time,from_time+interval '32 days'); raise exception 'expected_range_denial'; exception when others then if sqlerrm<>'report_range_invalid' then raise; end if; end;
 begin perform public.hpa_sales_report_snapshot(actor,fixture_branch,from_time+interval '1 hour',to_time); raise exception 'expected_midnight_denial'; exception when others then if sqlerrm<>'report_range_invalid' then raise; end if; end;
 if has_function_privilege('anon','public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz)','execute') or has_function_privilege('authenticated','public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz)','execute') then raise exception 'report_public_rpc'; end if;
 if not has_function_privilege('service_role','public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz)','execute') then raise exception 'report_service_role_missing'; end if;
 -- More than 1,000 rows must remain complete. IDs and payment fields are fictional.
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 select fixture_id,repeat('a',64),repeat('b',64),'qa-report',fixture_id::text,repeat('c',64),
 document||jsonb_build_object('id',fixture_id,'number','QA-REPORT-'||fixture_id,'createdAt','2030-01-02T05:00:00Z'),'2030-01-02T05:00:00Z'::timestamptz
 from (select gen_random_uuid() as fixture_id from generate_series(1,1001)) fixtures;
 result:=public.hpa_sales_report_snapshot(actor,fixture_branch,from_time,to_time);
 if jsonb_array_length(result->'orders')<>1004 then raise exception 'report_truncated_to_snapshot_1000'; end if;
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 select fixture_id,repeat('a',64),repeat('b',64),'qa-report',fixture_id::text,repeat('c',64),
 document||jsonb_build_object('id',fixture_id,'number','QA-REPORT-'||fixture_id,'createdAt','2030-01-02T05:00:00Z'),'2030-01-02T05:00:00Z'::timestamptz
 from (select gen_random_uuid() as fixture_id from generate_series(1,9000)) fixtures;
 begin perform public.hpa_sales_report_snapshot(actor,fixture_branch,from_time,to_time); raise exception 'expected_large_report_denial'; exception when others then if sqlerrm<>'report_too_large' then raise; end if; end;
end;
$$;
select 'Report owner/branch permissions, IST boundaries, completion/receipt clocks, projection privacy, >1000 completeness and >10000 refusal passed; transaction will roll back' as result;
