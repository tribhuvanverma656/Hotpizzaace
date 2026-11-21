-- Development-only transactional fixtures. No passwords, real staff or food are created.
begin;
do $kitchen_ready$
<<qa>>
declare
  actor uuid; owner_session uuid:=gen_random_uuid(); chef uuid:=gen_random_uuid(); chef_session uuid:=gen_random_uuid();
  second_session uuid:=gen_random_uuid(); branch_two text:='qa-kitchen-'||gen_random_uuid()::text;
  source_branch public.hpa_branches; s jsonb; profile jsonb; result jsonb; before_order jsonb;
  document jsonb; order_id uuid:=gen_random_uuid(); other_order uuid:=gen_random_uuid(); review_order uuid:=gen_random_uuid(); website_order uuid:=gen_random_uuid(); v integer; old_order uuid:=gen_random_uuid(); entry jsonb;
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
  -- Active ticket is in the queue, not in Ready today.
  result:=public.hpa_kitchen_queue(chef,chef_session);
  if not (result ? 'ready') or jsonb_typeof(result->'ready')<>'array' then raise exception 'ready_list_missing'; end if;
  if exists(select 1 from jsonb_array_elements(result->'ready') r where r->>'id'=order_id::text) then raise exception 'active_order_listed_as_ready'; end if;
  -- Normal kitchen flow: preparing, then ready.
  result:=public.hpa_kitchen_transition(chef,chef_session,order_id,1,'preparing');
  v:=(select version from public.hpa_orders where id=order_id);
  result:=public.hpa_kitchen_transition(chef,chef_session,order_id,v,'ready');
  result:=public.hpa_kitchen_queue(chef,chef_session);
  if exists(select 1 from jsonb_array_elements(result->'orders') o where o->>'id'=order_id::text) then raise exception 'ready_order_still_active'; end if;
  select r into entry from jsonb_array_elements(result->'ready') r where r->>'id'=order_id::text;
  if entry is null then raise exception 'ready_order_missing'; end if;
  if entry->>'readyAt' is null or jsonb_array_length(entry->'items')<>1 or entry->'items'->0->>'name'<>'QA item'
    then raise exception 'ready_order_incomplete'; end if;
  -- Later hand-over statuses stay in the list.
  update public.hpa_orders set data=jsonb_set(data,'{status}','"served"') where id=order_id;
  if not exists(select 1 from jsonb_array_elements(public.hpa_kitchen_queue(chef,chef_session)->'ready') r where r->>'id'=order_id::text)
    then raise exception 'served_order_dropped'; end if;
  -- Other branches never appear.
  update public.hpa_orders set data=jsonb_set(data,'{status}','"ready"') where id=other_order;
  if exists(select 1 from jsonb_array_elements(public.hpa_kitchen_queue(chef,chef_session)->'ready') r where r->>'id'=other_order::text)
    then raise exception 'cross_branch_ready_listed'; end if;
  -- Yesterday's ready orders are excluded.
  insert into public.hpa_orders(id,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
    select old_order,repeat('e',64),'qa-kitchen',gen_random_uuid()::text,repeat('f',64),
      document||jsonb_build_object('id',old_order,'branchId','barra','status','ready'),now()-interval '2 days';
  if exists(select 1 from jsonb_array_elements(public.hpa_kitchen_queue(chef,chef_session)->'ready') r where r->>'id'=old_order::text)
    then raise exception 'old_ready_listed'; end if;
  -- Cancelled orders are never listed.
  update public.hpa_orders set data=jsonb_set(data,'{status}','"cancelled"') where id=order_id;
  if exists(select 1 from jsonb_array_elements(public.hpa_kitchen_queue(chef,chef_session)->'ready') r where r->>'id'=order_id::text)
    then raise exception 'cancelled_listed'; end if;
  -- Not callable from browsers.
  if has_function_privilege('anon','public.hpa_kitchen_ready_today(text)','EXECUTE')
    or has_function_privilege('authenticated','public.hpa_kitchen_ready_today(text)','EXECUTE')
    then raise exception 'ready_today_public'; end if;
end $kitchen_ready$;
select 'Kitchen ready-today list passed' as result;
rollback;
