import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { build } from 'esbuild';

test('commerce and webhook deployment artifacts include every relative dependency with one shared validation bundle', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'hpa-edge-artifact-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'commerce.json');
  await promisify(execFile)(process.execPath, ['scripts/bundle-commerce-edge.mjs', output]);
  for (const path of [output, output.replace('.json', '-webhook.json')]) {
    const files: Array<{ name: string; content: string }> = JSON.parse(
      await readFile(path, 'utf8'),
    );
    assert.ok(files.some((f) => f.name === 'index.ts'));
    assert.ok(files.some((f) => f.name === 'deno.json'));
    assert.equal(new Set(files.map((f) => f.name)).size, files.length);
    assert.ok(
      files.reduce((total, file) => total + file.content.length, 0) < 800_000,
      'validation must not be repeated in every entry module',
    );
    const sources = new Map(files.map((f) => [f.name, f.content]));
    const result = await build({
      entryPoints: ['index.ts'],
      write: false,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      plugins: [
        {
          name: 'load-exact-deployed-files',
          setup(plugin) {
            plugin.onResolve({ filter: /^npm:/ }, (args) => ({ path: args.path, external: true }));
            plugin.onResolve({ filter: /.*/ }, (args) => {
              const file =
                args.kind === 'entry-point'
                  ? args.path
                  : posix.normalize(posix.join(posix.dirname(args.importer), args.path));
              assert.ok(!file.startsWith('../') && !file.startsWith('/'));
              assert.ok(sources.has(file), `Missing deployed dependency: ${file}`);
              return { path: file, namespace: 'edge-artifact' };
            });
            plugin.onLoad({ filter: /.*/, namespace: 'edge-artifact' }, (args) => ({
              contents: sources.get(args.path)!,
              loader: args.path.endsWith('.ts') ? 'ts' : 'js',
            }));
          },
        },
      ],
    });
    assert.ok(result.outputFiles[0].text.includes('Deno.serve'));
  }
});
