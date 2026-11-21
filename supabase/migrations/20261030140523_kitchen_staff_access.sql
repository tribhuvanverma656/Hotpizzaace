-- Chef access is additive and disabled by default. No owner/customer membership changes.
create table public.hpa_kitchen_config (
  id boolean primary key default true check(id), enabled boolean not null default false
);
insert into public.hpa_kitchen_config(id,enabled) values(true,false);
create table public.hpa_kitchen_staff (
  id uuid primary key references auth.users(id) on delete restrict,
  username text not null unique check(username ~ '^[a-z][a-z0-9._-]{2,31}$'
    and username not in ('admin','administrator','owner','root','system','support','hotpizzaace','hotpizzaaceadmin')),
  display_name text not null check(length(btrim(display_name)) between 2 and 80),
  branch_id text not null references public.hpa_branches(id) on delete restrict,
  auth_alias text not null unique check(auth_alias ~ '^[a-f0-9]{32}@staff\.hotpizzaace\.com$'),
  enabled boolean not null default false,
  state text not null check(state in ('provisioning','ready','reset_pending','blocked')),
  authorization_version integer not null default 1 check(authorization_version>0),
  resume_enabled boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(not enabled or state='ready')
);
create index hpa_kitchen_staff_branch_idx on public.hpa_kitchen_staff(branch_id);
create table public.hpa_kitchen_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references public.hpa_kitchen_staff(id) on delete restrict,
  authorization_version integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '12 hours'), revoked_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '12 hours')
);
create index hpa_kitchen_sessions_staff_idx on public.hpa_kitchen_sessions(user_id);
create table public.hpa_kitchen_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  staff_id uuid not null references public.hpa_kitchen_staff(id) on delete restrict,
  action text not null, previous_record jsonb, next_record jsonb,
  order_id uuid references public.hpa_orders(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index hpa_kitchen_audit_staff_idx on public.hpa_kitchen_audit(staff_id,created_at);
create function public.hpa_kitchen_pause_sessions()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.enabled and not new.enabled then
    update public.hpa_kitchen_staff set authorization_version=authorization_version+1,updated_at=now();
    update public.hpa_kitchen_sessions set revoked_at=coalesce(revoked_at,now()) where revoked_at is null;
  end if;
  return new;
end $$;
create trigger hpa_kitchen_pause_sessions after update of enabled on public.hpa_kitchen_config
  for each row execute function public.hpa_kitchen_pause_sessions();
do $$ declare t text; begin
  foreach t in array array['hpa_kitchen_config','hpa_kitchen_staff','hpa_kitchen_sessions','hpa_kitchen_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to service_role',t);
    execute format('create policy kitchen_client_deny on public.%I for all to anon,authenticated using(false) with check(false)',t);
  end loop;
end $$;

-- service_role cannot read auth.users/auth.sessions. Expose only this boolean lookup
-- in a non-exposed schema, with no client EXECUTE or underlying Auth table grants.
-- Edge obtains the UUID/session pair from a server-verified Auth token, never a body actor.
create schema hpa_kitchen_private;
revoke all on schema hpa_kitchen_private from public,anon,authenticated;
grant usage on schema hpa_kitchen_private to service_role;
create function hpa_kitchen_private.live_identity(p_user_id uuid,p_session_id uuid,p_alias text)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session_id and s.user_id=p_user_id and u.email=p_alias
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
      and (s.not_after is null or s.not_after>now()) for key share of s);
$$;
revoke all on function hpa_kitchen_private.live_identity(uuid,uuid,text) from public,anon,authenticated;
grant execute on function hpa_kitchen_private.live_identity(uuid,uuid,text) to service_role;

create function public.hpa_kitchen_require_enabled()
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.hpa_kitchen_config where id=true and enabled for share;
  if not found then raise exception 'kitchen_disabled'; end if;
end $$;
create function public.hpa_kitchen_require_owner(p_actor_id uuid,p_actor_session_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform public.hpa_kitchen_require_enabled();
  perform 1 from public.hpa_admin_memberships where user_id=p_actor_id and role='owner' for share;
  if not found or not hpa_kitchen_private.live_identity(p_actor_id,p_actor_session_id,'hotpizzaace@gmail.com')
    then raise exception 'kitchen_owner_required'; end if;
end $$;
create function public.hpa_kitchen_staff_document(p_staff public.hpa_kitchen_staff)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_staff.id,'username',p_staff.username,'displayName',p_staff.display_name,
    'branchId',p_staff.branch_id,'branchName',b.data->>'name','enabled',p_staff.enabled,'state',p_staff.state,
    'version',p_staff.authorization_version,'createdAt',p_staff.created_at,'lastSignInAt',p_staff.last_sign_in_at)
  from public.hpa_branches b where b.id=p_staff.branch_id;
