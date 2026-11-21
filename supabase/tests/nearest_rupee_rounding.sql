-- Pure helper checks plus fictional projection fixtures. Run after the nearest-
-- rupee migration inside this BEGIN/ROLLBACK. No gateway calls or real payments.
begin isolation level repeatable read;
do $nearest_rounding$
declare
 profile jsonb; legacy jsonb; rounded jsonb; inclusive jsonb; altered jsonb; bad jsonb;
 mode text; paise integer; expected_total integer; expected_adjustment integer;
 saved_document_digest text; old_document_digest text; old_invoice_digest text;
 actor uuid; source_branch public.hpa_branches; fixture_branch text:='qa-rounding-'||gen_random_uuid()::text;
 qr public.hpa_table_qr; raw_token text; request_id uuid:=gen_random_uuid(); order_id uuid:=gen_random_uuid();
 request_data jsonb; order_data jsonb; result jsonb; report jsonb;
 from_time timestamptz:='2095-01-01T18:30:00Z'; to_time timestamptz:='2095-01-02T18:30:00Z';
begin
 -- Capture all existing financial documents before any fictional write.
 select md5(coalesce(string_agg(data::text,'|' order by id),'')),
   md5(coalesce(string_agg((data->'invoice')::text,'|' order by id),''))
 into old_document_digest,old_invoice_digest from public.hpa_orders;
 profile:='{"businessName":"QA ONLY","address":"QA address","gstin":"09ANCPV1491R1Z3","fssaiNumber":"12721045000614","stateName":"Uttar Pradesh","stateCode":"09","sac":"996331","cgstRate":2.5,"sgstRate":2.5}';
 legacy:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('unitPrice',21900,'quantity',1)),
   'subtotal',21900,'deliveryFee',0,'discount',0,'total',22996,
   'tax',jsonb_build_object('supplier',profile,'taxableValue',21900,'cgst',548,'sgst',548,'total',1096));
 if not public.hpa_order_tax_valid(legacy) then raise exception 'historical exact-paise bill rejected'; end if;
 if not public.hpa_order_tax_valid(legacy||'{"total":22900,"roundOff":-96}'::jsonb) then
   raise exception 'historical customer-favour floor bill rejected'; end if;
 rounded:=legacy||'{"total":23000,"roundOff":4,"roundOffPolicy":"nearest_rupee"}'::jsonb;
 foreach mode in array array['dine_in','delivery','pickup'] loop
   if not public.hpa_order_tax_valid(rounded||jsonb_build_object('fulfillment',mode)) then
     raise exception 'nearest GST bill rejected for %',mode; end if;
   -- Exhaust every fractional boundary, including +50 at the half-rupee tie.
   for paise in 0..99 loop
     expected_total:=case when paise<50 then 22000 else 22100 end;
     expected_adjustment:=expected_total-(22000+paise);
     altered:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('unitPrice',22000+paise,'quantity',1)),
       'subtotal',22000+paise,'deliveryFee',0,'discount',0,'total',expected_total,
       'roundOff',expected_adjustment,'roundOffPolicy','nearest_rupee','fulfillment',mode);
     if not public.hpa_order_tax_valid(altered) then raise exception 'nearest paise boundary rejected: % %',mode,paise; end if;
     if public.hpa_order_tax_valid(altered||jsonb_build_object('roundOff',expected_adjustment+1)) then
       raise exception 'off-by-one adjustment accepted: %',paise; end if;
     if public.hpa_order_tax_valid(altered||jsonb_build_object('total',expected_total+1)) then
       raise exception 'off-by-one payable accepted: %',paise; end if;
   end loop;
 end loop;
 for bad in select value from jsonb_array_elements('[3,5,-96,100,4.5,"4",null,true]'::jsonb) loop
   if public.hpa_order_tax_valid(jsonb_set(rounded,'{roundOff}',bad)) then
     raise exception 'invalid adjustment accepted: %',bad; end if;
 end loop;
 for bad in select value from jsonb_array_elements('["floor_rupee","NEAREST_RUPEE","",null,1,{},[]]'::jsonb) loop
   if public.hpa_order_tax_valid(jsonb_set(rounded,'{roundOffPolicy}',bad)) then
     raise exception 'invalid rounding policy accepted: %',bad; end if;
 end loop;
 if public.hpa_order_tax_valid(rounded-'roundOff') then raise exception 'policy without adjustment accepted'; end if;
 if public.hpa_order_tax_valid(rounded-'roundOffPolicy') then raise exception 'new upward bill disguised as legacy floor'; end if;
 if public.hpa_order_tax_valid(jsonb_set(rounded,'{tax,cgst}','547')) then raise exception 'GST changed to absorb rounding'; end if;
 if public.hpa_order_tax_valid(jsonb_set(rounded,'{subtotal}','"21900"')) then raise exception 'string subtotal accepted'; end if;
 if public.hpa_order_tax_valid(jsonb_set(rounded,'{tax,total}','"1096"')) then raise exception 'string tax accepted'; end if;
 if public.hpa_order_tax_valid(jsonb_set(rounded,'{tax,cgst}','"548"')) then raise exception 'string CGST accepted'; end if;
 if public.hpa_order_round_off_valid('{"subtotal":49,"deliveryFee":0,"discount":0,"total":0,"roundOff":-49,"roundOffPolicy":"nearest_rupee"}') then
   raise exception 'zero payable accepted'; end if;
 if not public.hpa_order_round_off_valid('{"subtotal":50,"deliveryFee":0,"discount":0,"total":100,"roundOff":50,"roundOffPolicy":"nearest_rupee"}') then
   raise exception 'half-rupee minimum payable rejected'; end if;

 inclusive:=jsonb_build_object('subtotal',2050,'deliveryFee',0,'discount',0,'total',2000,'roundOff',-50,'roundOffPolicy','nearest_rupee',
   'items',jsonb_build_array(jsonb_build_object('unitPrice',2050,'quantity',1,'gstInclusive','{"rateBps":500,"code":"2201"}'::jsonb)),
   'tax',jsonb_build_object('supplier',profile,'version',2,'includedTotal',98,'taxableValue',1952,'cgst',49,'sgst',49,'total',98,
     'groups','[{"pricing":"inclusive","rateBps":500,"code":"2201","grossValue":2050,"deliveryFee":0,"discount":0,"taxableValue":1952,"cgst":49,"sgst":49,"total":98}]'::jsonb));
 if not public.hpa_order_tax_valid(inclusive) then raise exception 'MRP ceiling exception rejected'; end if;
 if public.hpa_order_tax_valid(inclusive||'{"total":2100,"roundOff":50}'::jsonb) then raise exception 'MRP-only bill rounded above printed price'; end if;
 if not public.hpa_order_tax_valid(inclusive-'roundOffPolicy') then raise exception 'historical floor MRP bill rejected'; end if;

 -- The protective cap may subtract up to 99 paise, so do not validate only the
 -- ordinary nearest-rounding range of -49 through +50.
 altered:=inclusive||'{"subtotal":2099,"total":2000,"roundOff":-99}'::jsonb;
 altered:=jsonb_set(altered,'{items,0,unitPrice}','2099');
 altered:=jsonb_set(altered,'{tax}',jsonb_build_object('supplier',profile,'version',2,'includedTotal',100,'taxableValue',1999,'cgst',50,'sgst',50,'total',100,
   'groups','[{"pricing":"inclusive","rateBps":500,"code":"2201","grossValue":2099,"deliveryFee":0,"discount":0,"taxableValue":1999,"cgst":50,"sgst":50,"total":100}]'::jsonb));
 if not public.hpa_order_tax_valid(altered) then raise exception 'MRP 99-paise ceiling adjustment rejected'; end if;

 -- A discount can round up if the final payable remains within the original MRP.
 altered:=inclusive||'{"discount":70,"total":2000,"roundOff":20}'::jsonb;
 altered:=jsonb_set(altered,'{tax}',jsonb_build_object('supplier',profile,'version',2,'includedTotal',94,'taxableValue',1886,'cgst',47,'sgst',47,'total',94,
   'groups','[{"pricing":"inclusive","rateBps":500,"code":"2201","grossValue":2050,"deliveryFee":0,"discount":70,"taxableValue":1886,"cgst":47,"sgst":47,"total":94}]'::jsonb));
 if not public.hpa_order_tax_valid(altered) then raise exception 'discounted MRP nearest rounding rejected'; end if;
 -- A delivery fee creates a separate exclusive service; the MRP-only cap no longer applies.
 altered:=inclusive||'{"deliveryFee":100,"total":2200,"roundOff":44}'::jsonb;
 altered:=jsonb_set(altered,'{tax}',jsonb_build_object('supplier',profile,'version',2,'includedTotal',98,'taxableValue',2052,'cgst',52,'sgst',52,'total',104,
   'groups','[{"pricing":"exclusive","rateBps":500,"code":"996331","grossValue":0,"deliveryFee":100,"discount":0,"taxableValue":100,"cgst":3,"sgst":3,"total":6},{"pricing":"inclusive","rateBps":500,"code":"2201","grossValue":2050,"deliveryFee":0,"discount":0,"taxableValue":1952,"cgst":49,"sgst":49,"total":98}]'::jsonb));
 if not public.hpa_order_tax_valid(altered) then raise exception 'MRP delivery nearest rounding rejected'; end if;
 -- Mixed food/MRP uses normal nearest rounding, including an exact .50 upward tie.
 altered:=inclusive||'{"subtotal":12050,"total":12600,"roundOff":50}'::jsonb;
 altered:=jsonb_set(altered,'{items}',(inclusive->'items')||jsonb_build_array(jsonb_build_object('unitPrice',10000,'quantity',1)));
 altered:=jsonb_set(altered,'{tax}',jsonb_build_object('supplier',profile,'version',2,'includedTotal',98,'taxableValue',11952,'cgst',299,'sgst',299,'total',598,
   'groups','[{"pricing":"exclusive","rateBps":500,"code":"996331","grossValue":10000,"deliveryFee":0,"discount":0,"taxableValue":10000,"cgst":250,"sgst":250,"total":500},{"pricing":"inclusive","rateBps":500,"code":"2201","grossValue":2050,"deliveryFee":0,"discount":0,"taxableValue":1952,"cgst":49,"sgst":49,"total":98}]'::jsonb));
 if not public.hpa_order_tax_valid(altered) then raise exception 'mixed food/MRP rounding rejected'; end if;
 if public.hpa_order_tax_valid(jsonb_set(inclusive,'{items,0,gstInclusive}','null')) then raise exception 'malformed MRP classification accepted'; end if;
 if public.hpa_order_tax_valid(jsonb_set(inclusive,'{tax,groups}','[]')) then raise exception 'missing MRP groups accepted'; end if;

 -- A new policy must survive both the customer QR and the owner report boundary.
 select * into source_branch from public.hpa_branches where data->'settings' ? 'billing' order by id limit 1;
 select user_id into actor from public.hpa_admin_memberships where role='owner' limit 1;
 if source_branch.id is null or actor is null then raise exception 'rounding_projection_fixture_missing'; end if;
 insert into public.hpa_branches(id,slug,data) values(fixture_branch,fixture_branch,
   source_branch.data||jsonb_build_object('id',fixture_branch,'slug',fixture_branch,'name','QA rounding rollback only'));
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.hpa_table_qr(branch_id,table_label,ordering_scope,token,token_hash,created_by)
 values(fixture_branch,'QA rounding only','branch',raw_token,encode(extensions.digest(raw_token,'sha256'),'hex'),actor) returning * into qr;
 request_data:=rounded||jsonb_build_object('branchId',fixture_branch,'tableLabel',qr.table_label,'customerName','QA rollback only','customerPhone','9876543210','notes','',
   'selections',jsonb_build_array(jsonb_build_object('productId','qa-only','quantity',1,'toppingIds','[]'::jsonb,'notes','')));
 insert into public.hpa_table_requests(id,table_id,branch_id,generation,guest_session_hash,idempotency_key,request_hash,data)
 values(request_id,qr.id,fixture_branch,qr.generation,repeat('a',64),gen_random_uuid(),repeat('b',64),request_data);
 select public.hpa_table_request_document(r) into result from public.hpa_table_requests r where id=request_id;
 if result->>'roundOffPolicy' is distinct from 'nearest_rupee' or result->'roundOff' is distinct from '4'::jsonb or result->'total' is distinct from '23000'::jsonb then
   raise exception 'QR projection lost policy or amounts'; end if;
 begin
   update public.hpa_table_requests set data=data-'roundOff' where id=request_id;
   raise exception 'QR marker-only document bypassed check';
 exception when check_violation then null; end;
 begin
   update public.hpa_table_requests set data=jsonb_set(data,'{roundOffPolicy}','null') where id=request_id;
   raise exception 'QR malformed policy bypassed check';
 exception when check_violation then null; end;

 order_data:=rounded||jsonb_build_object('id',order_id,'number','QA-ROUNDING-'||order_id,'createdAt',from_time,
   'branchId',fixture_branch,'customer',jsonb_build_object('name','QA rollback only','phone','9876543210'),
   'fulfillment','pickup','paymentMethod','cash','paymentStatus','pending','status','pending');
 insert into public.hpa_orders(id,guest_session_hash,tracking_token_hash,idempotency_scope,idempotency_key,request_hash,data,created_at)
 values(order_id,repeat('a',64),repeat('b',64),'qa-rounding',order_id::text,repeat('c',64),order_data,from_time);
 select md5(data::text) into saved_document_digest from public.hpa_orders where id=order_id;
 execute 'set local role service_role';
 report:=public.hpa_sales_report_snapshot(actor,fixture_branch,from_time,to_time);
 execute 'reset role';
 select value into result from jsonb_array_elements(report->'orders') where value->>'id'=order_id::text;
 if result is null or result->>'roundOffPolicy' is distinct from 'nearest_rupee' or result->'roundOff' is distinct from '4'::jsonb or result->'total' is distinct from '23000'::jsonb then
   raise exception 'sales projection lost policy or amounts'; end if;
 if result ?| array['items','customer'] then raise exception 'sales projection exposed private details'; end if;
 if (select md5(data::text) from public.hpa_orders where id=order_id) is distinct from saved_document_digest then
   raise exception 'report mutated saved bill'; end if;
 if (select md5(coalesce(string_agg(data::text,'|' order by id),'')) from public.hpa_orders where id<>order_id) is distinct from old_document_digest
   or (select md5(coalesce(string_agg((data->'invoice')::text,'|' order by id),'')) from public.hpa_orders where id<>order_id) is distinct from old_invoice_digest then
   raise exception 'historical financial documents changed'; end if;
 if has_function_privilege('anon','public.hpa_order_round_off_valid(jsonb)','EXECUTE')
   or has_function_privilege('authenticated','public.hpa_order_round_off_valid(jsonb)','EXECUTE')
   or has_function_privilege('anon','public.hpa_order_tax_valid(jsonb)','EXECUTE')
   or has_function_privilege('authenticated','public.hpa_table_request_document(public.hpa_table_requests)','EXECUTE')
   or has_function_privilege('authenticated','public.hpa_sales_report_snapshot(uuid,text,timestamptz,timestamptz)','EXECUTE') then
   raise exception 'rounding helper or private projection exposed to client'; end if;
end $nearest_rounding$;
select 'Nearest boundaries, legacy bills, GST/MRP cap, QR/report projections, private grants and immutable history passed; rolling back' as result;
rollback;
