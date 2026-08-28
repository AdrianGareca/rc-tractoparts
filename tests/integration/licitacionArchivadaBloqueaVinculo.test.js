// =============================================================================
// tests/integration/licitacionArchivadaBloqueaVinculo.test.js
//
// Hallazgo MEDIO (visto desde Cotizaciones, arreglado en licitacionLinkGuard.js)
// — una licitación Archivada/No adjudicada no bloqueaba el avance de sus
// cotizaciones vinculadas.
//
// verificarVinculoLicitacion sólo comprobaba que la licitación referenciada
// EXISTIERA, nunca su estado. Se podía crear o editar una cotización
// vinculándola a una licitación ya 'Archivada' o 'No adjudicada' sin ningún
// aviso. Ahora esos dos estados bloquean un vínculo NUEVO o CAMBIADO con 422 —
// pero una cotización que YA estaba atada a esa licitación antes de que se
// archivara no se desata sola: si la edición no está CAMBIANDO el vínculo, se
// deja pasar (mismo criterio de "no trabar lo que ya existía" usado para el
// cliente en clienteLinkGuard.js).
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

jest.setTimeout(30000); // create/update pueden regenerar el PDF

const EJEC_USER = 'test_ejec_licarch';
const PASSWORD  = 'TestLicArch01!';
const CLIENTE   = 'Test Cliente LICARCH';

let ejecId;
let clienteId;
let licArchivadaId;
let licActivaId;
const cotizacionesCreadas = [];

// Contador en vez de Date.now() a secas: la columna es VARCHAR(20) y
// "LIC-ARCH-" + 13 dígitos de epoch ya ocupa 22 — el slice(0,20) cortaba el
// sufijo random entero, y dos licitaciones creadas en el mismo milisegundo
// (como acá, una atrás de la otra) chocaban por codigo UNIQUE.
let contadorCodigo = 0;
async function crearLicitacion(nombre, estado) {
  contadorCodigo += 1;
  const codigo = `LA${Date.now().toString(36)}${contadorCodigo}`.slice(0, 20);
  const [res] = await pool.execute(
    `INSERT INTO licitaciones (codigo, nombre, id_cliente, estado, id_responsable)
     VALUES (?, ?, ?, ?, ?)`,
    [codigo, nombre, clienteId, estado, ejecId]
  );
  return res.insertId;
}

const bodyBase = (overrides = {}) => ({
  id_cliente:    clienteId,
  descripcion:   'Test cotización LICARCH',
  fecha_emision: '2026-07-24',
  detalles: [
    { descripcion_item: 'Repuesto de prueba', cantidad: 1, precio_unitario: 100 },
  ],
  ...overrides,
});

let token;

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [EJEC_USER]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [EJEC_USER]);
  await pool.execute(`DELETE FROM licitaciones WHERE nombre LIKE 'Test Licitacion LICARCH%'`);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [EJEC_USER]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo LICARCH', EJEC_USER, hash]
  );
  ejecId = u.insertId;

  const [c] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]);
  clienteId = c.insertId;

  licArchivadaId = await crearLicitacion('Test Licitacion LICARCH Archivada', 'Archivada');
  licActivaId    = await crearLicitacion('Test Licitacion LICARCH Activa', 'Cotizando');

  const login = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: EJEC_USER, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  for (const id of cotizacionesCreadas) {
    await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [id]);
    await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [id]);
  }
  await pool.execute('DELETE FROM licitaciones WHERE id IN (?, ?)', [licArchivadaId ?? 0, licActivaId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

describe('LICARCH — una licitación Archivada/No adjudicada no admite nuevos vínculos', () => {

  test('LICARCH-01: crear una cotización nueva vinculada a una licitación Archivada → 422', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyBase({ id_licitacion: licArchivadaId }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('LICARCH-02: crear una cotización vinculada a una licitación activa → 201 (control sigue funcionando)', async () => {
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyBase({ id_licitacion: licActivaId }));

    expect(res.status).toBe(201);
    cotizacionesCreadas.push(res.body.data.id);
  });

  test('LICARCH-03: editar una cotización CAMBIANDO su vínculo hacia una licitación Archivada → 422', async () => {
    const created = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send(bodyBase()); // sin licitación
    expect(created.status).toBe(201);
    const cotId = created.body.data.id;
    cotizacionesCreadas.push(cotId);

    const res = await request(app)
      .put(`/api/cotizaciones/${cotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(bodyBase({ id_licitacion: licArchivadaId }));

    expect(res.status).toBe(422);

    const [rows] = await pool.execute('SELECT id_licitacion FROM cotizaciones WHERE id = ?', [cotId]);
    expect(rows[0].id_licitacion).toBeNull();
  });

  test('LICARCH-04: editar una cotización YA vinculada a la licitación Archivada, SIN cambiar el vínculo → permitido (200)', async () => {
    // Esta cotización quedó atada a licArchivadaId ANTES de que se archivara
    // (se inserta directo por SQL para simular ese estado previo, ya que la
    // API ya no permite crear el vínculo mientras está archivada).
    const [cot] = await pool.execute(
      `INSERT INTO cotizaciones
         (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision, estado, id_licitacion)
       VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', ?)`,
      [`LA-${Date.now()}`.slice(0, 20), clienteId, ejecId, 'Cotización preexistente LICARCH', licArchivadaId]
    );
    const cotId = cot.insertId;
    cotizacionesCreadas.push(cotId);
    await pool.execute(
      `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
       VALUES (?, 'Repuesto de prueba', 1, 100.00, 100.00, 'UND')`,
      [cotId]
    );

    const res = await request(app)
      .put(`/api/cotizaciones/${cotId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(bodyBase({
        descripcion:   'Cotización preexistente LICARCH editada',
        id_licitacion: licArchivadaId, // el MISMO vínculo, no cambia
      }));

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT id_licitacion FROM cotizaciones WHERE id = ?', [cotId]);
    expect(rows[0].id_licitacion).toBe(licArchivadaId);
  });
});
