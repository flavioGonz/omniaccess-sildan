# Design

## Context

Ver proposal.md — Why. Lo que condiciona el cómo (medido en San Nicolás el 7–8/10):

- **Dónde llegan las lecturas.** `server.js` resuelve cada lectura LPR (Entrada .7, Salida .8), guarda el `AccessEvent`, emite `access_event` por socket y llama a `POST /api/notifications/event` (Next) con `{ modulo: "LPR", evento, deviceId, plate, direction, snapshotPath }` — **para todas las lecturas**, haya reglas o no. La .86 (LPR Interior) entra por `lib/paso-por-acceso.ts`, que crea su `AccessEvent` y llama a `notificarEvento` con `instante`. Esos dos son los únicos puntos de entrada: el motor se cuelga ahí sin tocar `server.js`.
- **Cámaras.** `Device.direction` (ENTRY/EXIT) y `deviceType` (`LPR_CAMERA`, `LPR_INTERIOR`) ya dicen qué cámara es de entrada, de salida o interior.
- **Datos.** `AccessEvent` (25 k filas en 9 días, índice `[plateDetected, timestamp]`), `Unit` (81 lotes, enlazados a los polígonos de `BARRIO_MAP.lotes[].unitId`), `Invitation`/`Guest`/`GuestPlate` con vigencia y lote, `Bitacora` (registro manual del guardia, destino como texto). Matrículas normalizadas con `normalizarMatricula`.
- **Medido:** 45 % de las entradas tiene salida leída (<12 h); mediana de permanencia 139 min, p90 431 min; 2.948 matrículas sólo en Salida; rutinas claras (desvío 2–9 min) en 12 matrículas con ≥5 días. Las horas se guardan en UTC; el barrio es UTC-3 (`ZONA` en `lib/fechas`).
- **Tiempo real hacia las pantallas.** Next no tiene `global.io`: emite por `avisarPorSocket` (`/internal/emit` de `server.js`). El monitor escucha con `useTiempoReal`; la consola del guardia tiene su propio socket a `/io/socket.io`.
- **Periódico.** El CT ya corre un cron por minuto contra `/api/devices/health/tick`. `dispatch-worker` es el otro proceso permanente, pero no comparte runtime con Next.
- **Reglas de la casa:** nada hardcodeado (ajustes en `Setting`, constantes con su porqué), migraciones con el Prisma del proyecto, `server.js` no se toca, piezas de `omniaccess-diseno`, un control nunca aparenta hacer lo que no hace.

## Goals / Non-Goals

**Goals:**
- Un solo motor (`lib/visitas`) para los dos modos; el modo sólo cambia presentación, contadores y qué avisos aplican.
- Ninguna lectura espera al motor: si el motor falla, el acceso y el socket `access_event` siguen igual.
- Los perfiles se calculan en lote, fuera del camino de la lectura; la lectura sólo los consulta.
- Todo número que dependa de una salida no leída se muestra como estimado.

**Non-Goals:**
- Cambiar la decisión de `server.js` (en cerrado la barrera sigue decidiendo lo mismo).
- Reescribir el historial del panel (`/admin/history`) al vocabulario de barrio abierto: en este cambio se adapta el monitor LPR y la consola del guardia.
- Aprendizaje automático: los patrones son estadística simple y explicable (mediana, p90, desvío), para que cada aviso pueda decir por qué.

## Decisions

**D1. El motor se engancha en los dos puntos de entrada de Next, no en `server.js`.**
`lib/visitas/motor.ts: alLeerMatricula(lectura)` se llama desde la ruta `/api/notifications/event` (lecturas de `server.js`) y desde `paso-por-acceso.ts` (la .86), con `try/catch` propio y sin `await` bloqueante para la respuesta. Como `server.js` no manda el id del `AccessEvent`, el motor lo busca (misma matrícula + cámara, últimos 2 min) para enlazar la visita con la lectura que la abrió o cerró. *Alternativa descartada:* hacerlo en `server.js` — exige reiniciar `omniaccess-webhooks` (OK del usuario cada vez) y duplica la lógica en JS plano.

