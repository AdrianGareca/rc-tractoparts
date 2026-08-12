// =============================================================================
// public/js/views/dashboard/modules/licitacionModal.js
// "Nueva / Editar Licitación" — y también el modal de "Adjuntar Documentos",
// vía mode: 'attach'.
//
// QUÉ QUEDÓ ACÁ Y QUÉ SE FUE
// Esta función tenía 269 líneas de código y era la más larga del proyecto: la
// plantilla, el autocompletado de convocante, el selector de archivos y los dos
// caminos de guardado, todo en un solo cuerpo. Hoy es lo que su nombre dice —
// abre el modal — y cada pieza vive en su archivo:
//
//   licitacion/modalPlantilla.js    el HTML del formulario
//   licitacion/modalConvocante.js   el autocompletado de entidad convocante
//   licitacion/modalDocumentos.js   elegir archivos y mostrarlos
//   licitacion/modalGuardado.js     qué pasa al apretar guardar
//
// Cada una se puede leer sola. Las cuatro se montan sobre el MISMO overlay y se
// comunican por el DOM —el campo oculto del convocante, el mensaje de error—,
// no por variables compartidas: por eso ninguna necesita saber de las otras.
//
// LOS TRES MODOS
//   'create'  formulario completo + documentos opcionales. `licitacion` se ignora.
//   'edit'    formulario completo + documentos. Requiere `licitacion`. Solo se
//             llega mientras está en un estado editable (En preparacion /
//             Cotizando) — lo hace cumplir quien abre el modal, que recién
//             entonces cablea el botón "Editar".
//   'attach'  SOLO documentos, sin cabecera y sin restricción de estado.
//             Requiere `licitacion`. Deja adjuntar archivos en cualquier etapa
//             (por ejemplo después de "Adjudicada"), que es lo que 'edit' no
//             puede hacer una vez que la cabecera queda de solo lectura.
//
// Exporta: openLicitacionModal({ mode, licitacion, onSaved, mountTarget })
// =============================================================================

import { rotulosDelModal, construirModal } from './licitacion/modalPlantilla.js';
import { montarBuscadorDeConvocante }      from './licitacion/modalConvocante.js';
import { montarSelectorDeDocumentos }      from './licitacion/modalDocumentos.js';
import { subirDocumentosSueltos, guardarCabecera } from './licitacion/modalGuardado.js';

/**
 * @param {object}   opciones
 * @param {'create'|'edit'|'attach'} opciones.mode
 * @param {object|null} opciones.licitacion  la fila a editar o a la que adjuntar
 * @param {Function} opciones.onSaved        se corre después de guardar/subir bien
 * @param {HTMLElement} opciones.mountTarget dónde colgar el overlay
 */
export function openLicitacionModal({ mode = 'create', licitacion = null, onSaved, mountTarget = document.body }) {
  // Los modos que necesitan una fila se exigen con `&& licitacion`: sin ella,
  // 'edit' y 'attach' no tienen a qué referirse y el modal cae a 'create'.
  const isAttach = mode === 'attach' && Boolean(licitacion);
  const isEdit   = mode === 'edit'   && Boolean(licitacion);
  const showHeaderFields = !isAttach;

  const { title, submitLabel } = rotulosDelModal({ isAttach, isEdit });

  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = construirModal({
    licitacion, isEdit, isAttach, showHeaderFields, title, submitLabel,
  });

  mountTarget.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const close = () => overlay.remove();

  $('#lic-close').addEventListener('click', close);
  $('#lic-cancel').addEventListener('click', close);
  // Clic en el fondo = cerrar. Se compara con el overlay mismo: un clic adentro
  // del modal burbujea hasta acá y cerraría la ventana a mitad de la carga.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Las dos piezas interactivas. Cada una encuentra sus propios elementos y no
  // hace nada si no están (en 'attach' no hay convocante que buscar).
  montarBuscadorDeConvocante({ overlay });
  const documentos = montarSelectorDeDocumentos({ overlay });

  // ── Guardar ─────────────────────────────────────────────────────────────────
  $('#lic-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl = $('#lic-form-err');
    errEl.textContent = '';

    // Contexto común a los dos caminos. `alTerminar` cierra el modal y avisa a
    // quien lo abrió: es lo que refresca la lista de atrás.
    const contexto = {
      documentos,
      boton: $('#lic-submit'),
      mostrarError: (mensaje) => { errEl.textContent = mensaje; },
      alTerminar: (resultado) => {
        close();
        if (typeof onSaved === 'function') onSaved(resultado);
      },
    };

    if (isAttach) {
      await subirDocumentosSueltos({ ...contexto, licitacion });
      return;
    }

    await guardarCabecera({ ...contexto, $, licitacion, isEdit });
  });

  // El foco al primer campo útil. El setTimeout espera a que el navegador
  // termine de insertar el overlay: enfocar un nodo que todavía no se pintó no
  // hace nada y la persona tiene que ir al campo con el mouse.
  setTimeout(() => (showHeaderFields ? $('#lic-nombre') : $('#lic-doc-input'))?.focus(), 50);
}
