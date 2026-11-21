import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundle the exact same pricing and validation source used in the website.
// This output is a deployment artifact, not a second hand-maintained implementation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || '/private/tmp/hpa-commerce-edge-files.json');
const entryPoints = [
  ['domain.js', 'lib/commerce/domain.ts'],
  ['addresses.js', 'lib/commerce/addresses.ts'],
  ['razorpay.js', 'lib/payments/razorpay.ts'],
  ['payments.js', 'lib/payments/service.ts'],
  ['phonepe.js', 'lib/payments/phonepe.ts'],
  ['phonepe-payments.js', 'lib/payments/phonepe-service.ts'],
  ['counter.js', 'lib/counter.ts'],
  ['kitchen.js', 'lib/kitchen.ts'],
  ['reports.js', 'lib/commerce/reports.ts'],
  ['table-qr.js', 'lib/commerce/table-qr.ts'],
];
const buildOptions = {
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: true,
};
// Keep one copy of validation/pricing in the deployment instead of repeating it in
// every handler. All relative chunk dependencies are included in the upload.
const generated = resolve(root, 'supabase/functions/hpa-commerce/.generated');
const bundle = await build({
  ...buildOptions,
  entryPoints: Object.fromEntries(
    entryPoints.map(([name, source]) => [name.replace(/\.js$/, ''), resolve(root, source)]),
  ),
  splitting: true,
  outdir: generated,
  chunkNames: 'shared/[name]-[hash]',
});
const files = await Promise.all(
  ['index.ts', 'deno.json'].map(async (name) => ({
    name,
    content: await readFile(resolve(root, 'supabase/functions/hpa-commerce', name), 'utf8'),
  })),
);
for (const file of bundle.outputFiles)
  files.push({ name: relative(generated, file.path), content: file.text });
files.push({ name: 'types.ts', content: await readFile(resolve(root, 'types/index.ts'), 'utf8') });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(files));
console.log(`Prepared ${files.length} deployment files at ${output}`);
const webhookFiles = [
  {
    name: 'index.ts',
    content: await readFile(
      resolve(root, 'supabase/functions/hpa-razorpay-webhook/index.ts'),
      'utf8',
    ),
  },
  ...files.filter((file) => file.name === 'deno.json'),
];
// The webhook has its own small deployment and never depends on commerce chunks.
for (const [name, source] of entryPoints.filter(([name]) =>
  ['razorpay.js', 'payments.js'].includes(name),
)) {
  const result = await build({ ...buildOptions, entryPoints: [resolve(root, source)] });
  webhookFiles.push({ name, content: result.outputFiles[0].text });
}
await writeFile(output.replace(/\.json$/, '-webhook.json'), JSON.stringify(webhookFiles));

// PhonePe webhook: its own deployment, sharing one bundle of its two modules so the
// PhonePeError class identity is preserved between them.
const phonePeFiles = [
  {
    name: 'index.ts',
    content: await readFile(
      resolve(root, 'supabase/functions/hpa-phonepe-webhook/index.ts'),
      'utf8',
    ),
  },
  ...files.filter((file) => file.name === 'deno.json'),
];
const phonePeBundle = await build({
  ...buildOptions,
  entryPoints: {
    phonepe: resolve(root, 'lib/payments/phonepe.ts'),
    'phonepe-payments': resolve(root, 'lib/payments/phonepe-service.ts'),
  },
  splitting: true,
  outdir: resolve(root, 'supabase/functions/hpa-phonepe-webhook/.generated'),
  chunkNames: 'shared/[name]-[hash]',
});
for (const file of phonePeBundle.outputFiles)
  phonePeFiles.push({
    name: relative(resolve(root, 'supabase/functions/hpa-phonepe-webhook/.generated'), file.path),
    content: file.text,
  });
await writeFile(output.replace(/\.json$/, '-phonepe-webhook.json'), JSON.stringify(phonePeFiles));
