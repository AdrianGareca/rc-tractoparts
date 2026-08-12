// =============================================================================
// public/js/views/dashboard/modules/licitacion/modalPlantilla.js
// El HTML del modal de licitación, y nada más.
//
// POR QUÉ ESTÁ SEPARADO
// openLicitacionModal tenía 269 líneas de código —era la función más larga del
// proyecto— y casi cien eran una cadena de texto. Armar el HTML no comparte
// nada con cablear los eventos: no lee estado, no toca la red, no depende del
// DOM montado. Es una función de datos a texto.
//
// Sacarla tiene dos efectos que se sienten enseguida: lo que queda en el modal
// es lógica de verdad (ninguna plantilla en el medio), y el formulario se puede
// revisar de un vistazo sin buscarlo entre los addEventListener.
//
// TODO lo que entra del servidor pasa por escHtml. Los nombres de las entidades
// convocantes los escriben las personas, y un apóstrofo en «Gob. Aut. Mun. de
// L'Eduardo» rompe el atributo si no se escapa.
// =============================================================================

import { escHtml } from '../../helpers.js';

/** Las dos monedas del sistema. Espejo de VALID_CURRENCIES en LicitacionModel. */
export const CURRENCIES = ['BOB', 'USD'];

/** Extensiones que el servidor acepta como documento de licitación. */
export const ALLOWED_DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'];

/**
 * Los dos textos que cambian según para qué se abrió el modal.
 *
 * Estaban como dos ternarios anidados en línea. Acá son una tabla, que es lo
 * que son: tres modos, dos textos cada uno.
 *
 * @param {{ isAttach: boolean, isEdit: boolean }} modo
 * @returns {{ title: string, submitLabel: string }}
 */
export function rotulosDelModal({ isAttach, isEdit }) {
  if (isAttach) return { title: 'Adjuntar documentos', submitLabel: 'Subir documentos' };
  if (isEdit)   return { title: 'Editar licitación',   submitLabel: 'Guardar cambios' };
  return { title: 'Nueva licitación', submitLabel: 'Crear licitación' };
}

/**
 * Los campos de cabecera: nombre, convocante, descripción, presupuesto y fecha.
 * En modo 'attach' no se renderiza — no hay cabecera que editar.
 *
 * @param {object|null} licitacion  la fila a editar; se ignora si isEdit es false
 * @param {boolean} isEdit
 */
