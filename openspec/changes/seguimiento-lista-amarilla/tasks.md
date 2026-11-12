# Tasks

## 1. Base de datos

- [ ] 1.1 Agregar al schema `PlateWatch.revisarEl DateTime?` y el modelo `NotaVigilancia { id, fichaClave, tipo, texto, autor?, createdAt }` con `@@index([fichaClave, createdAt])`. Sólo comentarios `//` y `///`.
  - Verificación: `npx prisma validate` y `npx tsc --noEmit` limpios.
- [ ] 1.2 Migración aditiva `…_seguimiento_lista_amarilla`: la columna, la tabla y un `UPDATE` que pone `revisarEl = now() + 30 días` a las filas `SEARCH` con `active = true`.
  - Verificación en el lab (`prisma migrate deploy`): `SELECT count(*) FROM "PlateWatch" WHERE category='SEARCH' AND active AND "revisarEl" IS NULL` da 0, y ninguna fila `BLACKLISTED` cambió (`revisarEl` en null).

## 2. Contexto en el aviso

- [ ] 2.1 `lib-contexto-vigilancia.js` (CommonJS): `contextoDe(lecturas, ahora, zona)` devuelve `{ lecturas7, dias7, anterior }` y `fraseDeContexto(contexto, ahora, zona)` devuelve el texto. Puras, con el reloj y la zona por parámetro; días contados en `America/Montevideo`.
  - Prueba (`tests/contexto-vigilancia.test.ts`, entra en `npm run test:libs`): primera vez; 5.ª lectura en 4 días con la anterior «ayer 22:14»; única anterior de hace más de 7 días (lleva fecha); dos lecturas a las 23:50 y 00:10 cuentan como dos días; lista vacía no rompe.
- [ ] 2.2 En `server.js`, tras calcular `watchHit` y sólo si la categoría es `SEARCH` y la función `LPR_BUSQUEDA` está prendida: consultar las lecturas de 7 días de esa matrícula (`accessType PLATE`, `sinVehiculo false`, sin la actual) y agregar `contexto` a `watchHit`. En `try/catch` con tope de 1,5 s: si falla, se registra y el aviso sigue sin contexto.
  - Verificación en el lab: con una matrícula amarilla de prueba, el log de la lectura muestra el contexto; forzando el error (matar la consulta con un tope de 1 ms en una corrida de prueba) el aviso sale igual.
- [ ] 2.3 Sumar la frase al Telegram de la guardia (una línea, después del motivo) y `contexto` (la frase y los números) al `extra` de `notificarPorReglas` para `WATCHLIST`.
  - Verificación en el lab: el Telegram de una segunda lectura trae la línea; una regla de WhatsApp/correo existente sigue saliendo sin cambios en su plantilla.
- [ ] 2.4 Mostrar la frase donde hoy se muestra el motivo de una amarilla: `avisos/AvisosLpr` y `PilaAvisos`, la franja de atención del Monitor LPR (`VistaLpr`) y Control LPR. Tipo `tono-aviso`, una línea, sin cortar el motivo.
  - Verificación en el lab: leer dos veces la matrícula de prueba; la segunda muestra «2.ª lectura en 7 días…» en el monitor y en Control LPR. Una matrícula de lista negra no muestra la línea.
- [ ] 2.5 Medir el costo: tiempo de proceso de una lectura amarilla antes y después (líneas del log del webhook), en diez lecturas.
  - Verificación: la diferencia de la mediana queda anotada en el commit; si pasa de 50 ms se revisa la consulta antes de seguir.

## 3. Fecha de revisión

- [ ] 3.1 `estadoRevision(revisarEl, ahora)` y la constante `REVISION_DIAS = 30` / `REVISION_AVISO_DIAS = 5` en `lib/padron.ts`. Devuelve `al-dia | por-vencer | vencida` y los días que faltan o pasaron; `null` en una amarilla activa es `vencida`.
  - Prueba (`tests/revision-lista-amarilla.test.ts`): a 30, 6, 5, 0 y −1 días, y con `null`.
- [ ] 3.2 Fijar `revisarEl` en los caminos de alta: `guardarFichaListaNegra` (alta amarilla: +30 días; edición: no la toca; paso a negra: `null`), `addWatch` (carga rápida del monitor y bot) y `reactivarFichaListaNegra` (+30 días).
  - Verificación: prueba de las tres acciones contra la base de pruebas, o en el lab cargando por cada camino y mirando la columna.
- [ ] 3.3 Acción `renovarRevision(clave)`: exige sesión, pone +30 días en todas las filas activas de la ficha y asienta `RENOVACION` en la bitácora. Rechaza fichas dadas de baja y las de lista negra.
  - Verificación: en el lab, renovar una ficha por vencer la deja al día y deja el asiento con el nombre de quien lo hizo.
- [ ] 3.4 `FichaListaNegra` suma `revisarEl`. `TablaListaNegra` suma la columna **Revisión** (sólo en la pestaña amarilla): «en 12 días», «vence en 3 días» (`chip-aviso`), «vencida hace 4 días» (`chip-mal`), vacía si está dada de baja. Filtro «Para revisar» en la barra de la pestaña.
  - Verificación en el lab: con una ficha al día, una por vencer y una vencida (fechas puestas a mano en la base), la tabla muestra las tres y el filtro deja dos.

## 4. Bitácora

