// =============================================================================
// public/js/views/authView.js
// Login View Controller
//
// BEHAVIORAL PATTERN: CHAIN OF RESPONSIBILITY
//
// Before the API is ever called, submitted credentials pass through a chain
// of discrete validation handlers. Each handler:
//   • Has a single responsibility (presence check, format, length, etc.)
//   • Either stops the chain by returning false (and marks the field invalid)
//   • Or passes control to the next handler by calling super.handle(ctx)
//
// Chain:  PresenceHandler → UsernameFormatHandler → PasswordLengthHandler
//                        → ApiSubmitHandler
//
// This cleanly separates "what is wrong with the input" from "how to display
// the error" and from "what to do with valid input" — each concern lives in
// its own class.
// =============================================================================

import AuthSession from '../services/authSession.js';
import api         from '../services/apiClient.js';

// =============================================================================
// CHAIN OF RESPONSIBILITY — Abstract Handler
// =============================================================================
class Handler {
  /** @type {Handler|null} */
  _next = null;

  /** Attach the next handler and return it (enables fluent chaining). */
  setNext(handler) {
    this._next = handler;
    return handler;
  }

  /**
   * Process the request context.
   * Concrete handlers override this; they call super.handle(ctx) to pass forward.
   * @param {object} ctx
   * @returns {Promise<boolean>} false = chain aborted, true = chain completed
   */
  async handle(ctx) {
    if (this._next) return this._next.handle(ctx);
    return true;
  }
}

// =============================================================================
// CONCRETE HANDLERS
// =============================================================================

