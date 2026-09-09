// =============================================================================
// public/js/shared/fechaLocal.js
// Fechas 'YYYY-MM-DD' en la hora de acá, no en UTC.
//
// LA TRAMPA
// `new Date().toISOString().slice(0, 10)` es la forma corta y obvia de sacar la
// fecha de hoy, y en Bolivia está mal cuatro horas por día.
//
// Bolivia es UTC−4 todo el año. A las 20:00 del lunes acá, en UTC ya es martes.
// Así que entre las 20:00 y la medianoche, toISOString() devuelve el día
// SIGUIENTE — sin error, sin aviso, y sólo para quien esté trabajando de noche.
//
// Al revés pasa lo mismo con `new Date('2026-09-08')`: el navegador lo
// interpreta como medianoche UTC, que acá son las 20:00 del día 7. Un
// calendario armado así muestra el día anterior seleccionado.
//
// DÓNDE YA MORDIÓ
// - checkSeguimientosDelDia() usaba toISOString() para la marca de «ya mostré
//   el aviso hoy». Quien entrara después de las 20:00 la guardaba con la fecha
//   de mañana, y al día siguiente el recordatorio de seguimientos NO aparecía.
//   Un aviso que se salta un día entero, sin que nadie lo note.
// - El bloqueo por intentos fallidos tuvo su propia versión de esto: la fecha
//   llegaba cuatro horas en el pasado y el bloqueo nunca se aplicaba (ver
//   authController).
// - quotationFilters.js lo documenta del lado del servidor.
//
// Estas dos funciones estaban copiadas en calendarPicker.js y reportesView.js,
// las dos con su comentario explicando el mismo problema. Están acá para que
// haya UN solo lugar donde arreglarlo, y para que quien busque «fecha» en
// shared/ lo encuentre antes de escribir toISOString() otra vez.
// =============================================================================

/**
 * Una fecha como 'YYYY-MM-DD' según el reloj de quien mira la pantalla.
 *
 * @param   {Date} d
 * @returns {string} 'YYYY-MM-DD'
 */
export function ymd(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

/**
 * Lee 'YYYY-MM-DD' como una fecha local, sin el corrimiento de un día que
 * produce `new Date('YYYY-MM-DD')` al tomarlo como medianoche UTC.
 *
 * @param   {string} s — 'YYYY-MM-DD'
 * @returns {Date}     — medianoche local de ese día
 */
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** La fecha de hoy como 'YYYY-MM-DD' local. El reemplazo directo de toISOString(). */
export function hoyYmd() {
  return ymd(new Date());
}
