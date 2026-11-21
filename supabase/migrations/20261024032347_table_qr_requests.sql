-- A table QR is a public, revocable request capability, not a payment or staff login.
-- Raw tokens are retained only in server-only rows so the owner can reprint an existing QR.
create table public.hpa_table_qr (
 id uuid primary key default gen_random_uuid(),
 branch_id text not null references public.hpa_branches(id) on delete restrict,
 table_label text not null check(length(btrim(table_label)) between 1 and 40),
 token text not null unique check(token ~ '^[a-f0-9]{64}$'),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 active boolean not null default true,
 generation integer not null default 1 check(generation>0),
 version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint hpa_table_token_binding check(token_hash=encode(extensions.digest(token,'sha256'),'hex'))
);
create unique index hpa_table_qr_label_unique on public.hpa_table_qr(branch_id,lower(btrim(table_label)));
create index hpa_table_qr_actor_idx on public.hpa_table_qr(created_by);

create table public.hpa_table_requests (
 id uuid primary key,
 table_id uuid not null references public.hpa_table_qr(id) on delete restrict,
 branch_id text not null references public.hpa_branches(id) on delete restrict,
 generation integer not null check(generation>0),
 guest_session_hash text not null check(guest_session_hash ~ '^[a-f0-9]{64}$'),
 idempotency_key uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 data jsonb not null check((jsonb_typeof(data)='object' and jsonb_typeof(data->'selections')='array'
   and jsonb_array_length(data->'selections') between 1 and 50 and jsonb_typeof(data->'items')='array'
   and jsonb_array_length(data->'items')=jsonb_array_length(data->'selections')
   and (data->>'total')::bigint between 1 and 4999999) is true),
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes',
 accepted_order_id uuid unique references public.hpa_orders(id) on delete restrict,
 acceptance_key uuid,
 acceptance_hash text check(acceptance_hash ~ '^[a-f0-9]{64}$'),
 decided_by uuid references auth.users(id) on delete restrict,
 decided_at timestamptz,
 unique(table_id,generation,guest_session_hash,idempotency_key),
 constraint hpa_table_request_decision check((
   (status='pending' and accepted_order_id is null and acceptance_key is null and acceptance_hash is null and decided_by is null and decided_at is null)
   or (status='accepted' and accepted_order_id is not null and acceptance_key is not null and acceptance_hash is not null and decided_by is not null and decided_at is not null)
   or (status='rejected' and accepted_order_id is null and acceptance_key is null and acceptance_hash is null and decided_by is not null and decided_at is not null)
 ) is true)
);
create index hpa_table_requests_queue_idx on public.hpa_table_requests(branch_id,status,created_at);
create index hpa_table_requests_guest_idx on public.hpa_table_requests(guest_session_hash,created_at desc);
create index hpa_table_requests_actor_idx on public.hpa_table_requests(decided_by) where decided_by is not null;
create unique index hpa_counter_source_request_unique on public.hpa_orders((data->'counter'->>'sourceRequestId'))
where data->'counter' ? 'sourceRequestId';

