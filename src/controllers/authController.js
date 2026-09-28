// =============================================================================
// src/controllers/authController.js
// Authentication Controller — HU01: Login and Logout
//
// Sprint 2 hardening: added explicit hash.trim() as a defensive measure
// against any database driver that might pad fixed-width columns, even though
// our schema declares password_hash as VARCHAR(255). The trim costs nothing
// and makes the comparison resilient to column-type regressions.
// =============================================================================

'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const UserModel = require('../models/UserModel');
const { revokeToken }             = require('../middlewares/authMiddleware');
const { logEvent, AuditActions }  = require('../utils/auditLog');

// Rondas de bcrypt configuradas para este entorno. Mismo valor que usa
// userController al crear o cambiar contrasenas. Aca hace falta para dos cosas:
// fabricar el hash senuelo con el MISMO costo que los hashes reales, y decidir
// si una contrasena que acaba de validar quedo guardada con un costo viejo.
const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// Hash senuelo: formato valido de bcrypt, sin ninguna contrasena real detras. Se
// compara contra el cuando el nombre de usuario no existe, para quemar el mismo
// CPU que una comparacion de verdad y que el tiempo de respuesta no delate que
// usuarios existen (sin esto: usuario desconocido = 401 instantaneo sin bcrypt;
// usuario conocido con clave mala = el costo completo de bcrypt.compare).
//
// POR QUE SE CALCULA Y NO ES UNA CONSTANTE ESCRITA A MANO
// El costo va grabado DENTRO del hash. Mientras fue un literal de costo 12, bajar
// BCRYPT_ROUNDS a 10 dejaba a los usuarios reales en ~150 ms y al senuelo en
// ~990 ms: ese hueco de 6x reabria exactamente el canal de tiempos que este hash
// existe para cerrar (medido en el estres local del 2026-09-23). Calculandolo a
// partir de ROUNDS, el senuelo cuesta siempre lo mismo que un hash real.
//
// Se calcula la primera vez que hace falta y no al cargar el modulo: bcryptjs es
// JavaScript puro y hashear a 12 rondas bloquea ~700 ms, que se pagarian en el
// arranque del servidor y en cada archivo de pruebas que requiera este modulo.
let _dummyHash = null;
function dummyBcryptHash() {
  if (_dummyHash === null) {
    _dummyHash = bcrypt.hashSync('ninguna-cuenta-tiene-esta-contrasena', ROUNDS);
  }
  return _dummyHash;
}

// ---------------------------------------------------------------------------
// _rechazarLogin — auditar el intento fallido y responder 401.
//
// Los tres motivos de rechazo que conocen al usuario (cuenta inactiva, cuenta
// bloqueada, contraseña incorrecta) terminaban con el MISMO bloque de quince
// líneas: un logEvent de LOGIN_FAILED con los mismos siete campos, y un 401.
// Lo único que cambiaba entre los tres era el `reason`, algún dato extra en el
// detalle, y —en el caso del bloqueo— el mensaje.
//
// QUÉ NO ENTRA ACÁ, Y ES A PROPÓSITO
// El `bcrypt.compare(password, dummyBcryptHash())` que iguala los tiempos NO
// se movió adentro. Cada camino lo necesita distinto: el de usuario
// inexistente y el de cuenta inactiva lo queman a propósito, el de contraseña
// incorrecta ya gastó ese tiempo comparando de verdad, y el de cuenta
// bloqueada corta antes sin comparar nada. Meterlo acá le agregaría ~100ms al
// camino más común y volvería a abrir el canal de tiempos que ese código
// existe para cerrar.
//
// Tampoco entra el incrementFailedAttempts: sólo cuenta como intento fallido
// la contraseña equivocada, no que la cuenta esté inactiva o ya bloqueada.
// ---------------------------------------------------------------------------
async function _rechazarLogin(res, { user, clientIp, motivo, detalleExtra = {}, mensaje }) {
  await logEvent({
    id_usuario:     user.id,
    nombre_usuario: user.nombre_usuario,
    accion:         AuditActions.LOGIN_FAILED,
    entidad:        'usuarios',
    id_entidad:     user.id,
    detalle:        { reason: motivo, ...detalleExtra },
    ip_origen:      clientIp,
    resultado:      'fallo',
  });

  // El genérico por defecto: nunca revelar si el usuario existe (enumeración).
  // El bloqueo es la única excepción y pasa su propio mensaje, porque ahí sí
  // conviene que la persona sepa que tiene que esperar.
  return res.status(401).json({
    success: false,
    message: mensaje ?? 'Invalid credentials.',
  });
}

