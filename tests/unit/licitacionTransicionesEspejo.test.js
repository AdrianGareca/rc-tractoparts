// =============================================================================
// tests/unit/licitacionTransicionesEspejo.test.js
// La matriz de licitaciones del navegador tiene que decir EXACTAMENTE lo mismo
// que la del servidor.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// La regla de quién puede mover una licitación de un estado a otro está escrita
// DOS veces:
//
//   servidor    src/models/LicitacionModel.js               LICITACION_ROLE_TRANSITIONS
//   navegador   public/js/.../licitacion/permissions.js     TRANSITIONS
//
// Las dos copias son deliberadas y no se pueden unificar: el servidor es
// CommonJS y el navegador módulos nativos, y no hay paso de compilación que
// pueda compartir un archivo entre ambos. Lo que sí se puede es exigir que no
// se separen.
//
// Cotizaciones ya tenía esa exigencia —quotationTransitionsFront.test.js— y es
// la que impide que el dashboard ofrezca un botón que el servidor va a rechazar.
// Licitaciones tenía la MISMA duplicación y ninguna prueba que la vigilara: el
// comentario del archivo del navegador dice «Espejo de LicitacionModel», y ese
// comentario era toda la garantía que había. Un comentario no falla cuando
// alguien edita una sola de las dos.
//
// QUÉ SE SIENTE CUANDO DIVERGEN
// Si el navegador ofrece de más: el usuario ve el botón, lo aprieta, y recibe
// un 403 que no podía haber previsto. Si ofrece de menos: le falta un botón que
// tiene derecho a usar, y no hay ningún mensaje que se lo explique — simplemente
// no está, y va a pedir por WhatsApp que alguien «con más permiso» lo haga.
//
// La matriz de licitaciones tiene un eje MÁS que la de cotizaciones: no alcanza
// con el rol, importa la RELACIÓN con la licitación (ser el responsable). Por
// eso el cruce de abajo recorre rol × delegación × responsabilidad × estado ×
// destino, y no solo rol × estado × destino.
// =============================================================================

'use strict';

// El módulo del navegador importa AuthSession para leer la sesión. Acá no hay
// sesión ni navegador, y no hace falta: todas las funciones que se prueban son
// puras y reciben el usuario por parámetro. El mock existe solo para que el
// import no explote.
jest.mock('../../public/js/services/authSession.js', () => ({
  __esModule: true,
  default: { getRole: jest.fn(), getUserId: jest.fn(), canApproveQuotations: jest.fn() },
}));

import {
  ESTADOS as FRONT_ESTADOS,
  TRANSITIONS as FRONT_MATRIZ,
  EDITABLE_STATES as FRONT_EDITABLES,
  resolveActorType as resolverActorFront,
  allowedTransitions as permitidasFront,
} from '../../public/js/views/dashboard/modules/licitacion/permissions.js';

const {
  VALID_STATES: BACK_ESTADOS,
  LICITACION_ROLE_TRANSITIONS: BACK_MATRIZ,
  EDITABLE_STATES: BACK_EDITABLES,
  resolveActorType: resolverActorBack,
  validateTransitionByRole: validarBack,
} = require('../../src/models/LicitacionModel');

// Los tres tipos de actor de la matriz. No son roles: 'jefe' agrupa Jefe y
// SysAdmin, y 'responsable'/'delegado' dependen de la licitación concreta.
const ACTORES = ['responsable', 'delegado', 'jefe'];

// Todos los roles que existen en el sistema, incluidos los que NO pueden tocar
// una licitación. Los de solo lectura son la mitad importante del cruce: el
// error más caro no es ofrecer el botón equivocado, es ofrecérselo a quien no
// debería ver ninguno.
const ROLES = ['Jefe', 'SysAdmin', 'Proyectos', 'Ejecutivo', 'Administracion'];

const ID_RESPONSABLE = 7;

// ---------------------------------------------------------------------------
describe('las dos matrices son la misma matriz', () => {
  test('mismos tipos de actor', () => {
    expect(Object.keys(FRONT_MATRIZ).sort()).toEqual(Object.keys(BACK_MATRIZ).sort());
  });

  test.each(ACTORES)('%s — mismos estados de origen y mismos destinos', (actor) => {
    // toEqual compara en profundidad: detecta un destino agregado, uno borrado
    // y un estado de origen que falta. No detecta el ORDEN, y está bien —
    // el orden de los botones no es una regla de negocio.
    expect(FRONT_MATRIZ[actor]).toEqual(BACK_MATRIZ[actor]);
  });

  test('mismos estados válidos', () => {
    // Si el ENUM de la base gana un estado y el navegador no se entera, la
    // licitación aparece sin ningún botón: TRANSITIONS[actor][estado] da
    // undefined y allowedTransitions devuelve la lista vacía. Se ve igual que
    // «no tenés permiso», que es una explicación falsa.
    expect(FRONT_ESTADOS).toEqual(BACK_ESTADOS);
  });

  test('mismos estados editables', () => {
    // Acá la divergencia se siente al revés: el navegador habilita el formulario
    // de edición y el servidor rechaza el guardado DESPUÉS de que la persona
    // escribió todo.
    expect(FRONT_EDITABLES).toEqual(BACK_EDITABLES);
  });
});