/** Handler 1 — Both fields must be non-empty */
class PresenceHandler extends Handler {
  #view;
  constructor(view) { super(); this.#view = view; }

  async handle(ctx) {
    if (!ctx.username.trim()) {
      this.#view.setFieldError('username', 'El nombre de usuario es requerido.');
      return false;
    }
    if (!ctx.password) {
      this.#view.setFieldError('password', 'La contraseña es requerida.');
      return false;
    }
    return super.handle(ctx);
  }
}

/** Handler 2 — Username must match the safe identifier pattern */
class UsernameFormatHandler extends Handler {
  #view;
  constructor(view) { super(); this.#view = view; }

  async handle(ctx) {
    const SAFE = /^[\w\-]{3,50}$/;
    if (!SAFE.test(ctx.username.trim())) {
      this.#view.setFieldError(
        'username',
        'Solo letras, números, guiones o guiones bajos (3–50 caracteres).'
      );
      return false;
    }
    return super.handle(ctx);
  }
}

/** Handler 3 — Password must not be trivially short */
class PasswordLengthHandler extends Handler {
  #view;
  constructor(view) { super(); this.#view = view; }

  async handle(ctx) {
    if (ctx.password.length < 1) {
      this.#view.setFieldError('password', 'La contraseña no puede estar vacía.');
      return false;
    }
    return super.handle(ctx);
  }
}

/**
 * Handler 4 (terminal) — Submit to the API and handle all response scenarios.
 * This handler never calls next() because it is the chain terminus.
 */
class ApiSubmitHandler extends Handler {
  #view;
  constructor(view) { super(); this.#view = view; }

  async handle(ctx) {
    this.#view.setLoading(true);

    try {
      const data = await api.post('/api/auth/login', {
        nombre_usuario: ctx.username.trim(),
        password:       ctx.password,
      });

      // Successful login — persist session, redirect to dashboard
      AuthSession.setSession(data.data.token, data.data.user);
      window.location.href = '/dashboard.html';

    } catch (err) {
      this.#view.setLoading(false);

      if (err.status === 401) {
        // Generic — never reveal whether user exists
        this.#view.setAlert('Credenciales inválidas. Verifique su usuario y contraseña.', 'error');

      } else if (err.status === 422) {
        // Zod field-level errors from the server
        const fieldErrors = err.data?.errors ?? [];
        let handled = false;
        for (const { field, message } of fieldErrors) {
          if (field === 'nombre_usuario') { this.#view.setFieldError('username', message); handled = true; }
          if (field === 'password')       { this.#view.setFieldError('password', message); handled = true; }
        }
        if (!handled) {
          this.#view.setAlert(err.data?.message || 'Datos de entrada inválidos.', 'error');
        }

      } else if (err.status === 429) {
        // Login rate limit reached
        this.#view.setAlert(
          'Demasiados intentos fallidos. Por su seguridad, espere 15 minutos antes de reintentar.',
          'warning'
        );

      } else {
        this.#view.setAlert('Error interno del servidor. Por favor, intente más tarde.', 'error');
      }
    }
    return false; // Chain terminates here regardless of outcome
  }
}

// =============================================================================
// AUTH VIEW CONTROLLER
// Owns the DOM references and exposes helper methods consumed by the handlers.
// =============================================================================
class AuthViewController {
  #form;
  #usernameInput;
  #passwordInput;
  #errUsername;
  #errPassword;
  #formAlert;
  #btnLogin;
  #btnLabel;
  #btnSpinner;
  #chain; // Head of the validation chain

  constructor() {
    this.#form         = document.getElementById('login-form');
    this.#usernameInput= document.getElementById('username');
    this.#passwordInput= document.getElementById('password');
    this.#errUsername  = document.getElementById('err-username');
    this.#errPassword  = document.getElementById('err-password');
    this.#formAlert    = document.getElementById('form-alert');
    this.#btnLogin     = document.getElementById('btn-login');
    this.#btnLabel     = document.getElementById('btn-label');
    this.#btnSpinner   = document.getElementById('btn-spinner');
  }

  /** Build the Chain of Responsibility and wire the form submit listener. */
  init() {
    // Redirect immediately if the user is already authenticated
    if (AuthSession.isAuthenticated()) {
      window.location.href = '/dashboard.html';
      return;
    }

    // Assemble the chain
    const presence  = new PresenceHandler(this);
    const format    = new UsernameFormatHandler(this);
    const pwdLen    = new PasswordLengthHandler(this);
    const apiSubmit = new ApiSubmitHandler(this);

    presence.setNext(format).setNext(pwdLen).setNext(apiSubmit);
    this.#chain = presence;

    // Attach submit listener
    this.#form.addEventListener('submit', (e) => this._onSubmit(e));

    // Clear field errors on input
    this.#usernameInput.addEventListener('input', () => this._clearFieldError('username'));
    this.#passwordInput.addEventListener('input', () => this._clearFieldError('password'));

    // Focus the first field
    this.#usernameInput.focus();
  }

  /** Handle form submit — clear state, build context, pass to chain head */
  async _onSubmit(e) {
    e.preventDefault();
    this._clearAll();

    const ctx = {
      username: this.#usernameInput.value,
      password: this.#passwordInput.value,
    };

    await this.#chain.handle(ctx);
  }

  // ---- DOM helper methods called by handlers --------------------------------

  setFieldError(field, message) {
    if (field === 'username') {
      this.#usernameInput.classList.add('is-invalid');
      this.#errUsername.textContent = message;
    } else if (field === 'password') {
      this.#passwordInput.classList.add('is-invalid');
      this.#errPassword.textContent = message;
    }
  }

  setAlert(message, type = 'error') {
    this.#formAlert.textContent = message;
    this.#formAlert.className   = `form-alert show alert-${type}`;
  }

  setLoading(isLoading) {
    this.#btnLogin.disabled = isLoading;
    if (isLoading) {
      this.#btnLabel.textContent = 'Verificando...';
      this.#btnSpinner.classList.remove('hidden');
    } else {
      this.#btnLabel.textContent = 'Iniciar sesión';
      this.#btnSpinner.classList.add('hidden');
    }
  }

  _clearFieldError(field) {
    if (field === 'username') {
      this.#usernameInput.classList.remove('is-invalid');
      this.#errUsername.textContent = '';
    } else if (field === 'password') {
      this.#passwordInput.classList.remove('is-invalid');
      this.#errPassword.textContent = '';
    }
  }

  _clearAll() {
    this._clearFieldError('username');
    this._clearFieldError('password');
    this.#formAlert.className = 'form-alert';
    this.#formAlert.textContent = '';
  }
}

// =============================================================================
// Bootstrap — ES modules are deferred, so the DOM is already parsed here.
// =============================================================================
new AuthViewController().init();
