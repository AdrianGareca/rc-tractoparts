// =============================================================================
// public/js/shared/subModal.js
// La ventana que se abre ENCIMA de otra ventana.
//
// QUÉ ES UN SUB-MODAL
// El modal principal (modalUI.js) es uno solo y lo maneja el tablero. Cuando
// desde adentro de ese modal hace falta abrir otro —registrar un cliente
// mientras se carga una cotización, ver el detalle de una licitación— se usa
// esta capa aparte, que se monta directo sobre el <body>.
//
// EL PROBLEMA QUE RESUELVE
// Cinco módulos lo creaban a mano con las mismas cuatro líneas, y no habían
// quedado iguales. Sólo UNO ponía `aria-labelledby`: los otros cuatro son
// diálogos que un lector de pantalla anuncia sin decir de qué son. Nadie lo
// nota mirando la pantalla, y por eso llevaba así desde el principio.
//
// Acá el atributo no es opcional: la función pide el título y lo enlaza sola.
// =============================================================================

import { escapeHtml } from './escapeHtml.js';

/** Contador para que cada sub-modal abierto tenga un id de título único.
 *  Sin esto, dos sub-modales simultáneos compartirían el mismo
 *  `aria-labelledby` y el segundo apuntaría al título del primero. */
let contador = 0;

/**
 * Crea el sub-modal, lo monta y devuelve lo necesario para operarlo.
 *
 * @param {Object}   o
 * @param {string}   o.titulo     — encabezado visible; también lo que anuncia
 *                                  el lector de pantalla
 * @param {string}   o.cuerpo     — HTML del contenido, YA escapado por quien llama
 * @param {boolean} [o.ancho]     — variante de 720px para tablas anchas
 * @param {HTMLElement} [o.donde] — dónde montarlo (por defecto, el <body>)
 * @returns {{ overlay: HTMLElement, $: Function, cerrar: Function }}
 *
 * @example
 *   const { $, cerrar } = crearSubModal({ titulo: 'Nuevo cliente', cuerpo: html });
 *   $('#guardar').addEventListener('click', () => { …; cerrar(); });
 */
export function crearSubModal({ titulo, cuerpo, ancho = false, donde = document.body }) {
  const idTitulo = `subm-title-${++contador}`;

  const overlay = document.createElement('div');
  overlay.className = 'sub-modal-overlay';

  // Los tres atributos que hacen que esto sea un diálogo y no un div.
  // `role` y `aria-modal` los ponían los cinco; `aria-labelledby` sólo uno.
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', idTitulo);

  overlay.innerHTML = `
    <div class="sub-modal${ancho ? ' sub-modal-wide' : ''}">
      <div class="sub-modal-header">
        <h4 id="${idTitulo}">${escapeHtml(titulo)}</h4>
        <button type="button" class="btn-icon sub-modal-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="sub-modal-body">${cuerpo}</div>
    </div>`;

  donde.appendChild(overlay);

  const cerrar = () => overlay.remove();

  // El botón de la cruz y el clic fuera, enganchados acá: los cinco módulos
  // los repetían, y uno se olvidaba del clic fuera.
  overlay.querySelector('.sub-modal-close')?.addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    // Sólo el clic en el fondo, no el que sube desde adentro del cuadro.
    if (e.target === overlay) cerrar();
  });

  return {
    overlay,
    /** Buscador acotado a este sub-modal: no puede alcanzar el modal de atrás. */
    $: (sel) => overlay.querySelector(sel),
    cerrar,
  };
}
