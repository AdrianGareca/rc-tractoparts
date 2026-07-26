// =============================================================================
// tests/unit/quotationFormBrandModal.test.js
// Red de seguridad del sub-modal de alta de marca.
//
// upsertBrand se llamaba DUPLICADO en el código original (alta exitosa y rama
// 409 "ya existe"). Al unificarlo, estos tests fijan que las dos rutas siguen
// comportándose igual: no duplicar, y dejar el caché ordenado por nombre —
// del que depende el orden de los <option> en TODAS las filas.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  showToast: jest.fn(),
}));

import {
  upsertBrand,
  buildBrandOptions,
} from '../../public/js/views/quotationForm/brandModal.js';

describe('upsertBrand', () => {
  test('agrega una marca nueva y avisa que la agregó', () => {
    const brands = [{ id: 1, nombre: 'CAT' }];

    expect(upsertBrand(brands, { id: 2, nombre: 'Komatsu' })).toBe(true);
    expect(brands).toHaveLength(2);
  });

  test('no duplica una marca que ya está en el caché', () => {
    const brands = [{ id: 1, nombre: 'CAT' }];

    expect(upsertBrand(brands, { id: 1, nombre: 'CAT' })).toBe(false);
    expect(brands).toHaveLength(1);
  });

  test('deja el caché ordenado alfabéticamente', () => {
    const brands = [{ id: 1, nombre: 'Volvo' }, { id: 2, nombre: 'CAT' }];

    upsertBrand(brands, { id: 3, nombre: 'JCB' });

    expect(brands.map(b => b.nombre)).toEqual(['CAT', 'JCB', 'Volvo']);
  });

  test('ordena respetando acentos (localeCompare, no orden de bytes)', () => {
    const brands = [{ id: 1, nombre: 'Zeta' }, { id: 2, nombre: 'Álpha' }];

    upsertBrand(brands, { id: 3, nombre: 'Beta' });

    expect(brands.map(b => b.nombre)).toEqual(['Álpha', 'Beta', 'Zeta']);
  });

  test('muta el array recibido (es el caché compartido, no una copia)', () => {
    const brands = [];
    const misma  = brands;

    upsertBrand(brands, { id: 1, nombre: 'CAT' });

    expect(misma).toHaveLength(1);
  });

  test('la detección de duplicado es por id, no por nombre', () => {
    const brands = [{ id: 1, nombre: 'CAT' }];

    expect(upsertBrand(brands, { id: 9, nombre: 'CAT' })).toBe(true);
    expect(brands).toHaveLength(2);
  });
});

describe('buildBrandOptions', () => {
  const brands = [{ id: 1, nombre: 'CAT' }, { id: 2, nombre: 'Komatsu' }];

  test('siempre incluye la opción "Sin marca" primero', () => {
    expect(buildBrandOptions(brands)).toMatch(/^<option value="">— Sin marca —<\/option>/);
  });

  test('emite una opción por marca', () => {
    const html = buildBrandOptions(brands);
    expect(html).toContain('<option value="1">CAT</option>');
    expect(html).toContain('<option value="2">Komatsu</option>');
  });

  test('preselecciona la marca indicada', () => {
    const html = buildBrandOptions(brands, 2);
    expect(html).toContain('<option value="2" selected>Komatsu</option>');
    expect(html).toContain('<option value="1">CAT</option>');
  });

  test('sin selección no marca ninguna opción', () => {
    expect(buildBrandOptions(brands)).not.toContain('selected');
  });

  test('escapa el nombre de la marca (viene de la API)', () => {
    const html = buildBrandOptions([{ id: 1, nombre: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('con el caché vacío queda sólo "Sin marca"', () => {
    expect(buildBrandOptions([])).toBe('<option value="">— Sin marca —</option>');
  });
});