do $$ declare t text;
begin
 foreach t in array array['hpa_table_qr','hpa_table_requests'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('grant select,insert,update on public.%I to service_role',t);
   execute format('create policy server_only on public.%I for all to anon,authenticated using(false) with check(false)',t);
 end loop;
end $$;

create function public.hpa_manage_table_qr(p_actor_id uuid,p_action text,p_branch_id text default null,p_table_label text default null,p_table_id uuid default null,p_expected_version integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.hpa_table_qr; raw_token text;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 if p_action='create' then
   perform 1 from public.hpa_branches where id=p_branch_id for update;
   if not found then raise exception 'table_branch_not_found'; end if;
   if (select count(*) from public.hpa_table_qr where branch_id=p_branch_id)>=200 then raise exception 'table_limit_reached'; end if;
   if p_table_label is null or length(btrim(p_table_label)) not between 1 and 40 then raise exception 'table_invalid'; end if;
   raw_token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.hpa_table_qr(branch_id,table_label,token,token_hash,created_by)
   values(p_branch_id,btrim(p_table_label),raw_token,encode(extensions.digest(raw_token,'sha256'),'hex'),p_actor_id) returning * into t;
 elsif p_action in ('rotate','disable') then
   select * into t from public.hpa_table_qr where id=p_table_id for update;
   if not found then raise exception 'table_not_found'; end if;
   if t.version is distinct from p_expected_version then raise exception 'version_conflict'; end if;
   if p_action='rotate' then
     raw_token:=encode(extensions.gen_random_bytes(32),'hex');
     update public.hpa_table_qr set token=raw_token,token_hash=encode(extensions.digest(raw_token,'sha256'),'hex'),
       active=true,generation=generation+1,version=version+1,updated_at=now() where id=t.id returning * into t;
   elsif t.active then
     update public.hpa_table_qr set active=false,version=version+1,updated_at=now() where id=t.id returning * into t;
   end if;
 else raise exception 'table_invalid'; end if;
 return jsonb_build_object('id',t.id,'branchId',t.branch_id,'tableLabel',t.table_label,'active',t.active,'generation',t.generation,
   'version',t.version,'token',t.token,'createdAt',t.created_at,'updatedAt',t.updated_at);
end $$;
revoke all on function public.hpa_manage_table_qr(uuid,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.hpa_manage_table_qr(uuid,text,text,text,uuid,integer) to service_role;

create function public.hpa_table_request_document(p_request public.hpa_table_requests)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'id',p_request.id,'number','TBL-'||upper(left(replace(p_request.id::text,'-',''),8)),
   'branchId',p_request.branch_id,'tableLabel',t.table_label,'generation',p_request.generation,
   'status',case when p_request.status='pending' and (p_request.expires_at<=now() or not t.active or t.generation<>p_request.generation) then 'expired' else p_request.status end,
   'version',p_request.version,'createdAt',p_request.created_at,'expiresAt',p_request.expires_at,
   'items',p_request.data->'items','customerName',p_request.data->>'customerName','notes',p_request.data->>'notes',
   'subtotal',p_request.data->'subtotal','tax',p_request.data->'tax','total',p_request.data->'total',
   'acceptedOrderNumber',(select o.data->>'number' from public.hpa_orders o where o.id=p_request.accepted_order_id)
 ) from public.hpa_table_qr t where t.id=p_request.table_id;
$$;
revoke all on function public.hpa_table_request_document(public.hpa_table_requests) from public,anon,authenticated;
grant execute on function public.hpa_table_request_document(public.hpa_table_requests) to service_role;

create function public.hpa_get_table_request(p_request_id uuid,p_table_id uuid,p_generation integer,p_guest_hash text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.hpa_table_request_document(r) from public.hpa_table_requests r
 where r.id=p_request_id and r.table_id=p_table_id and r.generation=p_generation and r.guest_session_hash=p_guest_hash;
$$;
revoke all on function public.hpa_get_table_request(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.hpa_get_table_request(uuid,uuid,integer,text) to service_role;

create function public.hpa_create_table_request(p_token_hash text,p_guest_hash text,p_idempotency_key uuid,p_request_hash text,p_expected_revision bigint,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.hpa_table_qr; r public.hpa_table_requests; rev bigint; b public.hpa_branches;
begin
 select revision into rev from public.hpa_commerce_state where id=true for update;
 select * into t from public.hpa_table_qr where token_hash=p_token_hash and active=true for share;
 if not found then raise exception 'table_not_found'; end if;
 select * into r from public.hpa_table_requests where table_id=t.id and generation=t.generation and guest_session_hash=p_guest_hash and idempotency_key=p_idempotency_key;
 if found then
   if r.request_hash is distinct from p_request_hash then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('request',public.hpa_table_request_document(r),'replayed',true);
 end if;
 if rev is distinct from p_expected_revision then raise exception 'revision_conflict'; end if;
 select * into b from public.hpa_branches where id=t.branch_id;
 if b.data->'settings'->>'counterAcceptingOrders' is distinct from 'true' or b.data->'settings'->>'temporarilyClosed' is distinct from 'false' then raise exception 'counter_unavailable'; end if;
 if p_data->'tax'->'supplier' is distinct from b.data->'settings'->'billing'
   or p_data->>'tableLabel' is distinct from t.table_label or p_data->>'branchId' is distinct from t.branch_id then raise exception 'table_request_invalid'; end if;
 insert into public.hpa_table_requests(id,table_id,branch_id,generation,guest_session_hash,idempotency_key,request_hash,data)
 values(p_request_id,t.id,t.branch_id,t.generation,p_guest_hash,p_idempotency_key,p_request_hash,p_data) returning * into r;
 return jsonb_build_object('request',public.hpa_table_request_document(r),'replayed',false);
end $$;
revoke all on function public.hpa_create_table_request(text,text,uuid,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hpa_create_table_request(text,text,uuid,text,bigint,uuid,jsonb) to service_role;

create function public.hpa_list_table_requests(p_actor_id uuid,p_branch_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 if not exists(select 1 from public.hpa_branches where id=p_branch_id) then raise exception 'table_branch_not_found'; end if;
 select jsonb_build_object('requests',coalesce(jsonb_agg(q.doc order by q.created_at) filter(where q.ordinal<=200),'[]'::jsonb),'hasMore',count(*)>200)
 into result from (
   select public.hpa_table_request_document(r)||jsonb_build_object('selections',r.data->'selections') as doc,r.created_at,row_number() over(order by r.created_at,r.id) as ordinal
   from public.hpa_table_requests r join public.hpa_table_qr t on t.id=r.table_id
   where r.branch_id=p_branch_id and r.status='pending' and r.expires_at>now() and t.active and t.generation=r.generation
   order by r.created_at,r.id limit 201
 ) q;
 return result;
end $$;
revoke all on function public.hpa_list_table_requests(uuid,text) from public,anon,authenticated;
grant execute on function public.hpa_list_table_requests(uuid,text) to service_role;

create function public.hpa_decide_table_request(p_request_id uuid,p_expected_request_version integer,p_actor_id uuid,p_action text,p_order_data jsonb default null,p_idempotency_key uuid default null,p_request_hash text default null,p_expected_revision bigint default null,p_payment jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.hpa_table_requests; t public.hpa_table_qr; result jsonb; o public.hpa_orders;
begin
 perform public.hpa_require_counter_owner(p_actor_id);
 select * into r from public.hpa_table_requests where id=p_request_id for update;
 if not found then raise exception 'table_request_not_found'; end if;
 if r.status='accepted' and p_action='accept' then
   if r.acceptance_key is distinct from p_idempotency_key or r.acceptance_hash is distinct from p_request_hash then raise exception 'idempotency_conflict'; end if;
   select * into o from public.hpa_orders where id=r.accepted_order_id;
   return jsonb_build_object('order',o.data||jsonb_build_object('version',o.version),'replayed',true);
 end if;
 if r.version is distinct from p_expected_request_version then raise exception 'version_conflict'; end if;
 if r.status<>'pending' then raise exception 'table_request_decided'; end if;
 if p_action='reject' then
   update public.hpa_table_requests set status='rejected',version=version+1,decided_by=p_actor_id,decided_at=now() where id=r.id returning * into r;
   return jsonb_build_object('request',public.hpa_table_request_document(r));
 end if;
 if p_action<>'accept' then raise exception 'table_request_invalid'; end if;
 select * into t from public.hpa_table_qr where id=r.table_id for share;
 if not t.active or t.generation<>r.generation or r.expires_at<=now() then raise exception 'table_request_expired'; end if;
 if p_idempotency_key is null or p_request_hash is null or p_expected_revision is null
   or p_order_data->>'branchId' is distinct from r.branch_id
   or p_order_data->'counter'->>'tableLabel' is distinct from t.table_label
   or p_order_data->'counter'->>'entry' is distinct from 'table_qr'
   or p_order_data->'counter'->>'sourceRequestId' is distinct from r.id::text
   or p_order_data->'customer'->>'instructions' is distinct from coalesce(r.data->>'notes','')
   or jsonb_array_length(p_order_data->'items') is distinct from jsonb_array_length(r.data->'selections')
   or exists (
     select 1 from jsonb_array_elements(r.data->'selections') s
     where not exists(select 1 from jsonb_array_elements(p_order_data->'items') i
       where i->>'id'=s->>'id' and i->>'productId'=s->>'productId' and i->>'quantity'=s->>'quantity' and i->>'notes'=s->>'notes')
   ) then raise exception 'table_request_mismatch'; end if;
 result:=public.hpa_create_counter_order(p_order_data,p_actor_id,p_idempotency_key,p_request_hash,p_expected_revision,p_payment);
 update public.hpa_table_requests set status='accepted',version=version+1,accepted_order_id=(result->'order'->>'id')::uuid,
   acceptance_key=p_idempotency_key,acceptance_hash=p_request_hash,decided_by=p_actor_id,decided_at=now()
 where id=r.id;
 return result;
end $$;
revoke all on function public.hpa_decide_table_request(uuid,integer,uuid,text,jsonb,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.hpa_decide_table_request(uuid,integer,uuid,text,jsonb,uuid,text,bigint,jsonb) to service_role;
