/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/pantallaClientes.test.js
// La primera prueba que DIBUJA una pantalla de verdad.
//
// POR QUÉ NO EXISTÍA NINGUNA HASTA AHORA
// El proyecto corría todo con `testEnvironment: "node"`, donde no hay `document`
// ni `window`. Con eso se puede probar una función que devuelve un string de
// HTML, pero no lo que pasa DESPUÉS: si el evento quedó cableado, si la tabla
// reemplazó al esqueleto, si el contador se actualizó. De las 115 suites que
// tenía el proyecto, ninguna montaba una vista.
//
// Ese era el punto ciego que explica el episodio contado por Adrián: «tras la
// refactorización hubo errores en la interfaz». Una extracción puede dejar el
// HTML idéntico y romper el cableado, y ninguna prueba se enteraba.
//
// CÓMO SE HABILITÓ
// Con `jest-environment-jsdom` (un navegador de mentira en memoria) y el
// docblock `@jest-environment jsdom` de arriba de este archivo. Se declara POR
// ARCHIVO a propósito, en vez de cambiar el `testEnvironment` global: las otras
// 115 suites siguen corriendo en Node, que es más rápido y es lo que necesitan.
// Para escribir otra prueba de pantalla alcanza con copiar ese docblock.
//
// QUÉ PRUEBA ESTE ARCHIVO EN PARTICULAR
// El salto de la página al terminar de cargar. El esqueleto de carga existe
// para reservar el lugar exacto que va a ocupar la tabla; si declara otra
// cantidad de columnas, la página se reacomoda igual y el esqueleto no sirvió
// de nada. Los cuatro paneles del dashboard lo tenían mal, y la prueba que
// debía vigilarlo comparaba contra números escritos a mano (por eso «confirmaba»
// el valor equivocado). Acá se mide sobre el DOM real: se cuenta el esqueleto
// dibujado, se deja llegar la respuesta, y se cuenta la tabla que lo reemplazó.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
  showToast: jest.fn(),
}));

jest.mock('../../public/js/views/dashboard/modules/clientModal.js', () => ({
  __esModule: true,
  openClienteModal: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import { mountClientsTab } from '../../public/js/views/dashboard/modules/clientsView.js';

/** Un cliente de mentira, con lo mínimo que la tabla lee. */
const cliente = (i) => ({
  id: i,
  razon_social: `Cliente ${i}`,
  nit: `100${i}`,
  contacto: `Contacto ${i}`,
  email: `c${i}@ejemplo.com`,
  telefono: `7000000${i}`,
  activo: 1,
});

/** Deja correr las promesas pendientes sin adelantar el reloj. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pantalla de clientes — el esqueleto reserva el lugar exacto de la tabla', () => {
  let panel;

  beforeEach(() => {
    document.body.innerHTML = '<div id="panel"></div>';
    panel = document.getElementById('panel');
    jest.clearAllMocks();
  });

  test('el esqueleto de carga tiene las MISMAS columnas que la tabla que lo reemplaza', async () => {
    // La respuesta se deja pendiente a propósito: así se puede mirar el DOM
    // en el momento exacto en que el esqueleto está en pantalla.
    let entregarDatos;
    api.get.mockReturnValue(new Promise((resolve) => { entregarDatos = resolve; }));

    const montado = mountClientsTab(panel);
    await tick();

    // ── Momento 1: cargando ────────────────────────────────────────────────
    const filaCabecera = panel.querySelector('.skeleton-row-head');
    expect(filaCabecera).not.toBeNull();
    const columnasDelEsqueleto = filaCabecera.querySelectorAll('.skeleton-cell').length;

    // ── Momento 2: llegaron los datos ──────────────────────────────────────
    entregarDatos({
      data: [cliente(1), cliente(2)],
      pagination: { totalRecords: 2, page: 1, limit: 20 },
    });
    await montado;
    await tick();

    const tabla = panel.querySelector('table.data-table');
    expect(tabla).not.toBeNull();
    const columnasDeLaTabla = tabla.querySelectorAll('thead th').length;

    // El punto de todo: si estos dos números difieren, la página pega un salto
    // al terminar de cargar — que es exactamente lo que el esqueleto viene a
    // evitar. Acá se mide en el DOM, no contando llaves en el código fuente.
    expect(columnasDelEsqueleto).toBe(columnasDeLaTabla);
  });

  test('la tabla muestra una fila por cliente y el contador dice cuántos hay', async () => {
    api.get.mockResolvedValue({
      data: [cliente(1), cliente(2), cliente(3)],
      pagination: { totalRecords: 3, page: 1, limit: 20 },
    });

    await mountClientsTab(panel);
    await tick();

    expect(panel.querySelectorAll('table.data-table tbody tr')).toHaveLength(3);
    expect(panel.querySelector('#clients-total').textContent).toContain('3');
  });

  test('sin resultados no queda una tabla vacía, queda el mensaje de vacío', async () => {
    api.get.mockResolvedValue({ data: [], pagination: { totalRecords: 0, page: 1, limit: 20 } });

    await mountClientsTab(panel);
    await tick();

    expect(panel.querySelector('table.data-table')).toBeNull();
    expect(panel.textContent).toContain('Sin resultados');
  });

  test('el buscador está cableado: escribir y apretar Buscar vuelve a pedir con q=', async () => {
    // Esto es lo que NINGUNA prueba del proyecto podía verificar hasta ahora:
    // que el listener quedó puesto. Una refactorización que mueva el markup a
    // otro archivo y se olvide el cableado deja la pantalla muda, con el HTML
    // perfecto — y así se ve exactamente igual en una revisión del código.
    api.get.mockResolvedValue({ data: [cliente(1)], pagination: { totalRecords: 1, page: 1, limit: 20 } });

    await mountClientsTab(panel);
    await tick();

    const llamadasAntes = api.get.mock.calls.length;

    panel.querySelector('#clients-search').value = 'sanchez';
    panel.querySelector('#clients-search-btn').click();
    await tick();

    expect(api.get.mock.calls.length).toBeGreaterThan(llamadasAntes);
    const ultimaUrl = api.get.mock.calls.at(-1)[0];
    expect(ultimaUrl).toContain('q=sanchez');
  });
});
