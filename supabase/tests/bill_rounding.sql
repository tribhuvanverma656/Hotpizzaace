-- Pure snapshot validation only: no catalogue, invoice, payment or order writes.
begin;
do $rounding_test$
declare profile jsonb; legacy jsonb; rounded jsonb; inclusive jsonb; altered jsonb; mode text; bad jsonb;
begin
 profile:='{"businessName":"QA ONLY","address":"QA address","gstin":"09ANCPV1491R1Z3","fssaiNumber":"12721045000614","stateName":"Uttar Pradesh","stateCode":"09","sac":"996331","cgstRate":2.5,"sgstRate":2.5}';
 legacy:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('unitPrice',21900,'quantity',1)),
   'subtotal',21900,'deliveryFee',0,'discount',0,'total',22996,
   'tax',jsonb_build_object('supplier',profile,'taxableValue',21900,'cgst',548,'sgst',548,'total',1096));
 if not public.hpa_order_tax_valid(legacy) then raise exception 'historical paise invoice rejected'; end if;
 rounded:=legacy||'{"total":22900,"roundOff":-96}'::jsonb;
 foreach mode in array array['dine_in','delivery','pickup'] loop
   if not public.hpa_order_tax_valid(rounded||jsonb_build_object('fulfillment',mode)) then
     raise exception 'valid customer-favour rounding rejected for %',mode;
   end if;
 end loop;
 for bad in select value from jsonb_array_elements('[96,-95,-100,-96.5,"-96",null]'::jsonb) loop
   altered:=jsonb_set(rounded,'{roundOff}',bad);
   if public.hpa_order_tax_valid(altered) then raise exception 'invalid adjustment accepted: %',bad; end if;
 end loop;
 if public.hpa_order_tax_valid(jsonb_set(rounded,'{tax,cgst}','547')) then raise exception 'tax changed to absorb rounding'; end if;
 if public.hpa_order_tax_valid(jsonb_set(rounded,'{total}','22901')) then raise exception 'inconsistent payable accepted'; end if;
 if public.hpa_order_round_off_valid('{"subtotal":99,"deliveryFee":0,"discount":0,"total":0,"roundOff":-99}') then raise exception 'zero bill accepted'; end if;
 inclusive:=jsonb_build_object('subtotal',2050,'deliveryFee',0,'discount',0,'total',2000,'roundOff',-50,
   'items',jsonb_build_array(jsonb_build_object('unitPrice',2050,'quantity',1,'gstInclusive','{"rateBps":500,"code":"2201"}'::jsonb)),
   'tax',jsonb_build_object('supplier',profile,'version',2,'includedTotal',98,'taxableValue',1952,'cgst',49,'sgst',49,'total',98,
     'groups','[{"pricing":"inclusive","rateBps":500,"code":"2201","grossValue":2050,"deliveryFee":0,"discount":0,"taxableValue":1952,"cgst":49,"sgst":49,"total":98}]'::jsonb));
 if not public.hpa_order_tax_valid(inclusive) then raise exception 'inclusive MRP bill rounding rejected'; end if;
 if not public.hpa_order_tax_valid(jsonb_set(rounded,'{total}','22996')-'roundOff') then raise exception 'old bill unexpectedly repriced'; end if;
end $rounding_test$;
rollback;
