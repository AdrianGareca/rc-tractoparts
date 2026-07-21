// =============================================================================
// public/js/views/dashboard/modules/proformaTemplate.js
// Generates the full read-only proforma view HTML for a quotation object.
// Used by the Executive's "Ver" detail, the Jefe's approval decision, and
// the Administrador's review panel.
//
// Extracted verbatim from dashboardView.js (formerly the module-private
// `_buildProformaHTML`) as part of the file-size cleanup — no behavioral
// change, just renamed to a public export.
// =============================================================================

import { badgeHtml, fmtDate, escHtml } from '../helpers.js';

//   @param {Object}  q         — full quotation data (from findById, includes detalles[])
//   @param {number}  id        — quotation ID (for PDF link)
//   @param {boolean|string} viewMode
//     false | 'executive' — Executive read-only view (no action buttons)
//     true  | 'jefe'      — Jefe full action grid + read-only admin comments
//     'admin'             — Administrador view: comment textarea + "En Espera" button
export function buildProformaHTML(q, id, viewMode) {
  const jefeMode     = viewMode === true  || viewMode === 'jefe';
  const adminMode    = viewMode === 'admin';
  // 'delegate' — Executive view PLUS the full operational action grid, shown to
  // executives holding the delegated can_approve_quotations flag (Delegación de
  // Funciones ampliada): aprobar, enviar, confirmar, solicitar cambios, en
  // espera y rechazar — same lifecycle powers as the Jefe, quotations ONLY.
  const delegateMode = viewMode === 'delegate';

  const detalles = q.detalles ?? [];
  const subtotal = detalles.reduce((sum, d) => sum + parseFloat(d.subtotal || 0), 0);
  // Prices are tax-inclusive — NO IVA is added on top. The TOTAL is the direct
  // sum of the line items minus the optional manual cash discount
  // (descuento_manual), mirroring the server-side monto_total math and the PDF.
  const descuento = q.descuento_manual != null ? (parseFloat(q.descuento_manual) || 0) : 0;
  const total     = Math.max(0, subtotal - descuento);

  // Escape-or-dash helper for optional metadata fields
  const v = (x) => (x != null && String(x).trim() !== '') ? escHtml(String(x)) : '—';

  // Mirror the PDF's CÓDIGO-column toggle so the on-screen preview and the
  // printed proforma always show the same column set (TINYINT 1/0, boolean,
  // or null on legacy rows → default to showing the column — same resolution
  // rule as pdfService.drawItemsTable).
  const showCodigos = q.mostrar_codigos == null ? true : Boolean(Number(q.mostrar_codigos));

  const detallesRows = detalles.length > 0
    ? detalles.map(d => {
        // Prefer the catalog Part Number (via productos FK); fall back to the
        // ad-hoc codigo_parte stored directly in the line item.
        const codigoParte = d.producto_codigo || d.codigo_parte;
        return `
        <tr>
          <td>${escHtml(d.descripcion_item)}</td>
          ${showCodigos ? `<td class="text-muted text-sm">${codigoParte ? escHtml(codigoParte) : '—'}</td>` : ''}
          ${d.marca_nombre ? `<td class="text-muted text-sm">${escHtml(d.marca_nombre)}</td>` : '<td class="text-muted text-sm">—</td>'}
          <td class="text-right">${Number(d.cantidad).toFixed(4).replace(/\.?0+$/, '')}</td>
          <td class="text-right">${Number(d.precio_unitario).toFixed(2)}</td>
          <td class="text-right fw-600">${Number(d.subtotal).toFixed(2)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="${showCodigos ? 6 : 5}" style="text-align:center;color:var(--text-muted);">Sin ítems registrados</td></tr>`;

  // Operational action grid — contextual buttons based on current state.
  // Rendered for the Jefe AND for delegated executives (Delegación de Funciones
  // ampliada): both operate the full lifecycle with the same transitions. The
  // backend re-validates every action against the DB-fresh flag, so these
  // conditionals are pure UI gating.
  const operative       = jefeMode || delegateMode;
  const canApprove      = operative && ['Pendiente', 'En revision', 'En espera'].includes(q.estado);
  const canEnviarCliente= operative && ['Pendiente', 'En revision', 'En espera', 'Aprobada internamente'].includes(q.estado);
  const canAceptar      = operative && ['Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRechazar     = operative && !['Confirmada', 'Aceptada', 'Archivada', 'Rechazada'].includes(q.estado);
  const canHold         = operative && ['Pendiente', 'En revision', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  const canRetract      = operative && ['En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente'].includes(q.estado);
  // High-privilege revert: only Jefe/SysAdmin can revert a Rechazada quotation.
  // Deliberately NOT extended to delegates — reverting a rejection re-opens a
  // closed commercial decision and stays with the Jefe.
  const canRevertir = jefeMode && q.estado === 'Rechazada';

  const jefeButtons = operative ? `
    <div class="approval-actions">
      <h4 class="approval-actions-title">${jefeMode ? 'Decisión del Jefe' : '🔑 Acciones Operativas — Delegación de Funciones'}</h4>
      <div class="approval-actions-grid">
        ${canRetract ? `<button class="btn btn-warning btn-sm" id="btn-solicitar-cambios">
          ↩ Solicitar Cambios
        </button>` : ''}
        ${canHold ? `<button class="btn btn-hold btn-sm" id="btn-en-espera">
          ⏸ Poner en Espera
        </button>` : ''}
        ${canApprove ? `<button class="btn btn-success" id="btn-aprobar">
          ✅ Aprobar Cotización
        </button>` : ''}
        ${canEnviarCliente ? `<button class="btn btn-success" id="btn-enviar-cliente"
          style="background:#16a34a;border-color:#15803d;grid-column:1/-1;">
          🟢 Aprobar y Enviar al Cliente
        </button>` : ''}
        ${canAceptar ? `<button class="btn btn-primary" id="btn-aceptar" style="grid-column:1/-1;">
          🏆 Confirmar Cotización — Cierre de Venta
        </button>` : ''}
        ${canRechazar ? `<button class="btn btn-danger btn-sm" id="btn-rechazar">
          ❌ Rechazar
        </button>` : ''}
      </div>
    </div>
    ${canRevertir ? `
    <div class="approval-actions" style="margin-top:1rem;border-top:2px solid #F59E0B;padding-top:1rem;">
      <h4 class="approval-actions-title" style="color:#B45309;">🔄 Revertir Rechazo</h4>
      <p class="text-sm" style="color:var(--text-secondary);margin-bottom:.75rem;">
        Como autoridad comercial superior, puede revaluar esta cotización y reintroducirla
        en el flujo de aprobación. Las observaciones de rechazo previas serán preservadas
        en el historial de estados.
      </p>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
        <button class="btn btn-warning btn-sm" id="btn-revertir-pendiente"
                style="background:#F59E0B;color:#000;border:none;">
          🔄 Revertir a Pendiente
        </button>
        <button class="btn btn-warning btn-sm" id="btn-revertir-revision"
                style="background:#F97316;color:#fff;border:none;">
          🔄 Revertir a En Revisión
        </button>
      </div>
    </div>` : ''}
    ` : '';

  // Admin action panel — comment box + "En Espera" + "Solicitar Cambios" buttons
  const adminButtons = adminMode ? `
    <div class="approval-actions" style="border-top:1px solid var(--border);margin-top:1.5rem;padding-top:1.25rem;">
      <h4 class="approval-actions-title">Revisión del Administrador</h4>
      <div class="form-group" style="margin-bottom:.75rem;">
        <label class="form-label" for="admin-comment-input">Comentario de Supervisión</label>
        <textarea class="form-control" id="admin-comment-input" rows="3"
                  placeholder="Ej: Verificar disponibilidad con proveedor antes de aprobar..."
                  style="resize:vertical;">${q.comentarios_admin ?? ''}</textarea>
        <span class="field-error" id="admin-comment-err"></span>
      </div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="btn-save-comment">
          💾 Guardar Comentario
        </button>
        <button class="btn btn-hold btn-sm" id="btn-admin-en-espera">
          ⏸ Poner en Espera con Comentario
        </button>
        ${
          ['En revision', 'En espera', 'Aprobada internamente'].includes(q.estado)
            ? `<button class="btn btn-warning btn-sm" id="btn-admin-solicitar-cambios">
          ↩ Solicitar Cambios
        </button>`
            : ''
        }
      </div>
    </div>` : '';

  // NOTE (Delegación ampliada): the former single "Aprobar Internamente" button
  // block was superseded by the full operational grid above (jefeButtons renders
  // in delegate mode too). Delegated actions are wired by ExecutiveStrategy to
  // flow through PUT /:id/estado — never the jefeOnly POST /:id/aprobar route.
  const delegateButtons = '';

  // Read-only admin comment block — shown to ALL authenticated roles when a
  // comment exists, so Ejecutivos can see supervisor notes.  In Jefe mode an
  // empty-state placeholder is also rendered so the section is never invisible.
  // Hidden in adminMode because that mode already provides an editable textarea.
  const adminCommentBlock = !adminMode && q.comentarios_admin
    ? `<div class="form-group" style="margin-top:1rem;padding:1rem;background:var(--bg-secondary,#f8f9fa);border-left:3px solid #F97316;border-radius:4px;">
      <span class="form-label" style="color:#F97316;">💬 Comentario del Administrador</span>
      <p class="proforma-description" style="margin-top:.25rem;">${escHtml(q.comentarios_admin)}</p>
    </div>`
    : jefeMode && !adminMode
      ? `<div class="form-group" style="margin-top:1rem;padding:1rem;background:var(--bg-secondary,#f8f9fa);border-left:3px solid #F97316;border-radius:4px;">
      <span class="form-label" style="color:#F97316;">💬 Comentario del Administrador</span>
      <p class="proforma-description text-muted" style="margin-top:.25rem;font-style:italic;">Sin comentarios del Administrador.</p>
    </div>`
      : '';

  return /* html */ `
    <div class="proforma-detail">

      <!-- Status + metadata bar -->
      <div class="proforma-meta-bar">
        <div class="proforma-meta-item">
          <span class="form-label">Estado</span>
          <p>${badgeHtml(q.estado)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Cliente</span>
          <p class="fw-600">${escHtml(q.cliente_nombre ?? q.id_cliente)}</p>
          ${q.cliente_nit ? `<small class="text-muted">NIT: ${escHtml(q.cliente_nit)}</small>` : ''}
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Ejecutivo</span>
          <p>${escHtml(q.ejecutivo_nombre ?? '—')}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Fecha Emisión</span>
          <p>${fmtDate(q.fecha_emision)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Fecha de Validez</span>
          <p>${fmtDate(q.fecha_validez)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Moneda</span>
          <p>${q.moneda}</p>
        </div>
      </div>

      <!-- Description -->
      <div class="form-group" style="margin-bottom:1rem;">
        <span class="form-label">Descripción</span>
        <p class="proforma-description">${escHtml(q.descripcion)}</p>
      </div>

      <!-- Solicitor data (DATOS DEL SOLICITANTE — mirrors the PDF grid) -->
      <div class="form-group" style="margin-bottom:1rem;">
        <span class="form-label" style="color:#1D4ED8;">👤 Datos del Solicitante</span>
        <div class="proforma-meta-bar" style="margin-top:.4rem;">
          <div class="proforma-meta-item">
            <span class="form-label">Nombre</span>
            <p>${v(q.nombre_sol)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Nº Solicitud / OC</span>
            <p>${v(q.nro_solicitud)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Área</span>
            <p>${v(q.area_sol)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Celular</span>
            <p>${v(q.celular_sol)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Correo</span>
            <p>${v(q.correo_sol)}</p>
          </div>
        </div>
      </div>

      <!-- Equipment data (DATOS DEL EQUIPO — mirrors the PDF grid) -->
      <div class="form-group" style="margin-bottom:1rem;">
        <span class="form-label" style="color:#1D4ED8;">🚜 Datos del Equipo</span>
        <div class="proforma-meta-bar" style="margin-top:.4rem;">
          <div class="proforma-meta-item">
            <span class="form-label">Marca</span>
            <p>${v(q.equipo_marca)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Tipo</span>
            <p>${v(q.equipo_tipo)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Modelo</span>
            <p>${v(q.equipo_modelo)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Serie</span>
            <p>${v(q.equipo_serie)}</p>
          </div>
          <div class="proforma-meta-item">
            <span class="form-label">Motor</span>
            <p>${v(q.equipo_motor)}</p>
          </div>
        </div>
      </div>

      <!-- Line items table -->
      <div class="table-wrapper proforma-items-wrapper" style="margin-bottom:1rem;">
        <table class="data-table proforma-items-table">
          <thead>
            <tr>
              <th>Descripción del Ítem</th>
              ${showCodigos ? '<th>Cód. Parte</th>' : ''}
              <th>Marca</th>
              <th class="text-right">Cantidad</th>
              <th class="text-right">Precio Unit. (${q.moneda})</th>
              <th class="text-right">Subtotal (${q.moneda})</th>
            </tr>
          </thead>
          <tbody>${detallesRows}</tbody>
        </table>
      </div>

      <!-- Totals panel (prices are tax-inclusive — no IVA row) -->
      <div class="proforma-totals">
        <div class="proforma-total-row">
          <span>Subtotal</span>
          <span class="fw-600">${q.moneda} ${subtotal.toFixed(2)}</span>
        </div>
        ${descuento > 0 ? `
        <div class="proforma-total-row">
          <span>Descuento</span>
          <span style="color:#C85A0F;font-weight:600;">− ${q.moneda} ${descuento.toFixed(2)}</span>
        </div>` : ''}
        <div class="proforma-total-row proforma-grand-total">
          <span>TOTAL</span>
          <span class="fw-600">${q.moneda} ${total.toFixed(2)}</span>
        </div>
      </div>

      ${q.obs_aprobacion ? `
      <div class="form-group" style="margin-top:1rem;">
        <span class="form-label">Observaciones de Aprobación</span>
        <p class="proforma-description">${escHtml(q.obs_aprobacion)}</p>
      </div>` : ''}

      ${q.observaciones ? `
      <div class="form-group" style="margin-top:.5rem;">
        <span class="form-label">Observaciones Generales</span>
        <p class="proforma-description">${escHtml(q.observaciones)}</p>
      </div>` : ''}

      <!-- Admin comment — read-only in Jefe mode -->
      ${adminCommentBlock}

      <!-- PDF + Excel viewer buttons -->
      <div class="proforma-pdf-bar">
        ${q.pdf_ruta ? `
        <button class="btn btn-outline btn-sm" id="btn-ver-pdf" type="button">
          📄 Ver PDF Adjunto
        </button>` : `
        <span class="text-muted text-sm">Sin documento PDF adjunto.</span>`}
        ${q.excel_ruta ? `
        <button
          type="button"
          id="btn-ver-excel"
          class="btn btn-sm"
          style="display:inline-flex;align-items:center;gap:.35rem;
                 background:#16a34a;color:#fff;border:1px solid #15803d;"
        >
          📊 Descargar Excel
        </button>` : ''}
      </div>

      ${jefeButtons}
      ${adminButtons}
      ${delegateButtons}
    </div>
  `;
}
