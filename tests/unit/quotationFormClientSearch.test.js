// =============================================================================
// tests/unit/quotationFormClientSearch.test.js
// Red de seguridad del desplegable de autocompletar cliente.
//
// El markup se arma con innerHTML a partir de datos que escribió un usuario
// (razón social y NIT cargados desde el alta de clientes), así que el escapado
// es lo crítico: es la superficie de XSS almacenado más directa del formulario.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  showToast: jest.fn(),
}));

jest.mock('../../public/js/views/dashboard/modules/clientModal.js', () => ({
  __esModule: true,
  openClienteModal: jest.fn(),
}));

import {
  buildDropdownHtml,
  SEARCH_DEBOUNCE_MS,
  BLUR_CLOSE_DELAY_MS,
} from '../../public/js/views/quotationForm/clientSearch.js';

describe('buildDropdownHtml — con resultados', () => {
  const clients = [
    { id: 1, razon_social: 'Minera San Cristóbal S.A.', nit: '1023456789' },
    { id: 2, razon_social: 'Transportes Andinos SRL',   nit: null },
  ];

  test('emite un ítem por cliente con su id y su etiqueta', () => {
    const html = buildDropdownHtml(clients, 'min');

    expect(html).toContain('data-id="1"');
    expect(html).toContain('data-id="2"');
    expect(html).toContain('data-label="Minera San Cristóbal S.A."');
  });

  test('muestra el NIT sólo cuando existe', () => {
    const html = buildDropdownHtml(clients, 'min');

    expect(html).toContain('NIT: 1023456789');
    expect((html.match(/cdi-nit/g) ?? [])).toHaveLength(1);
  });

  test('cada ítem trae su botón de editar con el id correspondiente', () => {
    const html = buildDropdownHtml(clients, 'min');

    expect(html).toContain('data-edit-id="1"');
    expect(html).toContain('data-edit-id="2"');
  });

  test('conserva las clases que el cableado usa como selector', () => {
    const html = buildDropdownHtml(clients, 'min');

    expect(html).toContain('client-dropdown-item');
    expect(html).toContain('cdi-edit');
    expect(html).toContain('cdi-name');
  });
});

describe('buildDropdownHtml — escapado (XSS almacenado)', () => {
  test('escapa la razón social en el texto visible', () => {
    const html = buildDropdownHtml(
      [{ id: 1, razon_social: '<img src=x onerror=alert(1)>', nit: null }], 'x');

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('escapa la razón social dentro del atributo data-label', () => {
    const html = buildDropdownHtml(
      [{ id: 1, razon_social: '" onmouseover="alert(1)', nit: null }], 'x');

    expect(html).not.toMatch(/data-label="" onmouseover="/);
    expect(html).toContain('&quot; onmouseover=&quot;alert(1)');
  });

  test('escapa el NIT', () => {
    const html = buildDropdownHtml(
      [{ id: 1, razon_social: 'ACME', nit: '<script>alert(1)</script>' }], 'x');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildDropdownHtml — sin resultados', () => {
  test('muestra el mensaje de vacío con el texto buscado', () => {
    const html = buildDropdownHtml([], 'inexistente');

    expect(html).toContain('client-dropdown-empty');
    expect(html).toContain('Sin resultados para');
    expect(html).toContain('inexistente');
  });

  test('escapa el texto buscado (lo tipea el usuario)', () => {
    const html = buildDropdownHtml([], '<script>alert(1)</script>');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('no emite ítems seleccionables', () => {
    expect(buildDropdownHtml([], 'x')).not.toContain('client-dropdown-item');
  });
});

describe('temporizadores', () => {
  test('el debounce de búsqueda es de 300 ms', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });

  test('el cierre por blur espera menos que el debounce', () => {
    // Si el cierre tardara más que el debounce, una búsqueda vieja podría
    // reabrir el desplegable después de que el usuario se fue del campo.
    expect(BLUR_CLOSE_DELAY_MS).toBeLessThan(SEARCH_DEBOUNCE_MS);
  });
});
