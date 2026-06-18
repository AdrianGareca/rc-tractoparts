// =============================================================================
// public/js/views/dashboard/modules/delegacionView.js
// Temporal Role Delegation Panel
//
// Renders the delegation management UI for Jefe / SysAdmin users.
// Mounted as a tab inside the ManagerStrategy dashboard.
//
// Features:
//   • List of existing delegations (active / revoked) with status badges
//   • Create form: Ejecutivo dropdown, fecha_inicio / fecha_fin pickers,
//     and an "Activar Delegación Temporal" submit button
//   • Inline revoke button for active delegations
//   • POST  /api/delegaciones        — create delegation
//   • DELETE /api/delegaciones/:id   — revoke delegation
//   • GET   /api/delegaciones/ejecutivos — populate dropdown
// =============================================================================

import api, { showToast } from '../../../services/apiClient.js';
import { escHtml, fmtDate } from '../helpers.js';

// ---------------------------------------------------------------------------
// _statusBadge — returns an HTML badge for a delegation record
// ---------------------------------------------------------------------------
function _statusBadge(row) {
  const now   = Date.now();
  const start = new Date(row.fecha_inicio).getTime();
  const end   = new Date(row.fecha_fin).getTime();

  if (!row.activo) {
    return `<span class="badge" style="background:#6B7280;color:#fff;">Revocada</span>`;
  }
  if (now < start) {
    return `<span class="badge" style="background:#3B82F6;color:#fff;">Programada</span>`;
  }
  if (now >= start && now <= end) {
    return `<span class="badge" style="background:#10B981;color:#fff;">Activa ✓</span>`;
  }
  return `<span class="badge" style="background:#F59E0B;color:#000;">Expirada</span>`;
}

