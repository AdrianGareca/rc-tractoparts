// =============================================================================
// tests/unit/pdfLayout.test.js
// Red de seguridad del layout de la tabla de ítems de la proforma.
//
// buildItemLayout reparte 523.28 pt entre 9 columnas. Si la suma se desvía, el
// PDF sale con una columna cortada o con un hueco al borde — y nadie lo nota
// hasta que el cliente recibe la proforma. La columna T. ENTREGA absorbe el
// resto justamente para que ese redondeo nunca se escape.
// =============================================================================

'use strict';

const {
  buildItemLayout,
  CW, PW, PH, MARGIN,
  C,
  BRAND_DEFS,
  TABLE_HEADER_H, ROW_MIN_H, ROW_PADDING, PAGE_BREAK_Y,
} = require('../../src/services/pdf/constants');

const sumWidths = (w) => Object.values(w).reduce((a, b) => a + b, 0);

describe('buildItemLayout — con columna CÓDIGO', () => {
  const { w, x, showCodigo } = buildItemLayout(true);

  test('los anchos suman exactamente el ancho de contenido', () => {
    expect(sumWidths(w)).toBeCloseTo(CW, 2);
  });

  test('CÓDIGO y CÓD. ALT. tienen ancho propio', () => {
    expect(w.codigo).toBe(48);
    expect(w.codAlt).toBe(52);
  });

  test('la primera columna arranca en el margen', () => {
    expect(x.item).toBe(MARGIN);
  });

  test('cada columna arranca donde termina la anterior', () => {
    const keys = Object.keys(w);
    keys.slice(1).forEach((k, i) => {
      const prev = keys[i];
      expect(x[k]).toBeCloseTo(x[prev] + w[prev], 5);
    });
  });

  test('la última columna termina justo en el margen derecho', () => {
    expect(x.entrega + w.entrega).toBeCloseTo(PW - MARGIN, 2);
  });

  test('expone el flag que usan los drawers', () => {
    expect(showCodigo).toBe(true);
  });
});

describe('buildItemLayout — sin columna CÓDIGO', () => {
  const { w, x } = buildItemLayout(false);

  test('los anchos siguen sumando el ancho de contenido', () => {
    expect(sumWidths(w)).toBeCloseTo(CW, 2);
  });

  test('CÓDIGO y CÓD. ALT. colapsan a cero', () => {
    expect(w.codigo).toBe(0);
    expect(w.codAlt).toBe(0);
  });

  test('DESCRIPCIÓN absorbe el espacio liberado', () => {
    const conCodigo = buildItemLayout(true).w;
    expect(w.desc).toBe(230);
    expect(w.desc).toBeGreaterThan(conCodigo.desc);
  });

  test('las columnas colapsadas no dejan hueco: comparten posición', () => {
    expect(x.codigo).toBe(x.codAlt);
    expect(x.codAlt).toBe(x.desc);
  });

  test('la última columna sigue cerrando en el margen derecho', () => {
    expect(x.entrega + w.entrega).toBeCloseTo(PW - MARGIN, 2);
  });
});

describe('buildItemLayout — invariantes entre ambos modos', () => {
  test('las columnas numéricas conservan su ancho', () => {
    const a = buildItemLayout(true).w;
    const b = buildItemLayout(false).w;

    ['item', 'cant', 'uni', 'pUnit', 'pTotal'].forEach((k) => {
      expect(a[k]).toBe(b[k]);
    });
  });

  test('emite las 9 columnas en los dos modos', () => {
    expect(Object.keys(buildItemLayout(true).w)).toHaveLength(9);
    expect(Object.keys(buildItemLayout(false).w)).toHaveLength(9);
  });

  test('ningún ancho es negativo', () => {
    [true, false].forEach((modo) => {
      Object.values(buildItemLayout(modo).w).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    });
  });
});

describe('geometría de página', () => {
  test('es A4 en puntos', () => {
    expect(PW).toBeCloseTo(595.28, 2);
    expect(PH).toBeCloseTo(841.89, 2);
  });

  test('el ancho de contenido descuenta los dos márgenes', () => {
    expect(CW).toBeCloseTo(PW - MARGIN * 2, 5);
  });

  test('el corte de página deja lugar para el pie', () => {
    expect(PAGE_BREAK_Y).toBeLessThan(PH - MARGIN);
    expect(PAGE_BREAK_Y).toBeGreaterThan(PH / 2);
  });

  test('las alturas de fila son coherentes', () => {
    expect(TABLE_HEADER_H).toBeGreaterThan(ROW_MIN_H);
    expect(ROW_PADDING).toBeLessThan(ROW_MIN_H);
  });
});

describe('paleta de estados', () => {
  test('cubre los 9 estados válidos de una cotización', () => {
    [
      'Pendiente', 'En revision', 'En espera', 'Aprobada internamente',
      'Enviada al cliente', 'Confirmada', 'Aceptada', 'Rechazada', 'Archivada',
    ].forEach((estado) => {
      expect(C.STATUS[estado]).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  test("'Aceptada' (legado) se pinta igual que 'Confirmada'", () => {
    expect(C.STATUS['Aceptada']).toBe(C.STATUS['Confirmada']);
  });

  test('los colores son hexadecimales válidos', () => {
    Object.entries(C).forEach(([k, v]) => {
      if (k === 'STATUS') return;
      expect(v).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });
});

describe('franja de marcas', () => {
  test('lista las 6 marcas con archivo y etiqueta', () => {
    expect(BRAND_DEFS).toHaveLength(6);
    BRAND_DEFS.forEach((b) => {
      expect(b.file).toMatch(/\.png$/);
      expect(b.label).toBeTruthy();
    });
  });
});
