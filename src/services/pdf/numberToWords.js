// =============================================================================
// src/services/pdf/numberToWords.js
// Numero -> palabras en espanol, para la linea "SON:" del bloque de totales.
// Ejemplo: numberToWordsES(3080.00) -> "TRES MIL OCHENTA CON 00/100"
//
// Extraido de pdfService.js sin cambios de comportamiento.
// Cubierto por tests/unit/numberToWords.test.js.
// =============================================================================

'use strict';

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
  const abs   = Math.abs(parseFloat(amount));
  const n     = Math.floor(abs);
  const cents = Math.round((abs - n) * 100);
  const cc    = String(cents).padStart(2, '0');
  if (n === 0) return `CERO CON ${cc}/100`;

  const w = _integerToWords(n);
  return `${w.trim()} CON ${cc}/100`;
}

module.exports = { numberToWordsES };
