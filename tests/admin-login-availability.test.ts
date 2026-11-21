import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type Element = { type: unknown; props: Record<string, unknown> };
type Effect = () => void | (() => void);
type Slot = { value?: unknown; dependencies?: unknown[]; cleanup?: () => void };

const source = build({
  stdin: {
    contents:
      'export {GoogleAdminLogin} from "./components/admin/google-admin-login"; export {AdminPasswordLogin} from "./components/admin/admin-password-login"; export {GoogleSignInButton} from "./components/auth/google-sign-in-button";',
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'admin-login-context',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, ({ importer }) =>
          /\/components\/admin\/(?:google-admin-login|admin-password-login)\.tsx$/.test(importer)
            ? { path: 'hooks', namespace: 'login-fixture' }
            : undefined,
        );
        for (const [filter, path] of [
          [/customer-auth-provider$/, 'auth'],
          [/shared-commerce-provider$/, 'shared'],
          [/^next\/navigation$/, 'navigation'],
          [/^next\/link$/, 'link'],
          [/^next\/image$/, 'image'],
          [/\.css$/, 'styles'],
        ] as const)
          plugin.onResolve({ filter }, () => ({ path, namespace: 'login-fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'login-fixture' }, ({ path }) => ({
          contents: {
            hooks:
              'export const useState=(value)=>fixture.hooks.useState(value); export const useEffect=(callback,deps)=>fixture.hooks.useEffect(callback,deps); export const useRef=(value)=>fixture.hooks.useRef(value);',
            auth: 'export const useCustomerAuth=()=>fixture.auth;',
            shared: 'export const useSharedCommerce=()=>fixture.shared;',
            navigation: 'export const useRouter=()=>fixture.router;',
            link: 'export default "a";',
            image: 'export default "img";',
            styles: 'export default {};',
          }[path]!,
        }));
      },
    },
  ],
});

function find(tree: unknown, match: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const result = find(child, match);
      if (result) return result;
    }
  } else if (tree && typeof tree === 'object' && 'props' in tree) {
    const element = tree as Element;
    if (match(element)) return element;
    return find(element.props.children, match);
  }
}

/** Runs the real login components and their effects without network or credentials. */
async function fixture(search = '?next=%2Fadmin%2Fkitchen') {
  const browser = Object.assign(new EventTarget(), { location: { search } });
  const slots = new Map<string, Slot[]>();
  const effects: { slot: Slot; callback: Effect }[] = [];
  let owner = '';
  let index = 0;
  let dirty = false;
  function nextSlot() {
    const component = slots.get(owner) ?? [];
    slots.set(owner, component);
    return (component[index++] ??= {});
  }
  const state = {
    auth: {
      user: null as null | { id: string; email: string; name: string },
      loading: true,
      error: null as string | null,
      signOut: async () => {},
    },
    shared: {
      ready: false,
      admin: false,
      adminLoading: true,
      adminError: null as string | null,
      error: null as string | null,
      refresh: async () => {},
    },
    redirects: [] as string[],
    router: { replace: (path: string) => state.redirects.push(path) },
    hooks: {
      useState(initial: unknown) {
        const slot = nextSlot();
        if (!Object.hasOwn(slot, 'value'))
          slot.value = typeof initial === 'function' ? initial() : initial;
        return [
          slot.value,
          (next: unknown) => {
            const value = typeof next === 'function' ? next(slot.value) : next;
            if (!Object.is(value, slot.value)) dirty = true;
            slot.value = value;
          },
        ];
      },
      useRef(initial: unknown) {
        const slot = nextSlot();
        return (slot.value ??= { current: initial });
      },
      useEffect(callback: Effect, dependencies: unknown[]) {
        const slot = nextSlot();
        if (
          !slot.dependencies ||
          dependencies.some((value, position) => !Object.is(value, slot.dependencies![position]))
        )
          effects.push({ slot, callback });
        slot.dependencies = dependencies.slice();
      },
    },
  };
  const output = {
    exports: {} as {
      GoogleAdminLogin: () => unknown;
      AdminPasswordLogin: (props: Record<string, unknown>) => unknown;
      GoogleSignInButton: unknown;
    },
  };
  new Function(
    'require',
    'module',
    'exports',
    'fixture',
    'window',
    (await source).outputFiles![0].text,
  )(createRequire(import.meta.url), output, output.exports, state, browser);
  let tree: unknown;
  let passwordTree: unknown;
  function render() {
    owner = 'google';
    index = 0;
    tree = output.exports.GoogleAdminLogin();
    const password = find(tree, (element) => element.type === output.exports.AdminPasswordLogin);
    assert.ok(password);
    owner = 'password';
    index = 0;
    passwordTree = output.exports.AdminPasswordLogin(password.props);
  }
  function flush() {
    for (let attempt = 0; attempt < 10; attempt++) {
      dirty = false;
      render();
      for (const { slot, callback } of effects.splice(0)) {
        slot.cleanup?.();
        slot.cleanup = callback() ?? undefined;
      }
      if (!dirty && effects.length === 0) return;
    }
    throw new Error('Login effects did not settle.');
  }
  function googleButton() {
    const result = find(tree, (element) => element.type === output.exports.GoogleSignInButton);
    assert.ok(result);
    return result;
  }
  function passwordButton() {
    const result = find(passwordTree, (element) => element.type === 'button');
    assert.ok(result);
    return result;
  }
  function form(action: string) {
    const result = find(action === '/api/auth/google' ? tree : passwordTree, (element) => {
      return element.type === 'form' && element.props.action === action;
    });
    assert.ok(result);
    return result;
  }
  render();
  return { state, browser, flush, googleButton, passwordButton, form };
}

