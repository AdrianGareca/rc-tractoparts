// =============================================================================
// tests/unit/parseIdCompartido.test.js
// El identificador de la URL se lee en un solo lugar.
//
// LO QUE SE MIDIÓ
// `if (isNaN(id) || id < 1)` estaba escrito 28 veces en nueve controladores, y
// el mensaje de error se había escrito de cuatro formas EN DOS IDIOMAS:
// «Invalid quotation ID.» (10), «Invalid user ID.» (3), «Invalid client ID.»
// (3) y «ID inválido.» (3).
//
// La duplicación sola sería prolijidad. Lo que la vuelve un problema es que ya
// se desincronizó, y no en un comentario: en el texto que ve el usuario. Según
// qué pantalla toque, el mismo error le llega en inglés o en español.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { parseId } = require('../../src/utils/parseId');

const RAIZ = path.resolve(__dirname, '../../src');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}

const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

// ---------------------------------------------------------------------------
describe('parseId — lo que acepta y lo que no', () => {
  test.each([
    ['1',    1],
    ['42',   42],
    ['9999', 9999],
    // parseInt corta en el primer carácter no numérico. Se acepta a propósito:
    // /api/clientes/12abc apunta sin ambigüedad al 12.
    ['12abc', 12],
  ])('«%s» se lee como %i', (entrada, esperado) => {
    const { id, error } = parseId(entrada, 'cliente');
    expect(error).toBeNull();
    expect(id).toBe(esperado);
  });

  test.each([
    ['0',         'el cero no existe como AUTO_INCREMENT'],
    ['-5',        'los negativos tampoco'],
    ['abc',       'texto que no empieza con número'],
    ['',          'cadena vacía'],
    [undefined,   'parámetro ausente'],
    [null,        'nulo'],
  ])('«%s» se rechaza — %s', (entrada) => {
    const { id, error } = parseId(entrada, 'cliente');
    expect(id).toBeNull();
    expect(error.status).toBe(400);
    expect(error.body.success).toBe(false);
  });

  test('el mensaje nombra la entidad, para que se entienda qué no se encontró', () => {
    expect(parseId('x', 'cotización').error.body.message).toContain('cotización');
    expect(parseId('x', 'usuario').error.body.message).toContain('usuario');
  });

  test('sin entidad usa un nombre genérico en vez de romperse', () => {
    expect(parseId('x').error.body.message).toContain('registro');
  });
});

// ---------------------------------------------------------------------------
// EL TRINQUETE
// ---------------------------------------------------------------------------
describe('la validación a mano sólo puede disminuir', () => {
  const TOPE = 4;

  const contar = () => archivos.reduce((total, f) => {
    // Se salta el propio helper: ahí la comprobación es la implementación.
    if (rel(f) === 'utils/parseId.js') return total;

    const src = fs.readFileSync(f, 'utf8');
    return total + src.split(String.fromCharCode(10)).reduce((n, linea) => {
      const t = linea.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return n;
      return n + (/isNaN\(\s*id\s*\)/.test(t) ? 1 : 0);
    }, 0);
  }, 0);

  test(`no hay más de ${TOPE} validaciones de id a mano`, () => {
    const actual = contar();

    if (actual > TOPE) {
      throw new Error(
        `Hay ${actual} comprobaciones «isNaN(id)» escritas a mano y el tope es ${TOPE}.\n\n` +
        'Usá parseId(req.params.id, \'cliente\') de src/utils/parseId.js. ' +
        'Las copias a mano ya se desincronizaron una vez: el mismo error le ' +
        'llegaba al usuario en inglés o en español según la pantalla.'
      );
    }
    expect(actual).toBeLessThanOrEqual(TOPE);
  });

  test('si bajaron, hay que bajar el tope', () => {
    const actual = contar();
    if (actual < TOPE) {
      throw new Error(
        `Ahora hay ${actual} validaciones a mano (el tope decía ${TOPE}). Bajá TOPE a ${actual}.`
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('los mensajes en inglés no vuelven', () => {
  // Estos cuatro son los que estaban escritos a mano. La aplicación le habla al
  // usuario en español; un mensaje en inglés es una copia que se coló.
  test.each([
    'Invalid quotation ID',
    'Invalid user ID',
    'Invalid client ID',
  ])('«%s» ya no aparece', (frase) => {
    const culpables = [];

    for (const f of archivos) {
      fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).forEach((linea, i) => {
        const t = linea.trim();
        // Los comentarios se saltean: parseId.js NOMBRA esas cuatro redacciones
        // para explicar de dónde salió, y exigir que no aparezcan volvería
        // imposible documentar el problema que el propio archivo resuelve.
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        if (linea.includes(frase)) culpables.push(`${rel(f)}:${i + 1}`);
      });
    }

    if (culpables.length > 0) {
      throw new Error(
        `«${frase}» sigue escrito en:\n  ${culpables.join('\n  ')}\n\n` +
        'La aplicación le habla al usuario en español. Usá parseId().'
      );
    }
  });
});
