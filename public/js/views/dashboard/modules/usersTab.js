// =============================================================================
// public/js/views/dashboard/modules/usersTab.js
// La pestaña "Gestión de usuarios", una sola vez.
//
// DE DÓNDE SALE
// Estaba escrita DOS veces: `_renderUsers` en managerStrategy.js (Jefe) y en
// adminStrategy.js (Administración), ~70 líneas cada una y byte por byte
// iguales salvo el id del botón de crear. La mitad de esta pantalla ya se
// compartía —los modales viven en userCrudModals.js desde hace tiempo, y las
// dos strategies lo dicen en un comentario— pero la tabla y su cableado
// quedaron copiados.
//
// Y ya se había empezado a pudrir: una copia pedía un esqueleto de carga de 7
// columnas y la otra de 8, sobre la misma tabla de 6. O sea que alguien editó
// una y se olvidó de la otra, y nadie se enteró porque el síntoma era medio
// segundo de una tabla gris con el ancho equivocado. La próxima divergencia
// podía caer en algo que importe más: un permiso, un botón que le aparece a
// quien no debe.
//
// Es el mismo movimiento que el proyecto ya hizo con mountClientsTab,
// mountAuditLogTab y mountLicitacionesTab, que las dos strategies consumen así.
//
// QUÉ SE QUEDA AFUERA Y POR QUÉ
// Los cuatro modales. No porque no se puedan compartir —de hecho ya se
// comparten— sino porque cada strategy sabe algo que este módulo no: a qué
// panel volver a dibujar después de una alta o una baja. Eso llega como
// callbacks.
// =============================================================================

import api from '../../../services/apiClient.js';
import { escHtml, roleBadgeHtml } from '../helpers.js';
import { tableSkeleton } from '../../../shared/skeleton.js';

/** Una fila de la tabla. Pura. */
function buildRowHtml(u) {
  return `
                  <tr>
                    <td>${u.id}</td>
                    <td>${escHtml(u.nombre_completo)}</td>
                    <td class="fw-600">${escHtml(u.nombre_usuario)}</td>
                    <td>${roleBadgeHtml(u.rol)}</td>
                    <td>
                      <span class="badge ${u.activo ? 'badge-active' : 'badge-inactive'}">
                        ${u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <div class="table-actions">
                        <button class="btn btn-ghost btn-sm" data-user-edit="${u.id}"
                                data-nombre="${escHtml(u.nombre_completo)}" data-rol="${u.id_rol}"
                                data-canapprove="${u.can_approve_quotations ? 1 : 0}">Editar</button>
                        ${u.activo
                          ? `<button class="btn btn-danger btn-sm" data-user-deact="${u.id}"
                                data-uname="${escHtml(u.nombre_usuario)}">Desactivar</button>`
                          : `<button class="btn btn-success btn-sm" data-user-act="${u.id}"
                                data-uname="${escHtml(u.nombre_usuario)}">Activar</button>`}
                      </div>
                    </td>
                  </tr>`;
}

/**
 * Dibuja la tabla de usuarios en `panel` y le cablea los cuatro botones.
 *
 * @param {HTMLElement} panel
 * @param {Object}   opts
 * @param {string}   opts.botonCrearId — id del botón "+ Nuevo usuario". Difiere
 *   entre las dos strategies (`btn-create-user` / `btn-create-user-admin`) y se
 *   conserva tal cual: `proformaButtonsWired.test.js` y cualquier cosa que
 *   busque esos ids por fuera seguirían encontrándolos.
 * @param {Function} opts.onCrear      — () => void
 * @param {Function} opts.onEditar     — (id, nombre, idRol, canApprove) => void
 * @param {Function} opts.onDesactivar — (id, nombreUsuario) => void
 * @param {Function} opts.onActivar    — (id, nombreUsuario) => void
 */
export async function mountUsersTab(panel, {
  botonCrearId,
  onCrear,
  onEditar,
  onDesactivar,
  onActivar,
}) {
  panel.innerHTML = tableSkeleton({ columnas: 6, etiqueta: 'Cargando datos' });

  try {
    const data  = await api.get('/api/usuarios');
    const users = data.data ?? [];

    panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Gestión de usuarios</h3>
            <button class="btn btn-primary btn-sm" id="${botonCrearId}">+ Nuevo usuario</button>
          </div>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Nombre</th><th>Usuario</th>
                  <th>Rol</th><th>Estado</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${users.map(buildRowHtml).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

    panel.querySelector(`#${botonCrearId}`)?.addEventListener('click', () => onCrear());

    panel.querySelectorAll('[data-user-edit]').forEach((btn) =>
      btn.addEventListener('click', () =>
        onEditar(btn.dataset.userEdit, btn.dataset.nombre, btn.dataset.rol, btn.dataset.canapprove)));

    panel.querySelectorAll('[data-user-deact]').forEach((btn) =>
      btn.addEventListener('click', () =>
        onDesactivar(btn.dataset.userDeact, btn.dataset.uname)));

    panel.querySelectorAll('[data-user-act]').forEach((btn) =>
      btn.addEventListener('click', () =>
        onActivar(btn.dataset.userAct, btn.dataset.uname)));

  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><p>Error cargando usuarios: ${escHtml(err.message)}</p></div>`;
  }
}
