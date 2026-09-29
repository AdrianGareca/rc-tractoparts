// =============================================================================
// tests/unit/ejecutivoTresBotones.test.js
// El ejecutivo sin delegación: tres botones, sólo sobre lo suyo, y avisos de
// rechazo y espera.
//
// LO QUE SE DECIDIÓ (Adrian, 2026-09-28)
// El ejecutivo sin delegación no tenía NINGÚN botón de estado: el Jefe le
// aprobaba una cotización, le llegaba «Ya puedes enviarla», y no había con qué.
// Ahora el dueño puede hacer exactamente tres cosas —enviarla al cliente,
// marcar que el cliente la rechazó, archivarla— y el resto lo hace el Jefe.
//
// Además el ejecutivo no se enteraba cuando le rechazaban una cotización o se la
// ponían en espera. Ahora recibe aviso, con el motivo adentro.
//
// QUÉ CUIDA ESTE ARCHIVO
//   1. Que la lista de botones de la pantalla y la matriz del servidor digan lo
//      mismo (un botón que el servidor rechaza es peor que no tener botón).
//   2. Que el servidor exija que la cotización sea del ejecutivo.
//   3. Que los avisos nuevos salgan, y que nadie se avise a sí mismo.
// =============================================================================

'use strict';

import {
  BOTONES_DEL_EJECUTIVO,
  botonesDelEjecutivo,
} from '../../public/js/views/dashboard/modules/proformaActions.js';

const fs   = require('fs');
const path = require('path');