function submission(form: Element) {
  const event = {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  (form.props.onSubmit as (value: typeof event) => void)(event);
  return event;
}

test('pending or failed background checks never disable an initialized fresh admin sign-in', async () => {
  for (const [authLoading, adminLoading] of [
    [true, true],
    [true, false],
    [false, true],
  ]) {
    const login = await fixture();
    assert.equal(
      login.googleButton().props.disabled,
      true,
      'initialize the safe return path first',
    );
    login.state.auth.loading = authLoading;
    login.state.shared.adminLoading = adminLoading;
    login.state.auth.error = 'Background sign-in check timed out.';
    login.state.shared.adminError = 'Background workspace check timed out.';
    login.flush();
    assert.equal(login.googleButton().props.disabled, false);
    assert.equal(login.passwordButton().props.disabled, false);
    assert.equal(login.form('/api/auth/google').props.method, 'post');
    assert.equal(login.form('/api/auth/password').props.method, 'post');
    assert.deepEqual(login.state.redirects, []);
  }
});

test('Google submission locks both methods, rejects duplicates and resets on pageshow', async () => {
  const login = await fixture();
  login.flush();
  const form = login.form('/api/auth/google');
  assert.equal(submission(form).defaultPrevented, false);
  assert.equal(submission(form).defaultPrevented, true, 'lock before a React repaint');
  login.flush();
  assert.equal(login.googleButton().props.disabled, true);
  assert.equal(login.passwordButton().props.disabled, true);
  assert.equal(submission(login.form('/api/auth/password')).defaultPrevented, true);
  login.browser.dispatchEvent(new Event('pageshow'));
  login.flush();
  assert.equal(login.googleButton().props.disabled, false);
  assert.equal(login.passwordButton().props.disabled, false);
  assert.equal(submission(login.form('/api/auth/google')).defaultPrevented, false);
});

test('password submission locks Google before repaint and pageshow permits a fresh attempt', async () => {
  const login = await fixture();
  login.flush();
  const google = login.form('/api/auth/google');
  assert.equal(submission(login.form('/api/auth/password')).defaultPrevented, false);
  assert.equal(submission(google).defaultPrevented, true);
  login.flush();
  assert.equal(login.googleButton().props.disabled, true);
  assert.equal(login.passwordButton().props.disabled, true);
  login.browser.dispatchEvent(new Event('pageshow'));
  login.flush();
  assert.equal(login.googleButton().props.disabled, false);
  assert.equal(login.passwordButton().props.disabled, false);
});

test('background checks do not authorize redirects; a verified owner uses only the safe return path', async () => {
  const login = await fixture('?next=https%3A%2F%2Fattacker.example');
  login.state.shared.admin = true;
  login.flush();
  assert.deepEqual(login.state.redirects, [], 'an unready admin result is not authorization');
  login.state.shared.admin = false;
  login.state.shared.ready = true;
  login.state.auth.user = { id: 'customer-fixture', email: 'customer@example.invalid', name: 'QA' };
  login.flush();
  assert.deepEqual(login.state.redirects, [], 'a customer must stay outside the dashboard');
  login.state.shared.admin = true;
  login.flush();
  assert.deepEqual(login.state.redirects, ['/admin/dashboard']);
});
