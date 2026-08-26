// =============================================================================
// tests/unit/authBearerDoble.test.js
// El paste de Swagger UI: "Authorization: Bearer Bearer <jwt>".
//
// BUG QUE ESTO ARREGLA
// Swagger UI (esquema 'bearer') antepone "Bearer " automáticamente. Si
// alguien pega el string completo "Bearer <jwt>" en el campo, la cabecera
// llega como "Bearer Bearer <jwt>". Ya existía un guardián pensado para ese
// caso, pero extraía el token con `authHeader.split(' ')[1]` — que corta en
// el primer espacio y deja `token` como la palabra suelta "Bearer", sin
// espacio. El guardián comprobaba `token.startsWith('bearer ')` (CON
// espacio), así que nunca podía dispararse: código muerto que parecía
// protección real. Encontrado en la ronda de estrés del 2026-08-25.
//
// CÓMO SE VERIFICA SIN TOCAR LA BASE
// authenticate() consulta la base recién después de validar la firma del JWT
// y de chequear la lista de revocados. El chequeo de revocados es anterior y
// vive sólo en memoria (isTokenRevoked), así que revocar el token de prueba y
// mandarlo con el doble prefijo alcanza para probar que la extracción
// recuperó el string EXACTO — si quedara mal extraído, no matchearía contra
// la lista de revocados y el flujo seguiría de largo hacia jwt.verify.
// =============================================================================

'use strict';

const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-para-bearer-doble';

const {
  authenticate,
  revokeToken,
  __clearRevokedTokens,
} = require('../../src/middlewares/authMiddleware');

const tokenQueVence = (segundos = 3600) =>
  jwt.sign({ id: 1, nombre_usuario: 'x', rol: 'Ejecutivo' }, process.env.JWT_SECRET, { expiresIn: segundos });

/** Mock mínimo de Express: sólo lo que authenticate() usa antes de tocar la base. */
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json   = (body) => { res.body = body; return res; };
  return res;
}

beforeEach(() => __clearRevokedTokens());

describe('authenticate — doble prefijo "Bearer Bearer <jwt>"', () => {
  test('el token se extrae completo y se reconoce como revocado', async () => {
    const t = tokenQueVence();
    revokeToken(t);

    const req  = { headers: { authorization: `Bearer Bearer ${t}` } };
    const res  = mockRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/revoked/i);
    expect(next).not.toHaveBeenCalled();
  });

  test('control: el mismo token con un solo prefijo también se reconoce como revocado', async () => {
    const t = tokenQueVence();
    revokeToken(t);

    const req  = { headers: { authorization: `Bearer ${t}` } };
    const res  = mockRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/revoked/i);
  });
});
