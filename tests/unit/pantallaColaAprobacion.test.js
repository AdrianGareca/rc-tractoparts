/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/pantallaColaAprobacion.test.js
// La cola de aprobación (Jefe) y la de revisión (Administrador), dibujadas.
//
// POR QUÉ UNA PRUEBA DE PANTALLA
// Las dos colas salieron de managerStrategy.js y adminStrategy.js a un módulo
// compartido y pasaron a paginar (ronda de estrés del 2026-09-15). Es
// exactamente el tipo de cambio que ya rompió la interfaz una vez en este
// proyecto: el HTML puede quedar idéntico y el botón «Revisar» dejar de abrir
// la proforma. Acá se monta el módulo en un DOM real y se aprietan los botones.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  showToast: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import { mountColaAprobacion } from '../../public/js/views/dashboard/modules/colaAprobacion.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const fila = (id) => ({
  id, numero_correlativo: `SC-2026/${String(id).padStart(6, '0')}`, estado: 'Pendiente',
  ejecutivo_nombre: 'Hilda', cliente_nombre: `Cliente ${id}`, monto_total: 100, moneda: 'BOB',
  fecha_emision: '2026-09-01', fecha_validez: '2026-09-16',
});

const respuesta = (filas, { page = 1, limit = 50, totalRecords = filas.length } = {}) => ({
  success: true, total: totalRecords, data: filas,
  pagination: { page, limit, totalRecords, totalPages: Math.max(1, Math.ceil(totalRecords / limit)), hasNext: page * limit < totalRecords, hasPrev: page > 1 },
});

const OPCIONES_JEFE = {
  titulo: 'Cola de aprobación', ayuda: 'ayuda', conEstado: true,
  textoBoton: 'Revisar y Decidir', textoVacio: 'No hay cotizaciones pendientes de aprobación.',
};

let panel, destruir;

beforeEach(() => {
  document.body.innerHTML = '<div id="panel"></div>';
  panel = document.getElementById('panel');
  jest.clearAllMocks();
});

afterEach(() => destruir?.());

describe('cola de aprobación', () => {
  test('pide la cola por páginas, no entera', async () => {
    api.get.mockResolvedValue(respuesta([fila(1)]));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar: jest.fn() });

    expect(api.get).toHaveBeenCalledWith('/api/cotizaciones/pendientes-aprobacion?page=1&limit=50');
  });

  test('el título muestra el total de la cola, no el de la página', async () => {
    api.get.mockResolvedValue(respuesta([fila(1), fila(2)], { limit: 2, totalRecords: 37 }));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar: jest.fn() });

    expect(panel.querySelector('#cola-titulo').textContent).toBe('Cola de aprobación (37)');
  });

  test('«Revisar y Decidir» abre la cotización de ESA fila', async () => {
    const onRevisar = jest.fn();
    api.get.mockResolvedValue(respuesta([fila(7), fila(9)]));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar });

    const botones = panel.querySelectorAll('[data-review]');
    expect(botones).toHaveLength(2);
    botones[1].click();
    expect(onRevisar).toHaveBeenCalledWith('9');
  });

  test('el Jefe ve la columna Estado; el Administrador no', async () => {
    api.get.mockResolvedValue(respuesta([fila(1)]));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar: jest.fn() });
    expect(panel.querySelectorAll('thead th')).toHaveLength(8);
    destruir();

    document.body.innerHTML = '<div id="panel"></div>';
    panel = document.getElementById('panel');
    api.get.mockResolvedValue(respuesta([fila(1)]));
    destruir = await mountColaAprobacion(panel, {
      ...OPCIONES_JEFE, titulo: 'Cola de revisión', conEstado: false, textoBoton: 'Revisar', onRevisar: jest.fn(),
    });
    const encabezados = [...panel.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(encabezados).toHaveLength(7);
    expect(encabezados).not.toContain('Estado');
  });

  test('el esqueleto reserva el ancho exacto de cada tabla', async () => {
    let entregar;
    api.get.mockReturnValue(new Promise((r) => { entregar = r; }));
    const montando = mountColaAprobacion(panel, { ...OPCIONES_JEFE, conEstado: false, onRevisar: jest.fn() });

    const columnasEsqueleto = panel.querySelectorAll('.skeleton-row-head .skeleton-cell').length;
    entregar(respuesta([fila(1)]));
    destruir = await montando;
    await tick();

    expect(columnasEsqueleto).toBe(panel.querySelectorAll('thead th').length);
  });

  test('cola vacía: lo dice, con el texto de esa cola', async () => {
    api.get.mockResolvedValue(respuesta([]));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar: jest.fn() });

    expect(panel.textContent).toContain('Cola vacía');
    expect(panel.textContent).toContain('No hay cotizaciones pendientes de aprobación.');
  });

  test('si la página pedida quedó vacía (se decidió la última), vuelve a la anterior', async () => {
    // Dos cotizaciones, una por página: el control de paginación muestra «›».
    api.get.mockResolvedValueOnce(respuesta([fila(1)], { page: 1, limit: 1, totalRecords: 2 }));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar: jest.fn() });

    // Mientras tanto alguien decidió la segunda: la página 2 llega vacía, y la
    // pantalla tiene que volver sola a la 1 en vez de decir «Cola vacía».
    api.get
      .mockResolvedValueOnce(respuesta([], { page: 2, limit: 1, totalRecords: 1 }))
      .mockResolvedValueOnce(respuesta([fila(1)], { page: 1, limit: 1, totalRecords: 1 }));

    const siguiente = panel.querySelector('[data-pag="next"]');
    expect(siguiente).not.toBeNull();
    expect(siguiente.disabled).toBe(false);
    siguiente.click();
    await tick(); await tick(); await tick();

    const pedidas = api.get.mock.calls.map((c) => c[0]);
    expect(pedidas).toHaveLength(3);
    expect(pedidas[1]).toContain('page=2');
    expect(pedidas[2]).toContain('page=1');
    expect(panel.textContent).not.toContain('Cola vacía');
    expect(panel.querySelectorAll('[data-review]')).toHaveLength(1);
  });

  test('un error del servidor se muestra con su mensaje', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('HTTP 500'), { data: { message: 'Falló la base' } }));
    destruir = await mountColaAprobacion(panel, { ...OPCIONES_JEFE, onRevisar: jest.fn() });

    expect(panel.textContent).toContain('Falló la base');
  });
});
