-- Non-sensitive connection probe. No customer/catalog/order data is exposed.
create function public.hpa_healthcheck()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true $$;

revoke all on function public.hpa_healthcheck() from public;
grant execute on function public.hpa_healthcheck() to anon, authenticated, service_role;
comment on function public.hpa_healthcheck() is
  'Infrastructure readiness only; does not imply application data migration is complete.';
