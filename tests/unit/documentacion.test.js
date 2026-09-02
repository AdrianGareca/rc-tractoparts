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
// Los dos guardias de CSS de más abajo miran SOLO los documentos que hablan de
// la interfaz.
//
// POR QUÉ HAY QUE ACOTARLOS
// Detectan un token por `--algo` y una clase por `.algo`. En un documento de
// diseño eso es exactamente lo que se quiere. En uno de operaciones del
// servidor, esas dos formas significan otra cosa por completo:
//
//     --verify   --dry-run   --aplicar        banderas de línea de comandos
//     .sql.gz    .parcial    .conf            extensiones de archivo
//
// Cuando se agregó respaldos.md, el guardia acusó cuatro banderas de mysqldump
// y de los scripts por ser «tokens CSS inexistentes». No estaba encontrando un
// problema: estaba leyendo un manual de servidor como si fuera una hoja de
// estilos.
//
// Se listan por nombre y no por una regla automática a propósito: agregar un
// documento a esta lista obliga a mirarlo y confirmar que de verdad no habla de
// la interfaz, en lugar de que se excluya solo por casualidad.
// ---------------------------------------------------------------------------
const SIN_INTERFAZ = new Set(['respaldos.md']);

const TEXTO_DE_INTERFAZ = documentos
  .filter((d) => !SIN_INTERFAZ.has(d.nombre))
  .map((d) => d.texto)
  .join('\n');

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
      [...TEXTO_DE_INTERFAZ.matchAll(/`(--[a-zA-Z0-9-]+)`/g)]
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
      [...TEXTO_DE_INTERFAZ.matchAll(/`\.([a-zA-Z][a-zA-Z0-9-]*)`/g)]
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

// ---------------------------------------------------------------------------
// Las migraciones de esquema, listadas donde alguien las va a buscar.
//
// POR QUÉ EXISTE
// sql/init.sql sólo corre en el PRIMER arranque. Todo cambio de esquema para
// una base ya viva viaja en un sql/upgrade_*.sql aparte, y la única lista de
// esos scripts está en la tabla de §16.7 del README.
//
// El modo de fallar es silencioso en las dos direcciones: se agrega un upgrade
// y no se lo lista (quien despliega no lo corre, y producción queda distinta
// del esquema del repo — que fue exactamente lo que pasó con estado_venta e
// indices_bitacora), o se renombra un script y la tabla queda mandando a un
// archivo que no existe. Ninguna de las dos rompe una prueba por su cuenta:
// todo sigue en verde mientras el servidor se aleja del código.
// ---------------------------------------------------------------------------
describe('migraciones de esquema', () => {
  const enDisco = fs.readdirSync(path.join(RAIZ, 'sql'))
    .filter((f) => f.startsWith('upgrade_') && f.endsWith('.sql'))
    .sort();

  const readme    = fs.readFileSync(path.join(RAIZ, 'README.es.md'), 'utf8');
  const nombrados = new Set(readme.match(/upgrade_[a-z0-9_]+\.sql/g) ?? []);

  test('hay scripts de upgrade que revisar', () => {
    expect(enDisco.length).toBeGreaterThan(0);
  });

  test('cada sql/upgrade_*.sql aparece en el README', () => {
    const faltantes = enDisco.filter((f) => !nombrados.has(f));

    if (faltantes.length) {
      throw new Error(
        `Estos scripts existen pero el README no los nombra:\n  ${faltantes.join('\n  ')}\n\n` +
        'Esa tabla (§16.7) es la única lista de qué hay que correr al desplegar. ' +
        'Un upgrade que no está ahí no se corre, y el servidor queda con un ' +
        'esquema distinto al del repositorio sin que nada avise.'
      );
    }
  });

  test('cada upgrade que el README nombra existe en disco', () => {
    const enDiscoSet = new Set(enDisco);
    const fantasmas  = [...nombrados].filter((f) => !enDiscoSet.has(f));

    if (fantasmas.length) {
      throw new Error(
        `El README nombra estos scripts, pero no están en sql/:\n  ${fantasmas.join('\n  ')}\n\n` +
        'Quien siga esas instrucciones al desplegar se va a encontrar con un ' +
        'archivo que no existe, en el peor momento para descubrirlo.'
      );
    }
  });
});
