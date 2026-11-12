# Design

## Context

Ver `proposal.md` para el porqué. Lo que condiciona el cómo:

- **Una ficha no es una tabla.** Es un grupo de filas de `PlateWatch` (una por matrícula) que comparten el campo `ficha`. Su identificador en pantalla es una *clave*: `f:<id>` (ficha de la pestaña), `p:<filaId>` (matrícula suelta, cargada desde el monitor o el bot), `u:<userId>` (persona del padrón marcada) y `r:<userId>` (rol del módulo facial, sólo lectura). Guardar una suelta desde la pestaña la convierte en ficha: **la clave cambia de `p:` a `f:`**.
- **El aviso sale de `server.js`** (CommonJS, fuera de Next): al procesar la lectura calcula `watchHit`, manda el Telegram (`notifyWatchTelegram`), llama a las reglas (`notificarPorReglas`, evento `WATCHLIST`) y emite `access_event` por socket con `watch: watchHit`. Las pantallas (`AvisosLpr`, monitor, Control LPR) leen `ev.watch`.
- **«Investigar» ya existe**: `FichaMatriculaDrawer` + `getFichaMatricula` (ventana de 30 días, sobre `AccessEvent` de tipo matrícula, sin las «sin vehículo»). Muestra calendario de actividad, hora pico, día más activo, nocturnidad, pasadas con foto y detecciones relacionadas. Hoy sólo lo abre el Monitor LPR.
- La ficha (`CajonListaNegra`) ya tiene «Dónde se la vio»: las 60 lecturas más recientes de cada matrícula.
- Toda la Lista Amarilla está detrás de la función `LPR_BUSQUEDA`.

## Goals / Non-Goals

**Goals:**

- Reutilizar lo que ya mide la actividad de una matrícula; no escribir un segundo cálculo que con el tiempo dé otro número.
- Que el costo por lectura sea nulo para las matrículas que no están en la lista, y de una sola consulta para las que sí.
- Que ningún paso apague un aviso sin que alguien lo haya decidido.

**Non-Goals:**

- Seguimiento por rostro, ni de personas sin matrícula.
- Cambiar el motor de lecturas, el mapa o el cálculo de recorridos.
- Sumar los avistamientos de cámaras comunes (`PlateSighting` con origen `TRACK`) al contexto: ver Open Questions.
- Dar de baja sola una ficha vencida.
- Contexto en los avisos de alerta máxima.
- Plazo de revisión configurable por instancia o por ficha: en esta etapa son 30 días fijos, en una constante con nombre.

## Decisions

### 1. El contexto se calcula en el servidor de eventos, una vez, y viaja en `watch`

`server.js` calcula el contexto justo después de saber que la lectura es de una matrícula amarilla, y lo agrega a `watchHit` como `contexto: { lecturas7, dias7, anterior: { ts, camara } | null, frase }`. De ahí lo toman los cuatro destinos: el socket (pantallas), el Telegram, y el `extra` de las reglas.

- *Por qué no en cada pantalla:* serían cuatro lugares calculando lo mismo, y el Telegram y las reglas no tienen pantalla.
- *Por qué no guardarlo en la lectura (`AccessEvent.details`):* es derivable en cualquier momento de las propias lecturas; guardarlo lo congela con los valores de ese instante y obliga a explicar por qué no coincide con la ficha.

**Control LPR no escucha el socket** (se vio al implementar): arma su franja de atención desde `/api/monitor/lpr`. Esa ruta calcula el contexto de las amarillas de la franja con la misma función (`contextoDeLectura`) y **el instante de esa lectura** como reloj, así que da la misma frase que el aviso original. Es la ventaja de que sea derivable: no hubo que guardarlo para mostrarlo después.

