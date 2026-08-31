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

  // ── Las tres acciones de cada fila ───────────────────────────────────────
  // Se fijan ANTES de mover ese cableado a su propia función: son ~55 líneas
  // que hoy viven dentro de load(), y lo que tiene que sobrevivir a la mudanza
  // es exactamente esto — que cada botón le pegue al endpoint correcto con el
  // cliente correcto, y que Desactivar pida confirmación antes de borrar nada.
  describe('acciones de cada fila', () => {
    beforeEach(async () => {
      api.get.mockResolvedValue({
        data: [
          { ...cliente(1), activo: 1 },
          { ...cliente(2), activo: 0 },
        ],
        pagination: { totalRecords: 2, page: 1, limit: 20 },
      });
    });

    test('Editar abre el modal del cliente de ESA fila', async () => {
      const { openClienteModal } = require('../../public/js/views/dashboard/modules/clientModal.js');
      await mountClientsTab(panel);
      await tick();

      panel.querySelector('[data-client-edit="1"]').click();

      expect(openClienteModal).toHaveBeenCalledTimes(1);
      const args = openClienteModal.mock.calls[0][0];
      expect(args.mode).toBe('edit');
      expect(args.client.id).toBe(1);
    });

    test('Desactivar pide confirmación primero, y recién ahí borra', async () => {
      api.delete.mockResolvedValue({});
      await mountClientsTab(panel);
      await tick();

      panel.querySelector('[data-client-deact="1"]').click();
      await tick();

      // Todavía no borró nada: está esperando el sí.
      expect(api.delete).not.toHaveBeenCalled();
      expect(document.querySelector('#cd-confirm')).not.toBeNull();

      document.querySelector('#cd-confirm').click();
      await tick();

      expect(api.delete).toHaveBeenCalledWith('/api/clientes/1');
    });

    test('Desactivar y cancelar NO borra', async () => {
      api.delete.mockResolvedValue({});
      await mountClientsTab(panel);
      await tick();

      panel.querySelector('[data-client-deact="1"]').click();
      await tick();
      document.querySelector('#cd-cancel').click();
      await tick();

      expect(api.delete).not.toHaveBeenCalled();
    });

    test('Activar reactiva al cliente inactivo conservando sus datos', async () => {
      api.put.mockResolvedValue({});
      await mountClientsTab(panel);
      await tick();

      panel.querySelector('[data-client-act="2"]').click();
      await tick();

      expect(api.put).toHaveBeenCalledTimes(1);
      const [url, cuerpo] = api.put.mock.calls[0];
      expect(url).toBe('/api/clientes/2');
      expect(cuerpo.activo).toBe(true);
      // Reactivar no puede borrar los datos del cliente de paso: el endpoint
      // es el update general, así que hay que reenviarlos todos.
      expect(cuerpo.razon_social).toBe('Cliente 2');
      expect(cuerpo.nit).toBe('1002');
    });

    test('el cliente activo ofrece Desactivar y el inactivo, Activar', async () => {
      await mountClientsTab(panel);
      await tick();

      expect(panel.querySelector('[data-client-deact="1"]')).not.toBeNull();
      expect(panel.querySelector('[data-client-act="1"]')).toBeNull();
      expect(panel.querySelector('[data-client-act="2"]')).not.toBeNull();
      expect(panel.querySelector('[data-client-deact="2"]')).toBeNull();
    });
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
