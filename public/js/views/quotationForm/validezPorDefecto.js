// =============================================================================
// public/js/views/quotationForm/validezPorDefecto.js
// La fecha de validez se propone sola: emisión + 5 días.
//
// POR QUÉ
// Hasta el 2026-09-29 el ejecutivo elegía la validez a mano, sin ninguna
// propuesta, y en producción había de todo: 0, 3, 7, 10, 31 días. La hoja de
// términos del mismo PDF decía otro plazo. Ese día el Jefe ordenó 5 días
// calendario desde la emisión, que es lo que ventas ya daba casi siempre.
//
// LA REGLA
// Cuando cambia la emisión, la validez se recalcula SÓLO si el ejecutivo no la
// tocó: si está vacía, o si sigue siendo la propuesta de la emisión anterior.
// Una fecha elegida a mano no se pisa — el campo sigue siendo editable.
//
// El 5 es copia de DIAS_VIGENCIA en src/services/pdf/terminos.js (el navegador
// no puede importar ese archivo). tests/unit/validezCincoDias.test.js vigila
// que no se separen.
// =============================================================================

export const DIAS_VALIDEZ = 5;

/**
 * 'AAAA-MM-DD' + n días → 'AAAA-MM-DD'. Cuenta en UTC para que el resultado no
 * dependa de la zona horaria del navegador. Devuelve '' si la fecha no sirve.
 *
 * @param {string} iso
 * @param {number} dias
 * @returns {string}
 */
export function sumarDias(iso, dias) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Conecta la emisión con la validez. Se llama DESPUÉS de cargar los datos de
 * una edición o de un borrador recuperado, para que la emisión que ya estaba
 * cuente como punto de partida.
 *
 * @param {HTMLElement} container
 * @param {{ esEdicion?: boolean }} [opciones]
 */
export function wireValidezPorDefecto(container, { esEdicion = false } = {}) {
  const emision = container.querySelector('#fecha_emision');
  const validez = container.querySelector('#fecha_validez');
  if (!emision || !validez) return;

  // La última emisión VÁLIDA. Un vacío no la reemplaza: al corregir la fecha
  // con el teclado, borrar el día deja el campo vacío un instante y dispara
  // 'change'. Si ese vacío contara como «emisión anterior», la validez que se
  // propuso para la fecha original ya no se reconocería como propuesta y
  // quedaría clavada — con la emisión movida, la oferta saldría con otro plazo.
  let emisionAnterior = emision.value;

  const proponer = () => {
    const propuesta = sumarDias(emision.value, DIAS_VALIDEZ);
    if (!propuesta) return;

    const propuestaVieja  = sumarDias(emisionAnterior, DIAS_VALIDEZ);
    const noLaEligioAMano = !validez.value || validez.value === propuestaVieja;

    if (noLaEligioAMano) validez.value = propuesta;
    emisionAnterior = emision.value;
  };

  emision.addEventListener('change', proponer);

  // Un borrador recuperado con emisión y sin validez recibe la propuesta al
  // abrirse. Una EDICIÓN no: una cotización guardada sin validez (las hay en
  // producción) se quedaría con emisión + 5 —quizás una fecha ya pasada— y se
  // escribiría en la base al guardar cualquier otro cambio, sin que nadie la
  // haya elegido.
  if (!esEdicion && emision.value && !validez.value) proponer();
}
