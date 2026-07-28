// =============================================================================
// tests/unit/revokedTokens.test.js
// Lista de tokens revocados (logout) — que no crezca sin techo.
//
// FUGA QUE ESTO ARREGLA: revokeToken() metía cada token en un Set que no se
// limpiaba nunca. Dos problemas:
//
//   1. Crecimiento sin límite mientras el proceso viva. Con esta escala
//      (~10 usuarios) son unos pocos MB al año, no es dramático — pero es
//      memoria que sólo sube.
//   2. Los tokens ya vencidos ahí adentro no sirven para NADA: jwt.verify los
//      rechaza igual por expiración, antes de que se consulte esta lista. O sea
//      la estructura acumulaba justamente lo que no necesitaba.
// =============================================================================

'use strict';

const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-para-revocacion';

const {
  revokeToken,
  isTokenRevoked,
  purgeExpiredTokens,
  revokedTokenCount,
  __clearRevokedTokens,
} = require('../../src/middlewares/authMiddleware');

/** Token firmado que vence dentro de `segundos`. */
const tokenQueVence = (segundos) =>
  jwt.sign({ id: 1, nombre_usuario: 'x', rol: 'Ejecutivo' }, process.env.JWT_SECRET,
    { expiresIn: segundos });

/** Token ya vencido. */
const tokenVencido = () =>
  jwt.sign({ id: 1, nombre_usuario: 'x', rol: 'Ejecutivo', exp: Math.floor(Date.now() / 1000) - 60 },
    process.env.JWT_SECRET);

beforeEach(() => __clearRevokedTokens());

describe('revocación básica', () => {
  test('un token revocado queda marcado', () => {
    const t = tokenQueVence(3600);

    revokeToken(t);

    expect(isTokenRevoked(t)).toBe(true);
  });

  test('un token que no se revocó no lo está', () => {
    expect(isTokenRevoked(tokenQueVence(3600))).toBe(false);
  });

  test('revocar dos veces el mismo token no lo duplica', () => {
    const t = tokenQueVence(3600);

    revokeToken(t);
    revokeToken(t);

    expect(revokedTokenCount()).toBe(1);
  });

  test('un token basura no rompe la revocación', () => {
    expect(() => revokeToken('esto-no-es-un-jwt')).not.toThrow();
    expect(isTokenRevoked('esto-no-es-un-jwt')).toBe(true);
  });

  test('null o vacío se ignoran', () => {
    expect(() => revokeToken(null)).not.toThrow();
    expect(() => revokeToken('')).not.toThrow();
    expect(revokedTokenCount()).toBe(0);
  });
});

describe('purga de los vencidos', () => {
  test('un token vencido se descarta al purgar', () => {
    revokeToken(tokenVencido());
    expect(revokedTokenCount()).toBe(1);

    purgeExpiredTokens();

    expect(revokedTokenCount()).toBe(0);
  });

  test('un token vigente sobrevive a la purga', () => {
    const vigente = tokenQueVence(3600);
    revokeToken(vigente);

    purgeExpiredTokens();

    expect(revokedTokenCount()).toBe(1);
    expect(isTokenRevoked(vigente)).toBe(true);
  });

  test('purga sólo los vencidos, conservando el resto', () => {
    revokeToken(tokenVencido());
    revokeToken(tokenQueVence(3600));
    revokeToken(tokenVencido());

    purgeExpiredTokens();

    expect(revokedTokenCount()).toBe(1);
  });

  test('un token sin exp legible se conserva (no se puede saber si vencio)', () => {
    // Ante la duda, se conserva: descartar por las dudas reabriría la sesión.
    revokeToken('token-sin-exp');

    purgeExpiredTokens();

    expect(isTokenRevoked('token-sin-exp')).toBe(true);
  });
});

describe('la lista no crece sin techo', () => {
  test('revocar muchos vencidos no acumula memoria', () => {
    for (let i = 0; i < 500; i++) revokeToken(tokenVencido());

    // La purga automática se dispara sola al pasar el umbral.
    expect(revokedTokenCount()).toBeLessThan(500);
  });

  test('los vigentes SÍ se conservan aunque se dispare la purga', () => {
    const vigente = tokenQueVence(3600);
    revokeToken(vigente);

    for (let i = 0; i < 500; i++) revokeToken(tokenVencido());

    expect(isTokenRevoked(vigente)).toBe(true);
  });
});
