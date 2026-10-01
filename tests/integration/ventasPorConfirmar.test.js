// =============================================================================
// tests/integration/ventasPorConfirmar.test.js
// El aviso del Jefe: «este ejecutivo dice que vendió, falta confirmar».
//
// POR QUÉ EXISTE (decidido por Adrian el 2026-10-01)
// Una venta cerrada se podía anotar en dos lugares que no se hablaban: el
// ESTADO de la cotización ('Confirmada') y el SEGUIMIENTO ('Confirmado' /
// 'Venta concretada'). El ejecutivo solo puede tocar el segundo —confirmar la
// venta es del Jefe desde el 2026-09-28— así que si el Jefe no se enteraba, la
// cotización quedaba en 'Enviada al cliente' y la venta no contaba en ningún
// reporte que mire el estado.
//
// Adrian eligió que el estado NO cambie solo: el Jefe recibe un aviso y
// confirma él. 'No le interesa' solo se anota (no pasa a Rechazada).
//
// Lo que se verifica acá, por la API real y contra la base de pruebas:
//   - el ejecutivo anota la venta en el seguimiento → al Jefe le aparece
//   - 'Confirmado' cuenta igual que 'Venta concretada'
//   - 'No le interesa' no avisa nada
//   - fuera de 'Enviada al cliente' no avisa (ya la movió alguien)
//   - el aviso es SOLO del Jefe: el ejecutivo no lo ve en su campana
//   - cuando el Jefe confirma, el aviso desaparece solo
//
// Prerrequisito: NODE_ENV=test y la base de test creada (npm run db:init:test).
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

// Confirmar regenera el PDF en disco: varios segundos.
jest.setTimeout(60000);

const U_JEFE      = 'test_jefe_vpc';
const U_EJECUTIVO = 'test_ejec_vpc';
const PASSWORD    = 'TestVpc2026!';
const CLIENTE     = 'Test Cliente VPC';

let tokenJefe, tokenEjecutivo, idJefe, idEjecutivo, idCliente;
const creadas = [];

async function crearCotizacion(estado) {
  const correlativo = `VPC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision,
        estado, monto_total, fecha_validez)
     VALUES (?, ?, ?, 'Prueba VPC', CURDATE(), ?, 300.00, DATE_ADD(CURDATE(), INTERVAL 5 DAY))`,
    [correlativo.slice(0, 20), idCliente, idEjecutivo, estado]
  );
  creadas.push(res.insertId);
  await pool.execute(
    `INSERT INTO cotizacion_detalles
       (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Rodillo inferior', 2, 150.00, 300.00, 'UND')`,
    [res.insertId]
  );
  return res.insertId;
}

/** El ejecutivo anota el seguimiento por la API, como lo hace la pantalla. */
async function anotarSeguimiento(id, estadoVenta) {
  const res = await request(app)
    .patch(`/api/cotizaciones/${id}/seguimiento`)
    .set('Authorization', `Bearer ${tokenEjecutivo}`)
    .send({ estado_venta: estadoVenta });
  expect(res.status).toBe(200);
}

/** Los avisos 'venta_por_confirmar' de ESTA prueba (la base de test es compartida). */
async function avisosDe(token) {
  const res = await request(app)
    .get('/api/cotizaciones/notificaciones')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data.filter(
    (n) => n.tipo === 'venta_por_confirmar' && creadas.includes(n.id_cotizacion));
}