La consulta es una sola agregación sobre `AccessEvent` con `plateDetected = <chapa>`, `accessType = PLATE`, `sinVehiculo = false` y `timestamp >= ahora − 7 días` (índice `(plateDetected, timestamp)`), más la lectura anterior (`orderBy timestamp desc`, `take 1`, excluyendo la actual). Los «días distintos» se cuentan en la zona horaria de la instalación (`America/Montevideo`), no en UTC: una pasada a las 22:00 y otra a las 02:00 son dos días para el guardia.

### 2. La frase la arma una función pura, en un módulo que usan los dos mundos

`lib-contexto-vigilancia.js` (CommonJS, en la raíz como los demás `lib-*.js` que comparte `server.js`) exporta `contextoDe(lecturas)` y `fraseDeContexto(contexto, ahora)`. La frase se arma **una vez, en el servidor**, y las pantallas la muestran tal cual: así el Telegram y el monitor dicen exactamente lo mismo. Es pura y recibe el reloj por parámetro, para probar «ayer», «hace 3 días» y el cruce de medianoche sin esperar a que pasen.

- *Alternativa descartada:* mandar sólo los números y redactar en cada destino. Da frases parecidas pero no iguales, que es peor que no tenerlas.

### 3. El resumen de la ficha sale de `getFichaMatricula`, no de una consulta nueva

El resumen (lecturas 7/30 días, días activos, primera y última vez, franja, cámaras) se calcula a partir de lo que `getFichaMatricula` ya devuelve por matrícula (`total`, `porDia`, `porHora`, `camaras`, `primera`, `ultima`), sumando las matrículas de la ficha. Una acción nueva, `resumenSeguimiento(clave)`, las pide en paralelo y combina; las cuentas de 7 días salen de `porDia`.

- *Por qué:* un segundo cálculo terminaría mostrando «12 lecturas» en la ficha y «11 pasadas» en Investigar para la misma matrícula.
- *Costo aceptado:* trae también las pasadas con foto, que el resumen no usa. Son a lo sumo unas pocas matrículas por ficha y se abre a pedido.

`FichaMatriculaDrawer` se mueve de `components/monitor/` a un lugar compartido sólo si importarlo desde Usuarios cierra un ciclo de módulos (el visor ya importa `CajonListaNegra`); si lo cierra, se carga con `dynamic()`, como ya hace el cajón con `FichaDeEvento`.

### 4. La revisión es una columna en `PlateWatch`, igual en todas las filas de la ficha

`PlateWatch.revisarEl DateTime?`. Se escribe igual en todas las filas de una ficha, como hoy `motivo` y `label`. El estado (al día / por vencer / vencida) **no se guarda**: se calcula al leer, con una función pura `estadoRevision(revisarEl, ahora)` en `lib/padron.ts`, que ya es el lugar de lo que «no habla con la base».

- *Alternativa descartada:* una tabla `Ficha` con sus campos propios. Es el modelo más limpio, pero convertir las claves `f:/p:/u:` existentes a una tabla es una migración de datos sobre algo que anda, para ganar una columna.
- La migración pone `revisarEl = ahora + 30 días` a las filas `SEARCH` activas, y nada a las demás. `null` en una amarilla activa (no debería pasar) se trata como vencida: es el lado seguro, pide que alguien la mire.

Dónde se fija: `guardarFichaListaNegra` (alta y edición: al dar de alta, 30 días; al editar, no la toca), `addWatch` (carga rápida y bot), `reactivarFichaListaNegra` (vuelve a 30 días) y la acción nueva `renovarRevision(clave)`.

### 5. La bitácora es una tabla propia, atada a la clave, y se muda cuando la clave cambia

```
NotaVigilancia { id, fichaClave, tipo, texto, autor, createdAt }   @@index([fichaClave, createdAt])
tipo: NOTA | ALTA | RENOVACION | NIVEL | BAJA | REACTIVACION
```

Sin `updatedAt` ni borrado: un asiento no se corrige, se agrega otro. `autor` es el mismo texto que `PlateWatch.createdBy` (nombre del operador o número de WhatsApp), no una relación: quien cargó por el bot no es un usuario del panel.

