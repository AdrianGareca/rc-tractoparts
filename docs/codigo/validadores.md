# La revisión de los datos — `src/validators/`

[Volver al índice](README.md)

## En pocas palabras

Antes de guardar nada, el sistema **revisa que los datos tengan sentido**: que
una fecha exista en el calendario, que un precio no sea negativo, que un nombre
no sea más largo de lo que entra en la base, que un estado sea uno de los
permitidos. Si algo está mal, la persona recibe un mensaje que dice **qué campo**
falló y **por qué**, y no se guarda nada.

## Cómo funciona

Las reglas están escritas con **Zod**, una librería que describe la forma que
debe tener cada dato. Cada ruta que recibe datos aplica su esquema con
`validate(...)` antes de llegar al controlador.

### `src/validators/validate.js` — el aplicador

| Función | Qué hace |
|---|---|
| `validate(schema)` | Fábrica: devuelve el control que revisa `req.body` con el esquema. Si pasa, **reemplaza `req.body` por los datos ya limpios** (recortados, redondeados, con su tipo correcto). Si no, responde 422 con la lista de campos que fallaron. |

### `src/validators/authValidator.js` — inicio de sesión

| Exporta | Qué define |
|---|---|
| `loginSchema` | Usuario y contraseña del inicio de sesión. |
| `USERNAME_REGEX`, `USERNAME_MIN_LENGTH`, `USERNAME_MAX_LENGTH` | Qué caracteres y qué largo puede tener un nombre de usuario. La creación de usuarios usa **las mismas** constantes, para no crear cuentas que después no puedan entrar. |

### `src/validators/fechaCalendario.js` — fechas reales

| Exporta | Qué hace |
|---|---|
| `FORMATO_FECHA` | El formato `AAAA-MM-DD`. |
| `esFechaCalendarioValida(valor)` | ¿La fecha existe? «2026-02-30» tiene el formato correcto pero no existe: esta función lo detecta. |

### `src/validators/quotationValidator.js` — cotizaciones

| Esquema | Para |
|---|---|
| `createQuotationSchema` | Crear una cotización: cliente, descripción, fechas, moneda, entidad emisora, datos del solicitante y del equipo, descuento, forma de pago y los ítems (de 1 a 200). |
| `updateQuotationSchema` | Editarla: las mismas reglas, pero **sin valores por defecto** en moneda y entidad emisora. |
| `updateStatusSchema` | Cambiar de estado: el estado nuevo, una observación y el comentario del Administrador. |
| `approveQuotationSchema` | Aprobar o rechazar: `aprobado` y observaciones. |
| `updateSeguimientoVentaSchema` | El seguimiento comercial: estado de venta, detalle (obligatorio si es «Otro») y fecha del próximo contacto. |

Reglas destacadas de los ítems: la cantidad se redondea a 4 decimales y el
precio a 2 **antes** de revisar los límites; la moneda solo puede ser BOB o USD;
la entidad emisora, una de las razones sociales habilitadas.

### `src/validators/licitacionValidator.js` — licitaciones

| Exporta | Para |
|---|---|
| `createLicitacionSchema`, `updateLicitacionSchema` | Crear y editar una licitación (nombre, cliente convocante, presupuesto, moneda, fecha límite, responsable). |
| `updateLicitacionStatusSchema` | Cambiar su estado. |
| `createGastoSchema` | Registrar un gasto (concepto, monto, moneda). |
| `validateListFilters(query)` | Revisa los filtros del listado (`estado`, ids…) que llegan en la URL, que `validate` no cubre porque solo mira el cuerpo. |

## Por qué es así

- **Revisar en la entrada, no en la base.** Si un dato inválido llega hasta
  MySQL, la base lo rechaza con un error técnico que sale como «error interno»
  (500) y la persona no sabe qué corregir. Revisando antes, el mensaje dice el
  campo exacto (422).
- **Editar no usa valores por defecto.** Fue un error real y repetido: el
  esquema de edición completaba con «BOB» la moneda que no se había enviado, y
  una proforma en dólares se guardaba en bolivianos con la cuenta bancaria de la
  otra empresa. En una edición, «no lo mandé» significa «dejalo como está».
- **El redondeo va antes de los límites.** Al revés, una cantidad de 0,00001
  pasaría el control «mayor que cero» y recién después se convertiría en cero.
- **El número que se valida es el que se guarda.** Las columnas de la base
  tienen 2 decimales para precios; si se validara un valor con más, la proforma
  impresa no cuadraría.

## Dónde está probado

Pruebas editarNoPisaCampos (editar no pisa lo que no se envió), laProformaCuadra
(los redondeos cuadran en el PDF), validationEdgeCases (casos límite),
fechaCalendario (fechas imposibles), gastosDeLicitacion (los gastos) y
usernameLength (el largo del nombre de usuario).
