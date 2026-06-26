/* @type {module} */
// =============================================================================
// public/js/services/authSession.js
// CREATIONAL PATTERN: SINGLETON
//
// Provides a single, globally shared session manager to the entire frontend.
//
// Pattern enforcement (two layers):
//   1. ES Module Cache — the JS module system evaluates this file exactly once.
//      Every `import AuthSession from './authSession.js'` returns the same
//      module binding, making re-instantiation structurally impossible.
//   2. Object.freeze() — prevents any importing module from mutating the
//      exported instance or swapping out its methods at runtime.
//
// All JWT-related state (storage, retrieval, payload decoding, session teardown)
// is encapsulated here. No other module may directly read/write localStorage
// for authentication data.
// =============================================================================

const TOKEN_KEY = 'rc_jwt';
const USER_KEY  = 'rc_user';

class _SessionManager {

  // ---------------------------------------------------------------------------
  // setSession
  // Persists the JWT and the denormalised user object received from /api/auth/login.
  // @param {string} token  — raw JWT string
  // @param {object} user   — { id, nombre_completo, nombre_usuario, rol }
  // ---------------------------------------------------------------------------
  setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  // ---------------------------------------------------------------------------
  // getToken — returns the raw JWT string or null
  // ---------------------------------------------------------------------------
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  // ---------------------------------------------------------------------------
  // getUser — returns the parsed user object or null
  // ---------------------------------------------------------------------------
  getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // clearSession — removes all auth data from localStorage (logout)
  // ---------------------------------------------------------------------------
  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  // ---------------------------------------------------------------------------
  // isAuthenticated
  // Checks token presence AND expiry from the decoded JWT payload.
  // Does NOT verify the signature (server handles that on every API call).
  // ---------------------------------------------------------------------------
  isAuthenticated() {
    const token = this.getToken();
    if (!token) return false;
    try {
      const { exp } = this._decodePayload(token);
      return typeof exp === 'number' && exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // getRole / getUserId / getDisplayName — convenience accessors
  // ---------------------------------------------------------------------------
  getRole()        { return this.getUser()?.rol             ?? null; }
  getUserId()      { return this.getUser()?.id              ?? null; }
  getDisplayName() { return this.getUser()?.nombre_completo ?? this.getUser()?.nombre_usuario ?? null; }
  getUsername()    { return this.getUser()?.nombre_usuario  ?? null; }

  // ---------------------------------------------------------------------------
  // canApproveQuotations
  // Delegación de Funciones — true when the logged-in user holds the delegated
  // can_approve_quotations flag (returned by /api/auth/login). Used purely to
  // decide whether to render the "Aprobar Internamente" action in the UI;
  // the server independently re-verifies the flag on every transition.
  // ---------------------------------------------------------------------------
  canApproveQuotations() { return this.getUser()?.can_approve_quotations === true; }

  // ---------------------------------------------------------------------------
  // _decodePayload (private-by-convention)
  // Decodes the base64url-encoded JWT payload segment WITHOUT signature
  // verification. Safe for client-side expiry checks only.
  // ---------------------------------------------------------------------------
  _decodePayload(token) {
    const [, b64] = token.split('.');
    // Convert base64url → base64, then decode
    const json = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  }
}

// =============================================================================
// SINGLETON EXPORT
// new _SessionManager() is called once at module evaluation time.
// Object.freeze() makes the instance immutable from the outside.
// =============================================================================
const AuthSession = Object.freeze(new _SessionManager());

export default AuthSession;
