// Expands the bundled Edge function file lists into a throwaway Supabase workdir so the
// Supabase CLI can deploy them. Nothing here contains or reads secrets.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const [bundleDir, workdir, projectRef] = process.argv.slice(2);
if (!bundleDir || !workdir || !/^[a-z]{20}$/.test(projectRef ?? ''))
  throw new Error('Usage: node scripts/prepare-edge-deploy.mjs <bundleDir> <workdir> <projectRef>');
const functions = {
  'hpa-commerce': 'hpa-commerce-edge-files.json',
  'hpa-razorpay-webhook': 'hpa-commerce-edge-files-webhook.json',
  'hpa-phonepe-webhook': 'hpa-commerce-edge-files-phonepe-webhook.json',
  'hpa-kitchen': 'hpa-kitchen-edge-files.json',
};
let config = `project_id = "${projectRef}"\n`;
for (const [name, file] of Object.entries(functions)) {
  const files = JSON.parse(await readFile(join(bundleDir, file), 'utf8'));
  for (const entry of files) {
    if (entry.name.includes('..') || entry.name.startsWith('/')) throw new Error(`Unsafe path ${entry.name}`);
    const target = resolve(workdir, 'supabase/functions', name, entry.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.content);
  }
  // Flatten generated shared chunks so CLI server-side bundling uploads every dependency.
  const entry = resolve(workdir, 'supabase/functions', name, 'index.ts');
  const bundled = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'esm',
    platform: 'neutral', target: 'es2022', minify: true, external: ['npm:*'],
  });
  await writeFile(entry, bundled.outputFiles[0].text);
  // Every function authenticates inside its own code (or by webhook signature).
  config += `\n[functions.${name}]\nverify_jwt = false\n`;
}
await writeFile(resolve(workdir, 'supabase/config.toml'), config);
console.log(`Prepared ${Object.keys(functions).length} functions in ${workdir}`);
