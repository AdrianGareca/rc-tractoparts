// =============================================================================
// tests/integration/reabrirConfirmada.test.js
// La llave del jefe, de punta a punta.
//
// CASO REAL QUE LO ORIGINÓ
// Una venta quedó 'Confirmada' y después el cliente pidió corregir unos datos.
// El sistema no dejaba: desde 'Confirmada' sólo se podía archivar. La analogía
// del área comercial fue la llave del jefe del supermercado — se puede abrir la
// caja después de cerrada, pero queda constancia de quién la abrió y por qué.
//
// Eso es lo que se verifica acá: que la llave abra, que exija motivo, que deje
// rastro en las dos bitácoras, que avise al ejecutivo dueño, y que después de
// reabrir la cotización vuelva a ser editable (que es todo el punto del pedido).
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

// Cada transición regenera el PDF en disco: son varios segundos, muy por encima
// de los 5 s por defecto de Jest.
jest.setTimeout(60000);

let tokenJefe, tokenSysAdmin, tokenEjecutivo, tokenDelegado;
let idJefe, idSysAdmin, idEjecutivo, idDelegado, idCliente;
const cotizacionesCreadas = [];

const U_JEFE      = 'test_jefe_llave';
const U_SYSADMIN  = 'test_sys_llave';
const U_EJECUTIVO = 'test_ejec_llave';
const U_DELEGADO  = 'test_deleg_llave';
const PASSWORD    = 'TestLlave2026!';
const CLIENTE     = 'Test Cliente LLAVE';

const MOTIVO = 'El cliente pidió corregir el NIT y la cantidad del ítem 2.';

// ---------------------------------------------------------------------------
/** Cotización completa, ya 'Confirmada', con su fecha de cierre puesta. */
async function crearConfirmada() {
  const correlativo = `LLV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const [res] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision,
        estado, monto_total, fecha_validez, fecha_confirmacion)
     VALUES (?, ?, ?, ?, CURDATE(), 'Confirmada', 300.00,
             DATE_ADD(CURDATE(), INTERVAL 15 DAY), NOW())`,
    [correlativo.slice(0, 20), idCliente, idEjecutivo, 'Venta cerrada LLAVE']
  );
  const id = res.insertId;
  cotizacionesCreadas.push(id);
  await pool.execute(
    `INSERT INTO cotizacion_detalles
       (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Rodillo inferior', 2, 150.00, 300.00, 'UND')`,
    [id]
  );
  return id;
}

const reabrir = (id, token, body) =>
  request(app)
    .put(`/api/cotizaciones/${id}/estado`)
    .set('Authorization', `Bearer ${token}`)
    .send({ nuevo_estado: 'Pendiente', ...body });

async function crearUsuario(nombre, usuario, idRol, hash, delegado = false) {
  const [res] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo, can_approve_quotations)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [nombre, usuario, hash, idRol, delegado ? 1 : 0]
  );
  return res.insertId;
}

async function login(usuario) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: usuario, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

// ---------------------------------------------------------------------------
beforeAll(async () => {
  const usuarios = [U_JEFE, U_SYSADMIN, U_EJECUTIVO, U_DELEGADO];
  const marcadores = usuarios.map(() => '?').join(', ');

  await pool.execute(
    `DELETE FROM cotizacion_detalles WHERE id_cotizacion IN
       (SELECT id FROM cotizaciones WHERE id_ejecutivo IN
         (SELECT id FROM usuarios WHERE nombre_usuario IN (${marcadores})))`,
    usuarios
  );
  await pool.execute(
    `DELETE FROM cotizaciones WHERE id_ejecutivo IN
       (SELECT id FROM usuarios WHERE nombre_usuario IN (${marcadores}))`,
    usuarios
  );
  await pool.execute(`DELETE FROM usuarios WHERE nombre_usuario IN (${marcadores})`, usuarios);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);

  idEjecutivo = await crearUsuario('Test Ejecutivo LLAVE', U_EJECUTIVO, 1, hash);
  idJefe      = await crearUsuario('Test Jefe LLAVE',      U_JEFE,      3, hash);
  idSysAdmin  = await crearUsuario('Test SysAdmin LLAVE',  U_SYSADMIN,  4, hash);
  idDelegado  = await crearUsuario('Test Delegado LLAVE',  U_DELEGADO,  1, hash, true);

  const [cli] = await pool.execute(
    'INSERT INTO clientes (razon_social, activo) VALUES (?, 1)',
    [CLIENTE]
  );
  idCliente = cli.insertId;

  tokenEjecutivo = await login(U_EJECUTIVO);
  tokenJefe      = await login(U_JEFE);
  tokenSysAdmin  = await login(U_SYSADMIN);
  tokenDelegado  = await login(U_DELEGADO);
});

