-- Staff must confirm receipt; a merchant UPI reference is optional.
-- Keep cash arithmetic, method separation, and validation of supplied references.
alter table public.hpa_counter_settlements
  drop constraint hpa_counter_tender,
  add constraint hpa_counter_tender check ((
    (method = 'cash' and cash_tendered >= amount
      and change_amount = cash_tendered - amount and upi_reference is null)
    or
    (method = 'upi' and cash_tendered is null and change_amount is null
      and (upi_reference is null or upi_reference ~ '^[A-Z0-9]{6,80}$'))
  ) is true);