export function camposDeCabecera(licitacion, isEdit) {
  // Los valores precargados. Se calculan una vez arriba en lugar de repetir el
  // `isEdit ? … : ''` seis veces adentro de la plantilla, que es donde antes se
  // perdía de vista qué campo se precargaba y cuál no.
  const nombre       = isEdit ? escHtml(licitacion.nombre) : '';
  const clienteNom   = isEdit ? escHtml(licitacion.cliente_nombre ?? '') : '';
  const clienteId    = isEdit ? escHtml(String(licitacion.id_cliente)) : '';
  const descripcion  = isEdit && licitacion.descripcion ? escHtml(licitacion.descripcion) : '';
  const presupuesto  = isEdit && licitacion.presupuesto_referencial != null
    ? escHtml(String(licitacion.presupuesto_referencial))
    : '';
  // La fecha llega del servidor como marca de tiempo completa; el <input
  // type="date"> solo entiende AAAA-MM-DD y se queda vacío con cualquier otra
  // cosa — sin avisar.
  const fechaLimite  = isEdit && licitacion.fecha_limite
    ? escHtml(String(licitacion.fecha_limite).slice(0, 10))
    : '';

  const ayudaCliente = isEdit
    ? 'Convocante actual: ' + clienteNom
    : 'Selecciona la entidad que convoca la licitación.';

  return `
    <div class="form-group">
      <label class="form-label" for="lic-nombre">Nombre de la licitación *</label>
      <input class="form-control" id="lic-nombre" type="text" maxlength="200" required
             value="${nombre}"
             placeholder="Ej. Provisión de repuestos flota municipal 2026" />
    </div>

    <div class="form-group">
      <label class="form-label" for="lic-cliente-search">Entidad convocante *</label>
      <div class="client-select-wrapper">
        <div class="client-search-group">
          <input class="form-control" id="lic-cliente-search" type="text" autocomplete="off"
                 aria-haspopup="listbox" aria-autocomplete="list"
                 placeholder="Buscar por razón social o NIT…"
                 value="${clienteNom}" />
          <button type="button" class="btn btn-outline-green btn-sm btn-nuevo-cliente" id="lic-cliente-new"
                  title="Registrar nueva entidad convocante">+ Nuevo</button>
        </div>
        <!-- La fuente de verdad del convocante elegido. El campo de texto es
             solo lo que la persona ve; al guardar se lee de acá, así que
             escribir sin elegir de la lista NO deja un id colgado. -->
        <input type="hidden" id="lic-id-cliente" value="${clienteId}" />
        <div class="client-dropdown" id="lic-cliente-results" role="listbox" aria-label="Convocantes sugeridos"></div>
      </div>
      <small class="text-muted" id="lic-cliente-hint">${ayudaCliente}</small>
    </div>

    <div class="form-group">
      <label class="form-label" for="lic-descripcion">Descripción</label>
      <textarea class="form-control" id="lic-descripcion" rows="3" maxlength="5000"
                placeholder="Objeto de la licitación, alcance, notas…">${descripcion}</textarea>
    </div>

    <div class="flex gap-2 flex-wrap">
      <div class="form-group fg-crece-min">
        <label class="form-label" for="lic-presupuesto">Presupuesto referencial</label>
        <input class="form-control" id="lic-presupuesto" type="number" min="0" step="0.01"
               value="${presupuesto}" placeholder="0.00" />
      </div>
      <div class="form-group fg-120">
        <label class="form-label" for="lic-moneda">Moneda</label>
        <select class="form-control" id="lic-moneda">
          ${CURRENCIES.map((c) =>
            `<option value="${c}" ${isEdit && licitacion.moneda === c ? 'selected' : ''}>${c}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group fg-crece-min">
        <label class="form-label" for="lic-fecha-limite">Fecha límite</label>
        <input class="form-control" id="lic-fecha-limite" type="date" value="${fechaLimite}" />
      </div>
    </div>`;
}

/**
 * El modal completo: encabezado, formulario y botonera.
 *
 * @param {{ licitacion: object|null, isEdit: boolean, isAttach: boolean,
 *           showHeaderFields: boolean, title: string, submitLabel: string }} opciones
 * @returns {string} HTML del interior del overlay
 */
export function construirModal({ licitacion, isEdit, isAttach, showHeaderFields, title, submitLabel }) {
  // En modo adjuntar se muestra el código de la licitación en el título: es la
  // única referencia visible de a QUÉ se le están subiendo los archivos, porque
  // el formulario de cabecera no está.
  const sufijoTitulo = isAttach ? ` — ${escHtml(licitacion.codigo)}` : '';

  return `
    <div class="sub-modal">
      <div class="sub-modal-header">
        <h4>${title}${sufijoTitulo}</h4>
        <button type="button" class="btn-icon sub-modal-close" id="lic-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <form id="lic-form" novalidate>
          ${showHeaderFields ? camposDeCabecera(licitacion, isEdit) : ''}

          <div class="form-group">
            <label class="form-label">Documentos ${showHeaderFields ? '<span class="text-muted">(opcional)</span>' : ''}</label>
            <div class="flex items-center gap-1 flex-wrap">
              <input type="file" id="lic-doc-input" class="hidden" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" />
              <button type="button" class="btn btn-ghost btn-sm" id="lic-doc-pick">Elegir archivos</button>
              <span class="text-muted text-sm">PDF, Word, Excel o imágenes · varios a la vez</span>
            </div>
            <div id="lic-doc-filelist" class="mt-04"></div>
          </div>

          <div class="form-error" id="lic-form-err"></div>

          <div class="flex justify-end gap-1 mt-1">
            <button type="button" class="btn btn-ghost" id="lic-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary" id="lic-submit">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>`;
}