- [ ] 4.1 Acciones `bitacoraDe(clave)` (asientos, más nuevos primero) y `anotarEnBitacora(clave, texto)` (exige sesión, recorta, rechaza vacío y más de 1.000 caracteres, firma con `quienSoy()`). Rechazan las claves `r:`.
  - Prueba: sin sesión → rechazo; texto vacío → rechazo con su mensaje.
- [ ] 4.2 Asientos automáticos: `ALTA` (guardar una ficha nueva, `addWatch`), `NIVEL` (cambio de nivel en `guardarFichaListaNegra`), `BAJA` (`bajaFichaListaNegra`), `REACTIVACION` (`reactivarFichaListaNegra`). Sólo para fichas que son o fueron amarillas.
  - Verificación en el lab: alta → baja → reactivar → pasar a negra deja cuatro asientos en orden, cada uno con su autor.
- [ ] 4.3 Mudar la bitácora cuando la clave cambia: en `guardarFichaListaNegra`, si la clave de entrada es `p:<filaId>`, en la misma transacción pasar sus asientos a la `f:<id>` resultante.
  - Prueba: cargar una suelta, anotar, guardarla desde la pestaña con nombre y otra matrícula; `bitacoraDe(f:…)` devuelve la nota y `bitacoraDe(p:…)` queda vacía.
- [ ] 4.4 Sección **Bitácora** en `CajonListaNegra` (sólo amarillas con la función prendida): campo para la nota con su botón, y la lista con fecha (`Momento`), autor y texto; los asientos del sistema, en tono `quieto`. Con sus cuatro estados: cargando, vacía («Todavía no hay nada anotado»), error con reintento, con datos.
  - Verificación en el lab: escribir una nota la muestra arriba sin recargar; cortar la red muestra el error con «Reintentar».

## 5. Seguimiento en la ficha

- [ ] 5.1 Acción `resumenSeguimiento(clave)`: pide `getFichaMatricula` por cada matrícula de la ficha y combina — lecturas 7 y 30 días, días activos, primera y última vez, franja horaria con más lecturas y cámaras por cantidad.
  - Prueba de la función que combina (pura, con dos fichas de matrícula de fixture): suma bien y no cuenta dos veces un día compartido.
- [ ] 5.2 Sección **Seguimiento** en `CajonListaNegra`, arriba de «Dónde se la vio»: las cifras (`tabular-nums`), las cámaras, y por cada matrícula el botón **Investigar**, que abre `FichaMatriculaDrawer`. Sin lecturas, dice «Ninguna cámara la vio todavía» en lugar de ceros. Cargando y error con reintento.
  - Verificación en el lab: con la matrícula de prueba, las cifras coinciden con las de Investigar en el Monitor LPR para la misma matrícula; Investigar abre y cierra sin cerrar la ficha.
- [ ] 5.3 Si importar `FichaMatriculaDrawer` desde Usuarios cierra un ciclo de módulos, cargarlo con `dynamic()` (como `FichaDeEvento`).
  - Verificación: `npm run build` sin avisos de dependencia circular.
- [ ] 5.4 Columna **Vista** en la tabla de la pestaña amarilla: última vez (`Momento`) y lecturas en 7 días.
  - Verificación en el lab: coincide con el resumen de la ficha.

## 6. Acciones de la ficha

- [ ] 6.1 En la ficha amarilla, la fila de revisión con su estado y los tres botones: **Renovar**, **Pasar a lista negra**, **Dar de baja**. «Pasar a lista negra» usa `guardarFichaListaNegra` con el nivel nuevo y el diálogo de avisos que ya existe; al terminar lleva a la pestaña Lista negra con la ficha abierta.
  - Verificación en el lab: con una matrícula de alguien del padrón, pide la confirmación de la barrera; cancelada, no cambia nada; confirmada, la ficha queda en Lista negra con su bitácora y el asiento `NIVEL`.
- [ ] 6.2 La carga rápida del monitor (`WatchlistDialog`) dice, al cargar una amarilla, que se revisa en 30 días.
  - Verificación en el lab: el texto aparece sólo en el modo amarillo.

## 7. Función apagada y cierre

- [ ] 7.1 Con `LPR_BUSQUEDA` apagada: `server.js` no calcula contexto; las secciones Seguimiento y Bitácora, la columna y el filtro no se dibujan; las acciones nuevas responden como función apagada.
  - Verificación en el lab: apagar la función, leer la matrícula de prueba (sin aviso ni contexto), volver a prenderla y comprobar que revisión y bitácora siguen como estaban.
- [ ] 7.2 Actualizar los textos que describen la función (`lib/funciones.ts`) y la ayuda de la pestaña, en el mismo commit que el comportamiento.
  - Verificación: lectura de los textos en Ajustes › Funciones.
- [ ] 7.3 `npx tsc --noEmit`, `npm run test:libs` y `npm run build` limpios; despliegue en el lab; subir la rama `lab` a GitHub.
  - Verificación: `health` 200, `git status -sb` sin diferencia con `origin/lab`.
- [ ] 7.4 Recorrido completo en el lab con Nico: cargar, leer dos veces, anotar, renovar, pasar a negra.
  - Verificación: visto bueno de Nico por escrito en el chat.

## Workflow follow-up

- Pasar a San Nicolás (mismo commit y migración) cuando Nico lo indique.
- Archivar el cambio (`openspec archive`) después del visto bueno.
- Decidir las dos preguntas abiertas de `design.md` con el contexto ya funcionando.
