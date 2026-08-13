// =============================================================================
// public/js/views/dashboard/modules/cliente/modalPlantilla.js
// El HTML del modal de cliente, y nada mas.
//
// POR QUE ESTA SEPARADO
// openClienteModal era la funcion mas larga del proyecto despues de partir la de
// licitaciones, y noventa de sus lineas eran esta cadena. Armar el HTML no
// comparte nada con cablear los eventos: no lee estado, no toca la red, no
// depende del DOM montado.
//
// EL DETALLE DE LA FILA DE ORIGEN NUEVO
// El div #nc-origen-new lleva "hidden" y "flex" a la vez, y las dos hacen falta.
// La regla .hidden es display:none !important y gana mientras este puesta; al
// sacarla, lo que queda tiene que ser un contenedor flex o el gap-1 no hace nada
// y los dos botones caen debajo del campo de texto.
//
// Antes el JavaScript ponia el display en flex al revelar la fila. Al migrar los
// estilos inline a clases, el display:none quedo cubierto y el flex se perdio.
// Como la fila nace oculta, no se nota hasta que alguien aprieta el mas.
// Lo vigila tests/unit/utilidadesFlexCoherentes.test.js.
//
// TODO lo que viene de la base pasa por escHtml: la razon social la escriben las
// personas, y un apostrofo en "Ferreteria D'Angelo" rompe el atributo sin el.
// =============================================================================

import { escHtml } from '../../helpers.js';

/**
 * El interior del overlay.
 * @param {object|null} client  la fila a editar; null al crear
 * @param {boolean} isEdit
 * @returns {string} HTML
 */
export function construirModalCliente(client, isEdit) {
  return `
    <div class="sub-modal">
      <div class="sub-modal-header">
        <h4 id="subm-title">${isEdit ? 'Editar Cliente' : 'Registrar Nuevo cliente'}</h4>
        <button type="button" class="btn-icon sub-modal-close" id="subm-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nc-razon-social">Razón social *</label>
            <input class="form-control" type="text" id="nc-razon-social"
                   placeholder="Nombre comercial o legal" maxlength="150"
                   value="${escHtml(client?.razon_social ?? '')}" />
            <span class="field-error" id="nc-err-razon"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="nc-nit">NIT</label>
            <input class="form-control" type="text" id="nc-nit"
                   placeholder="Ej: 1234567890" maxlength="20"
                   value="${escHtml(client?.nit ?? '')}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nc-contacto">Contacto</label>
            <input class="form-control" type="text" id="nc-contacto"
                   placeholder="Nombre del responsable"
                   value="${escHtml(client?.contacto ?? '')}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nc-telefono">Teléfono</label>
            <input class="form-control" type="tel" id="nc-telefono"
                   placeholder="Ej: 77012345"
                   value="${escHtml(client?.telefono ?? '')}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="nc-email">Email</label>
          <input class="form-control" type="email" id="nc-email"
                 placeholder="contacto@empresa.com"
                 value="${escHtml(client?.email ?? '')}" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="nc-direccion">Dirección</label>
            <input class="form-control" type="text" id="nc-direccion"
                   placeholder="Av. Cristo Redentor #123" maxlength="200"
                   value="${escHtml(client?.direccion ?? '')}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nc-ciudad">Ciudad</label>
            <input class="form-control" type="text" id="nc-ciudad"
                   placeholder="Santa Cruz de la Sierra" maxlength="100"
                   value="${escHtml(client?.ciudad ?? '')}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="nc-origen">Origen del cliente</label>
          <div class="item-marca-grupo">
            <select class="form-control fg-crece" id="nc-origen">
              <option value="">— Sin clasificar —</option>
            </select>
            <button type="button" id="nc-add-origen" title="Agregar nuevo origen"
                    class="btn-add-inline">
              +
            </button>
          </div>
          <div id="nc-origen-new" class="hidden flex gap-1 mt-1">
            <input class="form-control fg-crece" type="text" id="nc-origen-new-input"
                   placeholder="Ej: Feria comercial" maxlength="100" />
            <button type="button" class="btn btn-ghost btn-sm" id="nc-origen-new-save">Guardar</button>
            <button type="button" class="btn btn-ghost btn-sm" id="nc-origen-new-cancel">✕</button>
          </div>
          <span class="text-muted text-sm">Uso interno para reportes — no aparece en el PDF de la cotización.</span>
        </div>
        <div class="form-alert" id="nc-alert" role="alert"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="subm-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="subm-save">
            <span id="subm-label">${isEdit ? 'Guardar cambios' : 'Guardar Cliente'}</span>
            <span class="spinner hidden" id="subm-spinner"></span>
          </button>
        </div>
      </div>
    </div>
  `;
}
