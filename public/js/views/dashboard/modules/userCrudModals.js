// =============================================================================
// public/js/views/dashboard/modules/userCrudModals.js
// Shared user-management modals (Crear / Editar / Desactivar / Activar).
//
// ManagerStrategy and AdminStrategy both render the exact same 4 modals for
// user CRUD (same fields, same validation, same Delegación de Funciones
// checkbox gating) — the only thing that ever differed between their two
// copies was which panel to re-render afterwards. That refresh step is the
// only thing each caller customizes, via the `onDone` callback.
//
// Extracted from managerStrategy.js / adminStrategy.js (previously duplicated
// verbatim in both, ~170 lines each) — no behavioral change, single source
// of truth now.
// =============================================================================

import AuthSession from '../../../services/authSession.js';
import { escHtml }  from '../helpers.js';
import { UI }        from '../modalUI.js';
import {
  CommandInvoker, CreateUserCommand, UpdateUserCommand, DeactivateUserCommand,
} from '../commands.js';

/**
 * showCreateUserModal — "Crear Nuevo Usuario" modal.
 * @param {Function} onDone — called after a successful create (typically re-renders the users tab)
 */
export function showCreateUserModal(onDone) {
  // Delegación de Funciones — only Jefe/Administracion/SysAdmin may set the flag.
  const canDelegate = ['Jefe', 'Administracion', 'SysAdmin'].includes(AuthSession.getRole());
  UI.openModal('Crear Nuevo Usuario', (body) => {
    body.innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="nu-nombre">Nombre Completo *</label>
          <input class="form-control" type="text" id="nu-nombre" />
        </div>
        <div class="form-group">
          <label class="form-label" for="nu-usuario">Nombre de Usuario *</label>
          <input class="form-control" type="text" id="nu-usuario" autocapitalize="none" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="nu-password">Contraseña *</label>
          <input class="form-control" type="password" id="nu-password" />
        </div>
        <div class="form-group">
          <label class="form-label" for="nu-rol">Rol *</label>
          <select class="form-control" id="nu-rol">
            <option value="1">Ejecutivo</option>
            <option value="2">Administracion</option>
            <option value="3">Jefe</option>
            <option value="5">Proyectos</option>
          </select>
        </div>
      </div>
      ${canDelegate ? `
      <div class="form-group">
        <label class="form-label checkbox-label">
          <input type="checkbox" id="nu-canapprove" />
          <span>Delegación de Funciones: gestión completa del ciclo de cotizaciones (aprobar, enviar, confirmar, rechazar)</span>
        </label>
      </div>` : ''}
      <div class="form-alert" id="nu-alert"></div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
        <button class="btn btn-ghost" id="nu-cancel">Cancelar</button>
        <button class="btn btn-primary" id="nu-confirm">Crear Usuario</button>
      </div>`;

    body.querySelector('#nu-cancel')?.addEventListener('click', UI.closeModal);
    body.querySelector('#nu-confirm')?.addEventListener('click', () => {
      const nombre   = body.querySelector('#nu-nombre')?.value.trim();
      const usuario  = body.querySelector('#nu-usuario')?.value.trim();
      const password = body.querySelector('#nu-password')?.value;
      const id_rol   = parseInt(body.querySelector('#nu-rol')?.value, 10);
      const alertEl  = body.querySelector('#nu-alert');

      if (!nombre || !usuario || !password) {
        alertEl.textContent = 'Todos los campos marcados con * son requeridos.';
        alertEl.className   = 'form-alert show alert-error';
        return;
      }

      const payload = { nombre_completo: nombre, nombre_usuario: usuario, password, id_rol };
      if (canDelegate) payload.can_approve_quotations = !!body.querySelector('#nu-canapprove')?.checked;

      const btn = body.querySelector('#nu-confirm');
      CommandInvoker.run(
        new CreateUserCommand(payload),
        {
          btn,
          successMsg: `Usuario "${usuario}" creado exitosamente.`,
          onSuccess:  () => { UI.closeModal(); onDone(); },
          onError:    (err) => {
            alertEl.textContent = err.data?.message || err.message;
            alertEl.className   = 'form-alert show alert-error';
          },
        }
      );
    });
  });
}

/**
 * showEditUserModal — "Editar Usuario" modal.
 * @param {Function} onDone — called after a successful update
 */
export function showEditUserModal(id, nombre, idRol, canApprove, onDone) {
  // Delegación de Funciones — only Jefe/Administracion/SysAdmin may set the flag.
  const canDelegate = ['Jefe', 'Administracion', 'SysAdmin'].includes(AuthSession.getRole());
  const isDelegated = String(canApprove) === '1' || canApprove === true;
  UI.openModal('Editar Usuario', (body) => {
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="eu-nombre">Nombre Completo</label>
        <input class="form-control" type="text" id="eu-nombre" value="${escHtml(nombre ?? '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="eu-rol">Rol</label>
        <select class="form-control" id="eu-rol">
          <option value="1" ${idRol == 1 ? 'selected' : ''}>Ejecutivo</option>
          <option value="2" ${idRol == 2 ? 'selected' : ''}>Administracion</option>
          <option value="3" ${idRol == 3 ? 'selected' : ''}>Jefe</option>
          <option value="5" ${idRol == 5 ? 'selected' : ''}>Proyectos</option>
        </select>
      </div>
      ${canDelegate ? `
      <div class="form-group">
        <label class="form-label checkbox-label">
          <input type="checkbox" id="eu-canapprove" ${isDelegated ? 'checked' : ''} />
          <span>Delegación de Funciones: gestión completa del ciclo de cotizaciones (aprobar, enviar, confirmar, rechazar)</span>
        </label>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label" for="eu-password">Nueva Contraseña (dejar vacío para no cambiar)</label>
        <input class="form-control" type="password" id="eu-password" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
        <button class="btn btn-ghost" id="eu-cancel">Cancelar</button>
        <button class="btn btn-primary" id="eu-confirm">Guardar Cambios</button>
      </div>`;

    body.querySelector('#eu-cancel')?.addEventListener('click', UI.closeModal);
    body.querySelector('#eu-confirm')?.addEventListener('click', () => {
      const updateData = {
        nombre_completo: body.querySelector('#eu-nombre')?.value.trim(),
        id_rol:          parseInt(body.querySelector('#eu-rol')?.value, 10),
      };
      const pw = body.querySelector('#eu-password')?.value;
      if (pw) updateData.password = pw;
      if (canDelegate) updateData.can_approve_quotations = !!body.querySelector('#eu-canapprove')?.checked;

      const btn = body.querySelector('#eu-confirm');
      CommandInvoker.run(new UpdateUserCommand(id, updateData), {
        btn,
        successMsg: 'Usuario actualizado exitosamente.',
        onSuccess:  () => { UI.closeModal(); onDone(); },
      });
    });
  });
}

/**
 * confirmDeactivateUser — confirmation modal for soft-deactivating a user.
 * @param {Function} onDone — called after a successful deactivation
 */
export function confirmDeactivateUser(id, username, onDone) {
  UI.openModal('Confirmar Desactivación', (body) => {
    body.innerHTML = `
      <div class="confirm-dialog">
        <h4>¿Desactivar al usuario "${escHtml(username)}"?</h4>
        <p>El usuario no podrá acceder al sistema. Esta acción puede revertirse editando el usuario.</p>
        <div style="display:flex;justify-content:center;gap:.75rem;">
          <button class="btn btn-ghost" id="dc-cancel">Cancelar</button>
          <button class="btn btn-danger" id="dc-confirm">Sí, Desactivar</button>
        </div>
      </div>`;

    body.querySelector('#dc-cancel')?.addEventListener('click', UI.closeModal);
    body.querySelector('#dc-confirm')?.addEventListener('click', () => {
      const btn = body.querySelector('#dc-confirm');
      CommandInvoker.run(new DeactivateUserCommand(id), {
        btn,
        successMsg: `Usuario "${username}" desactivado.`,
        onSuccess:  () => { UI.closeModal(); onDone(); },
      });
    });
  });
}

/**
 * confirmActivateUser — confirmation modal for reactivating a user.
 * @param {Function} onDone — called after a successful activation
 */
export function confirmActivateUser(id, username, onDone) {
  UI.openModal('Confirmar Activación', (body) => {
    body.innerHTML = `
      <div class="confirm-dialog">
        <h4>¿Activar al usuario "${escHtml(username)}"?</h4>
        <p>El usuario podrá acceder al sistema nuevamente.</p>
        <div style="display:flex;justify-content:center;gap:.75rem;">
          <button class="btn btn-ghost" id="ac-cancel">Cancelar</button>
          <button class="btn btn-success" id="ac-confirm">Sí, Activar</button>
        </div>
      </div>`;

    body.querySelector('#ac-cancel')?.addEventListener('click', UI.closeModal);
    body.querySelector('#ac-confirm')?.addEventListener('click', () => {
      const btn = body.querySelector('#ac-confirm');
      CommandInvoker.run(new UpdateUserCommand(id, { activo: 1 }), {
        btn,
        successMsg: `Usuario "${username}" activado.`,
        onSuccess:  () => { UI.closeModal(); onDone(); },
      });
    });
  });
}