**El cambio de clave.** Cuando `guardarFichaListaNegra` convierte una suelta (`p:<filaId>`) en ficha (`f:<nuevo>`), en la misma transacción hace `UPDATE NotaVigilancia SET fichaClave = 'f:<nuevo>' WHERE fichaClave = 'p:<filaId>'`. Es el único lugar donde una clave cambia; se cubre con una prueba.

- *Alternativa descartada:* atar las notas a la matrícula. Una ficha con dos matrículas tendría dos bitácoras, y sacar una matrícula de la ficha se llevaría parte de la historia.

Las fichas `r:` (rol facial) no llevan bitácora: no son de la Lista Amarilla.

### 6. «Pasar a lista negra» es `guardarFichaListaNegra` con otro nivel

No hay acción nueva para el cambio de nivel: el botón llama a `guardarFichaListaNegra` con los mismos datos y `nivel: "BLACKLISTED"`, que ya devuelve los `avisos` a confirmar (matrículas de gente del padrón) y ya empuja a las lectoras. Lo nuevo es el asiento `NIVEL` en la bitácora y que la pantalla, al terminar, lleve a la pestaña Lista negra. Al pasar a negra, `revisarEl` se pone en `null` (la revisión es de la amarilla).

### 7. Permisos: los de la ficha

Escribir notas, renovar y cambiar de nivel piden el permiso `vigilancia`, el mismo que hoy pide guardar o dar de baja una ficha (`lib/permisos-acciones` › `padron`). Leer el resumen y la bitácora pide sólo la sesión del panel, como leer la lista. Las acciones nuevas se declaran en esa tabla: la prueba `permisos-acciones` falla si una acción queda sin clase, y falló al escribirlas, que es para lo que está.

## Risks / Trade-offs

- [Una consulta más en el camino de la lectura] → Sólo corre si la matrícula ya dio `watchHit` amarillo; usa un índice existente y una ventana de 7 días; va en `try/catch` con un tope de tiempo, y si falla el aviso sale sin contexto. Se mide en el lab antes y después (tarea 2.5).
- [«Lecturas» no es «pasadas»: un vehículo leído por dos cámaras en un minuto cuenta dos] → El contexto lo llama «lecturas» y prioriza los días distintos, que no se inflan. Es la misma cuenta que muestra Investigar.
- [La bitácora queda huérfana si aparece otro camino que cambie la clave] → Hoy hay uno solo (decisión 5). La prueba de la tarea 4.3 falla si alguien agrega otro sin mudar las notas.
- [Fichas vencidas que nadie mira] → Vencer no apaga nada, así que el peor caso es el de hoy: una ficha vieja que sigue avisando. El filtro «Para revisar» y la columna lo ponen a la vista.
- [El texto del Telegram se alarga] → Una línea más, sólo en amarillas.

## Migration Plan

1. Migración aditiva (`prisma migrate deploy`): columna `revisarEl`, tabla `NotaVigilancia`, y el `UPDATE` que da 30 días a las amarillas activas. No toca filas de lista negra.
2. Desplegar en el lab; validar con una matrícula de prueba leída por una cámara del lab.
3. San Nicolás, cuando Nico lo indique: mismo commit, misma migración.

**Vuelta atrás:** el código anterior ignora la columna y la tabla nuevas, así que alcanza con volver al commit previo; la migración no se revierte.

## Open Questions

- ¿Conviene sumar al contexto los avistamientos de cámaras comunes (`PlateSighting` de origen `TRACK`)? Daría un seguimiento más fino dentro del barrio, pero esas lecturas tienen más errores de OCR. No cambia el diseño: sería otra fuente para la misma función. Se decide después de ver el contexto funcionando con las lectoras.
- ¿El aviso de «por vencer» debe llegar por algún canal (Telegram al administrador, insignia en el menú) además de verse en la tabla? Esta etapa lo deja sólo en la tabla.
