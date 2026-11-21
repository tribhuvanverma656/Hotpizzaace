-- Run against isolated staging after creating one online QR order.
-- All fixture writes are temporary and rolled back.
begin;
create temporary table hpa_qa_order_documents (like public.hpa_orders including all) on commit drop;
alter table hpa_qa_order_documents alter column tracking_token_hash set default repeat('a',64);
alter table hpa_qa_order_documents alter column idempotency_scope set default 'qa-rollback';
alter table hpa_qa_order_documents alter column idempotency_key set default gen_random_uuid()::text;
alter table hpa_qa_order_documents alter column request_hash set default repeat('b',64);
do $$
declare baseline jsonb; candidate jsonb; test_id uuid; rejected boolean; checked integer:=0;
begin
 select data into strict baseline from public.hpa_orders where data->>'channel'='website' and data->>'fulfillment'='dine_in' limit 1;
 test_id:=gen_random_uuid();
 insert into hpa_qa_order_documents(id,data) values(test_id,jsonb_set(baseline,'{id}',to_jsonb(test_id::text)));
 for candidate in select payload from (values
   (baseline-'qr'),
   (jsonb_set(baseline,'{paymentMethod}','"cash"')),
   (jsonb_set(baseline,'{paymentMode}','"simulation"')),
   (jsonb_set(baseline,'{qr,generation}','0')),
   (jsonb_set(baseline,'{qr,tableId}','"invalid"')),
   (jsonb_set(baseline,'{status}','"out_for_delivery"')),
   (jsonb_set(baseline,'{status}','"closed"'))
 ) cases(payload) loop
   test_id:=gen_random_uuid(); rejected:=false;
   begin
     insert into hpa_qa_order_documents(id,data) values(test_id,jsonb_set(candidate,'{id}',to_jsonb(test_id::text)));
   exception when check_violation then rejected:=true;
   end;
   if not rejected then raise exception 'Invalid online QR document accepted'; end if;
   checked:=checked+1;
 end loop;
 raise notice 'QR document checks passed: valid gateway order accepted; % malformed or unauthorized states rejected.',checked;
end $$;
rollback;