$$;
create function public.hpa_kitchen_profile(p_staff public.hpa_kitchen_staff,p_expires timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_staff.id,'username',p_staff.username,'displayName',p_staff.display_name,
    'branchId',p_staff.branch_id,'branchName',b.data->>'name','version',p_staff.authorization_version,
    'environment',c.mode,'expiresAt',p_expires)
  from public.hpa_branches b cross join public.hpa_commerce_state c where b.id=p_staff.branch_id and c.id=true;
$$;
create function public.hpa_kitchen_lookup(p_username text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hpa_kitchen_staff;
begin
  perform public.hpa_kitchen_require_enabled();
  select * into s from public.hpa_kitchen_staff where username=p_username and enabled and state='ready';
  if not found then return null; end if;
  return jsonb_build_object('id',s.id,'authAlias',s.auth_alias,'version',s.authorization_version);
end $$;
create function public.hpa_kitchen_register(p_user_id uuid,p_session_id uuid,p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hpa_kitchen_staff; ks public.hpa_kitchen_sessions;
begin
  perform public.hpa_kitchen_require_enabled();
  select * into s from public.hpa_kitchen_staff where id=p_user_id for update;
  if not found or not s.enabled or s.state<>'ready' or s.authorization_version is distinct from p_expected_version
    or not hpa_kitchen_private.live_identity(p_user_id,p_session_id,s.auth_alias)
    then raise exception 'kitchen_auth_required'; end if;
  -- Only a password login in the trusted Edge flow calls this service-only RPC.
  insert into public.hpa_kitchen_sessions(session_id,user_id,authorization_version)
    values(p_session_id,p_user_id,s.authorization_version) returning * into ks;
  update public.hpa_kitchen_staff set last_sign_in_at=now() where id=s.id returning * into s;
  return public.hpa_kitchen_profile(s,ks.expires_at);
end $$;
create function public.hpa_kitchen_session(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hpa_kitchen_staff; ks public.hpa_kitchen_sessions;
begin
  perform public.hpa_kitchen_require_enabled();
  -- Every operation locks the membership before its session/order. Disable/reassign
  -- and transition serialize on this row; a stale request cannot commit afterward.
  select * into s from public.hpa_kitchen_staff where id=p_user_id for share;
  if not found or not s.enabled or s.state<>'ready' then raise exception 'kitchen_auth_required'; end if;
  -- Lock the Auth parent before its registration child, matching Auth sign-out's
  -- FK cascade order. A concurrent sign-out cannot commit between check/update.
  if not hpa_kitchen_private.live_identity(p_user_id,p_session_id,s.auth_alias)
    then raise exception 'kitchen_session_revoked'; end if;
  select * into ks from public.hpa_kitchen_sessions where session_id=p_session_id and user_id=p_user_id for share;
  if not found or ks.revoked_at is not null or ks.expires_at<=clock_timestamp()
    or ks.authorization_version<>s.authorization_version
    then raise exception 'kitchen_session_revoked'; end if;
  return public.hpa_kitchen_profile(s,ks.expires_at);
end $$;
create function public.hpa_kitchen_logout(p_user_id uuid,p_session_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  -- Logout is allowed even if the deployment/account has since been disabled.
  perform 1 from public.hpa_kitchen_staff where id=p_user_id for update;
  update public.hpa_kitchen_sessions set revoked_at=coalesce(revoked_at,now())
    where user_id=p_user_id and session_id=p_session_id;
end $$;
create function public.hpa_kitchen_staff_list(p_actor_id uuid,p_actor_session_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.hpa_kitchen_require_owner(p_actor_id,p_actor_session_id);
  return jsonb_build_object(
    'staff',(select coalesce(jsonb_agg(public.hpa_kitchen_staff_document(s) order by s.username),'[]'::jsonb) from public.hpa_kitchen_staff s),
    'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.data->>'name') order by b.id),'[]'::jsonb) from public.hpa_branches b));
end $$;
create function public.hpa_kitchen_staff_begin(
  p_actor_id uuid,p_actor_session_id uuid,p_staff_id uuid,p_expected_version integer,p_action text,p_data jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hpa_kitchen_staff; before_document jsonb; next_document jsonb;
begin
  perform public.hpa_kitchen_require_owner(p_actor_id,p_actor_session_id);
  if p_staff_id is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or exists(select 1 from public.hpa_admin_memberships where user_id=p_staff_id)
    then raise exception 'kitchen_invalid_staff'; end if;
  if p_action='create' then
    if p_expected_version is not null or p_data->>'authAlias' is distinct from replace(p_staff_id::text,'-','')||'@staff.hotpizzaace.com'
      then raise exception 'kitchen_invalid_staff'; end if;
    insert into public.hpa_kitchen_staff(id,username,display_name,branch_id,auth_alias,state,resume_enabled)
      values(p_staff_id,p_data->>'username',p_data->>'displayName',p_data->>'branchId',p_data->>'authAlias','provisioning',true) returning * into s;
  else
    select * into s from public.hpa_kitchen_staff where id=p_staff_id for update;
    if not found then raise exception 'kitchen_staff_not_found'; end if;
    if s.authorization_version is distinct from p_expected_version then raise exception 'kitchen_version_conflict'; end if;
    before_document:=public.hpa_kitchen_staff_document(s);
    -- An interrupted Edge request must not strand an account forever. Recovery is
    -- a fresh owner-reauthenticated reset after the prior worker's maximum lifetime.
    if s.state in ('provisioning','reset_pending') and not
      (p_action='reset-password' and s.updated_at<clock_timestamp()-interval '15 minutes')
      then raise exception 'kitchen_operation_pending'; end if;
    if p_action='update' then
      if not p_data ?& array['username','displayName','branchId'] then raise exception 'kitchen_invalid_staff'; end if;
      update public.hpa_kitchen_staff set username=p_data->>'username',display_name=p_data->>'displayName',branch_id=p_data->>'branchId',
        authorization_version=authorization_version+1,updated_at=now() where id=s.id returning * into s;
    elsif p_action='disable' then
      update public.hpa_kitchen_staff set enabled=false,resume_enabled=false,authorization_version=authorization_version+1,updated_at=now() where id=s.id returning * into s;
    elsif p_action='enable' then
      if s.state<>'ready' then raise exception 'kitchen_state_requires_reset'; end if;
      update public.hpa_kitchen_staff set enabled=true,authorization_version=authorization_version+1,updated_at=now() where id=s.id returning * into s;
    elsif p_action='reset-password' then
      update public.hpa_kitchen_staff set enabled=false,resume_enabled=case when state in ('blocked','provisioning','reset_pending') then resume_enabled else enabled end,state='reset_pending',
        authorization_version=authorization_version+1,updated_at=now() where id=s.id returning * into s;
    else raise exception 'kitchen_invalid_action'; end if;
    update public.hpa_kitchen_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=s.id and revoked_at is null;
  end if;
  next_document:=public.hpa_kitchen_staff_document(s);
  insert into public.hpa_kitchen_audit(actor_id,staff_id,action,previous_record,next_record)
    values(p_actor_id,s.id,p_action,before_document,next_document);
  return next_document;
end $$;
create function public.hpa_kitchen_staff_finish(p_actor_id uuid,p_actor_session_id uuid,p_staff_id uuid,p_expected_version integer,p_success boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.hpa_kitchen_staff; previous_document jsonb;
begin
  -- Finalize an in-flight credential operation even if the global feature was
  -- paused after begin; the global gate still prevents all staff sign-ins/use.
  perform 1 from public.hpa_admin_memberships where user_id=p_actor_id and role='owner' for share;
  if not found or not hpa_kitchen_private.live_identity(p_actor_id,p_actor_session_id,'hotpizzaace@gmail.com')
    then raise exception 'kitchen_owner_required'; end if;
  select * into s from public.hpa_kitchen_staff where id=p_staff_id for update;
  if not found or s.authorization_version is distinct from p_expected_version then raise exception 'kitchen_version_conflict'; end if;
  if s.state not in ('provisioning','reset_pending') or p_success is null then raise exception 'kitchen_state_invalid'; end if;
  previous_document:=public.hpa_kitchen_staff_document(s);
  update public.hpa_kitchen_staff set enabled=(p_success and resume_enabled),state=case when p_success then 'ready' else 'blocked' end,
    authorization_version=authorization_version+1,updated_at=now() where id=s.id returning * into s;
  insert into public.hpa_kitchen_audit(actor_id,staff_id,action,previous_record,next_record)
    values(p_actor_id,s.id,case when p_success then 'credential_ready' else 'credential_failed' end,previous_document,public.hpa_kitchen_staff_document(s));
  return public.hpa_kitchen_staff_document(s);
end $$;

create function public.hpa_kitchen_order_eligible(p_data jsonb)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((
    p_data->>'status' in ('confirmed','preparing') and not p_data ? 'testVoid'
    and not coalesce((p_data->>'paymentReviewRequired')::boolean,false)
    and not coalesce((p_data->>'refundSyncPending')::boolean,false)
    and coalesce((p_data->'refund'->>'amount')::bigint,0)=0
    and case when p_data->>'channel'='counter' then
      (p_data->>'paymentMode'='counter_manual' and (
        (p_data->>'paymentStatus'='paid' and p_data->'settlement'->>'source'='staff'
          and (p_data->'settlement'->>'amount')::bigint=(p_data->>'total')::bigint)
        or (p_data->>'paymentStatus'='pending' and p_data->'counter'->>'payLater'='true'
          and length(btrim(coalesce(p_data->'counter'->>'payLaterReason','')))>=3)))
    else p_data->>'paymentMethod'='cash'
      or (p_data->>'paymentStatus'='paid' and p_data->>'paymentMode'=(select case mode when 'development' then 'razorpay_test' else 'razorpay_live' end from public.hpa_commerce_state where id=true))
      or (p_data->>'paymentStatus'='simulated_paid' and p_data->>'paymentMode'='simulation'
        and exists(select 1 from public.hpa_commerce_state where id=true and mode='development' and allow_simulated_payments)) end
  ),false);
$$;
create function public.hpa_kitchen_queue(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare profile jsonb; orders jsonb; total integer;
begin
  profile:=public.hpa_kitchen_session(p_user_id,p_session_id);
  select coalesce(jsonb_agg(x.data||jsonb_build_object('version',x.version) order by x.created_at,x.id),'[]'::jsonb),count(*)
    into orders,total from (select o.* from public.hpa_orders o where branch_id=profile->>'branchId'
      and status in ('confirmed','preparing') and public.hpa_kitchen_order_eligible(data)
      order by created_at,id limit 501) x;
  return jsonb_build_object('profile',profile,'orders',orders,'complete',total<=500);
end $$;
create function public.hpa_kitchen_transition(p_user_id uuid,p_session_id uuid,p_order_id uuid,p_expected_version integer,p_status text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare profile jsonb; o public.hpa_orders; previous_status text;
begin
  -- Lock order: config -> staff -> kitchen session -> order (same staff order as management).
  perform public.hpa_kitchen_require_enabled();
  perform 1 from public.hpa_kitchen_staff where id=p_user_id for update;
  profile:=public.hpa_kitchen_session(p_user_id,p_session_id);
  select * into o from public.hpa_orders where id=p_order_id and branch_id=profile->>'branchId' for update;
  if not found then raise exception 'kitchen_order_not_found'; end if;
  if o.version is distinct from p_expected_version then raise exception 'kitchen_version_conflict'; end if;
  if not public.hpa_kitchen_order_eligible(o.data) then raise exception 'kitchen_order_not_eligible'; end if;
  if not ((o.status='confirmed' and p_status='preparing') or (o.status='preparing' and p_status='ready'))
    then raise exception 'kitchen_transition_invalid'; end if;
  previous_status:=o.status;
  update public.hpa_orders set data=jsonb_set(data,'{status}',to_jsonb(p_status)),version=version+1 where id=o.id returning * into o;
  insert into public.hpa_order_events(order_id,actor_id,kind,previous_status,next_status,previous_payment_status,next_payment_status,order_version)
    values(o.id,p_user_id,'kitchen_status',previous_status,o.status,o.data->>'paymentStatus',o.data->>'paymentStatus',o.version);
  insert into public.hpa_kitchen_audit(actor_id,staff_id,action,order_id,previous_record,next_record)
    values(p_user_id,p_user_id,'preparation_transition',o.id,
      jsonb_build_object('status',previous_status),
      jsonb_build_object('status',o.status,'orderVersion',o.version,'branchId',o.branch_id,'username',profile->>'username','displayName',profile->>'displayName'));
  return jsonb_build_object('profile',profile,'order',o.data||jsonb_build_object('version',o.version));
end $$;

-- No browser role can execute even helpers. Only the verified Edge boundary has service credentials.
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname like 'hpa_kitchen_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
