// =============================================================================
// tests/unit/asyncCache.test.js
// Bug 3.3 — socketClient cached a REJECTED promise forever.
//
// loadIo() memoized `import(...)` in a module-scoped `ioPromise`. If that import
// rejected once (a transient network blip), `ioPromise` stayed a truthy rejected
// promise, so `if (!ioPromise)` was false forever after — every later call
// re-rejected with the stale error and the draft-lock feature was dead for the
// rest of the page's life. createRetryableCache fixes this: a rejection clears
// the cache so the next call retries.
// =============================================================================

import { createRetryableCache } from '../../public/js/shared/asyncCache.js';

describe('createRetryableCache', () => {
  test('memoizes a successful result — factory runs only once across many calls', async () => {
    let calls = 0;
    const get = createRetryableCache(async () => { calls += 1; return 'value'; });

    const a = await get();
    const b = await get();
    const c = await get();

    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(c).toBe('value');
    expect(calls).toBe(1);
  });

  test('a rejection is NOT cached — the next call retries the factory', async () => {
    let calls = 0;
    const get = createRetryableCache(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient network blip');
      return 'recovered';
    });

    await expect(get()).rejects.toThrow('transient network blip');
    // Before the fix this would re-reject forever; now the second call retries.
    await expect(get()).resolves.toBe('recovered');
    expect(calls).toBe(2);
  });

  test('concurrent callers during a pending load share the same in-flight promise', async () => {
    let calls = 0;
    let resolveInner;
    const get = createRetryableCache(() => {
      calls += 1;
      return new Promise((res) => { resolveInner = res; });
    });

    const p1 = get();
    const p2 = get();
    resolveInner('shared');

    await expect(p1).resolves.toBe('shared');
    await expect(p2).resolves.toBe('shared');
    expect(calls).toBe(1);
  });
});
