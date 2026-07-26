// =============================================================================
// tests/unit/quotationFormMountRace.test.js
// Montaje del formulario de cotización — carrera entre render() y destroy().
//
// mountQuotationForm() devuelve el destroy SINCRÓNICAMENTE, pero render() es
// async: antes de escribir el HTML espera GET /api/marcas y
// GET /api/cotizaciones/next-correlativo. Si el usuario cierra el modal en esa
// ventana, render() seguía escribiendo igual sobre #modal-body — que para
// entonces puede pertenecer YA a otro modal (Gestión de Clientes, detalle de
// proforma, …), reemplazando su contenido por un formulario muerto.
//
// Estos tests fijan el contrato: destruido = no se toca el contenedor.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => {
  const api = { get: jest.fn(), post: jest.fn(), put: jest.fn(), upload: jest.fn() };
  return { __esModule: true, default: api, showToast: jest.fn() };
});

jest.mock('../../public/js/services/socketClient.js', () => ({
  __esModule: true,
  connectSocket: jest.fn(),
}));

jest.mock('../../public/js/views/dashboard/modules/clientModal.js', () => ({
  __esModule: true,
  openClienteModal: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import { connectSocket } from '../../public/js/services/socketClient.js';
import { mountQuotationForm } from '../../public/js/views/quotationForm.js';

/** Contenedor mínimo que sólo registra las escrituras de innerHTML. */
function makeContainer() {
  return {
    writes: [],
    set innerHTML(v) { this.writes.push(v); },
    get innerHTML() { return this.writes[this.writes.length - 1] ?? ''; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

/** Promesa que se resuelve a mano, para cortar en un punto exacto del render. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** Deja correr la cola de microtareas pendientes. */
const flush = () => new Promise((r) => setImmediate(r));

describe('mountQuotationForm — cierre durante la carga inicial', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectSocket.mockResolvedValue({
      on() {}, emit() {}, disconnect() {}, timeout() { return this; }, connected: false,
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('cerrar el modal antes de que responda GET /api/marcas no escribe en el contenedor', async () => {
    const container = makeContainer();
    api.get.mockResolvedValue({ data: [] });

    const destroy = mountQuotationForm(container, {});
    destroy(); // El usuario cierra el modal mientras los catálogos siguen en vuelo.

    await flush();

    expect(api.get).toHaveBeenCalled();          // el render arrancó de verdad
    expect(container.writes).toHaveLength(0);    // …pero no dejó rastro
  });

  test('cerrar el modal mientras cuelga GET /next-correlativo no escribe', async () => {
    const container = makeContainer();
    const correlativo = deferred();

    api.get.mockImplementation((url) =>
      url.includes('next-correlativo')
        ? correlativo.promise
        : Promise.resolve({ data: [] })
    );

    const destroy = mountQuotationForm(container, {});
    await flush();

    destroy();                                   // se cierra el modal…
    correlativo.resolve({ data: { numero_correlativo: 'SC-2026/000042' } }); // …y recién ahí responde
    await flush();

    expect(container.writes).toHaveLength(0);
  });
});
