// =============================================================================
// public/js/shared/csvExport.js
// Bajar una tabla como CSV que Excel abra bien.
//
// POR QUÉ ES UN MÓDULO Y NO CUATRO LÍNEAS EN CADA REPORTE
// «Unir con comas y descargar» parece trivial y tiene tres detalles que, si se
// reescriben de memoria en el próximo reporte, se van a olvidar los tres:
//
//   1. EL BOM. Sin los tres bytes de marca UTF-8 al principio, Excel abre el
//      archivo con la codificación del sistema y toda la ñ y todo acento sale
//      como caracteres raros. Es EL motivo por el que la gente dice que «el
//      Excel salió mal».
//
//   2. INYECCIÓN DE FÓRMULAS. Un valor que empieza con = + - @ lo interpreta
//      Excel como fórmula, no como texto. Acá los datos son razones sociales y
//      descripciones que cargan los usuarios, así que un cliente llamado
//      «=SUMA(...)» ejecutaría algo en la máquina de quien abra el archivo.
//      Anteponer una comilla simple es la mitigación estándar.
//
//   3. CRLF. Excel en Windows corta las filas con \r\n; con \n solo, algunas
//      versiones meten todo en una fila.
//
// Ninguno de los tres se nota al probarlo en la máquina de quien lo programó.
// =============================================================================

/**
 * Un valor listo para una celda CSV.
 * Siempre entrecomillado: así una coma o un salto de línea dentro del texto no
 * parte la fila, sin tener que decidir caso por caso.
 */
export function csvCell(valor) {
  let s = valor == null ? '' : String(valor);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;      // no lo interpretes como fórmula
  return `"${s.replace(/"/g, '""')}"`;      // "" es como CSV escapa una comilla
}

/**
 * Arma el contenido del CSV, con BOM y saltos CRLF.
 *
 * @param {string[]}   cabecera
 * @param {Array<Array>} filas
 * @returns {string}
 */
export function buildCsv(cabecera, filas) {
  const lineas = [cabecera.map(csvCell).join(',')];
  for (const f of filas) lineas.push(f.map(csvCell).join(','));
  return '﻿' + lineas.join('\r\n');
}

/**
 * Arma el CSV y dispara la descarga.
 *
 * Se exporta lo que se le pasa — que debe ser lo que el usuario está VIENDO. Si
 * filtró y ordenó, el archivo tiene que coincidir con la pantalla; bajar el
 * conjunto completo sin avisar es una sorpresa desagradable con miles de filas.
 *
 * @param {Object}       opts
 * @param {string}       opts.nombre     — sin extensión; se le agrega la fecha
 * @param {string[]}     opts.cabecera
 * @param {Array<Array>} opts.filas
 */
export function downloadCsv({ nombre, cabecera, filas }) {
  if (!filas || filas.length === 0) return;

  const blob = new Blob([buildCsv(cabecera, filas)], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();

  // Sin revoke, el blob queda en memoria hasta que se cierre la pestaña.
  URL.revokeObjectURL(url);
}
