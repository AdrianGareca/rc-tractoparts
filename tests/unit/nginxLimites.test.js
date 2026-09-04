// =============================================================================
// tests/unit/nginxLimites.test.js
// Nginx tiene que aceptar archivos al menos tan grandes como los que la
// aplicación dice aceptar.
//
// EL FALLO QUE PREVIENE
// Hay DOS límites de tamaño de subida y están en lugares distintos:
//
//   1. El de la aplicación — `MAX_PDF_SIZE_MB` (10 MB en producción), que
//      aplican multer en quotationRoutes.js y licitacionRoutes.js.
//   2. El de Nginx — `client_max_body_size`, que hoy está en 15M.
//
// Nginx atiende PRIMERO. Si su límite queda por debajo del de la aplicación, un
// archivo intermedio —digamos 12 MB con Nginx en 10M— se rechaza con un `413`
// sin llegar nunca al proceso de Node. Los registros de la aplicación no
// muestran nada, porque la petición jamás entró: parece un error salido de la
// nada, y el rastro está en un archivo de Nginx que nadie mira.
//
// Y el valor por defecto de Nginx, si alguien restaura la configuración sin el
// `nginx.conf` de deploy/nginx/, es **1 MB** — con lo que dejaría de subirse
// prácticamente cualquier PDF.
//
// QUÉ SE COMPARA
// La copia versionada en deploy/nginx/ contra el `.env.example` del proyecto.
// No se puede consultar el servidor desde una prueba, así que se vigila lo que
// SÍ está en el repositorio; deploy/nginx/README.md explica cómo mantener esa
// copia sincronizada.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');
const NGINX_DIR = path.join(RAIZ, 'deploy/nginx');

const leer = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** El `client_max_body_size` declarado, en megabytes. */
function limiteNginxMB() {
  const conf = leer(path.join(NGINX_DIR, 'nginx.conf'));
  // Se ignoran las líneas comentadas: una directiva comentada NO aplica, y
  // darla por buena sería justamente el error que este archivo previene.
  const linea = conf.split('\n')
    .map((l) => l.trim())
    .find((l) => !l.startsWith('#') && /^client_max_body_size\s/.test(l));

  if (!linea) return null;

  const m = linea.match(/client_max_body_size\s+(\d+)\s*([mMkKgG]?)/);
  if (!m) return null;

  const n = Number(m[1]);
  const unidad = (m[2] || '').toLowerCase();
  if (unidad === 'g') return n * 1024;
  if (unidad === 'k') return n / 1024;
  if (unidad === 'm') return n;
  return n / (1024 * 1024);   // sin sufijo, nginx interpreta bytes
}

/** El límite que declara la aplicación, en megabytes. */
function limiteAppMB() {
  const env = leer(path.join(RAIZ, '.env.example'));
  const m = env.match(/^\s*MAX_PDF_SIZE_MB\s*=\s*(\d+)/m);
  // El respaldo es el mismo que usa el código cuando la variable no está.
  return m ? Number(m[1]) : 10;
}

describe('los archivos de Nginx están respaldados', () => {
  test.each(['nginx.conf', 'rctractoparts.conf', 'README.md'])('%s existe', (f) => {
    const ruta = path.join(NGINX_DIR, f);
    expect(fs.existsSync(ruta)).toBe(true);
    expect(fs.statSync(ruta).size).toBeGreaterThan(200);
  });

  test('el sitio hace de proxy al contenedor', () => {
    const sitio = leer(path.join(NGINX_DIR, 'rctractoparts.conf'));
    expect(sitio).toMatch(/proxy_pass\s+http:\/\/127\.0\.0\.1:3000/);
    expect(sitio).toContain('rctractoparts.org');
  });

  test('no se coló ningún secreto en la copia', () => {
    for (const f of ['nginx.conf', 'rctractoparts.conf']) {
      const texto = leer(path.join(NGINX_DIR, f));
      // ssl_certificate_key es una RUTA, no una clave: apunta al archivo que
      // vive sólo en el servidor. Cualquier otra cosa con pinta de credencial
      // no tendría por qué estar en el repositorio.
      const sospechoso = texto.split('\n').filter((l) =>
        /(password|passwd|secret|api[_-]?key|auth_basic_user_file)/i.test(l) &&
        !l.trim().startsWith('#'));
      expect(sospechoso).toEqual([]);
    }
  });
});

describe('el límite de subida de Nginx cubre el de la aplicación', () => {
  test('client_max_body_size está declarado y sin comentar', () => {
    const mb = limiteNginxMB();
    if (mb === null) {
      throw new Error(
        'deploy/nginx/nginx.conf no declara `client_max_body_size`.\n\n' +
        'Sin esa directiva Nginx usa su valor por defecto: 1 MB. Restaurar esa ' +
        'configuración dejaría de aceptar prácticamente cualquier PDF, con un ' +
        '413 que la aplicación nunca ve ni registra.'
      );
    }
    expect(mb).toBeGreaterThan(0);
  });

  test('es mayor o igual que MAX_PDF_SIZE_MB', () => {
    const nginx = limiteNginxMB();
    const app   = limiteAppMB();

    if (nginx < app) {
      throw new Error(
        `Nginx acepta hasta ${nginx} MB y la aplicación dice aceptar ${app} MB.\n\n` +
        `Un archivo de entre ${nginx} y ${app} MB se rechaza con un 413 en Nginx ` +
        'y no llega al proceso de Node: los registros de la aplicación quedan ' +
        'vacíos y el error parece salido de la nada.\n\n' +
        'Subí `client_max_body_size` en deploy/nginx/nginx.conf Y en el servidor ' +
        '(los dos, o la copia queda mintiendo), o bajá MAX_PDF_SIZE_MB.'
      );
    }
    expect(nginx).toBeGreaterThanOrEqual(app);
  });

  test('tiene margen sobre el límite de la aplicación', () => {
    // Una petición de subida pesa MÁS que el archivo: van también las fronteras
    // del multipart, los nombres de campo y las cabeceras. Con los dos límites
    // en el mismo número, un archivo de exactamente el máximo permitido lo
    // superaría por unos pocos bytes y se rechazaría igual.
    const nginx = limiteNginxMB();
    const app   = limiteAppMB();
    expect(nginx).toBeGreaterThan(app);
  });
});
