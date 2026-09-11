/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/revisionImportacion.test.js
// La ventana que muestra lo que el pegado desde Excel no resolvió solo.
//
// Lo que se vigila: que una marca desconocida se pueda agregar al catálogo o
// cambiar por una parecida, y que la decisión llegue a TODAS las filas que la
// traían; que los nombres que vienen de la planilla se muestren escapados; y
// que la ventana no aparezca cuando no hay nada que decir.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  showToast: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import {
  abrirRevisionImportacion, hayQueRevisar,
} from '../../public/js/views/quotationForm/revisionImportacion.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Un formulario de mentira con `n` filas, cada una con su selector de marca. */
function formulario(n = 3) {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.innerHTML = Array.from({ length: n }, (_, i) =>
    `<select class="item-marca" data-idx="${i}"><option value="">— Sin marca —</option></select>`
  ).join('');
  document.body.appendChild(container);
  return container;
}

const valores = (container) =>
  [...container.querySelectorAll('.item-marca')].map((s) => s.value);

const CATERPILLAR = { id: 1, nombre: 'Caterpillar' };

beforeEach(() => {
  api.post.mockReset();
});

describe('cuándo aparece', () => {
  test('sin nada que decir no se abre', () => {
    const container = formulario();
    expect(hayQueRevisar({})).toBe(false);
    expect(abrirRevisionImportacion({ container })).toBeNull();
    expect(document.querySelector('.sub-modal-overlay')).toBeNull();
  });

  test('con una columna ignorada, se abre y la nombra', () => {
    const container = formulario();
    abrirRevisionImportacion({ container, columnasIgnoradas: ['OBSERVACIONES'] });
    expect(document.querySelector('.sub-modal-overlay').textContent).toContain('OBSERVACIONES');
  });

  test('los avisos que antes iban a la consola ahora se leen en pantalla', () => {
    const container = formulario();
    abrirRevisionImportacion({ container, advertencias: ['Unidad "BULTOS" no reconocida en "X".'] });
    expect(document.querySelector('.sub-modal-overlay').textContent).toContain('BULTOS');
  });

  test('«Listo» la cierra', () => {
    const container = formulario();
    const sub = abrirRevisionImportacion({ container, advertencias: ['algo'] });
    sub.$('[data-listo]').click();
    expect(document.querySelector('.sub-modal-overlay')).toBeNull();
  });
});

describe('una marca desconocida', () => {
  const desconocida = (over = {}) => ({
    nombre: 'CATERPILLER', filas: [0, 2], sugerencias: [CATERPILLAR], ...over,
  });

  test('el nombre que vino de la planilla se muestra escapado', () => {
    const container = formulario();
    abrirRevisionImportacion({
      container, brands: [],
      desconocidas: [desconocida({ nombre: '<img src=x onerror=alert(1)>', sugerencias: [] })],
    });
    const overlay = document.querySelector('.sub-modal-overlay');
    expect(overlay.querySelector('img')).toBeNull();
    expect(overlay.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('«Usar Caterpillar» la aplica a TODAS sus filas, y a ninguna más', () => {
    const container = formulario(3);
    const onFieldChange = jest.fn();
    const brands = [CATERPILLAR];
    const sub = abrirRevisionImportacion({ container, brands, onFieldChange, desconocidas: [desconocida()] });

    sub.$('[data-usar="0"]').click();

    expect(valores(container)).toEqual(['1', '', '1']);
    expect(onFieldChange).toHaveBeenCalledWith(0, 'marca_id', 1);
    expect(onFieldChange).toHaveBeenCalledWith(2, 'marca_id', 1);
    expect(onFieldChange).not.toHaveBeenCalledWith(1, 'marca_id', expect.anything());
    expect(sub.$('[data-acciones]')).toBeNull();
    expect(sub.$('[data-resultado]').textContent).toContain('Caterpillar');
  });

  test('«Agregar» la crea en el catálogo y la aplica a sus filas', async () => {
    const container = formulario(3);
    const brands = [];
    api.post.mockResolvedValue({ data: { id: 99, nombre: 'HITACHI' } });
    const sub = abrirRevisionImportacion({
      container, brands, desconocidas: [desconocida({ nombre: 'HITACHI', sugerencias: [] })],
    });

    sub.$('[data-agregar]').click();
    await flush();

    expect(api.post).toHaveBeenCalledWith('/api/marcas', { nombre: 'HITACHI' });
    expect(valores(container)).toEqual(['99', '', '99']);
    // El caché del formulario también la tiene: las filas nuevas la ofrecen.
    expect(brands).toContainEqual({ id: 99, nombre: 'HITACHI' });
  });

  test('si ya existía (409), usa la existente en vez de fallar', async () => {
    const container = formulario(3);
    api.post.mockRejectedValue({ status: 409, data: { data: { id: 7, nombre: 'Hitachi' } } });
    const sub = abrirRevisionImportacion({
      container, brands: [], desconocidas: [desconocida({ nombre: 'HITACHI', sugerencias: [] })],
    });

    sub.$('[data-agregar]').click();
    await flush();

    expect(valores(container)).toEqual(['7', '', '7']);
    expect(sub.$('[data-resultado]').textContent).toContain('ya estaba');
  });

  test('si falla, lo dice y deja reintentar sin tocar las filas', async () => {
    const container = formulario(3);
    api.post.mockRejectedValue({ status: 500, data: { message: 'Error del servidor' } });
    const sub = abrirRevisionImportacion({
      container, brands: [], desconocidas: [desconocida({ nombre: 'HITACHI', sugerencias: [] })],
    });

    sub.$('[data-agregar]').click();
    await flush();

    expect(valores(container)).toEqual(['', '', '']);
    expect(sub.$('[data-agregar]').disabled).toBe(false);
    expect(sub.$('[data-resultado]').textContent).toContain('Error del servidor');
  });
});
