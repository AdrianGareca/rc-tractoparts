// =============================================================================
// tests/integration/paginaNoEncontrada.test.js
// Una dirección equivocada tiene que responder como una página, no como una API.
//
// EL PROBLEMA MEDIDO
// El manejador de 404 devolvía SIEMPRE JSON:
//
//   {"success":false,"message":"Route not found: GET /cotizacines"}
//
// Está bien para un cliente de API. Pero quien escribe mal la dirección en la
// barra del navegador, o abre un favorito viejo, es una persona — y ve eso:
// llaves, comillas, y un mensaje en inglés que le dice «Route not found» sin
// ofrecerle ninguna salida. No hay un enlace para volver, ni una explicación de
// qué pasó. La reacción normal es cerrar la pestaña y avisar que «el sistema no
// anda».
//
// LA REGLA
// La MISMA ruta responde distinto según quién pregunte, y lo dice el encabezado
// Accept que el propio cliente manda:
//
//   navegador (Accept: text/html)   → página en castellano, con vuelta al inicio
//   API / fetch (Accept: json)      → el JSON de siempre, intacto
//
// El código de estado es 404 en los dos casos. Eso no se negocia: es lo que
// leen los buscadores, los monitores de disponibilidad y el propio navegador.
//
// LO QUE LA PÁGINA NO PUEDE HACER
// El JSON repite la dirección pedida («Route not found: GET /...»). En JSON es
// inofensivo. En una página HTML, devolver texto que vino del pedido es
// exactamente cómo se inyecta código en el navegador de la víctima: alcanza con
// mandarle a alguien un enlace con una etiqueta <script> adentro. Por eso la
// página es ESTÁTICA y no menciona la dirección — el último test de este
// archivo lo exige.
//
// Prerrequisitos: NODE_ENV=test.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
describe('una persona que escribe mal la dirección', () => {
  test('recibe una página, no un volcado de JSON', async () => {
    const res = await request(app)
      .get('/cotizacines')                    // el error de tipeo típico
      .set('Accept', 'text/html');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  test('la página está en castellano y dice qué pasó', async () => {
    const res = await request(app).get('/pagina-que-no-existe').set('Accept', 'text/html');

    // No se exige una frase exacta —el texto se va a reescribir— sino que
    // aparezca la palabra que le da sentido a la pantalla.
    expect(res.text).toMatch(/no encontr/i);
    expect(res.text).not.toMatch(/Route not found/);
  });

  test('ofrece una salida y no deja a la persona encerrada', async () => {
    const res = await request(app).get('/pagina-que-no-existe').set('Accept', 'text/html');

    // Un enlace de vuelta a la raíz. Sin esto la única salida es el botón
    // «atrás» del navegador, y quien llegó por un favorito viejo no lo tiene.
    expect(res.text).toMatch(/href="\/"/);
  });

  test('no repite la dirección que se pidió', async () => {
    // El pedido trae texto que escribió otra persona. Devolverlo dentro del
    // HTML es cómo se ejecuta código ajeno en el navegador de la víctima.
    const res = await request(app)
      .get('/buscame-<script>alert(1)</script>')
      .set('Accept', 'text/html');

    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/<script>alert/);
    expect(res.text).not.toMatch(/buscame/);
  });
});

// ---------------------------------------------------------------------------
describe('lo que ya funcionaba sigue funcionando', () => {
  test('un cliente de API sigue recibiendo JSON', async () => {
    const res = await request(app)
      .get('/api/no-existe')
      .set('Accept', 'application/json');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Route not found/);
  });

  test('una ruta de API pedida desde el navegador tampoco devuelve una página', async () => {
    // Un fetch() del propio dashboard manda Accept: */* y espera JSON. Si le
    // llegara HTML, el .json() del frontend explotaría con un error de sintaxis
    // en vez del mensaje que el código sabe mostrar. Todo lo que empieza con
    // /api/ es API, sin importar quién pregunte.
    const res = await request(app)
      .get('/api/no-existe')
      .set('Accept', 'text/html,application/xhtml+xml');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('el health-check no se ve afectado', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