// Los efectos escriben en la base: se reemplazan los modelos por dobles.
jest.mock('../../src/models/QuotationModel', () => ({ insertNotificacion: jest.fn() }));
jest.mock('../../src/models/LicitacionModel', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/UserModel', () => ({ findById: jest.fn() }));
jest.mock('../../src/utils/auditLog', () => ({ logEvent: jest.fn(), AuditActions: {} }));

const QuotationModel = require('../../src/models/QuotationModel');
const { ROLE_TRANSITIONS } = require('../../src/models/quotation/constants');
const { verificarDueno } = require('../../src/controllers/quotation/stateTransitionGuards');
const { notificarAlEjecutivo, mensajeDeHito } =
  require('../../src/controllers/quotation/stateTransitionEffects');

const ANA = 7;   // la dueña
const LUIS = 9;  // un compañero

const sesion = (extra = {}) => ({ rol: 'Ejecutivo', userId: ANA, delegado: false, ...extra });
const cotizacion = (estado, id_ejecutivo = ANA) => ({ estado, id_ejecutivo });
const destinos = (q, s) => botonesDelEjecutivo(q, s).map((b) => b.destino);

// ---------------------------------------------------------------------------
// 1. Qué botones ve
// ---------------------------------------------------------------------------
describe('botonesDelEjecutivo — qué ve la dueña en cada estado', () => {
  test.each([
    ['Pendiente',             ['Archivada']],
    ['En revision',           []],
    ['En espera',             []],
    ['Aprobada internamente', ['Enviada al cliente']],
    ['Enviada al cliente',    ['Rechazada', 'Archivada']],
    ['Rechazada',             ['Archivada']],
    ['Confirmada',            ['Archivada']],
    ['Archivada',             []],
  ])('%s → %j', (estado, esperado) => {
    expect(destinos(cotizacion(estado), sesion())).toEqual(esperado);
  });

  test('nunca ve «Confirmada»: cerrar la venta es del Jefe', () => {
    for (const estado of Object.keys(ROLE_TRANSITIONS.Ejecutivo)) {
      expect(destinos(cotizacion(estado), sesion())).not.toContain('Confirmada');
    }
  });

  test('sobre la cotización de un compañero no ve nada', () => {
    expect(destinos(cotizacion('Aprobada internamente', LUIS), sesion())).toEqual([]);
  });

  test('el id del token como cadena igual la reconoce como suya', () => {
    expect(destinos(cotizacion('Aprobada internamente'), sesion({ userId: String(ANA) })))
      .toEqual(['Enviada al cliente']);
  });

  test('con delegación no se dibujan: ese ejecutivo usa la grilla del Jefe', () => {
    expect(destinos(cotizacion('Aprobada internamente'), sesion({ delegado: true }))).toEqual([]);
  });

  test.each(['Jefe', 'Administracion', 'SysAdmin', 'Proyectos'])('el rol %s no los ve', (rol) => {
    expect(destinos(cotizacion('Aprobada internamente'), sesion({ rol }))).toEqual([]);
  });
});

describe('la lista de botones y la matriz del servidor no se separan', () => {
  test('cada destino de un botón existe en la fila Ejecutivo del servidor', () => {
    const alcanzables = new Set(Object.values(ROLE_TRANSITIONS.Ejecutivo).flat());
    for (const b of BOTONES_DEL_EJECUTIVO) expect(alcanzables).toContain(b.destino);
  });

  test('la fila Ejecutivo del servidor no permite nada que no tenga botón', () => {
    const conBoton = new Set(BOTONES_DEL_EJECUTIVO.map((b) => b.destino));
    for (const destinosDelEstado of Object.values(ROLE_TRANSITIONS.Ejecutivo)) {
      for (const d of destinosDelEstado) expect(conBoton).toContain(d);
    }
  });

  test('cada botón tiene quien lo escuche en executiveStrategy.js', () => {
    const fuente = fs.readFileSync(path.resolve(__dirname,
      '../../public/js/views/dashboard/strategies/executiveStrategy.js'), 'utf8');
    for (const b of BOTONES_DEL_EJECUTIVO) expect(fuente).toContain(`'${b.id}'`);
  });
});

// ---------------------------------------------------------------------------
// 2. El servidor exige que sea suya
// ---------------------------------------------------------------------------
describe('verificarDueno', () => {
  test('la dueña pasa', () => {
    expect(verificarDueno(cotizacion('Aprobada internamente'), 'Ejecutivo', ANA, false)).toBeNull();
  });

  test('el id como cadena también pasa', () => {
    expect(verificarDueno(cotizacion('Aprobada internamente'), 'Ejecutivo', String(ANA), false)).toBeNull();
  });

  test('un compañero sin delegación recibe 403', () => {
    const err = verificarDueno(cotizacion('Aprobada internamente'), 'Ejecutivo', LUIS, false);
    expect(err.status).toBe(403);
  });

  test('un compañero CON delegación pasa: opera como el Jefe', () => {
    expect(verificarDueno(cotizacion('Aprobada internamente'), 'Ejecutivo', LUIS, true)).toBeNull();
  });

  test.each(['Jefe', 'Administracion', 'SysAdmin'])('%s no está atado a ser dueño', (rol) => {
    expect(verificarDueno(cotizacion('Aprobada internamente'), rol, LUIS, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Los avisos de rechazo y espera
// ---------------------------------------------------------------------------
describe('avisos al ejecutivo', () => {
  const q = { id_ejecutivo: ANA, numero_correlativo: 'SC-2026/000700', cliente_nombre: 'Minera Andina' };
  const jefe = { id: 1, nombre_usuario: 'ronald' };

  beforeEach(() => QuotationModel.insertNotificacion.mockClear());

  test('rechazo: le llega con tipo «rechazo», quién y el motivo', async () => {
    await notificarAlEjecutivo({
      id: 700, quotation: q, nuevoEstado: 'Rechazada', usuario: jefe,
      esReapertura: false, observacion: 'Precio fuera de mercado',
    });

    const aviso = QuotationModel.insertNotificacion.mock.calls[0][0];
    expect(aviso).toMatchObject({ id_usuario: ANA, id_cotizacion: 700, tipo: 'rechazo' });
    expect(aviso.mensaje).toContain('RECHAZADA por ronald');
    expect(aviso.mensaje).toContain('Motivo: Precio fuera de mercado');
  });

  test('en espera: le llega con tipo «en_espera»', async () => {
    await notificarAlEjecutivo({
      id: 700, quotation: q, nuevoEstado: 'En espera', usuario: jefe, esReapertura: false,
    });

    const aviso = QuotationModel.insertNotificacion.mock.calls[0][0];
    expect(aviso.tipo).toBe('en_espera');
    expect(aviso.mensaje).toContain('EN ESPERA por ronald');
    // Sin observación no se escribe un «Motivo:» vacío.
    expect(aviso.mensaje).not.toContain('Motivo');
  });

  test('si la rechaza ella misma (el cliente dijo que no) no se avisa a sí misma', async () => {
    await notificarAlEjecutivo({
      id: 700, quotation: q, nuevoEstado: 'Rechazada',
      usuario: { id: ANA, nombre_usuario: 'ana' }, esReapertura: false, observacion: 'No compra',
    });

    expect(QuotationModel.insertNotificacion).not.toHaveBeenCalled();
  });

  test('los mensajes de siempre no cambiaron', () => {
    expect(mensajeDeHito(q, 'Enviada al cliente', 'ronald', null))
      .toBe('La cotización #SC-2026/000700 para Minera Andina ha sido enviada al cliente. Ya puedes darle seguimiento.');
    expect(mensajeDeHito(q, 'Confirmada', 'ronald', null))
      .toBe('La cotización #SC-2026/000700 para Minera Andina ha sido confirmada. Cierre de venta registrado.');
  });
});

describe('el ENUM de la base conoce los tipos nuevos', () => {
  const leerSql = (archivo) => fs.readFileSync(path.resolve(__dirname, '../../sql', archivo), 'utf8');

  test.each(['init.sql', 'upgrade_2026_avisos_rechazo_espera.sql'])('%s', (archivo) => {
    const sql = leerSql(archivo);
    expect(sql).toMatch(/'rechazo'/);
    expect(sql).toMatch(/'en_espera'/);
  });
});
