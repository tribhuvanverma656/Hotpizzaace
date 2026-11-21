-- Development-only transactional fixtures. No passwords, real staff or food are created.
begin;
do $kitchen_staff$
<<qa>>
declare
  actor uuid; owner_session uuid:=gen_random_uuid(); chef uuid:=gen_random_uuid(); chef_session uuid:=gen_random_uuid();
  second_session uuid:=gen_random_uuid(); branch_two text:='qa-kitchen-'||gen_random_uuid()::text;
  source_branch public.hpa_branches; s jsonb; profile jsonb; result jsonb; before_order jsonb;
  document jsonb; order_id uuid:=gen_random_uuid(); other_order uuid:=gen_random_uuid(); review_order uuid:=gen_random_uuid(); website_order uuid:=gen_random_uuid(); v integer;
  counter_invoice jsonb; website_invoice jsonb; invoice_counter_after bigint;
begin
  select m.user_id into actor from public.hpa_admin_memberships m join auth.users u on u.id=m.user_id
    where m.role='owner' and lower(u.email)='hotpizzaace@gmail.com' limit 1;
  if actor is null then raise exception 'kitchen_fixture_owner_missing'; end if;
  select * into source_branch from public.hpa_branches where id='barra';
  insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,role,aud)
    values(chef,replace(chef::text,'-','')||'@staff.hotpizzaace.com',now(),now(),now(),'authenticated','authenticated');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(owner_session,actor,now(),now()),(chef_session,chef,now(),now()),(second_session,chef,now(),now());
  insert into public.hpa_branches(id,slug,data) values(branch_two,branch_two,source_branch.data||jsonb_build_object('id',branch_two,'slug',branch_two,'name',source_branch.data->>'name'));
  perform set_config('role','service_role',true);
  update public.hpa_kitchen_config set enabled=false where id;
  begin perform public.hpa_kitchen_lookup('qa-chef'); raise exception 'disabled_feature_accepted';
    exception when others then if sqlerrm<>'kitchen_disabled' then raise; end if; end;
  update public.hpa_kitchen_config set enabled=true where id;
  begin perform public.hpa_kitchen_staff_list(chef,chef_session); raise exception 'chef_read_staff_list';
    exception when others then if sqlerrm<>'kitchen_owner_required' then raise; end if; end;
  begin perform public.hpa_kitchen_staff_list(actor,chef_session); raise exception 'owner_session_not_bound';
    exception when others then if sqlerrm<>'kitchen_owner_required' then raise; end if; end;
  s:=public.hpa_kitchen_staff_begin(actor,owner_session,chef,null,'create',jsonb_build_object(
    'username','qa-chef','displayName','QA Chef','branchId','barra','authAlias',replace(chef::text,'-','')||'@staff.hotpizzaace.com'));
  if s->>'enabled'<>'false' or s->>'state'<>'provisioning' or s ? 'authAlias' then raise exception 'provisioning_not_private_or_blocked'; end if;
  if public.hpa_kitchen_lookup('qa-chef') is not null then raise exception 'unfinished_login_allowed'; end if;
  s:=public.hpa_kitchen_staff_finish(actor,owner_session,chef,1,true);
  if s->>'enabled'<>'true' or s->>'version'<>'2' then raise exception 'provisioning_finish_failed'; end if;
  begin perform public.hpa_kitchen_session(chef,chef_session); raise exception 'unregistered_token_accepted';
    exception when others then if sqlerrm<>'kitchen_session_revoked' then raise; end if; end;
  profile:=public.hpa_kitchen_register(chef,chef_session,2);
  if profile->>'branchId'<>'barra' or profile->>'version'<>'2' or profile ? 'authAlias' then raise exception 'profile_wrong'; end if;
  if (profile->>'expiresAt')::timestamptz>now()+interval '12 hours' then raise exception 'unbounded_staff_session'; end if;
  perform public.hpa_kitchen_register(chef,second_session,2);

  -- Paid/authorized counter semantics match the owner queue. Use a small rollback-only bill.
  document:=jsonb_build_object('id',order_id,'number','QA-REPLACED-BY-SERVER','createdAt',now(),
    'branchId','barra','branchName','Barra','channel','counter','environment','development',
    'customer',jsonb_build_object('name','PRIVATE NAME','phone','9876543210','address','PRIVATE ADDRESS'),
    'items',jsonb_build_array(jsonb_build_object('id','qa-line','productId','qa-only','name','QA item','unitPrice',10000,'quantity',1,'options','[]'::jsonb,'notes','PRIVATE NOTE')),
    'fulfillment','dine_in','paymentMode','counter_manual','paymentMethod','cash','paymentStatus','pending','status','confirmed',
    'subtotal',10000,'deliveryFee',0,'discount',0,'roundOff',0,'total',10500,
    'counter',jsonb_build_object('createdBy',actor,'tableLabel','PRIVATE REFERENCE','payLater',true,'payLaterReason','PRIVATE PAYLATER REASON'),
    'tax',jsonb_build_object('supplier',source_branch.data->'settings'->'billing','taxableValue',10000,'cgst',250,'sgst',250,'total',500));
  insert into public.hpa_orders(id,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data)
    values(order_id,repeat('a',64),'qa-kitchen',gen_random_uuid()::text,repeat('b',64),document);
  -- Normal counter acceptance has already assigned its immutable bill.
  perform public.hpa_assign_invoice(order_id);
  select data->'invoice' into counter_invoice from public.hpa_orders where id=order_id;
  document:=document||jsonb_build_object('id',other_order,'branchId',branch_two);
  insert into public.hpa_orders(id,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data)
    values(other_order,repeat('c',64),'qa-kitchen',gen_random_uuid()::text,repeat('d',64),document);
  result:=public.hpa_kitchen_queue(chef,chef_session);
  if not exists(select 1 from jsonb_array_elements(result->'orders') o where o->>'id'=order_id::text)
    or exists(select 1 from jsonb_array_elements(result->'orders') o where o->>'branchId'=branch_two)
    then raise exception 'branch_queue_isolation_failed'; end if;
  begin perform public.hpa_kitchen_transition(chef,chef_session,other_order,1,'preparing'); raise exception 'cross_branch_mutation';
    exception when others then if sqlerrm<>'kitchen_order_not_found' then raise; end if; end;
  begin perform public.hpa_kitchen_transition(chef,chef_session,order_id,1,'ready'); raise exception 'skipped_preparation';
    exception when others then if sqlerrm<>'kitchen_transition_invalid' then raise; end if; end;
  select data into before_order from public.hpa_orders where id=order_id;
  result:=public.hpa_kitchen_transition(chef,chef_session,order_id,1,'preparing');
  if result->'order'->>'version'<>'2' or result->'order'->>'status'<>'preparing' then raise exception 'preparation_update_failed'; end if;
  if ((result->'order')-array['status','version']) is distinct from (before_order-'status') then raise exception 'chef_changed_financial_or_customer_fields'; end if;
  -- A sequential stale-version check; this does not prove overlapping transaction behavior.
  begin perform public.hpa_kitchen_transition(chef,second_session,order_id,1,'preparing'); raise exception 'stale_duplicate_committed';
    exception when others then if sqlerrm<>'kitchen_version_conflict' then raise; end if; end;
  if (select count(*) from public.hpa_order_events e where e.order_id=qa.order_id and kind='kitchen_status')<>1
    then raise exception 'duplicate_preparation_audit'; end if;
  -- Counter constraints already forbid a payment-review state. Exercise the
  -- independent website refund/review gate on a trusted, captured-payment fixture.
  document:=(document-'counter')||jsonb_build_object('id',review_order,'branchId','barra','channel','website',
    'fulfillment','pickup','paymentMode','razorpay_test','paymentMethod','card','paymentStatus','paid','status','preparing','paymentReviewRequired',true);
  insert into public.hpa_orders(id,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data)
    values(review_order,repeat('e',64),'qa-kitchen',gen_random_uuid()::text,repeat('f',64),document);
  begin perform public.hpa_kitchen_transition(chef,chef_session,review_order,1,'ready'); raise exception 'reviewed_order_prepared';
    exception when others then if sqlerrm<>'kitchen_order_not_eligible' then raise; end if; end;
  update public.hpa_orders set data=(data-'paymentReviewRequired')||jsonb_build_object('refundSyncPending',true),version=version+1 where id=review_order;
  begin perform public.hpa_kitchen_transition(chef,chef_session,review_order,2,'ready'); raise exception 'incomplete_refund_prepared';
    exception when others then if sqlerrm<>'kitchen_order_not_eligible' then raise; end if; end;
  result:=public.hpa_kitchen_transition(chef,chef_session,order_id,2,'ready');
  if result->'order'->>'status'<>'ready' then raise exception 'ready_update_failed'; end if;
  if result->'order'->'invoice' is distinct from counter_invoice then raise exception 'counter_invoice_reissued_by_chef'; end if;
  if exists(select 1 from jsonb_array_elements(public.hpa_kitchen_queue(chef,chef_session)->'orders') o where o->>'id'=order_id::text)
    then raise exception 'ready_order_still_queued'; end if;
  begin perform public.hpa_kitchen_transition(chef,chef_session,order_id,3,'served'); raise exception 'chef_served_order';
    exception when others then if sqlerrm<>'kitchen_order_not_eligible' then raise; end if; end;

  -- Website invoices are issued at Ready, including preparation completed by a chef.
  document:=(document-array['counter','paymentReviewRequired','refundSyncPending','invoice'])||jsonb_build_object(
    'id',website_order,'branchId','barra','channel','website','fulfillment','pickup',
    'paymentMode','razorpay_test','paymentMethod','card','paymentStatus','paid','status','confirmed');
  insert into public.hpa_orders(id,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data)
    values(website_order,repeat('1',64),'qa-kitchen',gen_random_uuid()::text,repeat('2',64),document);
  result:=public.hpa_kitchen_transition(chef,chef_session,website_order,1,'preparing');
  if result->'order' ? 'invoice' then raise exception 'website_invoice_issued_before_ready'; end if;
  select data into before_order from public.hpa_orders where id=website_order;
  result:=public.hpa_kitchen_transition(chef,chef_session,website_order,2,'ready');
  website_invoice:=result->'order'->'invoice';
  if website_invoice is null or website_invoice->>'kind'<>'test_bill'
    or website_invoice->>'number' not like 'TST/%' or not (website_invoice ? 'issuedAt')
    then raise exception 'chef_ready_website_invoice_missing'; end if;
  if ((result->'order')-array['status','version','invoice']) is distinct from (before_order-array['status','invoice'])
    then raise exception 'chef_ready_website_financial_or_customer_change'; end if;
  select coalesce(sum(last_value),0) into invoice_counter_after from public.hpa_invoice_counters;
  perform public.hpa_assign_invoice(website_order);
  begin perform public.hpa_kitchen_transition(chef,second_session,website_order,2,'ready'); raise exception 'stale_website_ready_committed';
    exception when others then if sqlerrm<>'kitchen_version_conflict' then raise; end if; end;
  if (select data->'invoice' from public.hpa_orders where id=website_order) is distinct from website_invoice
    or (select coalesce(sum(last_value),0) from public.hpa_invoice_counters)<>invoice_counter_after
    or (select count(*) from public.hpa_order_events e where e.order_id=website_order and kind='kitchen_status')<>2
    then raise exception 'chef_ready_website_invoice_or_event_duplicated'; end if;

  -- Disable is immediate for every registered session; re-enable never revives one.
  s:=public.hpa_kitchen_staff_begin(actor,owner_session,chef,2,'disable','{}');
  begin perform public.hpa_kitchen_session(chef,chef_session); raise exception 'disabled_session_survived';
    exception when others then if sqlerrm<>'kitchen_auth_required' then raise; end if; end;
  s:=public.hpa_kitchen_staff_begin(actor,owner_session,chef,3,'enable','{}');
  begin perform public.hpa_kitchen_session(chef,second_session); raise exception 'reenable_revived_old_session';
    exception when others then if sqlerrm<>'kitchen_session_revoked' then raise; end if; end;
  -- A reset failure blocks access; a new explicit reset can recover, without restoring old sessions.
  s:=public.hpa_kitchen_staff_begin(actor,owner_session,chef,4,'reset-password','{}');
  s:=public.hpa_kitchen_staff_finish(actor,owner_session,chef,5,false);
  if s->>'enabled'<>'false' or s->>'state'<>'blocked' then raise exception 'reset_failure_not_blocked'; end if;
  s:=public.hpa_kitchen_staff_begin(actor,owner_session,chef,6,'reset-password','{}');
  s:=public.hpa_kitchen_staff_finish(actor,owner_session,chef,7,true);
  if s->>'enabled'<>'true' or s->>'version'<>'8' then raise exception 'reset_recovery_failed'; end if;
  -- Rename/reassign invalidates old registration and keeps same immutable Auth alias.
  s:=public.hpa_kitchen_staff_begin(actor,owner_session,chef,8,'update',jsonb_build_object('username','qa-chef-new','displayName','QA Chef','branchId',branch_two));
  if s->>'version'<>'9' or s->>'branchId'<>branch_two or public.hpa_kitchen_lookup('qa-chef') is not null then raise exception 'staff_reassignment_failed'; end if;
  update public.hpa_kitchen_config set enabled=false where id;
  if (select authorization_version from public.hpa_kitchen_staff where id=chef)<>10 then raise exception 'global_pause_did_not_invalidate_sessions'; end if;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'hpa_kitchen_%'
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')))
    then raise exception 'public_kitchen_rpc'; end if;
  if has_function_privilege('anon','hpa_kitchen_private.live_identity(uuid,uuid,text)','EXECUTE')
    or has_table_privilege('service_role','auth.sessions','SELECT') then raise exception 'auth_session_lookup_overexposed'; end if;
end $kitchen_staff$;
select 'Kitchen branch isolation, strict transitions, preserved bills, stale versions, revocation, reset recovery and client denial passed' as result;
rollback;
