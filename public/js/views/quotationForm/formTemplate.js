// =============================================================================
// public/js/views/quotationForm/formTemplate.js
// Plantilla HTML del formulario de cotización.
//
// Función PURA: recibe la vista previa del correlativo y si estamos editando,
// y devuelve el markup completo. No toca el DOM ni conoce al Mediator — todo
// el cableado de eventos ocurre despues, en quotationForm.js.
//
// Extraído de FormMediator._buildFormHTML sin cambios de comportamiento.
// =============================================================================

import { escText } from './helpers.js';
import { stateIcon } from '../../shared/icons.js';

export function buildFormHTML({ nextCorrelativo = '', isEdit = false } = {}) {
  // Shared "(Opcional)" label marker — appended to every non-mandatory field
  // so users know at a glance which inputs can be left blank.
  const OPT = '<span style="color:#9ca3af;font-size:.8rem;font-weight:400;">(Opcional)</span>';

  const corrPreview = nextCorrelativo
    ? `<div class="correlativo-preview" style="display:inline-flex;align-items:center;gap:.5rem;
           padding:.25rem .75rem;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;
           font-size:.85rem;color:#1D4ED8;font-weight:600;margin-bottom:.75rem;">
         <span style="color:var(--clr-gray);font-weight:400;">Próximo Nº:</span>
         <span>${escText(nextCorrelativo)}</span>
       </div>`
    : '';

  return /* html */ `
    <form id="quotation-form" novalidate>
      <div class="form-alert alert-warning" id="qf-lock-banner" role="alert"></div>
      ${corrPreview}

      <!-- Header fields -->
      <div class="form-row">
        <!-- CLIENT SELECTOR: replaces the old number input -->
        <div class="form-group" style="flex:2;">
          <label class="form-label" for="cliente-search">Cliente *</label>
          <div class="client-select-wrapper">
            <div class="client-search-group">
              <input
                class="form-control"
                type="text"
                id="cliente-search"
                placeholder="Buscar por nombre o NIT…"
                autocomplete="off"
                aria-haspopup="listbox"
                aria-autocomplete="list"
              />
              <button type="button" id="btn-nuevo-cliente" class="btn btn-outline-green btn-sm btn-nuevo-cliente"
                      title="Registrar nuevo cliente en el sistema">
                + Nuevo Cliente
              </button>
            </div>
            <!-- Hidden field stores the resolved numeric client ID -->
            <input type="hidden" id="id_cliente" />
            <!-- Autocomplete dropdown -->
            <div class="client-dropdown" id="client-dropdown" role="listbox" aria-label="Clientes sugeridos"></div>
          </div>
          <span class="field-error" id="err-cliente"></span>
        </div>

        <div class="form-group">
          <label class="form-label" for="fecha_emision">Fecha de Emisión *</label>
          <input class="form-control" type="date" id="fecha_emision" required />
          <span class="field-error" id="err-fecha"></span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="id_licitacion">Licitación asociada <span class="text-muted">(opcional)</span></label>
        <select class="form-control" id="id_licitacion">
          <option value="">— Sin licitación (cotización suelta) —</option>
        </select>
        <span class="field-hint text-muted text-sm">Vincula esta cotización a una licitación en curso para que Proyectos la vea en su seguimiento.</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="descripcion">Descripción *</label>
        <textarea class="form-control" id="descripcion" rows="2" placeholder="Descripción de la cotización" required></textarea>
        <span class="field-error" id="err-descripcion"></span>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="moneda">Moneda</label>
          <select class="form-control" id="moneda">
            <option value="BOB">BOB — Boliviano</option>
            <option value="USD">USD — Dólar</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="entidad_emisora">Entidad Emisora *</label>
          <select class="form-control" id="entidad_emisora">
            <option value="Empresa unipersonal de Ronald Roca Cartagena">Empresa unipersonal de Ronald Roca Cartagena</option>
            <option value="Roca Importaciones S.R.L.">Roca Importaciones S.R.L.</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="tipo_pedido">Tipo / Canal de Pedido</label>
          <input class="form-control" type="text" id="tipo_pedido" placeholder="Ej: EMAIL, PRESENCIAL, TELÉFONO" maxlength="50" />
        </div>
        <div class="form-group">
          <label class="form-label" for="fecha_validez">
            Fecha de Validez
            <span
              class="info-icon"
              tabindex="0"
              role="tooltip"
              aria-label="Fecha límite de precios y disponibilidad"
              data-tooltip="En Bolivia, los precios de repuestos pesados fluctuan con el tipo de cambio y disponibilidad de importación. Esta fecha garantiza al cliente los precios y el stock cotizados. Pasada esta fecha, los valores pueden variar."
            >ⓘ</span>
          </label>
          <input class="form-control" type="date" id="fecha_validez" />
          <span class="field-error" id="err-validez"></span>
        </div>
        <div class="form-group">
          <label class="form-label" for="observaciones">Observaciones</label>
          <input class="form-control" type="text" id="observaciones" placeholder="Opcional" />
        </div>
      </div>

      <!-- DATOS DEL SOLICITANTE -->
      <details class="form-section-details" open>
        <summary class="form-section-summary">Datos del Solicitante</summary>
        <div class="form-row" style="margin-top:.75rem;">
          <div class="form-group">
            <label class="form-label" for="solicitante_nombre">Nombre del Solicitante ${OPT}</label>
            <input class="form-control" type="text" id="solicitante_nombre"
                   placeholder="Ej: Juan Pérez" maxlength="120" />
          </div>
          <div class="form-group">
            <label class="form-label" for="solicitante_no_solicitud">Nº Solicitud / OC ${OPT}</label>
            <input class="form-control" type="text" id="solicitante_no_solicitud"
                   placeholder="Ej: OC-2026-0045" maxlength="100" />
          </div>
          <div class="form-group">
            <label class="form-label" for="solicitante_area">Área / Departamento ${OPT}</label>
            <input class="form-control" type="text" id="solicitante_area"
                   placeholder="Ej: Mantenimiento" maxlength="100" />
          </div>
          <div class="form-group">
            <label class="form-label" for="solicitante_celular">Celular ${OPT}</label>
            <input class="form-control" type="tel" id="solicitante_celular"
                   placeholder="Ej: 77012345" maxlength="30" />
          </div>
          <div class="form-group">
            <label class="form-label" for="solicitante_correo">Correo ${OPT}</label>
            <input class="form-control" type="email" id="solicitante_correo"
                   placeholder="solicitante@empresa.com" maxlength="120" />
          </div>
        </div>
      </details>

      <!-- DATOS DEL EQUIPO -->
      <details class="form-section-details" open>
        <summary class="form-section-summary">Datos del Equipo</summary>
        <div class="form-row" style="margin-top:.75rem;">
          <div class="form-group">
            <label class="form-label" for="equipo_marca">Marca ${OPT}</label>
            <input class="form-control" type="text" id="equipo_marca"
                   placeholder="Ej: Caterpillar" maxlength="80" />
          </div>
          <div class="form-group">
            <label class="form-label" for="equipo_tipo">Tipo ${OPT}</label>
            <input class="form-control" type="text" id="equipo_tipo"
                   placeholder="Ej: Excavadora" maxlength="80" />
          </div>
          <div class="form-group">
            <label class="form-label" for="equipo_modelo">Modelo ${OPT}</label>
            <input class="form-control" type="text" id="equipo_modelo"
                   placeholder="Ej: 336" maxlength="80" />
          </div>
          <div class="form-group">
            <label class="form-label" for="equipo_serie">Nº Serie ${OPT}</label>
            <input class="form-control" type="text" id="equipo_serie"
                   placeholder="Ej: CAT0336XXXXX" maxlength="80" />
          </div>
          <div class="form-group">
            <label class="form-label" for="equipo_motor">Nº Motor ${OPT}</label>
            <input class="form-control" type="text" id="equipo_motor"
                   placeholder="Ej: C9.3" maxlength="80" />
          </div>
        </div>
      </details>

      <!-- CONDICIONES LOGÍSTICAS -->
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="tiempo_entrega">Tiempo de Entrega (general)</label>
          <input class="form-control" type="text" id="tiempo_entrega"
                 placeholder="Ej: 25 DÍAS CALENDARIO" maxlength="100" />
        </div>
      </div>

      <!-- Line items — OBSERVER Subject changes trigger all three Observers -->
      <div class="line-items-section">
        <h4>Ítems de Detalle</h4>
        <div class="table-wrapper" style="border-radius:6px;">
          <table class="line-items-table">
            <thead>
            <tr>
              <th style="width:22%">Descripción</th>
              <th style="width:10%">Cód. Parte</th>
              <th style="width:10%">Cód. Alt.</th>
              <th style="width:11%">Marca</th>
              <th style="width:7%">UM</th>
              <th style="width:7%">Cantidad</th>
              <th style="width:11%">Precio Unit.</th>
              <th style="width:10%">Subtotal</th>
              <th style="width:10%">T. Entrega</th>
              <th style="width:2%"></th>
            </tr>
          </thead>
            <tbody id="items-body"></tbody>
          </table>
        </div>
        <button type="button" id="btn-add-item" class="btn btn-ghost btn-sm btn-add-item">
          + Agregar ítem
        </button>
      </div>

      <!-- Totals panel — updated by TotalsObserver -->
      <div class="totals-panel">
        <div class="totals-row">
          <span>Subtotal</span>
          <span class="totals-value" id="totals-subtotal">0.00</span>
        </div>
        <div class="totals-row">
          <label for="totals-discount" style="font-size:.85rem;color:var(--text-secondary);">
            Descuento Manual (monto fijo)
          </label>
          <input
            type="number"
            id="totals-discount"
            min="0" step="any"
            placeholder="0.00"
            style="width:120px;text-align:right;padding:.25rem .5rem;border:1px solid var(--border);border-radius:4px;font-size:.9rem;"
            title="Ingrese un descuento en monto absoluto (no porcentaje). Se resta directamente del subtotal."
          />
        </div>
        <div class="totals-row total-final">
          <span>Total</span>
          <span class="totals-value" id="totals-total">0.00</span>
        </div>
      </div>

      <!-- Payment terms + PDF config -->
      <div class="form-row" style="margin-top:1rem;align-items:flex-end;gap:1rem;flex-wrap:wrap;">
        <div class="form-group" style="flex:2;min-width:220px;">
          <label class="form-label" for="forma_pago">Forma de Pago</label>
          <select class="form-control" id="forma_pago">
            <option value="">Por defecto (60% ANTICIPO Y SALDO CONTRA ENTREGA)</option>
            <option value="20% DE ANTICIPO">20% DE ANTICIPO</option>
            <option value="30% DE ANTICIPO">30% DE ANTICIPO</option>
            <option value="40% DE ANTICIPO">40% DE ANTICIPO</option>
            <option value="50% DE ANTICIPO">50% DE ANTICIPO</option>
            <option value="60% DE ANTICIPO">60% DE ANTICIPO</option>
            <option value="__otro__">Otro (Personalizado)</option>
          </select>
        </div>
        <div class="form-group" style="flex:2;min-width:220px;display:none;" id="forma_pago_custom_group">
          <label class="form-label" for="forma_pago_custom">Forma de Pago Personalizada</label>
          <input class="form-control" type="text" id="forma_pago_custom"
                 placeholder="Ej: 70% ANTICIPO Y SALDO A 30 DÍAS" maxlength="200" />
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:.5rem;padding-bottom:.25rem;">
          <input type="checkbox" id="mostrar_codigos" checked
                 style="width:16px;height:16px;cursor:pointer;" />
          <label for="mostrar_codigos" class="form-label" style="margin:0;cursor:pointer;">
            Mostrar columna CÓDIGO en el PDF
          </label>
        </div>
      </div>

      <!-- Excel optional attachment -->
      <div class="form-group mt-2">
        <label class="form-label">Planilla Excel de Auditoría (opcional)</label>
        <div class="drop-zone drop-zone-excel" id="excel-drop-zone">
          <input type="file" id="excel-input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
          <div class="drop-zone-icon">${stateIcon('subir')}</div>
          <p class="drop-zone-text">Arrastra un archivo .xlsx aquí o haz clic para seleccionar</p>
          <p class="drop-zone-hint">Máximo 10 MB · Solo archivos .xlsx</p>
          <p class="drop-zone-file hidden" id="excel-file-name"></p>
        </div>
      </div>

      <!-- General form alert -->
      <div class="form-alert" id="qf-alert" role="alert"></div>

      <!-- Footer buttons -->
      <div class="modal-actions">
        <button type="button" id="btn-cancel" class="btn btn-ghost">Cancelar</button>
        <button type="submit" id="btn-submit" class="btn btn-primary">
          <span class="btn-label">${isEdit ? 'Guardar Cambios' : 'Crear Cotización'}</span>
          <span class="spinner hidden btn-spinner"></span>
        </button>
      </div>

    </form>
  `;
}
