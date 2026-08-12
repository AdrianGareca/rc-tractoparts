// =============================================================================
// public/js/shared/ultimaGana.js
// Que una respuesta vieja no pise a una nueva.
//
// EL PROBLEMA QUE RESUELVE, Y POR QUÉ NO SE VE
// Un panel dispara su consulta y escribe el resultado cuando llega. Si el
// usuario cambia el filtro y vuelve a pedir antes de que la primera termine,
// hay dos respuestas en vuelo — y la que escriba ÚLTIMA gana, sin importar cuál
// se pidió después.
//
// El caso que lo vuelve grave: el Jefe elige «Este año» y aprieta Aplicar
// (consulta pesada, tres segundos). Sin esperar, elige «Hoy» y aprieta otra vez
// (cuatrocientos milisegundos). Termina primero la de hoy. Dos segundos y medio
// después llega la del año y sobrescribe la pantalla.
//
// El Jefe queda mirando el volumen ANUAL creyendo que es el del día. No hay
// error, no hay parpadeo, no hay nada que lo delate: los números son reales,
// sólo que de otro período. Es el peor tipo de bug — el que se ve bien.
//
// POR QUÉ UN TURNERO Y NO UN AbortController
// Abortar cancela la petición HTTP, que es mejor cuando se puede. Pero exige
// que quien la dispara acepte una `signal`, y varias de estas consultas pasan
// por capas que no la propagan. El turnero funciona con cualquier promesa:
// no cancela nada, sólo decide quién tiene derecho a escribir.
//
// Los dos se pueden combinar — abortar para no gastar red, y el turnero para
// no escribir. Este módulo cubre el segundo, que es el que evita el dato falso.
// =============================================================================

/**
 * Crea un turnero para UN panel. Cada panel necesita el suyo: que el listado de
 * clientes pida algo no puede invalidar lo que está cargando el de auditoría.
 *
 * @returns {{ ejecutar: Function }}
 *
 * @example
 *   const turnero = crearTurnero();          // una vez, al montar el panel
 *
 *   async function cargar() {
 *     seccion.loading();
 *     const { vigente, valor } = await turnero.ejecutar(() => api.get(url));
 *     if (!vigente) return;                  // llegó tarde: no escribe
 *     pintar(valor);
 *   }
 */
export function crearTurnero() {
  // Contador monótono. Cada pedido se lleva su número y después comprueba si
  // sigue siendo el último. Un entero alcanza: no hay forma de desbordarlo
  // apretando un botón, y comparar números es más barato que cualquier otra cosa.
  let ultimoTurno = 0;

  return {
    /**
     * Corre `tarea` y dice si su resultado todavía vale.
     *
     * @param   {Function} tarea — devuelve una promesa con los datos
     * @returns {Promise<{ vigente: boolean, valor: * }>}
     */
    async ejecutar(tarea) {
      const miTurno = ++ultimoTurno;

      try {
        const valor = await tarea();

        // La comprobación va DESPUÉS del await, que es el único lugar donde
        // sirve. Hacerla antes —como hacía una de las pantallas— siempre da
        // verdadero, porque el turno se acaba de asignar y todavía no hubo
        // ocasión de que otro pedido lo pisara.
        return { vigente: miTurno === ultimoTurno, valor };

      } catch (err) {
        // Un error de la petición VIGENTE se propaga: el panel tiene que poder
        // mostrar su estado de error, o se queda con el esqueleto de carga
        // para siempre.
        if (miTurno === ultimoTurno) throw err;

        // Un error de una petición YA VENCIDA se traga a propósito. La pantalla
        // está mostrando el resultado de un pedido más nuevo, y un cartel de
        // error sería mentira sobre lo que el usuario tiene delante.
        return { vigente: false, valor: undefined };
      }
    },
  };
}
