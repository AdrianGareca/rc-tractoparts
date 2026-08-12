// =============================================================================
// tests/integration/notificacionNoMienteAutor.test.js
// Una notificación no puede atribuirle la acción a quien la recibe.
//
// EL BUG
// La consulta de notificaciones traía:
//
//     u.nombre_completo AS solicitado_por,
//     u.nombre_completo AS rol_solicitante
//     ...
//     LEFT JOIN usuarios u ON u.id = c.id_ejecutivo
//
// `u` está unido por `c.id_ejecutivo` — el DUEÑO de la cotización. Y el dueño
// es justamente el destinatario de la notificación.
//
// Así que el Jefe aprobaba la cotización de Ana, Ana abría la campana, y leía:
//
//     «La cotización #SC-2026/000120 ha sido aprobada por el Jefe.
//      Gestionado por: Ana Pérez»
//
// Ana no gestionó nada: la recibió. Y `rol_solicitante` devolvía un nombre
// completo donde el nombre del campo promete un rol — un dato que la pantalla
// ni siquiera usaba.
//
// POR QUÉ SE QUITA EN VEZ DE ARREGLARSE
// La tabla `notificaciones` no guarda quién ejecutó la acción, así que el dato
// correcto no existe en la base: arreglarlo de verdad pide una columna nueva y
// una migración.
//
// Pero el mensaje YA nombra al autor en su propio texto — «ha sido aprobada por
// el Jefe», «fue REABIERTA por Juan». El campo era redundante además de falso.
// Agregar una columna para volver a decir lo que el mensaje ya dice sería pagar
// una migración por una duplicación.
//
// Se quita el campo, se quita el JOIN que sólo existía para él, y la pantalla
// deja de afirmar algo que no es cierto.
//
// Prerequisitos: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000);

let tokenAna, anaId, clienteId, cotizacionId;

const ANA     = 'test_ana_notif';
const PASS    = 'TestNotif01!';
const CLIENTE = 'Test Client NOTIF';
const NOMBRE_ANA = 'Ana Notificaciones';

beforeAll(async () => {
  await pool.execute('DELETE FROM notificaciones WHERE id_usuario IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [ANA]);
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [ANA]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [ANA]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [ANA]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASS, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`, [NOMBRE_ANA, ANA, hash]);
  anaId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]);
  clienteId = c.insertId;

  // Una cotización de Ana. Ella es la DUEÑA — y por eso la destinataria.
  const [q] = await pool.execute(
    `INSERT INTO cotizaciones (numero_correlativo, id_cliente, id_ejecutivo, descripcion,
                               fecha_emision, estado, moneda, monto_total)
     VALUES (?, ?, ?, ?, CURDATE(), 'Aprobada internamente', 'BOB', 500.00)`,
    [`NTF-${Date.now()}`.slice(0, 20), clienteId, anaId, 'Cotización de Ana']);
  cotizacionId = q.insertId;

  // La notificación que el Jefe le dispara al aprobarla.
  await pool.execute(
    `INSERT INTO notificaciones (id_usuario, id_cotizacion, tipo, mensaje, leida)
     VALUES (?, ?, 'aprobacion', ?, 0)`,
    [anaId, cotizacionId,
     'La cotización ha sido aprobada por el Jefe. Ya puedes enviarla.']);

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: ANA, password: PASS });
  expect(login.status).toBe(200);
  tokenAna = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM notificaciones WHERE id_usuario = ?', [anaId ?? 0]);
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [anaId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

const pedirNotificaciones = () => request(app)
  .get('/api/cotizaciones/notificaciones')
  .set('Authorization', `Bearer ${tokenAna}`);

describe('NTF — la notificación no le atribuye la acción al destinatario', () => {

  test('NTF-01: la notificación llega', async () => {
    const res = await pedirNotificaciones();
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });

  test('NTF-02: NO dice que Ana gestionó lo que Ana recibió', async () => {
    const res = await pedirNotificaciones();
    const fila = res.body.data.find((n) => n.id_cotizacion === cotizacionId);

    expect(fila).toBeDefined();
    // El campo se quitó. Si vuelve trayendo el nombre de la destinataria, la
    // pantalla imprime «Gestionado por: Ana Notificaciones» — a Ana.
    expect(fila.solicitado_por ?? null).not.toBe(NOMBRE_ANA);
  });

  test('NTF-03: `rol_solicitante` no devuelve un nombre donde promete un rol', async () => {
    const res = await pedirNotificaciones();
    const fila = res.body.data.find((n) => n.id_cotizacion === cotizacionId);

    expect(fila.rol_solicitante ?? null).not.toBe(NOMBRE_ANA);
  });

  test('NTF-04: lo que sí importa sigue llegando', async () => {
    // El arreglo no puede vaciar la notificación: el correlativo, el cliente y
    // el mensaje son lo que el ejecutivo necesita leer.
    const res = await pedirNotificaciones();
    const fila = res.body.data.find((n) => n.id_cotizacion === cotizacionId);

    expect(typeof fila.numero_correlativo).toBe('string');
    expect(fila.cliente_nombre).toBe(CLIENTE);
    expect(fila.observacion).toContain('aprobada por el Jefe');
  });

  test('NTF-05: el mensaje ya nombra al autor — por eso el campo sobraba', async () => {
    const res = await pedirNotificaciones();
    const fila = res.body.data.find((n) => n.id_cotizacion === cotizacionId);

    // Ésta es la justificación de quitar el campo en vez de migrarlo: quien
    // hizo la acción ya está escrito en el texto que el usuario lee.
    expect(fila.observacion).toMatch(/por el Jefe|por \w+/i);
  });
});
