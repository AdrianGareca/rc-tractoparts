// =============================================================================
// tests/unit/catalogoSimple.test.js
// Los dos catálogos de nombre único se comportan igual porque SON el mismo código.
//
// QUÉ SON ESTOS CATÁLOGOS
// «Marcas» (Caterpillar, Komatsu…) y «Orígenes de cliente» (Feria comercial,
// Recomendación…). Los dos son lo mismo: una lista de nombres únicos que crece
// desde un «+» adentro de otro formulario, sin pantalla propia de gestión.
//
// EL PROBLEMA MEDIDO
// brandController.js y origenClienteController.js eran gemelos de 104 y 99
// líneas. La cabecera del segundo lo decía sin rodeos: «Mirrors
// brandController.js — same validation/uniqueness/audit contract». Y ya habían
// divergido en tres cosas, ninguna de las cuales daba error:
//
//   • uno registraba la auditoría con AuditActions.CREAR_ORIGEN_CLIENTE y el
//     otro con la cadena suelta 'CREAR_MARCA', que no estaba en la lista — así
//     que ese evento quedaba registrado y a la vez era imposible de filtrar
//   • los mensajes del GET estaban en inglés en los dos ('Error retrieving
//     brands.'), en una aplicación que es toda en castellano
//   • el 409 del catch de respaldo devolvía el nombre TECLEADO en vez del
//     nombre YA GUARDADO, así que quien escribía «caterpillar» recibía
//     «La marca "caterpillar" ya existe» en minúscula, en lugar del
//     «Caterpillar» real del catálogo
//
// Ese es el costo de un gemelo: no es escribir dos veces, es que los dos se
// separan de a poco y nadie se entera.
//
// EL GÉNERO ES UN PARÁMETRO, Y NO ES UN CAPRICHO
// «La marca» pero «el origen». «El nombre de la marca» pero «el nombre del
// origen». En castellano no alcanza con interpolar el sustantivo: hay que saber
// su género para elegir el artículo y para contraer «de el» en «del». Por eso
// la fábrica lo pide, en vez de armar frases que suenen a traducción automática.
// =============================================================================

'use strict';

const { crearControladorDeCatalogo } = require('../../src/controllers/catalogoSimple');
const { AuditActions } = require('../../src/utils/auditLog');

jest.mock('../../src/utils/auditLog', () => {
  const real = jest.requireActual('../../src/utils/auditLog');
  return { ...real, logEvent: jest.fn().mockResolvedValue(undefined) };
});

/** Un modelo de mentira con los tres métodos que la fábrica usa. */
function modeloFalso({ existente = null, alCrear = null, error = null } = {}) {
  return {
    getAll:        jest.fn().mockResolvedValue([{ id: 1, nombre: 'Caterpillar' }]),
    findByNombre:  jest.fn().mockResolvedValue(existente),
    create:        jest.fn(async (n) => {
      if (error) throw error;
      return alCrear ?? { id: 9, nombre: n };
    }),
  };
}

/** Un `res` de mentira que anota qué se le respondió. */
function resFalso() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json   = (b) => { r.body = b; return r; };
  return r;
}

const req = (body = {}) => ({ body, user: { id: 3, nombre_usuario: 'ejec1' }, ip: '1.2.3.4' });

const marcas = (modelo) => crearControladorDeCatalogo({
  modelo, tabla: 'marcas', accion: AuditActions.CREAR_MARCA,
  sustantivo: 'marca', genero: 'f',
});

const origenes = (modelo) => crearControladorDeCatalogo({
  modelo, tabla: 'origenes_cliente', accion: AuditActions.CREAR_ORIGEN_CLIENTE,
  sustantivo: 'origen', genero: 'm',
});

// ---------------------------------------------------------------------------
describe('el castellano sale bien en los dos géneros', () => {
  test('femenino: «de la marca», «La marca»', async () => {
    const res = resFalso();
    await marcas(modeloFalso()).crear(req({ nombre: '   ' }), res);
    expect(res.body.message).toBe('El nombre de la marca es requerido.');
  });

  test('masculino: «del origen», «El origen»', async () => {
    const res = resFalso();
    await origenes(modeloFalso()).crear(req({ nombre: '' }), res);
    // «de el origen» sería un error de castellano: la contracción es obligatoria.
    expect(res.body.message).toBe('El nombre del origen es requerido.');
    expect(res.body.message).not.toContain('de el');
  });

  test('el aviso de duplicado usa el artículo correcto', async () => {
    const r1 = resFalso();
    await marcas(modeloFalso({ existente: { id: 4, nombre: 'Caterpillar' } }))
      .crear(req({ nombre: 'caterpillar' }), r1);
    expect(r1.body.message).toBe('La marca "Caterpillar" ya existe en el catálogo.');

    const r2 = resFalso();
    await origenes(modeloFalso({ existente: { id: 7, nombre: 'Feria comercial' } }))
      .crear(req({ nombre: 'feria comercial' }), r2);
    expect(r2.body.message).toBe('El origen "Feria comercial" ya existe en el catálogo.');
  });

  test('ningún mensaje sale en inglés', async () => {
    // Los del GET estaban en inglés en los dos controladores.
    const modelo = modeloFalso();
    modelo.getAll = jest.fn().mockRejectedValue(new Error('la base se cayó'));

    const res = resFalso();
    await marcas(modelo).listar(req(), res);

    expect(res.code).toBe(500);
    expect(res.body.message).not.toMatch(/error retrieving|failed|unable/i);
    expect(res.body.message).toMatch(/marcas/i);
  });
});