// ---------------------------------------------------------------------------
describe('los dos deciden el mismo tipo de actor', () => {
  // La matriz puede ser idéntica y aun así divergir el resultado, si cada lado
  // elige una FILA distinta. Ese es el eje propio de licitaciones y el más
  // fácil de romper: el navegador compara `userId === licitacion.id_responsable`
  // y el servidor recibe un booleano ya calculado por el controlador.
  const casos = [];
  for (const rol of ROLES) {
    for (const delegado of [false, true]) {
      for (const esResponsable of [false, true]) {
        casos.push([rol, delegado, esResponsable]);
      }
    }
  }

  test.each(casos)('%s (delegado=%s, responsable=%s)', (rol, delegado, esResponsable) => {
    const actorBack = resolverActorBack(rol, delegado, esResponsable);

    const actorFront = resolverActorFront(
      { estado: 'Cotizando', id_responsable: ID_RESPONSABLE },
      { role: rol, userId: esResponsable ? ID_RESPONSABLE : 99, canApprove: delegado }
    );

    expect(actorFront).toBe(actorBack);
  });
});

// ---------------------------------------------------------------------------
// La garantía antidivergencia de verdad: para CADA combinación posible, lo que
// el navegador le ofrece al usuario tiene que ser exactamente lo que el
// servidor le acepta. Es el mismo cruce que protege a cotizaciones.
// ---------------------------------------------------------------------------
describe('lo que ofrece el navegador es lo que acepta el servidor', () => {
  const escenarios = [];
  for (const rol of ROLES) {
    for (const delegado of [false, true]) {
      for (const esResponsable of [false, true]) {
        for (const estado of BACK_ESTADOS) {
          escenarios.push({ rol, delegado, esResponsable, estado });
        }
      }
    }
  }

  test.each(escenarios)(
    '$rol (delegado=$delegado, responsable=$esResponsable) desde $estado',
    ({ rol, delegado, esResponsable, estado }) => {
      const licitacion = { estado, id_responsable: ID_RESPONSABLE };
      const usuario = {
        role:       rol,
        userId:     esResponsable ? ID_RESPONSABLE : 99,
        canApprove: delegado,
      };

      const ofrecidos = permitidasFront(licitacion, usuario);

      // Lo que el servidor acepta no se lee de su matriz —se le PREGUNTA, estado
      // por estado—. Leer la matriz probaría que dos objetos son iguales; esto
      // prueba que la función que decide de verdad decide lo mismo, incluida
      // toda la lógica de resolveActorType y los casos de solo lectura.
      const aceptados = BACK_ESTADOS.filter(
        (destino) => validarBack(estado, destino, rol, delegado, esResponsable).valid
      );

      expect(ofrecidos.slice().sort()).toEqual(aceptados.slice().sort());
    }
  );
});

// ---------------------------------------------------------------------------
describe('el comparador compara algo', () => {
  // Un cruce que nunca encuentra nada pasaría los tres bloques de arriba sin
  // vigilar nada. Ya pasó en este proyecto: un trinquete de colores reportaba
  // 0 sobre 29 reales y la prueba pasaba, porque cero es menor que veintinueve.
  test('hay al menos un caso donde el servidor acepta transiciones', () => {
    const permitidas = permitidasFront(
      { estado: 'En preparacion', id_responsable: ID_RESPONSABLE },
      { role: 'Proyectos', userId: ID_RESPONSABLE, canApprove: false }
    );
    expect(permitidas.length).toBeGreaterThan(0);
  });

  test('y al menos uno donde no acepta ninguna', () => {
    const permitidas = permitidasFront(
      { estado: 'En preparacion', id_responsable: ID_RESPONSABLE },
      { role: 'Administracion', userId: 5, canApprove: false }
    );
    expect(permitidas).toEqual([]);
  });

  test('una divergencia inventada rompe la comparación', () => {
    // Prueba de la prueba: se le agrega un destino imposible a una copia de la
    // matriz del navegador y se verifica que el cruce lo detecta. Sin esto, un
    // toEqual mal escrito —comparando un objeto consigo mismo, por ejemplo—
    // pasaría para siempre.
    const copiaTorcida = {
      ...FRONT_MATRIZ.responsable,
      'Archivada': ['Cotizando'],   // Archivada es terminal en las dos matrices
    };
    expect(copiaTorcida).not.toEqual(BACK_MATRIZ.responsable);
  });
});
