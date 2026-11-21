-- Daily customer references are independent of internal UUIDs and tax-invoice numbers.
-- Development and production use separate databases. A single counter per database
-- spans all branches/channels and remains safe if its configured mode ever changes.
create table public.hpa_order_number_counters (
 business_date date primary key,
 last_value bigint not null check(last_value>0)
);
alter table public.hpa_order_number_counters enable row level security;
create policy order_number_counters_client_deny on public.hpa_order_number_counters
for all to anon,authenticated using(false) with check(false);
revoke all on public.hpa_order_number_counters from public,anon,authenticated,service_role;
grant select,insert,update on public.hpa_order_number_counters to service_role;

-- UPSERT locks the one daily row: simultaneous branches cannot read the same number.
-- Transaction rollback also rolls back allocation. Padding must never truncate 10000+.
create function public.hpa_next_order_number(p_issued_at timestamptz)
returns text language plpgsql volatile security invoker set search_path='' as $$
declare day date; sequence_value bigint;
begin
 if p_issued_at is null or not isfinite(p_issued_at) then raise exception 'order_number_clock_invalid'; end if;
 day:=(p_issued_at at time zone 'Asia/Kolkata')::date;
 insert into public.hpa_order_number_counters(business_date,last_value) values(day,1)
 on conflict(business_date) do update
   set last_value=hpa_order_number_counters.last_value+1
 returning last_value into sequence_value;
 return 'HPA-'||to_char(day,'DDMMYY')||'-'||lpad(sequence_value::text,greatest(4,length(sequence_value::text)),'0');
end $$;
revoke all on function public.hpa_next_order_number(timestamptz) from public,anon,authenticated;
grant execute on function public.hpa_next_order_number(timestamptz) to service_role;

create function public.hpa_assign_order_number()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.data:=jsonb_set(new.data,'{number}',to_jsonb(public.hpa_next_order_number(clock_timestamp())));
 return new;
end $$;
revoke all on function public.hpa_assign_order_number() from public,anon,authenticated,service_role;
create trigger hpa_assign_order_number before insert on public.hpa_orders
for each row execute function public.hpa_assign_order_number();

-- Existing rows and invoice documents are not rewritten. All create RPCs already use
-- INSERT ... RETURNING * (and counter creation rereads after invoice assignment), so
-- their responses expose the saved reference. Idempotent replays return before INSERT
-- and therefore reuse the original reference without allocating another sequence.
