// =============================================================================
// src/config/verificarEntorno.js
// La aplicación no arranca con un secreto de sesión que no sirve.
//
// EL PROBLEMA
// `JWT_SECRET` es lo que firma la sesión de cada persona que entra. Si falta,
// el primer intento de login revienta y alguien se entera. Pero si es DÉBIL
// —o si quedó el texto de ejemplo del `.env.example`— todo funciona con
// normalidad: la gente entra, trabaja, no hay ningún error en los registros.
// Sólo que cualquiera que conozca ese valor puede fabricarse un token de Jefe.
//
// Ese es el peor tipo de problema: el que no se manifiesta. Hasta ahora nada
// lo comprobaba en ningún momento.
//
// POR QUÉ NO ALCANZA CON MIRAR EL LARGO
// El placeholder que trae el `.env.example` es
// «replace_with_a_long_random_secret_at_least_64_chars»: 51 caracteres. Un
// control de «al menos 32» lo deja pasar sin chistar. O sea que el chequeo
// obvio falla justo en el caso más probable — alguien que copió el ejemplo,
// cambió la base de datos y se olvidó del secreto.
//
// Por eso se miran las dos cosas: que sea largo Y que no sea uno de los textos
// que vienen escritos en el repositorio.
//
// POR QUÉ ES UNA FUNCIÓN PURA
// No lee `process.env` por su cuenta ni corta el proceso: recibe el entorno y
// devuelve qué encontró. Así se puede probar sin variables de entorno de
// mentira y sin que un `process.exit()` mate a la suite. Quien decide morir es
// server.js, que es de quien es esa responsabilidad.
//
// DÓNDE SE LLAMA, Y POR QUÉ NO EN app.js
// En server.js, antes de abrir el puerto. app.js lo importan las pruebas para
// levantar la aplicación en memoria, y ahí no hay —ni hace falta— un entorno
// de producción completo.
// =============================================================================

'use strict';

// Mínimo del secreto de sesión. Con 32 caracteres aleatorios hay ~256 bits, que
// es lo que recomienda la propia especificación de JWT para HS256. Por debajo
// de eso el secreto se vuelve alcanzable por fuerza bruta con hardware común.
const MINIMO_SECRETO = 32;

// Textos que vienen escritos en el repositorio (.env.example) o que son
// evidentemente de ejemplo. Se comparan en minúscula y por CONTENIDO, no por
// igualdad: alguien que le agregue un sufijo al placeholder sigue teniendo un
// secreto público.
const SEÑALES_DE_EJEMPLO = [
  'change_me', 'changeme', 'replace_with', 'replace-me', 'replaceme',
  'your_secret', 'your-secret', 'yoursecret', 'tu_secreto',
  'example', 'ejemplo', 'placeholder', 'todo', 'xxxx',
];

const esDeEjemplo = (valor) => {
  const v = String(valor).toLowerCase();
  return SEÑALES_DE_EJEMPLO.some((señal) => v.includes(señal));
};

// Variables sin las cuales la aplicación no puede funcionar de verdad.
const OBLIGATORIAS = [
  ['JWT_SECRET',  'firma la sesión de cada persona que entra'],
  ['DB_USER',     'el usuario con el que se conecta a MySQL'],
  ['DB_PASSWORD', 'la contraseña de ese usuario'],
  ['DB_NAME',     'el nombre de la base de datos'],
];

/**
 * Revisa el entorno y devuelve qué está mal.
 *
 * @param   {Object} env — normalmente process.env
 * @returns {{errores: string[], avisos: string[]}}
 *   `errores` impide arrancar; `avisos` se imprimen y se sigue.
 */
function revisarEntorno(env = {}) {
  const errores = [];
  const avisos  = [];

  // ── Lo que tiene que existir ──────────────────────────────────────────────
  for (const [nombre, paraQue] of OBLIGATORIAS) {
    const valor = env[nombre];
    if (!valor || !String(valor).trim()) {
      errores.push(`Falta ${nombre} — ${paraQue}.`);
    }
  }

  // ── El secreto de sesión ──────────────────────────────────────────────────
  const secreto = String(env.JWT_SECRET || '');

  if (secreto.trim()) {
    if (secreto.length < MINIMO_SECRETO) {
      errores.push(
        `JWT_SECRET tiene ${secreto.length} caracteres y el mínimo son ${MINIMO_SECRETO}. ` +
        'Con uno corto, el secreto que firma las sesiones se puede adivinar por fuerza bruta ' +
        'y cualquiera puede fabricarse un token de Jefe.'
      );
    }

    if (esDeEjemplo(secreto)) {
      errores.push(
        'JWT_SECRET es todavía el texto de ejemplo del .env.example. ' +
        'Ese valor está escrito en el repositorio, así que lo conoce cualquiera ' +
        'que vea el código: no es un secreto.'
      );
    }

    // No es un error, pero un secreto de una sola clase de caracteres tiene
    // mucha menos entropía de la que sugiere su largo.
    const clases = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(secreto)).length;
    if (clases < 2 && secreto.length < 64) {
      avisos.push(
        `JWT_SECRET usa una sola clase de caracteres. Con ${secreto.length} de largo ` +
        'eso es menos aleatorio de lo que parece.'
      );
    }
  }

  // ── La contraseña de la base ──────────────────────────────────────────────
  if (env.DB_PASSWORD && esDeEjemplo(env.DB_PASSWORD)) {
    errores.push('DB_PASSWORD es todavía el texto de ejemplo del .env.example.');
  }

  // ── Avisos ────────────────────────────────────────────────────────────────
  const rondas = parseInt(env.BCRYPT_ROUNDS, 10);
  if (!Number.isNaN(rondas) && rondas < 10) {
    avisos.push(
      `BCRYPT_ROUNDS está en ${rondas}. Menos de 10 se considera débil hoy: ` +
      'las contraseñas guardadas quedan más fáciles de romper si alguna vez se ' +
      'filtra la base.'
    );
  }

  if (!env.NODE_ENV) {
    avisos.push("NODE_ENV no está definido. En producción debería decir 'production'.");
  }

  return { errores, avisos };
}

/**
 * Imprime el resultado. Devuelve true si se puede arrancar.
 * Separado de revisarEntorno() para que la revisión siga sin efectos.
 */
function informarEntorno({ errores, avisos }, log = console) {
  for (const aviso of avisos) log.warn(`[Entorno] AVISO: ${aviso}`);

  if (errores.length === 0) return true;

  log.error('='.repeat(70));
  log.error('[Entorno] La aplicación NO puede arrancar:');
  for (const error of errores) log.error(`  • ${error}`);
  log.error('');
  log.error('  Revisá el archivo .env del servidor. Para generar un secreto nuevo:');
  log.error('      node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  log.error('='.repeat(70));
  return false;
}

module.exports = { revisarEntorno, informarEntorno, MINIMO_SECRETO, SEÑALES_DE_EJEMPLO };
