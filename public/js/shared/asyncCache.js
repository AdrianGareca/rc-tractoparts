// =============================================================================
// public/js/shared/asyncCache.js
// Memoize an async factory, but DO NOT cache a rejection.
//
// A plain `if (!promise) promise = factory()` caches whatever the factory
// returns — including a rejected promise. That means one transient failure
// (e.g. a network blip loading the Socket.IO client) poisons the cache forever:
// every later call returns the same rejected promise and never retries. This
// helper clears the cache on rejection so the next call gets a fresh attempt,
// while still sharing a single in-flight promise among concurrent callers and
// memoizing a successful result.
// =============================================================================

/**
 * @template T
 * @param {() => (T | Promise<T>)} factory
 * @returns {() => Promise<T>} a getter that memoizes success and retries after failure
 */
export function createRetryableCache(factory) {
  let promise = null;

  return function get() {
    if (!promise) {
      let started;
      try {
        started = Promise.resolve(factory()); // start immediately; wrap non-promises
      } catch (err) {
        return Promise.reject(err); // synchronous throw — nothing cached, next call retries
      }
      promise = started.catch((err) => {
        promise = null; // allow the NEXT call to retry instead of caching the rejection
        throw err;
      });
    }
    return promise;
  };
}
