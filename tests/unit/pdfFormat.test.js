// =============================================================================
// tests/unit/pdfFormat.test.js
// Red de seguridad del formateo de la proforma.
//
// formatDate es el más delicado: db.js configura `timezone: '+00:00'`, así que
// mysql2 devuelve fechas como instantes UTC. Leerlas con getters locales corre
// la fecha impresa un día entero cuando el server está detrás de UTC (Bolivia
// es UTC-4). Una proforma con la fecha de emisión equivocada es un problema
// contable, no cosmético.
// =============================================================================

'use strict';

const { fmtNum, fmtPrice, formatDate } = require('../../src/services/pdf/format');

describe('fmtNum — formato es-BO', () => {
  test('usa punto de miles y coma decimal', () => {
    expect(fmtNum(2100.5)).toBe('2.100,50');
    expect(fmtNum(1234567.89)).toBe('1.234.567,89');
  });

  test('siempre imprime 2 decimales', () => {
    expect(fmtNum(5)).toBe('5,00');
    expect(fmtNum(0)).toBe('0,00');
  });

  test('redondea a 2 decimales', () => {
    expect(fmtNum(10.999)).toBe('11,00');
    expect(fmtNum(0.005)).toBe('0,01');
  });

  test('acepta strings numéricos', () => {
    expect(fmtNum('2100.5')).toBe('2.100,50');
  });

  test('los valores ausentes salen como guion largo', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum('')).toBe('—');
    expect(fmtNum('abc')).toBe('—');
  });

  test('cero NO se confunde con ausente', () => {
    expect(fmtNum(0)).not.toBe('—');
  });

  test('formatea negativos', () => {
    expect(fmtNum(-1500)).toContain('1.500,00');
  });
});

describe('fmtPrice', () => {
  test('BOB lleva prefijo Bs.', () => {
    expect(fmtPrice(2100.5, 'BOB')).toBe('Bs. 2.100,50');
  });

  test('USD lleva prefijo $', () => {
    expect(fmtPrice(2100.5, 'USD')).toBe('$ 2.100,50');
  });

  test('cualquier moneda que no sea BOB usa $', () => {
    expect(fmtPrice(100, undefined)).toBe('$ 100,00');
  });

  test('un valor ausente sale como guion, SIN símbolo de moneda', () => {
    expect(fmtPrice(null, 'BOB')).toBe('—');
    expect(fmtPrice('', 'USD')).toBe('—');
  });
});

describe('formatDate — strings YYYY-MM-DD', () => {
  test('convierte a DD/MM/YYYY', () => {
    expect(formatDate('2026-07-26')).toBe('26/07/2026');
  });

  test('acepta un datetime completo y se queda con la fecha', () => {
    expect(formatDate('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
  });

  test('NO depende de la zona horaria del proceso', () => {
    // Se parsea de los componentes del string, sin pasar por Date.
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
  });
});

describe('formatDate — objetos Date (lo que devuelve mysql2)', () => {
  test('lee la fecha en UTC, no en horario local', () => {
    // Medianoche UTC: con getters locales en Bolivia (UTC-4) esto imprimiría
    // el día anterior.
    expect(formatDate(new Date('2026-07-26T00:00:00.000Z'))).toBe('26/07/2026');
  });

  test('el borde de fin de mes no se corre un día', () => {
    expect(formatDate(new Date('2026-03-01T00:00:00.000Z'))).toBe('01/03/2026');
  });

  test('el borde de fin de año no se corre un día', () => {
    expect(formatDate(new Date('2026-01-01T00:00:00.000Z'))).toBe('01/01/2026');
  });

  test('rellena día y mes con cero', () => {
    expect(formatDate(new Date('2026-02-03T12:00:00.000Z'))).toBe('03/02/2026');
  });
});

describe('formatDate — entradas inválidas', () => {
  test('los valores ausentes salen como guion largo', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  test('un string no parseable se devuelve tal cual', () => {
    expect(formatDate('no-es-fecha')).toBe('no-es-fecha');
  });

  test('una fecha ya formateada como DD/MM/YYYY se conserva', () => {
    // No matchea YYYY-MM-DD y new Date() la rechaza; antes se imprimía
    // "Invalid Date" y se perdía un dato que era perfectamente legible.
    expect(formatDate('26/07/2026')).toBe('26/07/2026');
  });

  test('un Date inválido sale como guion largo', () => {
    // No hay valor original que rescatar, así que se usa el mismo placeholder
    // que el resto de los datos ausentes.
    expect(formatDate(new Date('x'))).toBe('—');
    expect(formatDate(new Date(NaN))).toBe('—');
  });

  test('NUNCA imprime "Invalid Date" en la proforma', () => {
    ['no-es-fecha', '26/07/2026', 'pendiente', new Date('x'), new Date(NaN)]
      .forEach((v) => expect(formatDate(v)).not.toBe('Invalid Date'));
  });

  test('no rompe la generación del PDF con ninguna entrada rara', () => {
    [null, undefined, '', 'x', new Date('x'), 0, {}, []]
      .forEach((v) => expect(() => formatDate(v)).not.toThrow());
  });
});
