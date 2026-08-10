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
import { buildProformaActions } from './proformaActions.js';

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
    : `<tr><td colspan="${showCodigos ? 6 : 5}" class="empty-cell">Sin ítems registrados</td></tr>`;

  // Los permisos de interfaz y los tres bloques de botones viven en
  // ./proformaActions.js. Son DECISIÓN (quién puede qué) y no presentación:
  // mezclados acá adentro, cambiar un permiso obligaba a leer trescientas
  // líneas de HTML para encontrar el if.
  const { jefeButtons, adminButtons, delegateButtons, adminCommentBlock } =
    buildProformaActions(q, { jefeMode, adminMode, delegateMode });

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
          <span class="form-label">Fecha de emisión</span>
          <p>${fmtDate(q.fecha_emision)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Fecha de validez</span>
          <p>${fmtDate(q.fecha_validez)}</p>
        </div>
        <div class="proforma-meta-item">
          <span class="form-label">Moneda</span>
          <p>${q.moneda}</p>
        </div>
      </div>

      <!-- Description -->
      <div class="form-group mb-2">
        <span class="form-label">Descripción</span>
        <p class="proforma-description">${escHtml(q.descripcion)}</p>
      </div>

      <!-- Solicitor data (DATOS DEL SOLICITANTE — mirrors the PDF grid) -->
      <div class="form-group mb-2">
        <span class="form-label proforma-bloque-label">Datos del solicitante</span>
        <div class="proforma-meta-bar mt-04">
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
      <div class="form-group mb-2">
        <span class="form-label proforma-bloque-label">Datos del equipo</span>
        <div class="proforma-meta-bar mt-04">
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
      <div class="table-wrapper proforma-items-wrapper mb-2">
        <table class="data-table proforma-items-table">
          <thead>
            <tr>
              <th>Descripción del ítem</th>
              ${showCodigos ? '<th>Cód. parte</th>' : ''}
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
          <span class="proforma-descuento">− ${q.moneda} ${descuento.toFixed(2)}</span>
        </div>` : ''}
        <div class="proforma-total-row proforma-grand-total">
          <span>TOTAL</span>
          <span class="fw-600">${q.moneda} ${total.toFixed(2)}</span>
        </div>
      </div>

      ${q.obs_aprobacion ? `
      <div class="form-group mt-2">
        <span class="form-label">Observaciones de aprobación</span>
        <p class="proforma-description">${escHtml(q.obs_aprobacion)}</p>
      </div>` : ''}

      ${q.observaciones ? `
      <div class="form-group mt-1">
        <span class="form-label">Observaciones generales</span>
        <p class="proforma-description">${escHtml(q.observaciones)}</p>
      </div>` : ''}

      <!-- Admin comment — read-only in Jefe mode -->
      ${adminCommentBlock}

      <!-- PDF + Excel viewer buttons -->
      <div class="proforma-pdf-bar">
        ${q.pdf_ruta ? `
        <button class="btn btn-outline btn-sm" id="btn-ver-pdf" type="button">
          Ver PDF Adjunto
        </button>` : `
        <span class="text-muted text-sm">Sin documento PDF adjunto.</span>`}
        ${q.excel_ruta ? `
        <button
          type="button"
          id="btn-ver-excel"
          class="btn btn-sm btn-excel"
        >
          Descargar Excel
        </button>` : ''}
      </div>

      ${jefeButtons}
      ${adminButtons}
      ${delegateButtons}
    </div>
  `;
}