**D2. Tres tablas nuevas.**
- `Visita` (id, plate?, tipo, unitId?, loteNombre, nombre?, empresa?, origen GUARDIA|INVITACION, registradaPor, invitationId?, entra, vence, sale?, cierre CAMARA_SALIDA|GUARDIA|FIN_DEL_DIA?, extensiones (JSON: quién, cuánto, cuándo), accessEventEntradaId?, accessEventSalidaId?, avisadaExcedidaAt?). Índices por `[plate, sale]` y `[sale, vence]`.
- `PerfilMatricula` (plate PK, primeraVez, ultimaVez, diasVistos, entradas, salidas, visitasConSalida, permanenciaMedianaMin?, permanenciaP90Min?, soloCalle, rutina JSON? {dows, minutoMedio, desvioMin, dias}, clase, unitIdProbable?, actualizado).
- `AvisoGuardia` (id, tipo, plate?, visitaId?, accessEventId?, motivo, datos JSON, creado, atendidoPor?, atendidoAt?, nota?). Índice `[atendidoAt, creado]` y `[tipo, plate, creado]` para el antirrebote.
*Alternativa descartada:* reutilizar `Bitacora` para las visitas — no tiene vencimiento, ni cierre, ni lote como unidad, y mezclarlo rompería sus pantallas.

**D3. Ajustes en `Setting`, leídos con caché corta.**
`MODO_ACCESO` (ABIERTO|CERRADO, default CERRADO), `VISITA_TIPOS` (JSON `[{clave, nombre, minutos, activo}]`), `AVISOS_GUARDIA` (JSON con cada aviso `{activo, umbral…}`, la franja nocturna, la ventana antirrebote, la hora de corte del día y los parámetros de rutina: días mínimos 4, desvío máximo 30 min, ventana del perfil 30 días). Los valores por defecto viven en `lib/visitas/ajustes.ts` como constantes con su porqué, y se cachean 30 s en memoria del proceso (una lectura por segundo no puede pegarle a `Setting` cada vez).

**D4. Perfiles en lote por SQL, cada 10 minutos, desde el tick.**
Una consulta agregada sobre `AccessEvent` de la ventana (30 días) en hora del barrio (`AT TIME ZONE 'America/Montevideo'`, de `ZONA`): días distintos, entradas/salidas, pares entrada→primera salida <12 h para mediana y p90, y por día la primera entrada para la rutina (media y desvío de los minutos del día). `soloCalle` = sin ninguna entrada en la ventana. Clase: padrón (credencial PLATE o vehículo) → Residente; rutina → Habitual; ≥4 días → Frecuente; 2–3 → Ocasional; 1 → Primera vez. Se hace `upsert` sólo de las filas que cambiaron. Medido: ~5 k matrículas; la consulta del análisis tardó < 2 s. *Alternativa descartada:* recalcular en cada lectura — la mediana y el desvío requieren todas las visitas de la matrícula; en lote es una consulta, en cada lectura serían miles.

**D5. Qué se decide en la lectura y qué en el tick.**
- *En la lectura* (motor): cámara de **salida** → cerrar visita en curso de esa matrícula; cámara de **entrada** → si hay invitación vigente y no hay visita, abrirla; evaluar "fuera de rutina" (contra `PerfilMatricula.rutina`), "primera vez de noche" (sin perfil o clase Primera vez + franja), "da vueltas" (conteo de lecturas de esa matrícula en M min, excluidos residentes/rutina/soloCalle/visita) y, en ABIERTO, "entró sin registrarse". La .86 cuenta como "visto adentro" (actualiza la visita, no abre ni cierra).
- *En el tick* (cada minuto): visitas vencidas sin aviso → `VISITA_EXCEDIDA`; visitas con matrícula que superan el p90 de su perfil → `PERMANENCIA_INUSUAL`; a la hora de corte, cerrar las abiertas como `FIN_DEL_DIA`; cada 10 min, perfiles.
Cada aviso nuevo pasa por el antirrebote (D6) y se emite por socket `aviso_guardia`; cada cambio de visita, `visita`.

**D6. Antirrebote de avisos en la base, no en memoria.**
Antes de crear un aviso se busca uno del mismo `tipo` y `plate`/`visitaId` no atendido o creado dentro de la ventana (60 min). En la base porque hay dos procesos que pueden generar avisos (la ruta de la lectura y el tick) y Next puede reiniciarse.

**D7. "Registrado" se resuelve una vez y se reusa.**
`lib/visitas/registro.ts: estaRegistrada(plate)` = padrón (credencial PLATE o `Vehicle`) ∪ visita en curso ∪ invitación vigente ∪ lista blanca. Lo usan el motor, `/api/monitor/lpr` (para el vocabulario y los contadores) y la ficha. En CERRADO no cambia nada de lo que muestra hoy el monitor.

**D8. El tick: ruta interna con token, llamada por cron.**
`GET /api/visitas/tick` con `x-tracking-token` (el mismo `TRACKING_TOKEN` de `/api/notifications/event`), agregado a las rutas internas que el middleware deja pasar con token. Cron del CT: `* * * * * curl -s -H "x-tracking-token: …" http://127.0.0.1:10001/api/visitas/tick`. *Alternativa descartada:* `setInterval` en Next — se duplica con cada worker y se pierde en cada build; y en `dispatch-worker` — no comparte Prisma generado ni el código TS.

