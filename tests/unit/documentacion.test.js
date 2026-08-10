// =============================================================================
// tests/unit/documentacion.test.js
// La documentación no puede envejecer en silencio.
//
// POR QUÉ EXISTE
// Un documento desactualizado es PEOR que no tenerlo. Nadie desconfía de un
// .md: se lee, se cree, y manda al lector en la dirección equivocada — a un
// archivo que se renombró, a una clase que se borró, a un número que ya no es.
// Y a diferencia del código, nada avisa: la documentación no se compila.
//
// Este archivo la trata como código. Verifica cuatro cosas:
//
//   1. Cada archivo que los documentos citan existe.
//   2. Cada token CSS que nombran está definido.
//   3. Cada clase CSS que nombran está definida.
//   4. Los NÚMEROS que afirman coinciden con los que exigen las pruebas.
//
// El cuarto es el que más vale. docs/pruebas.md dice «estilos inline: 23» en
// una tabla. Cuando la migración siga y el trinquete baje a 15, esa tabla queda
// mintiendo — y es justamente el dato por el que alguien abriría el documento.
// Acá se compara contra el TOPE real de estilosInline.test.js.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');
const DOCS = path.join(RAIZ, 'docs');

const documentos = fs.readdirSync(DOCS)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ nombre: f, texto: fs.readFileSync(path.join(DOCS, f), 'utf8') }));

const TODO = documentos.map((d) => d.texto).join('\n');

// ---------------------------------------------------------------------------
describe('el índice nombra todos los documentos', () => {
  const indice = documentos.find((d) => d.nombre === 'README.md');

  test('existe docs/README.md', () => {
    expect(indice).toBeDefined();
  });

  test('cada documento está enlazado desde el índice', () => {
    const sueltos = documentos
      .filter((d) => d.nombre !== 'README.md')
      .filter((d) => !indice.texto.includes(`(${d.nombre})`))
      .map((d) => d.nombre);

    if (sueltos.length > 0) {
      throw new Error(
        `Estos documentos no están enlazados desde docs/README.md:\n  ${sueltos.join('\n  ')}\n\n` +
        'Un documento al que no se llega desde el índice es un documento que ' +
        'nadie va a leer, y que va a envejecer sin que nadie lo note.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('todo lo que la documentación cita existe', () => {
  test('los archivos referenciados están en el repositorio', () => {
    // Rutas dentro de comillas invertidas: `src/config/swagger.js`
    const rutas = new Set(
      [...TODO.matchAll(/`((?:src|public|sql|tests|scripts|docs)\/[a-zA-Z0-9_\/.*-]+\.(?:js|sql|css|html|md))`/g)]
        .map((m) => m[1])
        // Los comodines son ejemplos de patrón, no archivos concretos.
        .filter((r) => !r.includes('*'))
    );

    const faltan = [...rutas].filter((r) => !fs.existsSync(path.join(RAIZ, r)));

    if (faltan.length > 0) {
      throw new Error(
        `La documentación cita archivos que no existen:\n  ${faltan.join('\n  ')}\n\n` +
        'O se renombraron y hay que actualizar el documento, o el documento ' +
        'describe algo que nunca llegó a existir.'
      );
    }
  });

  test('los tokens CSS mencionados están definidos', () => {
    const cssDir = path.join(RAIZ, 'public', 'css');
    const CSS = fs.readdirSync(cssDir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8'))
      .join('\n');

    const declarados = new Set(
      [...CSS.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1])
    );

    // Tres cosas se escriben con dos guiones y NO son tokens de la hoja:
    const EXCEPCIONES = new Set([
      // Bandera de línea de comandos de Jest.
      '--runInBand',
      // Se inyecta en el elemento desde el JavaScript, con el color de cada
      // tarjeta: no se declara en el CSS porque su valor recién se conoce al
      // dibujar. Ver .stat-card::before en components.css.
      '--stat-accent',
      // Se nombra justamente porque NO existía: es el bug que documenta
      // tokensDefinidos.test.js. Exigir que exista invertiría el sentido.
      '--bg-secondary',
    ]);

    const citados = new Set(
      [...TODO.matchAll(/`(--[a-zA-Z0-9-]+)`/g)]
        .map((m) => m[1])
        .filter((t) => !EXCEPCIONES.has(t))
    );

    const faltan = [...citados].filter((t) => !declarados.has(t));
    expect(faltan).toEqual([]);
  });

  test('las clases CSS mencionadas están definidas', () => {
    const cssDir = path.join(RAIZ, 'public', 'css');
    const CSS = fs.readdirSync(cssDir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8'))
      .join('\n');

    // `.filter-bar` — sólo el selector simple, no las combinaciones.
    //
    // Se descartan las extensiones de archivo: `.md`, `.js` y `.css` se
    // escriben igual que una clase y no lo son. Sin esto el guardia exigía
    // que existiera una clase llamada «md».
    const EXTENSIONES = new Set(['md', 'js', 'css', 'sql', 'html', 'json', 'xlsx', 'pdf', 'env']);

    const citadas = new Set(
      [...TODO.matchAll(/`\.([a-zA-Z][a-zA-Z0-9-]*)`/g)]
        .map((m) => m[1])
        .filter((c) => !EXTENSIONES.has(c))
    );

    const faltan = [...citadas].filter(
      (c) => !new RegExp(`\\.${c}\\s*[,{:.\\s]`).test(CSS)
    );

    if (faltan.length > 0) {
      throw new Error(
        `La documentación menciona clases que no existen en public/css/:\n  .${faltan.join('\n  .')}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// EL QUE MÁS VALE
//
// Los documentos afirman números. Los números envejecen. Acá se comparan
// contra la única fuente que no puede mentir: el test que los hace cumplir.
// ---------------------------------------------------------------------------
describe('los números que afirma la documentación son los reales', () => {
  const testEstilos = fs.readFileSync(
    path.join(RAIZ, 'tests', 'unit', 'estilosInline.test.js'), 'utf8'
  );

  /** Los TOPE del archivo de trinquetes, en orden: inline, emoji, hex. */
  const topes = [...testEstilos.matchAll(/const TOPE = (\d+);/g)].map((m) => Number(m[1]));

  test('el archivo de trinquetes declara los tres topes', () => {
    expect(topes).toHaveLength(3);
  });

  // La tabla de docs/pruebas.md:
  //   | Estilos inline en `public/js` | 274 | 23 |
  const filaTabla = (etiqueta) => {
    const re = new RegExp(`\\|\\s*${etiqueta}[^|]*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`);
    const m = re.exec(TODO);
    return m ? { antes: Number(m[1]), ahora: Number(m[2]) } : null;
  };

  test.each([
    ['Estilos inline', 0],
    ['Emoji en la interfaz', 1],
    ['Colores hexadecimales a mano', 2],
  ])('«%s» coincide con el trinquete', (etiqueta, indice) => {
    const fila = filaTabla(etiqueta);

    expect(fila).not.toBeNull();

    if (fila.ahora !== topes[indice]) {
      throw new Error(
        `docs/pruebas.md dice que «${etiqueta}» está en ${fila.ahora}, ` +
        `pero el trinquete de estilosInline.test.js exige ${topes[indice]}.\n\n` +
        'Es el dato por el que alguien abriría ese documento. Actualizá la ' +
        'tabla al bajar el tope — o el documento queda mintiendo justo donde ' +
        'más se lo consulta.'
      );
    }
  });
});
