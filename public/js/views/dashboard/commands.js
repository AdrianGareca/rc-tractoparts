// =============================================================================
// public/js/views/dashboard/commands.js
// COMMAND PATTERN — critical mutations encapsulated as Command objects with a
// single execute() method. CommandInvoker runs them with loading-state
// management and toast feedback, decoupling the UI trigger from the action.
//
//   Command (abstract)
//     ├─ ApproveQuotationCommand    — POST /:id/aprobar
//     ├─ ChangeStatusCommand        — PUT  /:id/estado
//     ├─ DeactivateUserCommand      — DELETE /api/usuarios/:id
//     ├─ CreateUserCommand          — POST   /api/usuarios
//     ├─ UpdateUserCommand          — PUT    /api/usuarios/:id
//     ├─ SetComentarioAdminCommand  — PATCH  /:id/comentario-admin
//     └─ HoldWithCommentCommand     — PUT    /:id/estado (En espera + comentario_admin)
//
// Extracted verbatim from dashboardView.js as part of the file-size cleanup
// — no behavioral change.
// =============================================================================

import api, { showToast } from '../../services/apiClient.js';

export class Command {
  /** @returns {Promise<any>} */
  async execute() {
    throw new Error('Command.execute() must be implemented by subclass.');
  }
}

// ── Concrete Commands ─────────────────────────────────────────────────────────

/** POST /api/cotizaciones/:id/aprobar  — Approve or reject a quotation */
export class ApproveQuotationCommand extends Command {
  #id; #aprobado; #obs;
  constructor(id, aprobado, obs = '') {
    super();
    this.#id      = id;
    this.#aprobado= aprobado;
    this.#obs     = obs;
  }
  async execute() {
    return api.post(`/api/cotizaciones/${this.#id}/aprobar`, {
      aprobado:      this.#aprobado,
      observaciones: this.#obs,   // controller reads req.body.observaciones
    });
  }
}

/** PUT /api/cotizaciones/:id/estado — Change quotation status */
export class ChangeStatusCommand extends Command {
  #id; #newStatus; #obs;
  constructor(id, newStatus, obs = '') {
    super();
    this.#id        = id;
    this.#newStatus = newStatus;
    this.#obs       = obs;
  }
  async execute() {
    return api.put(`/api/cotizaciones/${this.#id}/estado`, {
      nuevo_estado: this.#newStatus,
      observacion:  this.#obs,
    });
  }
}

/** DELETE /api/usuarios/:id — Soft-deactivate a user */
export class DeactivateUserCommand extends Command {
  #id;
  constructor(id) { super(); this.#id = id; }
  async execute() { return api.delete(`/api/usuarios/${this.#id}`); }
}

/** POST /api/usuarios — Create a new user */
export class CreateUserCommand extends Command {
  #data;
  constructor(data) { super(); this.#data = data; }
  async execute() { return api.post('/api/usuarios', this.#data); }
}

/** PUT /api/usuarios/:id — Update a user record */
export class UpdateUserCommand extends Command {
  #id; #data;
  constructor(id, data) { super(); this.#id = id; this.#data = data; }
  async execute() { return api.put(`/api/usuarios/${this.#id}`, this.#data); }
}

/** PATCH /api/cotizaciones/:id/comentario-admin — Save admin supervision comment */
export class SetComentarioAdminCommand extends Command {
  #id; #comment;
  constructor(id, comment) { super(); this.#id = id; this.#comment = comment; }
  async execute() {
    return api.patch(`/api/cotizaciones/${this.#id}/comentario-admin`, {
      comentario_admin: this.#comment,
    });
  }
}

/** PUT /api/cotizaciones/:id/estado — Change quotation status with optional admin comment */
export class HoldWithCommentCommand extends Command {
  #id; #comment;
  constructor(id, comment) { super(); this.#id = id; this.#comment = comment; }
  async execute() {
    return api.put(`/api/cotizaciones/${this.#id}/estado`, {
      nuevo_estado:    'En espera',
      observacion:     this.#comment,
      comentario_admin: this.#comment,  // persisted in dedicated column for Jefe to read
    });
  }
}

// ── Command Invoker ───────────────────────────────────────────────────────────

/**
 * CommandInvoker
 * Executes a Command with:
 *   • Optional button loading state (disabled + spinner text)
 *   • Automatic toast feedback on success/failure
 */
export const CommandInvoker = {
  async run(command, { btn, successMsg, onSuccess, onError } = {}) {
    const originalText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
      const result = await command.execute();
      showToast(successMsg || 'Acción completada con éxito.', 'success');
      if (onSuccess) onSuccess(result);
    } catch (err) {
      const msg = err.data?.message || err.message || 'Error al ejecutar la acción.';
      showToast(msg, 'error');
      if (onError) onError(err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  },
};