**D9. Pantallas.**
- **Monitor LPR:** `/api/monitor/lpr` suma `modo`, `enBarrio` (visitas en curso + en ABIERTO las no registradas con entrada hoy y sin salida, con `estimado: true`) y los avisos pendientes en `atencion` (en ABIERTO reemplazan al merodeo calculado, que marcaba a cualquier no registrado leído 4 veces); contadores según D7 y el modo. La ficha (`/api/monitor/lpr/lectura/<id>`) suma `perfil`. La vista agrega la columna "En el barrio ahora" (cuenta atrás que corre en el cliente con `vence`), la franja de rutina (7 × 24 celdas) en la ficha, y el vocabulario por modo. Todo dentro del alcance del enlace de pantalla LPR.
- **Consola del guardia:** botón grande "Registrar visita" (tipo en botones, lote con buscador sobre `Unit`, matrícula/nombre/empresa opcionales), lista de visitas en curso con Extender (+5/+10/+15) y Cerrar, y bandeja de avisos con Atendido. Server actions en `actions/visitas.ts` que exigen sesión con permiso `guardia`.
- **Panel:** Ajustes → "Visitas y patrones" (modo, tipos, avisos) y `/admin/visitas` (tablas de visitas y avisos del día con `ui/tabla`, bajo el permiso `guardia`).

**D10. Vocabulario centralizado.**
`lib/visitas/presentacion.ts` decide el texto y el tono de una lectura según modo + registrado + lista negra (REGISTRADO/bien, NO REGISTRADO/neutro, LISTA NEGRA/mal en abierto; PERMITIDO/DENEGADO como hoy en cerrado). El monitor y la consola lo usan; nadie escribe "Denegado" a mano.

## Risks / Trade-offs

- [El 55 % de las entradas no se ve salir → visitas de no registrados "eternas"] → no se modelan como visitas: sólo se muestran estimadas en el monitor, cierran al fin del día y nunca disparan permanencia.
- [Rutinas contaminadas por el tránsito de calle o por lecturas mal leídas] → `soloCalle` excluye a quien nunca entró; la rutina usa sólo lecturas de cámaras de entrada; mínimo 4 días.
- [Rutina que cruza la medianoche (llega 23:50 un día, 00:10 otro) da un desvío falso enorme] → se acepta en esta versión (es raro en llegadas diurnas); queda anotado para usar media circular si aparece.
- [Avisos de más los primeros días, con perfiles de pocos días] → "fuera de rutina" exige rutina detectada (≥4 días) y cada aviso se puede apagar o ajustar; la ventana antirrebote evita ráfagas.
- [La cámara deja de leer bien y llueven "primera vez"] → la "primera vez de noche" respeta la ventana antirrebote y la franja; los avisos dicen la confianza de la lectura.
- [Dos procesos generando el mismo aviso a la vez] → antirrebote en base (D6) con la consulta y el `create` en una transacción serializable corta.
- [El motor demora la ruta `/api/notifications/event`] → se ejecuta sin bloquear la respuesta y con tope de tiempo; si falla, se loguea y la lectura sigue.

## Migration Plan

1. Merge; `./node_modules/.bin/prisma migrate deploy` (tablas nuevas, nada existente cambia); `npm run build`; `pm2 restart omniaccess-web --update-env`. No se reinicia `omniaccess-webhooks` ni `dispatch-worker`.
2. Agregar la línea de cron del tick en el CT y anotarla en la lista de infraestructura.
3. En San Nicolás: Ajustes → Visitas y patrones → modo ABIERTO. Primer tick: perfiles de los últimos 30 días.
4. Verificar: `/monitor/lpr` (vocabulario, contadores, En el barrio ahora, ficha con rutina), `/guard` (registrar → aparece en el monitor; salida leída lo cierra; extender; atender aviso), `/admin/visitas`, `/admin/settings?seccion=visitas`, y que en un barrio sin ajuste el monitor siga mostrando Permitido/Denegado.
5. Rollback: volver el modo a CERRADO (apaga el vocabulario y los avisos de abierto sin desplegar); si hace falta, `git revert` + build + restart; las tablas nuevas pueden quedar (nadie más las lee).

## Open Questions

- Hora de corte del día: por defecto 05:00 (las horas con menos lecturas medidas son 04:00–06:00 del barrio). Se ajusta desde Ajustes si el barrio prefiere otra.