afterAll(async () => {
  const ids = [idJefe, idSysAdmin, idEjecutivo, idDelegado].filter(Boolean);

  if (cotizacionesCreadas.length > 0) {
    const m = cotizacionesCreadas.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM notificaciones WHERE id_cotizacion IN (${m})`, cotizacionesCreadas);
    await pool.execute(`DELETE FROM cotizacion_historial_estados WHERE id_cotizacion IN (${m})`, cotizacionesCreadas);
    await pool.execute(`DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (${m})`, cotizacionesCreadas);
    await pool.execute(`DELETE FROM cotizaciones WHERE id IN (${m})`, cotizacionesCreadas);
  }
  if (ids.length > 0) {
    const m = ids.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM bitacora_auditoria WHERE id_usuario IN (${m})`, ids);
    await pool.execute(`DELETE FROM usuarios WHERE id IN (${m})`, ids);
  }
  if (idCliente) await pool.execute('DELETE FROM clientes WHERE id = ?', [idCliente]);
  await pool.end();
});

// =============================================================================
describe('LLAVE — el motivo es obligatorio', () => {

  test('LLV-01: sin motivo el servidor rechaza con 422 y la venta sigue cerrada', async () => {
    const id  = await crearConfirmada();
    const res = await reabrir(id, tokenJefe, {});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/motivo/i);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Confirmada');
  });

  test('LLV-02: un motivo en blanco no cuenta como motivo', async () => {
    const id  = await crearConfirmada();
    const res = await reabrir(id, tokenJefe, { observacion: '    ' });

    expect(res.status).toBe(422);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Confirmada');
  });

  // Archivar una Confirmada es la salida normal y nunca pidió justificación:
  // el requisito nuevo no debe contagiarse a las transiciones que ya existían.
  test('LLV-03: archivar una Confirmada sigue sin exigir motivo', async () => {
    const id  = await crearConfirmada();
    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: 'Archivada' });

    expect(res.status).toBe(200);
  });
});

