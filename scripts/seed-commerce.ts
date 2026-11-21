import { writeFile } from 'node:fs/promises';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';

// This script generates a reviewed, non-sensitive catalog seed; it never connects to a DB.
// Existing browser customer records, receipts and addresses are deliberately excluded.
const branches = structuredClone(initialBranches).map((branch) => ({
  ...branch,
  settings: {
    ...branch.settings,
    acceptingOrders: false,
    temporarilyClosed: false,
    paymentMethods: branch.settings.paymentMethods.filter((method) => method !== 'cash'),
  },
}));
const jsonSql = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const sql = `-- One-time initialization; never overwrite an existing owner-managed catalog.
do $$
begin
  if exists(select 1 from public.hpa_products) or exists(select 1 from public.hpa_branches) then
    raise exception 'Catalog already initialized';
  end if;
  perform public.hpa_replace_catalog(
    (select revision from public.hpa_commerce_state where id = true),
    ${jsonSql(initialProducts)},
    ${jsonSql(initialCategories)},
    ${jsonSql(branches)}
  );
end $$;
`;
const destination = process.argv[2] ?? '/private/tmp/hpa-commerce-seed.sql';
writeFile(destination, sql)
  .then(() => {
    console.log(
      `Prepared ${initialProducts.length} products, ${initialCategories.length} categories and ${branches.length} paused branch at ${destination}`,
    );
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Could not prepare catalog seed.');
    process.exitCode = 1;
  });
