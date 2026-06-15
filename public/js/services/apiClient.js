// =============================================================================
// public/js/services/apiClient.js
// Centralised HTTP Client
//
// Wraps the native fetch() API to:
//   • Auto-inject Authorization: Bearer <token> from the AuthSession Singleton
//   • Parse JSON responses uniformly
//   • Surface HTTP errors as structured Error objects (err.status, err.data)
//   • Support both JSON and multipart/form-data payloads
//
// All paths are relative (e.g. '/api/auth/login') so the client works on any
// port without hardcoding localhost:3000.
// =============================================================================

import AuthSession from './authSession.js';

// ---------------------------------------------------------------------------
// _request — internal engine for all HTTP methods
// ---------------------------------------------------------------------------
async function _request(method, endpoint, body = null, isFormData = false) {
  const headers = {};
  const token   = AuthSession.getToken();

  if (token)                    headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData && body)      headers['Content-Type']  = 'application/json';

  const options = { method, headers };

  if (body) {
    options.body = isFormData ? body : JSON.stringify(body);
  }

  const response = await fetch(endpoint, options);

  // Redirect to login on 401 (session expired / token revoked)
  if (response.status === 401) {
    AuthSession.clearSession();
    if (!endpoint.includes('/api/auth/login')) {
      window.location.href = '/';
      return;
    }
  }

  // Parse JSON where available
  const contentType = response.headers.get('Content-Type') || '';
  const isJson      = contentType.includes('application/json');
  const payload     = isJson ? await response.json() : null;

  if (!response.ok) {
    const err    = new Error(payload?.message || `HTTP ${response.status}`);
    err.status   = response.status;
    err.data     = payload;
    throw err;
  }

  // Return raw Response object for binary/non-JSON responses (e.g. PDF download)
  return isJson ? payload : response;
}

// ---------------------------------------------------------------------------
// Public API surface — thin wrappers per HTTP verb
// ---------------------------------------------------------------------------
const api = {
  get:    (endpoint)           => _request('GET',    endpoint),
  post:   (endpoint, body)     => _request('POST',   endpoint, body),
  put:    (endpoint, body)     => _request('PUT',    endpoint, body),
  patch:  (endpoint, body)     => _request('PATCH',  endpoint, body),
  delete: (endpoint)           => _request('DELETE', endpoint),

  /** Multipart upload — body must be a FormData instance */
  upload: (endpoint, formData) => _request('POST',   endpoint, formData, true),
};

// ---------------------------------------------------------------------------
// Toast — lightweight notification utility (shared by all views)
// Renders into #toast-stack if present; silently no-ops otherwise.
// ---------------------------------------------------------------------------
export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-stack');
  if (!container) return;

  const el       = document.createElement('div');
  el.className   = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  // Animate in on next frame
  requestAnimationFrame(() => el.classList.add('toast-visible'));

  // Animate out then remove
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, duration);
}

export default api;