// =============================================================================
describe('LLAVE — quién puede usarla', () => {

  test('LLV-04: el Jefe reabre y la cotización queda Pendiente', async () => {
    const id  = await crearConfirmada();
    const res = await reabrir(id, tokenJefe, { observacion: MOTIVO });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Pendiente');
  });

  test('LLV-05: el SysAdmin también', async () => {
    const id  = await crearConfirmada();
    const res = await reabrir(id, tokenSysAdmin, { observacion: MOTIVO });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Pendiente');
  });

  test('LLV-06: un Ejecutivo común no puede — 403', async () => {
    const id  = await crearConfirmada();
    const res = await reabrir(id, tokenEjecutivo, { observacion: MOTIVO });

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Confirmada');
  });

  // El delegado opera con la matriz del Jefe para todo el ciclo comercial.
  // Reabrir una venta cerrada queda deliberadamente afuera de la delegación.
  test('LLV-07: un Ejecutivo CON delegación tampoco — 403', async () => {
    const id  = await crearConfirmada();
    const res = await reabrir(id, tokenDelegado, { observacion: MOTIVO });

    expect(res.status).toBe(403);
    expect(res.body.allowed_transitions).not.toContain('Pendiente');

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Confirmada');
  });

  // Lo que al delegado SÍ le corresponde. Va junto al caso de arriba a
  // propósito: el recorte de la llave no debe llevarse puesto lo demás que el
  // rol delegado sí puede hacer sobre una venta cerrada.
  test('LLV-07b: el ejecutivo delegado SÍ puede archivar una Confirmada', async () => {
    const id  = await crearConfirmada();
    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenDelegado}`)
      .send({ nuevo_estado: 'Archivada' });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Archivada');
  });
});

// =============================================================================
describe('LLAVE — queda constancia', () => {

  test('LLV-08: la bitácora registra REABRIR_COTIZACION, no un cambio de estado común', async () => {
    const id = await crearConfirmada();
    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const [filas] = await pool.execute(
      `SELECT accion, detalle FROM bitacora_auditoria
        WHERE entidad = 'cotizaciones' AND id_entidad = ?
        ORDER BY id DESC LIMIT 1`,
      [id]
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].accion).toBe('REABRIR_COTIZACION');

    // El motivo tiene que poder leerse después, no sólo el hecho de la apertura.
    const detalle = typeof filas[0].detalle === 'string'
      ? JSON.parse(filas[0].detalle)
      : filas[0].detalle;
    expect(JSON.stringify(detalle)).toContain('NIT');
  });

  test('LLV-09: el historial de estados guarda el motivo y quién lo hizo', async () => {
    const id = await crearConfirmada();
    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const [filas] = await pool.execute(
      `SELECT estado_anterior, estado_nuevo, observacion, rol_usuario
         FROM cotizacion_historial_estados
        WHERE id_cotizacion = ? ORDER BY id DESC LIMIT 1`,
      [id]
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].estado_anterior).toBe('Confirmada');
    expect(filas[0].estado_nuevo).toBe('Pendiente');
    expect(filas[0].observacion).toContain('NIT');
    expect(filas[0].rol_usuario).toBe('Jefe');
  });

  test('LLV-10: el ejecutivo dueño recibe una notificación', async () => {
    const id = await crearConfirmada();
    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const [filas] = await pool.execute(
      'SELECT tipo, mensaje FROM notificaciones WHERE id_cotizacion = ? AND id_usuario = ?',
      [id, idEjecutivo]
    );

    expect(filas.length).toBeGreaterThan(0);
    expect(filas[0].tipo).toBe('correccion');
    expect(filas[0].mensaje).toMatch(/reabiert|reabri/i);
  });
});

// =============================================================================
describe('LLAVE — la cotización vuelve a ser trabajable', () => {

  // El motivo de todo el pedido: que el ejecutivo pueda aplicar el cambio que
  // pidió el cliente. Si tras reabrir no puede editar, la llave no sirvió.
  // (PUT /:id reenvía la cabecera completa + el set de ítems, igual que el alta.)
  test('LLV-11: tras reabrir, el ejecutivo dueño puede editarla otra vez', async () => {
    const id = await crearConfirmada();
    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const hoy = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .put(`/api/cotizaciones/${id}`)
      .set('Authorization', `Bearer ${tokenEjecutivo}`)
      .send({
        id_cliente:    idCliente,
        descripcion:   'Repuestos corregidos a pedido del cliente',
        fecha_emision: hoy,
        moneda:        'USD',
        detalles: [
          { descripcion_item: 'Rodillo inferior', cantidad: 3, precio_unitario: 150, unidad: 'UND' },
        ],
      });

    expect(res.status).toBe(200);

    const [rows] = await pool.execute('SELECT descripcion FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].descripcion).toMatch(/corregidos/);
  });

  // Una cotización Pendiente no es una venta cerrada: dejar la fecha de cierre
  // puesta haría que un reporte la contara como confirmada estando en borrador.
  test('LLV-12: al reabrir se borra la fecha de confirmación', async () => {
    const id = await crearConfirmada();

    const [antes] = await pool.execute('SELECT fecha_confirmacion FROM cotizaciones WHERE id = ?', [id]);
    expect(antes[0].fecha_confirmacion).not.toBeNull();

    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const [despues] = await pool.execute('SELECT fecha_confirmacion FROM cotizaciones WHERE id = ?', [id]);
    expect(despues[0].fecha_confirmacion).toBeNull();
  });

  // Volver a cerrar la venta NO es un solo clic: desde 'Pendiente' nadie puede
  // saltar directo a 'Confirmada' — ni el Jefe. Hay que pasar por el envío al
  // cliente. Son dos pasos, y está bien que así sea: si reabrir y re-confirmar
  // fuera un ida y vuelta de un clic, el estado 'Confirmada' dejaría de
  // significar "el cliente aceptó estos términos" (los términos cambiaron).
  test('LLV-13: se puede volver a confirmar en dos pasos, y la fecha de cierre se re-estampa', async () => {
    const id = await crearConfirmada();
    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const mover = (estado) => request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: estado });

    // Atajo del Jefe: de Pendiente directo al cliente, sin aprobación interna.
    expect((await mover('Enviada al cliente')).status).toBe(200);
    expect((await mover('Confirmada')).status).toBe(200);

    const [rows] = await pool.execute(
      'SELECT estado, fecha_confirmacion FROM cotizaciones WHERE id = ?', [id]
    );
    expect(rows[0].estado).toBe('Confirmada');
    expect(rows[0].fecha_confirmacion).not.toBeNull();
  });

  test('LLV-13b: desde Pendiente nadie salta directo a Confirmada', async () => {
    const id = await crearConfirmada();
    await reabrir(id, tokenJefe, { observacion: MOTIVO });

    const res = await request(app)
      .put(`/api/cotizaciones/${id}/estado`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({ nuevo_estado: 'Confirmada' });

    expect(res.status).toBe(403);
  });
});

// =============================================================================
describe('LLAVE — lo que sigue cerrado', () => {

  test('LLV-14: una Archivada no se reabre ni con la llave del SysAdmin', async () => {
    const id = await crearConfirmada();
    await pool.execute("UPDATE cotizaciones SET estado = 'Archivada' WHERE id = ?", [id]);

    const res = await reabrir(id, tokenSysAdmin, { observacion: MOTIVO });

    expect(res.status).toBe(403);

    const [rows] = await pool.execute('SELECT estado FROM cotizaciones WHERE id = ?', [id]);
    expect(rows[0].estado).toBe('Archivada');
  });

  test('LLV-15: desde Confirmada no se salta a un estado intermedio', async () => {
    const id = await crearConfirmada();

    for (const destino of ['Aprobada internamente', 'Enviada al cliente', 'Rechazada']) {
      const res = await request(app)
        .put(`/api/cotizaciones/${id}/estado`)
        .set('Authorization', `Bearer ${tokenJefe}`)
        .send({ nuevo_estado: destino, observacion: MOTIVO });

      expect(res.status).toBe(403);
    }
  });
});
