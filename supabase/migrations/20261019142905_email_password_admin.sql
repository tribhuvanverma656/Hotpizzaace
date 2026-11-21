-- Supabase email confirmations must stay enabled (mailer_autoconfirm=false).
-- A password alone never grants access; the nominated owner must prove inbox ownership.
create or replace function hpa_private.claim_owner_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_claim uuid;
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
  update hpa_private.owner_invites set claimed_user_id = new.id
  where email = lower(new.email) and (claimed_user_id is null or claimed_user_id = new.id)
  returning claimed_user_id into v_claim;
  if v_claim = new.id then
    insert into public.hpa_admin_memberships(user_id, role) values (new.id, 'owner')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function hpa_private.claim_owner_invite() from public,anon,authenticated;

with claimed as (
  update hpa_private.owner_invites i set claimed_user_id=u.id
  from auth.users u
  where i.email=lower(u.email) and u.email_confirmed_at is not null
    and (i.claimed_user_id is null or i.claimed_user_id=u.id)
  returning i.claimed_user_id
)
insert into public.hpa_admin_memberships(user_id,role)
select claimed_user_id,'owner' from claimed on conflict(user_id) do nothing;
