// =============================================================================
// public/js/views/quotationForm/brandModal.js
// Sub-modal de alta rápida de marca ("+" en la columna Marca de cada fila).
//
// Lógica PURA separada del cableado:
//   upsertBrand       — inserta la marca en el caché y lo reordena por nombre
//   buildBrandOptions — markup de <option> del selector de marca
//   openBrandModal    — monta el sub-modal y maneja el alta contra la API
//
// Extraído de FormMediator._openNuevaMarcaModal sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormBrandModal.test.js.
// =============================================================================

import api, { showToast } from '../../services/apiClient.js';
import { escText } from './helpers.js';

/**
 * Inserta una marca en el caché compartido si todavía no está, y lo reordena
 * alfabéticamente. Muta el array recibido a propósito: es la MISMA referencia
 * que el Mediator le pasa a cada fila, así el alta se ve en todos los selectores.
 * @returns {boolean} true si la marca se agregó (false si ya estaba).
 */
export function upsertBrand(brands, brand) {
  if (brands.find(b => b.id === brand.id)) return false;
  brands.push({ id: brand.id, nombre: brand.nombre });
  brands.sort((a, b) => a.nombre.localeCompare(b.nombre));
  return true;
}

/** Markup completo de un <select> de marca, con `selectedId` preseleccionada. */
export function buildBrandOptions(brands, selectedId = null) {
  return '<option value="">— Sin marca —</option>' +
    brands.map(b =>
      `<option value="${b.id}"${b.id === selectedId ? ' selected' : ''}>${escText(b.nombre)}</option>`
    ).join('');
}

// ---------------------------------------------------------------------------
// openBrandModal tenía 99 líneas de código: el HTML, el refresco de TODOS los
// selectores de marca de la grilla, y la rama de «esa marca ya existe». Se
// partió por esas tres costuras — la misma repartición que clientModal.js y
// licitacionModal.js, a propósito: son tres modales con la misma forma, y que se
// lean igual le quita trabajo a quien toque el tercero después de haber
// entendido el primero.
// ---------------------------------------------------------------------------

