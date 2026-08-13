// =============================================================================
// src/services/pdf/numberToWords.js
// Numero -> palabras en espanol, para la linea "SON:" del bloque de totales.
// Ejemplo: numberToWordsES(3080.00) -> "TRES MIL OCHENTA CON 00/100"
//
// Extraido de pdfService.js sin cambios de comportamiento.
// Cubierto por tests/unit/numberToWords.test.js.
// =============================================================================

'use strict';

// El redondeo monetario compartido: la misma cuenta que decide el numero que se
// imprime en la caja del TOTAL, para que las letras no digan otra cosa.
const { redondearCentavos } = require('../../utils/quotationTotals');

const _ONES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO',
  'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
];
const _TENS = [
  '', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA',
  'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
];
const _HUNS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

function _lt1000(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  let s = '';
  const h   = Math.floor(n / 100);
  const rem = n % 100;
  if (h) s += _HUNS[h];
  if (h && rem) s += ' ';
  if (rem > 0) {
    if (rem < 20) {
      s += _ONES[rem];
    } else {
      s += _TENS[Math.floor(rem / 10)];
      if (rem % 10) s += ' Y ' + _ONES[rem % 10];
    }
  }
  return s;
}

function _buildWords(n) {
  if (n >= 1000) {
    const t = Math.floor(n / 1000);
    const r = n % 1000;
    return (t === 1 ? 'MIL' : `${_lt1000(t)} MIL`) + (r > 0 ? ' ' + _lt1000(r) : '');
  }
  return _lt1000(n);
}

// Render the full integer part, extending _buildWords (which covers 0–999,999)
// to the millones (10^6) and billones (10^12) groups. The group COUNT is rendered
// RECURSIVELY so a count above 999 never indexes past the hundreds table — that
// out-of-range access is what produced the literal "undefined" for n >= 10^9.
function _integerToWords(n) {
  if (n < 1000000) return _buildWords(n);
  if (n < 1000000000000) {
    const millones = Math.floor(n / 1000000);
    const resto    = n % 1000000;
    const head = millones === 1 ? 'UN MILLÓN' : `${_integerToWords(millones)} MILLONES`;
    return head + (resto > 0 ? ' ' + _buildWords(resto) : '');
  }
  const billones = Math.floor(n / 1000000000000);
  const resto    = n % 1000000000000;
  const head = billones === 1 ? 'UN BILLÓN' : `${_integerToWords(billones)} BILLONES`;
  return head + (resto > 0 ? ' ' + _integerToWords(resto) : '');
}

function numberToWordsES(amount) {
  if (amount == null || isNaN(parseFloat(amount))) return 'CERO CON 00/100';
  // Se redondea con la MISMA funcion que usa la caja del TOTAL antes de partir
  // el numero, no despues. Sin esto las letras describen un numero distinto del
  // impreso: 49.995 se imprime como 50.00 arriba —redondeo monetario, el medio
  // va para arriba— pero aca se partia en 49 mas Math.round(0.995 * 100), y ese
  // producto en punto flotante da 99.49999999999999, que redondea a 99.
  //
  //     TOTAL:  Bs. 50.00
  //     SON:    CUARENTA Y NUEVE CON 99/100 BOLIVIANOS
  //
  // Las letras tienen que decir el numero que se imprime. Punto.
  const abs = redondearCentavos(Math.abs(parseFloat(amount)));

  let n     = Math.floor(abs);
  let cents = Math.round((abs - n) * 100);

  // ── El arrastre de los centavos ────────────────────────────────────────────
  // Cuando el resto es 0.999… ese Math.round da 100, y sin esta corrección se
  // imprimía tal cual. El PDF llegaba a decir:
  //
  //     TOTAL:  Bs. 189.00
  //     SON:    CIENTO OCHENTA Y OCHO CON 100/100 BOLIVIANOS
  //
  // El número dice ciento ochenta y nueve y las letras ciento ochenta y ocho
  // con cien centavos — que ni siquiera es un importe que exista. En una
  // proforma boliviana el importe en letras es el que manda, así que las dos
  // cifras del mismo documento se contradecían en el renglón con peso legal.
  //
  // Se llegaba por el total del PDF, que suma los subtotales sin redondear:
  // catorce valores de dos decimales en punto flotante dejan residuo, y a veces
  // cae para abajo (188.99999999999997). fmtNum lo imprime como 189.00 —toFixed
  // redondea— pero acá se partía en 188 más 100 centavos.
  //
  // Cien centavos son un entero más y cero centavos. La causa se ataca además
  // redondeando el total antes de llegar acá (ver drawers/totals.js); esto deja
  // la función correcta para cualquier otro camino que aparezca después.
  if (cents === 100) {
    n += 1;
    cents = 0;
  }

  const cc = String(cents).padStart(2, '0');
  if (n === 0) return `CERO CON ${cc}/100`;

  const w = _integerToWords(n);
  return `${w.trim()} CON ${cc}/100`;
}

module.exports = { numberToWordsES };
