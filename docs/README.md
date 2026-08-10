# Documentación

El [README principal](../README.md) explica **qué hace** el sistema, cómo
instalarlo y cómo desplegarlo. Esta carpeta explica **cómo trabajar dentro de
él**: las decisiones que ya están tomadas y por qué, para no volver a
discutirlas ni deshacerlas sin querer.

| Documento | Responde a |
|---|---|
| [diseno.md](diseno.md) | ¿De qué color va esto? ¿Puedo poner un emoji? ¿Por qué mi `style=""` no se aplica? ¿Cómo nombro una clase? |
| [pruebas.md](pruebas.md) | ¿Qué es un trinquete? ¿Por qué falla un guardia? ¿Por qué `--runInBand`? ¿Cómo escribo una prueba acá? |

## Dónde está el resto

No todo tiene que estar en un `.md`. Buena parte de la documentación de este
proyecto vive **al lado del código que explica**, que es donde no se
desincroniza:

- **Cada módulo tiene una cabecera** que dice qué hace, por qué existe y qué
  decisión no obvia lo formó. Empezá por ahí antes que por cualquier documento.
- **La API** se documenta sola en `/api-docs` (Swagger, sólo Jefe y SysAdmin).
  Las respuestas compartidas están en `src/config/swagger.js`.
- **El esquema de la base** es `sql/init.sql`, con las migraciones incrementales
  en `sql/upgrade_*.sql`.
- **La máquina de estados** de las cotizaciones está en
  `src/models/quotation/stateMachine.js` y su espejo navegable en
  `public/js/shared/quotationTransitions.js`. El README la explica en §3.3.

## La regla que mantiene esto vivo

`tests/unit/documentacion.test.js` verifica que cada archivo citado exista, que
cada token y cada clase mencionados estén definidos, y que **los números que
estos documentos afirman coincidan con los que exigen las pruebas**.

Un documento que envejece en silencio es peor que no tenerlo: se lee, se cree,
y manda al lector en la dirección equivocada.
