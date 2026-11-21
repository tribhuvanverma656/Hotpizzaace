import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { initialCategories, initialProducts } from '../lib/data';

type Element = { type: unknown; props: Record<string, unknown> };
function find(tree: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
  } else if (tree && typeof tree === 'object' && 'props' in tree) {
    const node = tree as Element;
    return predicate(node) ? node : find(node.props.children, predicate);
  }
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object' && 'props' in tree)
    return text((tree as Element).props.children);
  return typeof tree === 'string' ? tree : '';
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const bundle = build({
  entryPoints: ['components/admin/product-form.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'product-save-context',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, ({ importer }) =>
          /\/(product-form|use-admin-store)\.tsx?$/.test(importer)
            ? { path: 'hooks', namespace: 'feedback-fixture' }
            : undefined,
        );
        for (const [filter, path] of [
          [/^next\/navigation$/, 'navigation'],
          [/^next\/link$/, 'link'],
          [/^sonner$/, 'toast'],
          [/shared-commerce-provider$/, 'shared'],
          [/^@\/lib\/store$/, 'store'],
          [/^\.\/shared$/, 'heading'],
        ] as const)
          plugin.onResolve({ filter }, () => ({ path, namespace: 'feedback-fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'feedback-fixture' }, ({ path }) => ({
          contents: {
            hooks:
              'export const useState=v=>fixture.useState(v);export const useRef=v=>fixture.useRef(v);',
            navigation:
              'export const useParams=()=>({id:fixture.product.id});export const useRouter=()=>({push:path=>fixture.navigation.push(path)});',
            link: 'export default "a";',
            toast:
              'export const toast=Object.fromEntries(["loading","success","error"].map(kind=>[kind,(message,options)=>fixture.notices.push({kind,message,id:options?.id})]));',
            shared: 'export const useSharedCommerce=()=>fixture.shared;',
            store: 'export const useDemoStore=()=>fixture.local;',
            heading: 'export const PageHeading="heading";',
          }[path]!,
        }));
      },
    },
  ],
});

/** Real product form and mutation guard with a deferred shared save, without live menu changes. */
async function fixture(isNew = false) {
  const slots: { value?: unknown }[] = [];
  let index = 0;
  let result = deferred();
  const state = {
    product: initialProducts[0],
    local: { products: initialProducts, categories: initialCategories },
    shared: {
      enabled: true,
      admin: true,
      revision: 1,
      mutateCatalog: async (...args: unknown[]) => {
        state.calls.push(args);
        await result.promise;
      },
    },
    calls: [] as unknown[][],
    notices: [] as { kind: string; message: string; id: string }[],
    navigation: [] as string[],
    useState(initial: unknown) {
      const slot = (slots[index++] ??= {});
      if (!Object.hasOwn(slot, 'value'))
        slot.value = typeof initial === 'function' ? initial() : initial;
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const slot = (slots[index++] ??= {});
      return (slot.value ??= { current: initial });
    },
  };
  const loaded = { exports: {} as { ProductForm: (props: { isNew: boolean }) => unknown } };
  new Function('require', 'module', 'exports', 'fixture', (await bundle).outputFiles![0].text)(
    createRequire(import.meta.url),
    loaded,
    loaded.exports,
    state,
  );
  let tree: unknown;
  const render = () => {
    index = 0;
    tree = loaded.exports.ProductForm({ isNew });
  };
  render();
  function node(predicate: (element: Element) => boolean) {
    const found = find(tree, predicate);
    assert.ok(found);
    return found;
  }
  const button = () => node((el) => el.type === 'button' && el.props.type === 'submit');
  const form = () => node((el) => el.type === 'form');
  const submit = () =>
    (form().props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault() {},
    });
  const fill = (label: string, value: string) => {
    const field = node((el) => el.type === 'label' && text(el).startsWith(label));
    const input = find(field.props.children, (el) => el.type === 'input' || el.type === 'textarea');
    assert.ok(input);
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    render();
  };
  return {
    state,
    render,
    button,
    form,
    submit,
    fill,
    node,
    result: () => result,
    retry: () => {
      result = deferred();
    },
  };
}

test('product save shows progress until completion and prevents duplicate submissions', async () => {
  const ui = await fixture();
  assert.equal(text(ui.button()), 'Save changes');
  const pending = ui.submit();
  ui.render();
  assert.equal(text(ui.button()), 'Saving…');
  assert.equal(ui.button().props.disabled, true);
  assert.equal(ui.form().props['aria-busy'], true);
  assert.ok(ui.node((el) => el.props.className === 'spin'));
  assert.match(text(ui.node((el) => el.props.role === 'status')), /Saving your product/);
  assert.equal(ui.state.notices.at(-1)?.kind, 'loading');
  assert.deepEqual(ui.state.navigation, []);
  await ui.submit();
  assert.equal(ui.state.calls.length, 1);
  ui.result().resolve();
  await pending;
  ui.render();
  assert.equal(ui.form().props['aria-busy'], false);
  assert.deepEqual(ui.state.navigation, ['/admin/products']);
  assert.equal(ui.state.notices.at(-1)?.message, 'Product updated');
  assert.equal(ui.state.notices[0].id, ui.state.notices.at(-1)?.id);
});

test('failed save replaces progress with the error, preserves the draft and allows retry', async () => {
  const ui = await fixture();
  ui.fill('Base price', '225');
  const pending = ui.submit();
  ui.result().reject(new Error('Restaurant data changed. Reload it before saving.'));
  await pending;
  ui.render();
  assert.equal(ui.button().props.disabled, false);
  assert.equal(text(ui.button()), 'Save changes');
  assert.equal(ui.state.navigation.length, 0);
  assert.equal(ui.state.notices.at(-1)?.kind, 'error');
  assert.match(text(ui.node((el) => el.props.role === 'alert')), /Restaurant data changed/);
  ui.retry();
  const retry = ui.submit();
  assert.equal((ui.state.calls[1][1] as { price: number }[])[0].price, 22500);
  ui.result().resolve();
  await retry;
  assert.equal(ui.state.notices.at(-1)?.kind, 'success');
});

test('new products announce creation and replace progress with successful creation', async () => {
  const ui = await fixture(true);
  ui.fill('Product name', 'QA progress pizza');
  ui.fill('Description', 'Only a local test of saving feedback.');
  ui.fill('Base price', '100');
  ui.fill('Or use an image URL', '/images/qa-product.png');
  const pending = ui.submit();
  ui.render();
  assert.equal(text(ui.button()), 'Creating…');
  assert.equal(ui.state.notices.at(-1)?.message, 'Creating product…');
  ui.result().resolve();
  await pending;
  assert.equal(ui.state.notices.at(-1)?.message, 'Product added to your menu');
});
