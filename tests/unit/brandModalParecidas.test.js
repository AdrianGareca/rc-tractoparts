/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/brandModalParecidas.test.js
// El botón «+» pregunta «¿quisiste decir…?» antes de crear una marca.
//
// POR QUÉ EXISTE
// El servidor sólo rechaza nombres idénticos sin distinguir mayúsculas. Así
// entró «CAT» cuando «Caterpillar» ya existía, y en producción hay cinco
// entradas que empiezan con CAT (medido el 2026-09-11). Unificar una vez no
// sirve si el mismo botón puede volver a crearlas al día siguiente.
//
// La pregunta NO bloquea: hay marcas parecidas que son distintas de verdad
// (MASTER y MASTER POWER, según Óscar), así que «No, crear igual» siempre
// está a mano.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  showToast: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import { openBrandModal } from '../../public/js/views/quotationForm/brandModal.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

const catalogo = () => [
  { id: 11, nombre: 'CAT' },
  { id: 26, nombre: 'CAT - USA' },
  { id: 1,  nombre: 'Caterpillar' },
  { id: 2,  nombre: 'Komatsu' },
];

/** Un formulario con una fila y el modal de alta abierto sobre ella. */
function abrir(brands = catalogo()) {
  document.body.innerHTML =
    '<div id="modal-body"><div id="form">' +
    '<select class="item-marca" data-idx="0"><option value="">— Sin marca —</option></select>' +
    '</div></div>';
  const container = document.getElementById('form');
  const onFieldChange = jest.fn();
  const overlay = openBrandModal(0, { container, brands, onFieldChange });
  return { overlay, container, onFieldChange, brands };
}

async function guardar(overlay, nombre) {
  overlay.querySelector('#bm-nombre').value = nombre;
  overlay.querySelector('#bm-save').click();
  await flush();
}

const abierto = () => document.querySelector('.sub-modal-overlay') !== null;

beforeEach(() => {
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { id: 99, nombre: 'NUEVA' } });
});

describe('con un nombre parecido a uno existente', () => {
  test('pregunta en lugar de crear', async () => {
    const { overlay } = abrir();
    await guardar(overlay, 'CATERPILLER');

    expect(api.post).not.toHaveBeenCalled();
    const caja = overlay.querySelector('#bm-sugerencias');
    expect(caja.classList.contains('show')).toBe(true);
    expect(caja.textContent).toContain('Caterpillar');
  });

  test('elegir la sugerencia la usa en la fila y cierra', async () => {
    const { overlay, container, onFieldChange } = abrir();
    await guardar(overlay, 'CATERPILLER');

    overlay.querySelector('[data-sugerencia="0"]').click();

    expect(container.querySelector('.item-marca').value).toBe('1');
    expect(onFieldChange).toHaveBeenCalledWith(0, 'marca_id', 1);
    expect(abierto()).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  test('«No, crear» la crea igual — hay parecidas que son distintas', async () => {
    const { overlay } = abrir();
    await guardar(overlay, 'CATERPILLER');

    overlay.querySelector('#bm-crear-igual').click();
    await flush();

    expect(api.post).toHaveBeenCalledWith('/api/marcas', { nombre: 'CATERPILLER' });
  });

  test('volver a escribir borra la pregunta', async () => {
    const { overlay } = abrir();
    await guardar(overlay, 'CATERPILLER');

    const input = overlay.querySelector('#bm-nombre');
    input.value = 'otra cosa';
    input.dispatchEvent(new Event('input'));

    expect(overlay.querySelector('#bm-sugerencias').classList.contains('show')).toBe(false);
  });
});

describe('con un nombre que ya existe escrito de otra forma', () => {
  test.each([
    ['caterpillar', '1'],
    ['CAT-USA',     '26'],
  ])('«%s» usa la existente sin pedirle nada al servidor', async (nombre, id) => {
    const { overlay, container } = abrir();
    await guardar(overlay, nombre);

    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelector('.item-marca').value).toBe(id);
    expect(abierto()).toBe(false);
  });
});

describe('con un nombre que no se parece a nada', () => {
  test('la crea directo, como siempre', async () => {
    const { overlay } = abrir();
    await guardar(overlay, 'HITACHI');

    expect(api.post).toHaveBeenCalledWith('/api/marcas', { nombre: 'HITACHI' });
  });
});
