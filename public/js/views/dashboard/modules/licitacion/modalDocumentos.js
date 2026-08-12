// =============================================================================
// public/js/views/dashboard/modules/licitacion/modalDocumentos.js
// El selector de documentos del modal de licitación.
//
// POR QUÉ ELIGE AHORA Y SUBE DESPUÉS
// Los archivos se acumulan en memoria y recién viajan cuando la licitación ya
// tiene id. Al crear una licitación nueva todavía no hay a qué adjuntarlos, y
// subir primero obligaría a inventar un registro provisorio que habría que
// limpiar si la persona cancela. Mismo patrón que el adjunto de Excel en
// quotationForm.js.
//
// QUÉ DEVUELVE Y POR QUÉ
// Un objeto con `hayArchivos()` y `aFormData()`, no la lista cruda. Quien
// guarda no necesita ver los archivos: necesita saber si hay y armar el envío.
// Devolver el arreglo dejaría que otro módulo lo modifique por atrás y la
// pantalla mostraría una cosa distinta de lo que se sube.
// =============================================================================

import { escHtml, docIcon } from '../../helpers.js';
import { ALLOWED_DOC_EXTENSIONS } from './modalPlantilla.js';

/** El nombre de campo que espera el servidor en el multipart. */
const CAMPO_MULTIPART = 'documentos';

/**
 * Cablea el selector de archivos dentro de un modal ya montado.
 *
 * @param {{ overlay: HTMLElement }} opciones
 * @returns {{ hayArchivos: () => boolean, cantidad: () => number, aFormData: () => FormData }}
 */
export function montarSelectorDeDocumentos({ overlay }) {
  const $ = (sel) => overlay.querySelector(sel);

  const boton  = $('#lic-doc-pick');
  const input  = $('#lic-doc-input');
  const lista  = $('#lic-doc-filelist');

  // Los archivos elegidos, en el orden en que se eligieron. Privado a propósito:
  // sale del módulo solo a través de aFormData().
  const elegidos = [];

  /** Redibuja la lista visible. Se llama después de cada alta y de cada baja. */
  function redibujar() {
    if (!lista) return;
    lista.innerHTML = elegidos.map((f, i) => `
      <div class="lista-item-compacto">
        <span>${docIcon(f.name)}</span>
        <span class="lista-item-nombre">${escHtml(f.name)}</span>
        <button type="button" class="btn-icon" data-remove-file="${i}" aria-label="Quitar ${escHtml(f.name)}">✕</button>
      </div>`).join('');

    // Los botones se recablean en cada redibujado porque el innerHTML de arriba
    // acaba de destruir los anteriores. No hay fuga: los nodos viejos ya no
    // existen y sus escuchas se van con ellos.
    lista.querySelectorAll('[data-remove-file]').forEach((btn) => {
      btn.addEventListener('click', () => {
        elegidos.splice(parseInt(btn.dataset.removeFile, 10), 1);
        redibujar();   // los índices de los que quedan cambiaron: hay que rehacerla
      });
    });
  }

  /**
   * Agrega archivos, salteando los de tipo no permitido.
   *
   * Los válidos se agregan igual: si alguien arrastra cinco archivos y uno es
   * un .zip, rechazar los cinco lo obliga a repetir toda la selección. Se
   * agregan los cuatro buenos y se avisa cuál quedó afuera.
   */
  function agregar(fileList) {
    const errEl = $('#lic-form-err');
    if (errEl) errEl.textContent = '';

    const rechazados = [];

    Array.from(fileList).forEach((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_DOC_EXTENSIONS.includes(ext)) { rechazados.push(f.name); return; }
      elegidos.push(f);
    });

    // Antes se escribía el mensaje adentro del bucle, así que con dos archivos
    // inválidos solo se veía el nombre del último y el primero desaparecía sin
    // explicación. Se juntan todos y se avisan de una.
    if (rechazados.length > 0 && errEl) {
      errEl.textContent = rechazados.length === 1
        ? `Tipo no permitido: "${rechazados[0]}". Solo PDF, Word, Excel o imágenes.`
        : `${rechazados.length} archivos de tipo no permitido: ${rechazados.join(', ')}. Solo PDF, Word, Excel o imágenes.`;
    }

    redibujar();
  }

  if (boton && input) {
    boton.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      if (e.target.files.length) agregar(e.target.files);
      // Vaciar el input permite volver a elegir EL MISMO archivo después de
      // haberlo quitado de la lista: sin esto el evento 'change' no dispara
      // porque el valor no cambió, y el archivo simplemente no se agrega.
      e.target.value = '';
    });
  }

  return {
    hayArchivos: () => elegidos.length > 0,
    cantidad:    () => elegidos.length,
    aFormData:   () => {
      const fd = new FormData();
      elegidos.forEach((f) => fd.append(CAMPO_MULTIPART, f));
      return fd;
    },
  };
}