// ---------------------------------------------------------------------------
// _emitirSesion — las credenciales dieron bien: abrir la sesión.
//
// Es el paso 6 de login(), entero: limpiar el contador de intentos, armar el
// token, firmarlo, dejar constancia en la bitácora y devolverle a la pantalla
// lo que necesita para arrancar. Se saca como una pieza sola porque es UNA
// cosa —"la cuenta está bien, dale acceso"— y porque login() quedaba de 84
// líneas: cuatro por encima del umbral que el proyecto se puso.
//
// No decide nada. Cuando esto corre, ya se comprobó que el usuario existe,
// está activo, no está bloqueado y la contraseña coincide.
// ---------------------------------------------------------------------------
async function _emitirSesion(res, { user, clientIp }) {
  // Reset failed-attempt counter and record last-access timestamp
  await UserModel.updateLoginSuccess(user.id);

  // Build the JWT payload — include only what downstream middleware needs.
  // user.rol is the role NAME string (e.g. 'Jefe') from the JOIN with roles.
  const tokenPayload = {
    id:             user.id,
    nombre_usuario: user.nombre_usuario,
    rol:            user.rol,   // Always the string name from the roles table JOIN
    // Persistent revocation stamp. The auth middleware compares this against
    // usuarios.token_version on every request, so a logout (which bumps the
    // counter) invalidates this token even after a server restart.
    token_version:  user.token_version ?? 0,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    algorithm: 'HS256',
  });

  await logEvent({
    id_usuario:     user.id,
    nombre_usuario: user.nombre_usuario,
    accion:         AuditActions.LOGIN,
    entidad:        'usuarios',
    id_entidad:     user.id,
    ip_origen:      clientIp,
    resultado:      'exito',
  });

  return res.status(200).json({
    success: true,
    message: 'Authentication successful.',
    data: {
      token,
      user: {
        id:              user.id,
        nombre_completo: user.nombre_completo,
        nombre_usuario:  user.nombre_usuario,
        rol:             user.rol,
        // Delegación de Funciones flag — the SPA stores this in AuthSession to
        // conditionally render the "Aprobar Internamente" action for delegated
        // executives. Authorization is still enforced server-side (the state
        // controller re-reads the flag fresh from the DB).
        can_approve_quotations: Boolean(user.can_approve_quotations),
      },
    },
  });
}

