// =============================================================================
// tests/unit/badgeHtmlEscape.test.js
// Bug 5.4 — badgeHtml() and roleBadgeHtml() interpolated their text into
// innerHTML WITHOUT escHtml(), unlike their sibling licitacionBadgeHtml().
// Today estado/rol come from a fixed enum so it is not exploitable, but it is a
// defense-in-depth gap: any future free-text state/role turns it into stored XSS.
// These tests pin the escaping.
// =============================================================================

import { badgeHtml, roleBadgeHtml, licitacionBadgeHtml, seguimientoVentaBadgeHtml } from '../../public/js/views/dashboard/helpers.js';

describe('badge helpers escape their text content', () => {
  test('badgeHtml escapes an unknown/hostile estado', () => {
    const html = badgeHtml('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('roleBadgeHtml escapes an unknown/hostile rol', () => {
    const html = roleBadgeHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('known values still render inside a span with the mapped class', () => {
    expect(badgeHtml('Pendiente')).toBe('<span class="badge badge-pendiente">Pendiente</span>');
    expect(roleBadgeHtml('Jefe')).toBe('<span class="badge badge-role-jefe">Jefe</span>');
  });

  test('consistent with licitacionBadgeHtml (which already escaped)', () => {
    expect(licitacionBadgeHtml('<b>x</b>')).toContain('&lt;b&gt;');
  });
});

describe('seguimientoVentaBadgeHtml — el badge del seguimiento comercial', () => {
  // BUG REAL: la columna "Seguim." de "Todas las cotizaciones" usaba
  // badgeHtml() a secas — la función pensada para el ESTADO DE APROBACIÓN
  // ('Pendiente', 'Confirmada'...) — que no reconoce ninguno de estos
  // valores y pintaba a todos con el gris genérico "badge-borrador".
  test('cada estado de venta tiene su propio color, ninguno cae al genérico', () => {
    const clases = [
      'Interesado', 'En negociacion', 'Confirmado', 'No le interesa', 'Venta concretada',
    ].map((estado_venta) => seguimientoVentaBadgeHtml({ estado_venta, estado_venta_detalle: null }));

    for (const html of clases) expect(html).not.toContain('badge-borrador');
    // Y no se repiten entre sí — cada estado se distingue visualmente del resto.
    expect(new Set(clases).size).toBe(clases.length);
  });

  test('sin seguimiento registrado, muestra un guion en vez de un badge vacío', () => {
    expect(seguimientoVentaBadgeHtml({ estado_venta: null, estado_venta_detalle: null }))
      .toBe('<span class="text-muted">—</span>');
  });

  test('"Otro" muestra el detalle, no la palabra "Otro"', () => {
    const html = seguimientoVentaBadgeHtml({
      estado_venta: 'Otro', estado_venta_detalle: 'Esperando aprobación de gerencia',
    });
    expect(html).toContain('Esperando aprobación de gerencia');
    expect(html).not.toContain('>Otro<');
  });

  test('"Otro" sin detalle cae a la palabra "Otro"', () => {
    const html = seguimientoVentaBadgeHtml({ estado_venta: 'Otro', estado_venta_detalle: null });
    expect(html).toContain('>Otro<');
  });

  test('escapa un detalle hostil', () => {
    const html = seguimientoVentaBadgeHtml({
      estado_venta: 'Otro', estado_venta_detalle: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