/** El HTML del modal. Es fijo: no hay modo editar ni datos que precargar. */
function construirModalMarca() {
  return /* html */ `
    <div class="sub-modal">
      <div class="sub-modal-header">
        <h4 id="bm-title">Registrar nueva marca</h4>
        <button type="button" class="btn-icon sub-modal-close" id="bm-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">
        <div class="form-group">
          <label class="form-label" for="bm-nombre">Nombre de la marca *</label>
          <input class="form-control" type="text" id="bm-nombre"
                 placeholder="Ej: Hitachi" maxlength="100" />
          <span class="field-error" id="bm-err"></span>
        </div>
        <div class="form-alert" id="bm-alert" role="alert"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="bm-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="bm-save">
            <span id="bm-label">Guardar Marca</span>
            <span class="spinner hidden" id="bm-spinner"></span>
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Deja la marca recién creada elegida en la fila que la pidió, y disponible en
 * TODAS las demás.
 *
 * POR QUÉ SE RECORREN TODOS LOS SELECTORES Y NO SÓLO EL DE LA FILA
 * El catálogo de marcas es uno solo para la grilla entera. Si la opción se
 * agregara nada más que en la fila que la creó, las otras diecinueve seguirían
 * sin verla y habría que crearla de nuevo en cada una — y el servidor
 * contestaría 409 cada vez.
 *
 * Al reconstruir cada <select> se pierde su valor, así que se guarda antes y se
 * restaura después. La única que cambia de valor es la fila que pidió la marca.
 */
function propagarMarcaNueva({ container, brands, brand, rowIndex, onFieldChange }) {
  upsertBrand(brands, brand);

  container.querySelectorAll('.item-marca').forEach((sel) => {
    const valorPrevio = sel.value;
    sel.innerHTML = buildBrandOptions(brands, brand.id);

    const idx = parseInt(sel.dataset.idx, 10);
    if (idx === rowIndex) {
      sel.value = String(brand.id);
      onFieldChange?.(rowIndex, 'marca_id', brand.id);
    } else {
      sel.value = valorPrevio;
    }
  });
}

/**
 * La marca ya existía (409).
 *
 * No es un error para quien la escribió: quería esa marca y es exactamente la
 * que hay. Se la elige y se avisa, en lugar de dejarlo con un rechazo y sin
 * saber qué hacer — que termina con alguien registrando «HITACHI 2».
 *
 * @returns {boolean} true si se resolvió acá; false si hay que mostrar el error
 */
function adoptarMarcaExistente({ err, container, brands, rowIndex, onFieldChange }) {
  if (!(err.status === 409 && err.data?.data)) return false;

  const existente = err.data.data;
  upsertBrand(brands, existente);

  // Sólo la fila que la pidió: las demás se enteran la próxima vez que se
  // redibujen, y forzar el redibujado entero por una marca que ya existía haría
  // perder lo que haya a medio escribir en las otras filas.
  const destino = container.querySelector(`.item-marca[data-idx="${rowIndex}"]`);
  if (destino) {
    if (!destino.querySelector(`option[value="${existente.id}"]`)) {
      const opt = document.createElement('option');
      opt.value       = existente.id;
      opt.textContent = existente.nombre;
      destino.appendChild(opt);
    }
    destino.value = String(existente.id);
    onFieldChange?.(rowIndex, 'marca_id', existente.id);
  }

  showToast(`Marca "${existente.nombre}" ya existe. Seleccionada automáticamente.`, 'info');
  return true;
}

/**
 * Abre el sub-modal de registro de marca.
 *
 * @param {number} rowIndex — fila que disparó el alta (recibe la marca nueva)
 * @param {Object} deps
 *   container     {HTMLElement} — raíz del formulario (para buscar los selectores)
 *   brands        {Array}       — caché compartido de marcas (se muta in-place)
 *   onFieldChange {Function}    — (idx, field, value) del Mediator
 */
export function openBrandModal(rowIndex, { container, brands, onFieldChange } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'bm-title');
  overlay.innerHTML = construirModalMarca();

  // Se cuelga del cuerpo del modal de cotización si existe, y del body si no:
  // este modal se abre DESDE otro modal, y colgarlo siempre del body lo dejaría
  // por debajo del que lo abrió.
  container.closest('.modal-body, [id="modal-body"]')?.appendChild(overlay)
    ?? document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const close = () => overlay.remove();

  $('#bm-close')?.addEventListener('click', close);
  $('#bm-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Enter guarda: es un formulario de un solo campo, y obligar a ir al botón con
  // el mouse rompe el ritmo de quien está cargando veinte ítems seguidos.
  $('#bm-nombre')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#bm-save')?.click(); }
  });

  $('#bm-save')?.addEventListener('click', async () => {
    const nombre  = $('#bm-nombre')?.value.trim();
    const errEl   = $('#bm-err');
    const alertEl = $('#bm-alert');
    const boton   = $('#bm-save');
    const rotulo  = $('#bm-label');
    const spinner = $('#bm-spinner');

    if (!nombre) { errEl.textContent = 'El nombre es requerido.'; return; }

    errEl.textContent  = '';
    alertEl.className  = 'form-alert';
    boton.disabled     = true;
    rotulo.textContent = 'Guardando...';
    spinner.classList.remove('hidden');

    try {
      const resp = await api.post('/api/marcas', { nombre });
      propagarMarcaNueva({ container, brands, brand: resp.data, rowIndex, onFieldChange });
      showToast(`Marca "${resp.data.nombre}" registrada y seleccionada.`, 'success');
      close();
    } catch (err) {
      if (adoptarMarcaExistente({ err, container, brands, rowIndex, onFieldChange })) {
        close();
        return;
      }

      alertEl.textContent = err.data?.message || err.message || 'Error al crear la marca.';
      alertEl.className   = 'form-alert show alert-error';

      // El botón se libera SÓLO en el camino de error: en el éxito el modal se
      // cierra y el botón se va con él, y restaurarlo antes de cerrar reabre por
      // un instante la ventana del doble clic.
      boton.disabled     = false;
      rotulo.textContent = 'Guardar Marca';
      spinner.classList.add('hidden');
    }
  });

  // El foco al campo. El setTimeout espera a que el navegador termine de
  // insertar el overlay: enfocar un nodo que todavía no se pintó no hace nada.
  setTimeout(() => $('#bm-nombre')?.focus(), 50);

  return overlay;
}