async function login(usuario) {
  const res = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: usuario, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

async function limpiar() {
  const usuarios = [U_JEFE, U_EJECUTIVO];
  const sub = `(SELECT id FROM cotizaciones WHERE id_ejecutivo IN
                 (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?)))`;
  await pool.execute(`DELETE FROM notificaciones WHERE id_cotizacion IN ${sub}`, usuarios);
  await pool.execute(`DELETE FROM cotizacion_historial_estados WHERE id_cotizacion IN ${sub}`, usuarios);
  await pool.execute(`DELETE FROM cotizacion_detalles WHERE id_cotizacion IN ${sub}`, usuarios);
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario IN (?, ?))`, usuarios);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario IN (?, ?)', usuarios);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);
}

beforeAll(async () => {
  await limpiar();

  const hash = await bcrypt.hash(PASSWORD, 10);
  const crear = async (nombre, usuario, idRol) => {
    const [r] = await pool.execute(
      `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
       VALUES (?, ?, ?, ?, 1)`, [nombre, usuario, hash, idRol]);
    return r.insertId;
  };
  idEjecutivo = await crear('Juan Vendedor VPC', U_EJECUTIVO, 1);
  idJefe      = await crear('Jefe VPC',          U_JEFE,      3);

  const [c] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE]);
  idCliente = c.insertId;

  tokenJefe      = await login(U_JEFE);
  tokenEjecutivo = await login(U_EJECUTIVO);
});

afterAll(async () => {
  await limpiar();
  await pool.end();
});

describe('VPC — el Jefe se entera de las ventas que falta confirmar', () => {

  test('VPC-01: «Venta concretada» en una enviada → aviso al Jefe con el nombre del vendedor', async () => {
    const id = await crearCotizacion('Enviada al cliente');
    await anotarSeguimiento(id, 'Venta concretada');

    const avisos = await avisosDe(tokenJefe);
    const aviso  = avisos.find((n) => n.id_cotizacion === id);
    expect(aviso).toBeDefined();
    expect(aviso.cliente_nombre).toBe(CLIENTE);
    expect(aviso.observacion).toContain('Juan Vendedor VPC');
    expect(aviso.observacion).toContain('Venta concretada');
  });

  test('VPC-02: «Confirmado» cuenta igual que «Venta concretada»', async () => {
    const id = await crearCotizacion('Enviada al cliente');
    await anotarSeguimiento(id, 'Confirmado');

    expect((await avisosDe(tokenJefe)).some((n) => n.id_cotizacion === id)).toBe(true);
  });

  test('VPC-03: «No le interesa» solo se anota: ni aviso ni cambio de estado', async () => {
    const id = await crearCotizacion('Enviada al cliente');
    await anotarSeguimiento(id, 'No le interesa');

    expect((await avisosDe(tokenJefe)).some((n) => n.id_cotizacion === id)).toBe(false);
    const [[fila]] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(fila.estado).toBe('Enviada al cliente');
  });

  test('VPC-04: anotar la venta NO cambia el estado (eso lo hace el Jefe)', async () => {
    const id = await crearCotizacion('Enviada al cliente');
    await anotarSeguimiento(id, 'Venta concretada');

    const [[fila]] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(fila.estado).toBe('Enviada al cliente');
  });

  test('VPC-05: si ya no está en «Enviada al cliente», no hay nada que avisar', async () => {
    const yaConfirmada = await crearCotizacion('Confirmada');
    const rechazada    = await crearCotizacion('Rechazada');
    await anotarSeguimiento(yaConfirmada, 'Venta concretada');
    await anotarSeguimiento(rechazada,    'Venta concretada');

    const ids = (await avisosDe(tokenJefe)).map((n) => n.id_cotizacion);
    expect(ids).not.toContain(yaConfirmada);
    expect(ids).not.toContain(rechazada);
  });

  test('VPC-06: el aviso es del Jefe — el ejecutivo no lo ve en su campana', async () => {
    const id = await crearCotizacion('Enviada al cliente');
    await anotarSeguimiento(id, 'Venta concretada');

    expect(await avisosDe(tokenEjecutivo)).toEqual([]);
  });

  test('VPC-07: cuando el Jefe confirma la venta, el aviso desaparece solo', async () => {
    const id = await crearCotizacion('Enviada al cliente');
    await anotarSeguimiento(id, 'Venta concretada');
    expect((await avisosDe(tokenJefe)).some((n) => n.id_cotizacion === id)).toBe(true);

    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: 'Confirmada' });
    expect(res.status).toBe(200);

    expect((await avisosDe(tokenJefe)).some((n) => n.id_cotizacion === id)).toBe(false);
  });
});
