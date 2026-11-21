-- Payment ledgers and invoice sequence allocation are server-only. Explicit deny
-- policies document the same default-deny boundary as RLS with no policies.
-- Table/RPC grants stay revoked from browser roles; service_role uses the verified Edge handlers.
create policy payment_attempts_client_deny on public.hpa_payment_attempts
  for all to anon, authenticated using (false) with check (false);
create policy payment_records_client_deny on public.hpa_payment_records
  for all to anon, authenticated using (false) with check (false);
create policy payment_events_client_deny on public.hpa_payment_webhook_events
  for all to anon, authenticated using (false) with check (false);
create policy invoice_counters_client_deny on public.hpa_invoice_counters
  for all to anon, authenticated using (false) with check (false);
