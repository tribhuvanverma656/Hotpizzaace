import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || '/private/tmp/hpa-kitchen-edge-files.json');
const bundled = await build({
  entryPoints: [resolve(root, 'lib/kitchen-staff.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: true,
});
const files = await Promise.all(
  ['index.ts', 'deno.json'].map(async (name) => ({
    name,
    content: await readFile(resolve(root, 'supabase/functions/hpa-kitchen', name), 'utf8'),
  })),
);
files.push({ name: 'kitchen-staff.js', content: bundled.outputFiles[0].text });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(files));
console.log(`Prepared ${files.length} kitchen deployment files at ${output}`);