// ---------------------------------------------------------------------------
// renderDelegacionPanel
// Main entry-point called by ManagerStrategy when the "Delegación" tab is selected.
//
// @param {HTMLElement} panel — the container element to render into
// ---------------------------------------------------------------------------
export async function renderDelegacionPanel(panel) {
  panel.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>Cargando…</span></div>';

  let ejecutivos   = [];
  let delegaciones = [];

  try {
    const [execData, delData] = await Promise.all([
      api.get('/api/delegaciones/ejecutivos'),
      api.get('/api/delegaciones'),
    ]);
    ejecutivos   = execData.data   ?? [];
    delegaciones = delData.data    ?? [];
  } catch (err) {
    panel.innerHTML = `
      <div class="empty-state">
        <p>Error cargando datos de delegación: ${escHtml(err.message)}</p>
      </div>`;
    return;
  }

  // ── Build the dropdown options ─────────────────────────────────────────────
  const ejecutivoOptions = ejecutivos.length > 0
    ? ejecutivos.map(e =>
        `<option value="${e.id}">${escHtml(e.nombre_completo)} (${escHtml(e.nombre_usuario)})</option>`
      ).join('')
    : `<option value="" disabled>Sin Ejecutivos activos</option>`;

  // ── Build the delegation history table ────────────────────────────────────
  const historyRows = delegaciones.length > 0
    ? delegaciones.map(d => `
        <tr>
          <td class="fw-600">${escHtml(d.delegado_nombre ?? '—')}</td>
          <td class="text-muted text-sm">${escHtml(d.delegado_usuario ?? '—')}</td>
          <td>${escHtml(d.delegado_rol ?? '—')}</td>
          <td class="text-sm">${fmtDate(d.fecha_inicio)}</td>
          <td class="text-sm">${fmtDate(d.fecha_fin)}</td>
          <td>${_statusBadge(d)}</td>
          <td>
            ${d.activo
              ? `<button class="btn btn-danger btn-sm" data-revoke="${d.id}"
                         style="font-size:.75rem;padding:.25rem .6rem;">
                   ✕ Revocar
                 </button>`
              : `<span class="text-muted text-xs">—</span>`}
          </td>
        </tr>`)
      .join('')
    : `<tr>
         <td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">
           Sin delegaciones registradas.
         </td>
       </tr>`;

  panel.innerHTML = `
    <!-- ── Create Delegation Card ─────────────────────────────────────── -->
    <div class="card" style="margin-bottom:1.5rem;border-left:4px solid var(--clr-blue);">
      <div class="card-header">
        <h3>🔑 Activar Delegación Temporal</h3>
        <span class="text-muted text-sm">
          Transfiera su autoridad de aprobación temporalmente a un Ejecutivo.
        </span>
      </div>
      <div style="padding:1.25rem;">
        <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;align-items:end;">

          <!-- Delegate selection -->
          <div class="form-group" style="margin:0;">
            <label class="form-label" for="del-ejecutivo">
              Ejecutivo Delegado <span style="color:var(--clr-red);">*</span>
            </label>
            <select class="form-control" id="del-ejecutivo">
              <option value="">— Seleccionar Ejecutivo —</option>
              ${ejecutivoOptions}
            </select>
            <span class="field-error" id="del-ejecutivo-err"></span>
          </div>

          <!-- fecha_inicio -->
          <div class="form-group" style="margin:0;">
            <label class="form-label" for="del-inicio">
              Fecha y Hora de Inicio <span style="color:var(--clr-red);">*</span>
            </label>
            <input
              class="form-control"
              type="datetime-local"
              id="del-inicio"
              style="color-scheme:dark;"
            />
            <span class="field-error" id="del-inicio-err"></span>
          </div>

          <!-- fecha_fin -->
          <div class="form-group" style="margin:0;">
            <label class="form-label" for="del-fin">
              Fecha y Hora de Fin <span style="color:var(--clr-red);">*</span>
            </label>
            <input
              class="form-control"
              type="datetime-local"
              id="del-fin"
              style="color-scheme:dark;"
            />
            <span class="field-error" id="del-fin-err"></span>
          </div>

        </div>

        <!-- Info note -->
        <p class="text-sm" style="color:var(--text-secondary);margin-top:.75rem;">
          ⚠️ Durante la ventana de tiempo definida, el Ejecutivo seleccionado tendrá
          permisos equivalentes a Jefe para gestionar cotizaciones.  La delegación
          puede revocarse en cualquier momento desde la tabla inferior.
        </p>

        <!-- Submit -->
        <div style="margin-top:1rem;display:flex;gap:.75rem;align-items:center;">
          <button class="btn btn-primary" id="btn-crear-delegacion"
                  style="display:inline-flex;align-items:center;gap:.4rem;">
            🔑 Activar Delegación Temporal
          </button>
          <span class="field-error" id="del-global-err"></span>
        </div>
      </div>
    </div>

    <!-- ── Delegation History Table ───────────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <h3>📋 Historial de Delegaciones</h3>
        <span class="text-muted text-sm">${delegaciones.length} registro(s)</span>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Delegado</th>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="del-history-body">
            ${historyRows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // ── Wire revoke buttons ────────────────────────────────────────────────────
  panel.querySelectorAll('[data-revoke]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.revoke;
      if (!confirm('¿Revocar esta delegación? El usuario delegado perderá los permisos inmediatamente.')) return;
      btn.disabled    = true;
      btn.textContent = '…';
      try {
        await api.delete(`/api/delegaciones/${id}`);
        showToast('Delegación revocada exitosamente.', 'success');
        await renderDelegacionPanel(panel); // full reload
      } catch (err) {
        showToast(err.data?.message || err.message || 'Error al revocar.', 'error');
        btn.disabled    = false;
        btn.textContent = '✕ Revocar';
      }
    });
  });

  // ── Wire create-delegation form ────────────────────────────────────────────
  panel.querySelector('#btn-crear-delegacion')?.addEventListener('click', async () => {
    const selectEl   = panel.querySelector('#del-ejecutivo');
    const inicioEl   = panel.querySelector('#del-inicio');
    const finEl      = panel.querySelector('#del-fin');
    const globalErr  = panel.querySelector('#del-global-err');

    // Clear previous errors
    panel.querySelector('#del-ejecutivo-err').textContent = '';
    panel.querySelector('#del-inicio-err').textContent    = '';
    panel.querySelector('#del-fin-err').textContent       = '';
    globalErr.textContent = '';

    const id_usuario_delegado = selectEl?.value;
    const fecha_inicio        = inicioEl?.value;
    const fecha_fin           = finEl?.value;

    // Client-side validation
    let hasError = false;
    if (!id_usuario_delegado) {
      panel.querySelector('#del-ejecutivo-err').textContent = 'Seleccione un Ejecutivo.';
      hasError = true;
    }
    if (!fecha_inicio) {
      panel.querySelector('#del-inicio-err').textContent = 'La fecha de inicio es requerida.';
      hasError = true;
    }
    if (!fecha_fin) {
      panel.querySelector('#del-fin-err').textContent = 'La fecha de fin es requerida.';
      hasError = true;
    }
    if (fecha_inicio && fecha_fin && new Date(fecha_fin) <= new Date(fecha_inicio)) {
      panel.querySelector('#del-fin-err').textContent = 'La fecha de fin debe ser posterior al inicio.';
      hasError = true;
    }
    if (hasError) return;

    const submitBtn = panel.querySelector('#btn-crear-delegacion');
    submitBtn.disabled    = true;
    submitBtn.textContent = '…';

    try {
      await api.post('/api/delegaciones', {
        id_usuario_delegado: parseInt(id_usuario_delegado, 10),
        fecha_inicio,
        fecha_fin,
      });
      showToast('Delegación temporal activada exitosamente.', 'success');
      await renderDelegacionPanel(panel); // full reload with updated list
    } catch (err) {
      const msg = err.data?.message || err.message || 'Error al crear la delegación.';
      globalErr.textContent = msg;
      submitBtn.disabled    = false;
      submitBtn.textContent = '🔑 Activar Delegación Temporal';
    }
  });
}
