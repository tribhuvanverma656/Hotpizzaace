# Daily order references

Source candidate, 30 October 2026. New accepted orders use **HPA-DDMMYY-0001**,
for example `HPA-301026-0001`. The date follows the database server's current time
in `Asia/Kolkata`; the sequence resets at local midnight and spans all branches,
website orders, staff counter orders and accepted QR requests within one database.
Development and production databases have independent sequences. Values above
9999 expand to five or more digits.

Allocation happens atomically in a database insert trigger. A QR request or cart
preview consumes no order number. Retrying an accepted order returns its original
reference. Internal order UUIDs, existing order references and tax-invoice numbers
remain unchanged; invoice numbering continues under its existing rules.

Release requires migration `20261030105842_daily_order_numbers.sql`. Existing create
RPCs already return the saved database row, so they return the assigned reference
without a frontend or Edge API change. Regression coverage is in
`supabase/tests/daily_order_numbers.sql`; execute it in a transaction and roll back.