const AuthController = {

  // ---------------------------------------------------------------------------
  // login — POST /api/auth/login
  //
  // Steps:
  //   1. Validate required fields
  //   2. Look up the user by username (INNER JOIN with roles)
  //   3. Reject inactive accounts
  //   4. Reject locked accounts (brute-force protection)
  //   5. Compare the submitted password against the stored bcrypt hash
  //   6. On success: reset failed-attempt counter, issue JWT, log event
  //   7. On failure: increment failed-attempt counter, log event
  // ---------------------------------------------------------------------------
  async login(req, res) {
    const { nombre_usuario, password } = req.body;

    // ── 1. Field presence check ───────────────────────────────────────────────
    if (!nombre_usuario || !password) {
      return res.status(422).json({
        success: false,
        message: 'Both nombre_usuario and password are required.',
      });
    }

    // Trim whitespace to tolerate accidental spaces (common on mobile / Swagger UI)
    const trimmedUsername = String(nombre_usuario).trim();
    const clientIp        = req.ip || req.socket?.remoteAddress || null;

    try {
      // ── 2. User lookup ────────────────────────────────────────────────────────
      const user = await UserModel.findByUsername(trimmedUsername);

      // Generic 401 — never reveal whether the username exists or not.
      // Burn an equivalent bcrypt.compare() cost against a dummy hash so this
      // path takes roughly as long as the wrong-password path below — otherwise
      // the response-time gap itself reveals whether the username is valid.
      if (!user) {
        await bcrypt.compare(password, dummyBcryptHash());
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      // ── 3. Active account check ───────────────────────────────────────────────
      if (!user.activo) {
        await bcrypt.compare(password, dummyBcryptHash()); // keep timing uniform
        return _rechazarLogin(res, { user, clientIp, motivo: 'account_inactive' });
      }

      // ── 4. Brute-force lockout check ──────────────────────────────────────────
      // `bloqueo_activo` lo calcula la propia consulta contra NOW() (ver
      // UserModel.findByUsername). Comparar acá con `new Date()` NO funciona:
      // MySQL guarda hora local y el driver la interpreta como UTC, así que la
      // fecha llega cuatro horas en el pasado y el bloqueo nunca se aplicaba.
      if (user.bloqueo_activo) {
        const minutos = Math.max(1, Number(user.bloqueo_minutos_restantes) || 1);

        return _rechazarLogin(res, {
          user,
          clientIp,
          motivo:       'account_locked',
          detalleExtra: { minutos_restantes: minutos },
          // El único rechazo que NO usa el mensaje genérico: acá conviene que
          // la persona sepa que está bloqueada y cuánto falta, en vez de
          // seguir probando contraseñas que igual no van a entrar.
          mensaje: `Account temporarily locked due to repeated failed login attempts. ` +
                   `Try again in ${minutos} minute(s).`,
        });
      }

      // ── 5. Password comparison ────────────────────────────────────────────────
      // .trim() on the stored hash is a defensive measure: if the database column
      // were ever misconfigured as CHAR (fixed-width, space-padded), MySQL would
      // return trailing spaces that silently break bcrypt's internal string checks.
      // VARCHAR(255) is correct and should never pad, but this costs nothing.
      const storedHash      = String(user.password_hash).trim();
      const passwordMatches = await bcrypt.compare(password, storedHash);

      if (!passwordMatches) {
        // Sólo este camino cuenta como intento fallido: una cuenta inactiva o
        // ya bloqueada no suma al contador que dispara el bloqueo.
        await UserModel.incrementFailedAttempts(user.id);

        return _rechazarLogin(res, {
          user,
          clientIp,
          motivo:       'wrong_password',
          detalleExtra: { attempts: (user.intentos_fallidos || 0) + 1 },
        });
      }

      // ── 6. La contrasena es correcta: migrar el hash si quedo con otro costo ──
      // El costo de bcrypt va grabado dentro del hash, asi que cambiar
      // BCRYPT_ROUNDS no toca las contrasenas YA guardadas. Sin esto, una cuenta
      // creada con 12 rondas sigue costando 12 para siempre y bajar el valor no
      // mejora nada: medido en el estres del 2026-09-23, diez personas entrando
      // a la vez seguian tardando 5,6 s con el servidor puesto en 10 rondas.
      //
      // Este es el UNICO momento en que el sistema conoce la contrasena en claro,
      // asi que es el unico momento en que puede volver a hashearla. Cada persona
      // se migra sola la primera vez que entra, sin cambiar su contrasena.
      //
      // No es fatal a proposito: si la escritura falla, la sesion se abre igual y
      // se reintenta en el proximo ingreso. Una mejora de rendimiento no puede
      // dejar a nadie afuera del sistema.
      try {
        if (bcrypt.getRounds(storedHash) !== ROUNDS) {
          const hashMigrado = await bcrypt.hash(password, ROUNDS);
          await UserModel.update(user.id, { password_hash: hashMigrado });
        }
      } catch (rehashErr) {
        console.warn('[AuthController.login] Rehash no aplicado (no fatal):', rehashErr.message);
      }

      // ── 7. Authentication successful ──────────────────────────────────────────
      return _emitirSesion(res, { user, clientIp });
    } catch (error) {
      console.error('[AuthController.login] Unexpected error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred. Please try again later.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getMe — GET /api/auth/me  (any authenticated role)
  //
  // Returns the CURRENT user record read fresh from the DB, in the same shape as
  // the login response's `data.user`. The SPA calls this on dashboard load to
  // re-hydrate AuthSession, so role-driven UI (notably the delegated
  // can_approve_quotations flag, which is NOT carried in the JWT) reflects the
  // live database value instead of the snapshot cached at login. Authorization
  // for every action is still enforced server-side; this only keeps the UI honest.
  // ---------------------------------------------------------------------------
  async getMe(req, res) {
    try {
      const user = await UserModel.findById(req.user.id);

      // The token verified, but the account may have been deactivated or deleted
      // since it was issued — treat that as an invalid session.
      if (!user || !user.activo) {
        return res.status(401).json({ success: false, message: 'Session user not found or inactive.' });
      }

      return res.status(200).json({
        success: true,
        data: {
          user: {
            id:              user.id,
            nombre_completo: user.nombre_completo,
            nombre_usuario:  user.nombre_usuario,
            rol:             user.rol,
            can_approve_quotations: Boolean(user.can_approve_quotations),
          },
        },
      });
    } catch (error) {
      console.error('[AuthController.getMe] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to load current user.' });
    }
  },

  // ---------------------------------------------------------------------------
  // logout — POST /api/auth/logout
  // Adds the current JWT to the in-memory revoked set. The authenticate
  // middleware has already verified the token and attached req.token.
  // ---------------------------------------------------------------------------
  async logout(req, res) {
    const clientIp = req.ip || req.socket?.remoteAddress || null;

    try {
      // Fast path: drop the exact token into the in-memory revocation set so it
      // is rejected immediately within this running process.
      revokeToken(req.token);

      // Durable path: bump the user's token_version so EVERY token issued to this
      // user is invalidated and the revocation survives a server restart.
      // If this write fails, the token is still only revoked in THIS process'
      // in-memory set (the fast path above) — other instances / a restart would
      // still accept it. Surface that to the client instead of silently
      // claiming full success, so the frontend can react (e.g. force-clear the
      // locally-stored token regardless).
      let durableRevocationFailed = false;
      try {
        await UserModel.incrementTokenVersion(req.user.id);
      } catch (versionErr) {
        durableRevocationFailed = true;
        console.error('[AuthController.logout] token_version bump FAILED — durable revocation incomplete:', versionErr.message);
      }

      await logEvent({
        id_usuario:    req.user.id,
        nombre_usuario: req.user.nombre_usuario,
        accion:        AuditActions.LOGOUT,
        entidad:       'usuarios',
        id_entidad:    req.user.id,
        ip_origen:     clientIp,
        resultado:     'exito',
      });

      return res.status(200).json({
        success: true,
        message: durableRevocationFailed
          ? 'Logged out locally. Full session revocation is pending — please discard the token on this device.'
          : 'Logged out successfully. Token has been invalidated.',
        warning: durableRevocationFailed,
      });
    } catch (error) {
      console.error('[AuthController.logout] Error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during logout.',
      });
    }
  },

  // ---------------------------------------------------------------------------
  // getDocsToken — GET /api/auth/docs-token  (Jefe / SysAdmin only, route-guarded)
  //
  // Issues a short-lived, single-purpose JWT used ONLY to open /api-docs.
  // Swagger UI is browser-navigated (a direct GET, not an XHR from apiClient),
  // so it cannot carry an Authorization header — the gate in src/app.js reads
  // the token from a ?token= query param instead. Deliberately NOT the user's
  // full 8h session token: a dedicated 10-minute token scoped to purpose
  // 'api-docs' means a leaked docs URL (pasted in chat, browser history) has a
  // tiny blast radius and cannot be replayed against any other endpoint.
  // ---------------------------------------------------------------------------
  async getDocsToken(req, res) {
    try {
      const token = jwt.sign(
        { id: req.user.id, rol: req.user.rol, purpose: 'api-docs' },
        process.env.JWT_SECRET,
        { expiresIn: '10m', algorithm: 'HS256' }
      );

      return res.status(200).json({ success: true, data: { token } });
    } catch (error) {
      console.error('[AuthController.getDocsToken] Error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to issue documentation access token.' });
    }
  },
};

module.exports = AuthController;
