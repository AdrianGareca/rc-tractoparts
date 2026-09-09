// =============================================================================
// tests/unit/nginxIpReal.test.js
// La aplicación tiene que seguir viendo la IP de la persona, no la del proxy.
//
// LA RELACIÓN QUE VIGILA
// Son dos piezas que viven en repositorios mentales distintos y sólo funcionan
// juntas:
//
//   1. `src/app.js` hace `app.set('trust proxy', 1)` — confía en UN salto.
//   2. La configuración de nginx tiene que entregarle la IP real en ese salto.
//
// Hoy la cadena es  persona → nginx → aplicación  y eso da UN salto: cierto.
// El día que se ponga Cloudflare delante pasan a ser DOS, y sin
// `cloudflare-real-ip.conf` la aplicación deja de ver a la persona. Medido:
//
//     hoy                         req.ip = 190.104.22.5   ← la persona
//     con Cloudflare, sin la conf   req.ip = 172.68.10.3   ← Cloudflare
//
// QUÉ SE ROMPE, Y POR QUÉ NO SE NOTARÍA
// `authRoutes.js` limita a 5 intentos de login por IP cada 15 minutos. Si todo
// llega con la misma media docena de IPs de Cloudflare, esa cuota pasa a ser
// COMPARTIDA POR TODA LA EMPRESA: el sexto intento del día, de quien sea, se
// rechaza. Y el mensaje dice «demasiados intentos desde esta IP», que es
// exactamente lo que nadie va a entender, porque cada uno intentó una vez.
//
// Además los 28 sitios que guardan `req.ip` en la bitácora de auditoría
// registrarían la dirección de Cloudflare. El registro se seguiría llenando,
// sin un solo error, y sería inútil.
//
// POR QUÉ ESTA PRUEBA Y NO UNA REVISIÓN A MANO
// Porque la falla no la produce un cambio en el código: la produce un cambio en
// el DNS, hecho desde un panel web, meses después, probablemente por la misma
// persona que ya se olvidó de esto. Lo único que puede recordárselo es algo que
// esté escrito acá.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');
const CONF = path.join(RAIZ, 'deploy/nginx/cloudflare-real-ip.conf');
const APP  = path.join(RAIZ, 'src/app.js');

const leer = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** Las líneas activas: sin comentarios ni vacías. */
const activas = (texto) => texto
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

describe('la aplicación declara cuántos saltos confía', () => {
  test("src/app.js sigue en `trust proxy: 1`", () => {
    const src = leer(APP);
    const m = src.match(/app\.set\(\s*['"]trust proxy['"]\s*,\s*([^)]+)\)/);

    if (!m) {
      throw new Error(
        "Desapareció `app.set('trust proxy', …)` de src/app.js.\n\n" +
        'Sin eso, Express ignora X-Forwarded-For y `req.ip` pasa a ser siempre ' +
        'la IP de nginx: la bitácora de auditoría deja de decir quién hizo qué, ' +
        'y el límite de intentos de login se vuelve uno solo para toda la empresa.'
      );
    }

    const valor = m[1].trim();
    if (valor !== '1') {
      throw new Error(
        `\`trust proxy\` quedó en \`${valor}\` y este archivo asume 1.\n\n` +
        'El número dice cuántos proxies hay ENTRE la persona y la aplicación. ' +
        'Si se agregó otro salto (Cloudflare, un balanceador), la forma correcta ' +
        'de resolverlo NO es subir este número: es que nginx entregue la IP real ' +
        'con deploy/nginx/cloudflare-real-ip.conf, y que este siga en 1.\n\n' +
        'Si de verdad cambió la arquitectura, actualizá también esta prueba.'
      );
    }
  });
});

describe('la configuración para cuando haya un proxy delante', () => {
  test('el archivo existe', () => {
    if (!fs.existsSync(CONF)) {
      throw new Error(
        'Falta deploy/nginx/cloudflare-real-ip.conf.\n\n' +
        'Es lo que hay que instalar ANTES de activar Cloudflare para que la ' +
        'aplicación siga viendo la IP de cada persona.'
      );
    }
  });

  test('lee la IP de la cabecera que pone Cloudflare', () => {
    const lineas = activas(leer(CONF));
    const cabecera = lineas.find((l) => /^real_ip_header\s/.test(l));

    if (!cabecera) {
      throw new Error(
        'No hay una línea `real_ip_header` activa.\n\n' +
        'Sin ella nginx no sabe de dónde sacar la IP real y `$remote_addr` ' +
        'sigue siendo la de Cloudflare.'
      );
    }
    expect(cabecera).toMatch(/CF-Connecting-IP/i);
  });

  test('declara en qué direcciones confiar', () => {
    // Sin `set_real_ip_from`, nginx acepta la cabecera de CUALQUIERA — y
    // entonces cualquiera puede decir que su IP es otra, que es peor que el
    // problema original: la bitácora pasaría a guardar lo que el atacante quiera.
    const rangos = activas(leer(CONF)).filter((l) => /^set_real_ip_from\s/.test(l));

    if (rangos.length === 0) {
      throw new Error(
        'No hay ningún `set_real_ip_from`.\n\n' +
        'Con `real_ip_header` pero sin lista de confianza, nginx le cree la ' +
        'cabecera a cualquiera: alguien podría falsificar su IP en la bitácora ' +
        'de auditoría y esquivar el límite de intentos de login.'
      );
    }
    // Los rangos publicados por Cloudflare son 15 de IPv4 y 7 de IPv6.
    expect(rangos.length).toBeGreaterThanOrEqual(20);
  });

  test('cada rango tiene forma de CIDR válido', () => {
    const rangos = activas(leer(CONF))
      .filter((l) => /^set_real_ip_from\s/.test(l))
      .map((l) => l.replace(/^set_real_ip_from\s+/, '').replace(/;$/, '').trim());

    const malos = rangos.filter((r) => {
      const v4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
      const v6 = /^[0-9a-f:]+\/\d{1,3}$/i;
      return !v4.test(r) && !v6.test(r);
    });

    // Un rango mal escrito hace que nginx no arranque — pero eso se descubre
    // recargando en el servidor, con el sitio ya caído.
    expect(malos).toEqual([]);
  });

  test('incluye los rangos grandes de Cloudflare', () => {
    // Una lista recortada no rompe nada visible: las peticiones que lleguen por
    // un rango que falta se atienden igual, sólo que registrando la IP de
    // Cloudflare. O sea, el problema original en pequeño y en silencio.
    const texto = leer(CONF);
    for (const rango of ['104.16.0.0/13', '172.64.0.0/13', '162.158.0.0/15', '2606:4700::/32']) {
      expect(texto).toContain(rango);
    }
  });

  test('no se coló ninguna credencial', () => {
    const sospechosas = activas(leer(CONF))
      .filter((l) => /(password|passwd|secret|api[_-]?key|token)/i.test(l));
    expect(sospechosas).toEqual([]);
  });
});

describe('el archivo explica cuándo instalarlo', () => {
  test('dice que va ANTES de activar Cloudflare', () => {
    // El orden importa: aplicarlo después significa que hubo una ventana con el
    // login limitado para toda la empresa y la bitácora registrando mal.
    const texto = leer(CONF).toLowerCase();
    expect(texto).toMatch(/antes.*(de )?activar|activar.*despu[eé]s/);
  });

  test('dice de dónde traer la lista actualizada', () => {
    expect(leer(CONF)).toContain('cloudflare.com/ips');
  });
});
