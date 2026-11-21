# Removing accidental production software tests

Production test orders that were incorrectly confirmed as cash/UPI received must not be treated as real collections. The original production environment, invoice number, prices, tax and settlement snapshot remain preserved.

A privileged, explicitly authorized maintenance transaction can add the server-only `testVoid` marker and cancel the operational order. The database trigger verifies that no original bill or payment fields change, records `removed_software_test_no_money`, and prevents later modification of the archived record. Linked accepted QR requests receive the same marker. Never disable receipt-ledger triggers, reuse invoice numbers, or relabel production records as development.

There is no public removal endpoint. Ordinary customer/admin/Kitchen/counter reads and owner report snapshots exclude these records. Idempotency keys remain reserved, so an old create/QR retry returns a removed response rather than generating a duplicate. QR customers can clear the removed request and begin a fresh order. Defensive reporting helpers also zero all contribution fields when given a marked audit record.

Before maintenance, confirm the exact order IDs, expected versions, original gross totals and the user’s statement that no payment was received. Lock the affected request/order rows in deterministic order, preserve bill and receipt hashes, assert the exact target count, update linked request versions, and increment the shared commerce revision. Verify operational/report exclusion and unchanged invoice/settlement snapshots after commit. This is a software-test correction, not a refund workflow.

Validation: TypeScript, ESLint, unit/Edge behavior tests and `supabase/tests/voided_test_orders.sql` within BEGIN/ROLLBACK. Do not generate test payment receipts on production for future QA; use development.
