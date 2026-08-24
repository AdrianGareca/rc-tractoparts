// =============================================================================
// public/js/shared/calendarPicker.js
// Selector de fecha en forma de calendario de mes, con días "ocupados"
// marcados visualmente (pero NUNCA bloqueados — elegir un día ocupado es
// válido, solo se avisa que ya hay algo agendado ese día).
//
// POR QUÉ NO ES UN <input type="date">
// El date picker nativo del navegador no se puede pintar por dentro: no hay
// forma de marcar un día concreto como "ocupado" con CSS ni JS. Por eso este
// campo usa un botón que abre este calendario propio, construido sobre el
// sub-modal compartido (shared/subModal.js) en vez de un popover flotante —
// mismo patrón de diálogo accesible que ya usa el resto de la aplicación, sin
// inventar un sistema de posicionamiento nuevo.
// =============================================================================

import { crearSubModal } from './subModal.js';
import { escapeHtml } from './escapeHtml.js';

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** 'YYYY-MM-DD' local, sin pasar por UTC (a diferencia de toISOString). */
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parsea 'YYYY-MM-DD' a un Date local (evita el corrimiento de un día que
 *  da `new Date('YYYY-MM-DD')` al interpretarlo como UTC medianoche). */
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Arma la grilla de un mes: celdas vacías de relleno + un <button> por día. */
function _gridHtml(mesRef, valorActual, ocupadas, hoyStr) {
  const primerDia = new Date(mesRef.getFullYear(), mesRef.getMonth(), 1);
  // getDay(): 0=domingo..6=sabado. Se convierte a semana que empieza en lunes.
  const offset = (primerDia.getDay() + 6) % 7;
  const diasEnMes = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0).getDate();

  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push('<span class="cal-celda cal-vacia"></span>');

  for (let dia = 1; dia <= diasEnMes; dia++) {
    const fecha = new Date(mesRef.getFullYear(), mesRef.getMonth(), dia);
    const fechaStr = ymd(fecha);
    const clases = ['cal-celda', 'cal-dia'];
    if (ocupadas.has(fechaStr))     clases.push('cal-ocupado');
    if (fechaStr === valorActual)   clases.push('cal-seleccionado');
    if (fechaStr === hoyStr)        clases.push('cal-hoy');

    celdas.push(
      `<button type="button" class="${clases.join(' ')}" data-fecha="${fechaStr}" title="${clases.includes('cal-ocupado') ? 'Ya hay un seguimiento agendado este día' : ''}">${dia}</button>`
    );
  }

  return celdas.join('');
}

/**
 * Abre el calendario de selección de fecha.
 *
 * @param {Object}   o
 * @param {string}   [o.titulo='Elegir fecha']
 * @param {string|null} o.valorActual   — 'YYYY-MM-DD' o null (sin fecha elegida)
 * @param {string[]} [o.fechasOcupadas] — fechas 'YYYY-MM-DD' a marcar, sin bloquear
 * @param {Function} o.onSelect         — (fechaStr) => void
 * @param {Function} [o.onClear]        — () => void — se llama al usar "Quitar fecha"
 */
export function openCalendarPicker({ titulo = 'Elegir fecha', valorActual = null, fechasOcupadas = [], onSelect, onClear }) {
  const ocupadas = new Set(fechasOcupadas);
  const hoy = new Date();
  const hoyStr = ymd(hoy);

  let mesRef = valorActual ? parseYmd(valorActual) : hoy;
  mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth(), 1);

  const cuerpo = `
    <div class="cal-picker">
      <div class="cal-header">
        <button type="button" class="btn btn-ghost btn-sm" id="cal-prev" aria-label="Mes anterior">‹</button>
        <span class="cal-titulo-mes" id="cal-titulo-mes"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="cal-next" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal-dias-semana">
        ${DIAS_SEMANA.map((d) => `<span class="cal-celda cal-dia-nombre">${d}</span>`).join('')}
      </div>
      <div class="cal-grid" id="cal-grid"></div>
      <div class="cal-leyenda text-sm text-muted mt-1">
        <span class="cal-leyenda-punto cal-ocupado"></span> Ya tienes un seguimiento agendado ese día
      </div>
      ${valorActual ? `<button type="button" class="btn btn-ghost btn-sm mt-1" id="cal-quitar">Quitar fecha</button>` : ''}
    </div>`;

  const { $, cerrar } = crearSubModal({ titulo: escapeHtml(titulo), cuerpo });

  function pintar() {
    $('#cal-titulo-mes').textContent = `${MESES[mesRef.getMonth()]} ${mesRef.getFullYear()}`;
    $('#cal-grid').innerHTML = _gridHtml(mesRef, valorActual, ocupadas, hoyStr);
    $('#cal-grid').querySelectorAll('.cal-dia').forEach((btn) => {
      btn.addEventListener('click', () => {
        onSelect(btn.dataset.fecha);
        cerrar();
      });
    });
  }

  $('#cal-prev').addEventListener('click', () => {
    mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1);
    pintar();
  });
  $('#cal-next').addEventListener('click', () => {
    mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 1);
    pintar();
  });
  $('#cal-quitar')?.addEventListener('click', () => {
    onClear?.();
    cerrar();
  });

  pintar();
}
