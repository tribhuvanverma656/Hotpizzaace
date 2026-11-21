-- Explicit deny policy and covering FK index for the private one-time owner invitation.
create policy no_client_access on hpa_private.owner_invites
for all to anon, authenticated using (false) with check (false);
create index hpa_owner_invite_claimed_idx on hpa_private.owner_invites(claimed_user_id)
where claimed_user_id is not null;

-- PostgreSQL CHECK accepts NULL. Require each existing document check to be true.
do $$
declare c record;
begin
  for c in
    select conrelid::regclass as relation, conname, pg_get_expr(conbin, conrelid) as expression
    from pg_constraint
    where conrelid in ('public.hpa_orders'::regclass, 'public.hpa_products'::regclass,
      'public.hpa_categories'::regclass, 'public.hpa_branches'::regclass)
      and contype = 'c' and pg_get_expr(conbin, conrelid) like '%jsonb_typeof%'
  loop
    execute format('alter table %s drop constraint %I, add constraint %I check ((%s) is true)',
      c.relation, c.conname, c.conname, c.expression);
  end loop;
end $$;