// ---------------------------------------------------------------------------
describe('el duplicado devuelve el nombre GUARDADO, no el tecleado', () => {
  test('el 409 normal trae la fila existente para que el front la seleccione', async () => {
    const res = resFalso();
    await marcas(modeloFalso({ existente: { id: 4, nombre: 'Caterpillar' } }))
      .crear(req({ nombre: '  caterpillar  ' }), res);

    expect(res.code).toBe(409);
    // El front usa esto para elegir la marca que ya existía en lugar de dejar
    // al usuario con un rechazo. Sin `data` no puede.
    expect(res.body.data).toEqual({ id: 4, nombre: 'Caterpillar' });
  });

  test('el 409 de la carrera también nombra la fila real', async () => {
    // Este es el camino de respaldo: dos personas mandan el mismo nombre a la
    // vez, la comprobación previa pasa en las dos y MySQL rechaza la segunda
    // por índice único. Antes acá se devolvía el texto TECLEADO, así que quien
    // escribía «caterpillar» leía «La marca "caterpillar" ya existe» — en
    // minúscula, sin parecerse al «Caterpillar» real del catálogo.
    const duplicado = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    const modelo = modeloFalso({ error: duplicado });
    // La segunda consulta —ya con la fila del otro— sí la encuentra.
    modelo.findByNombre = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 4, nombre: 'Caterpillar' });

    const res = resFalso();
    await marcas(modelo).crear(req({ nombre: 'caterpillar' }), res);

    expect(res.code).toBe(409);
    expect(res.body.message).toContain('Caterpillar');
    expect(res.body.data).toEqual({ id: 4, nombre: 'Caterpillar' });
  });
});

// ---------------------------------------------------------------------------
describe('lo que ya funcionaba sigue funcionando', () => {
  test('listar devuelve el catálogo', async () => {
    const res = resFalso();
    await marcas(modeloFalso()).listar(req(), res);
    expect(res.code).toBe(200);
    expect(res.body.data).toEqual([{ id: 1, nombre: 'Caterpillar' }]);
  });

  test('crear recorta los espacios y devuelve 201', async () => {
    const modelo = modeloFalso();
    const res = resFalso();
    await marcas(modelo).crear(req({ nombre: '  Komatsu  ' }), res);

    expect(modelo.create).toHaveBeenCalledWith('Komatsu');
    expect(res.code).toBe(201);
    expect(res.body.data.nombre).toBe('Komatsu');
  });

  test('un nombre de más de 100 caracteres se rechaza', async () => {
    const res = resFalso();
    await marcas(modeloFalso()).crear(req({ nombre: 'x'.repeat(101) }), res);
    expect(res.code).toBe(422);
    expect(res.body.message).toMatch(/100/);
  });

  test('un nombre que no es texto se rechaza sin romper', async () => {
    for (const basura of [undefined, null, 42, {}, []]) {
      const res = resFalso();
      await marcas(modeloFalso()).crear(req({ nombre: basura }), res);
      expect(res.code).toBe(422);
    }
  });

  test('un fallo inesperado del modelo da 500 y no 201', async () => {
    const modelo = modeloFalso({ error: new Error('se cayó la base') });
    const res = resFalso();
    await marcas(modelo).crear(req({ nombre: 'Komatsu' }), res);
    expect(res.code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('la auditoría se registra con el código correcto', () => {
  test('cada catálogo usa su propia acción, de la lista', async () => {
    const { logEvent } = require('../../src/utils/auditLog');
    logEvent.mockClear();

    await marcas(modeloFalso()).crear(req({ nombre: 'Komatsu' }), resFalso());

    expect(logEvent).toHaveBeenCalledTimes(1);
    const evento = logEvent.mock.calls[0][0];
    expect(evento.accion).toBe(AuditActions.CREAR_MARCA);
    expect(evento.entidad).toBe('marcas');
    expect(evento.resultado).toBe('exito');
  });

  test('un fallo al auditar no tumba el alta', async () => {
    // La marca ya se creó. Perder el registro de auditoría es malo, pero
    // devolver un error sobre algo que SÍ se guardó hace que la persona lo
    // intente de nuevo y reciba un 409 que no entiende.
    const { logEvent } = require('../../src/utils/auditLog');
    logEvent.mockRejectedValueOnce(new Error('la bitácora no responde'));

    const res = resFalso();
    await marcas(modeloFalso()).crear(req({ nombre: 'Komatsu' }), res);

    expect(res.code).toBe(201);
  });
});
