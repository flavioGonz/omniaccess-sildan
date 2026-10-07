# Diseño — intrusion-canales-nvr

## Estado medido (2026-10-03, server de San Nicolás)

- `Device`: 2 `LPR_CAMERA` (.7 .8), 4 `LPR_INTERIOR` (.86 .19 .22 .36), 3 `NVR` (.122 .123 .100).
  **Cero `CAMERA`** → monitor vacío. `Detection` = 0 filas, `IntrusionEvent` = 0 filas.
- NVR 2 `.123` DS-7616NI-M2/16P fw V4.63: 16 canales IP (perimetrales), `Smart/capabilities`
  con Line+FieldDetection. **Es el NVR de intrusión.**
- NVR 6 `.100` DS-7616NXI-K2(D) fw V4.83 (AcuSense): ~7 canales incl. las LPR; Smart OK.
- NVR 1 `.122`: sin respuesta HTTP. Revisar en sitio. **Fuera del camino crítico.**
- No existen `NVR_CHANNEL_MAP`, `EVENT_HOST_*` ni `ALARM_CONFIGURED_IPS`.
- Los endpoints ISAPI que usa el código son correctos para estos firmwares (verificado:
  `System/deviceInfo`, `ContentMgmt/InputProxy/channels`, `Smart/capabilities`). Ojo: el XML de
  `InputProxy/channels` varía entre V4.63 y V4.83 — `parseInputProxy` debe tolerar ambos (el
  conteo por `<InputProxyChannel>` falló en el NXI; los `<ipAddress>` sí aparecen).

## Decisión 1 — Una sola pila: la del primer barrio

Se adopta `monitor-intrusion` + `Detection` + `general_detection` como única verdad y se retira la
pila vieja de SN. Motivo: hoy, en `server.js`, `if (esEventoIntrusion(eventType)) { await
handleIntrusionEvent(...); return; }` corre **antes** de la rama de analíticas del primer barrio y se traga
todo cruce Hikvision; además ambas escriben `LineDetection/1` con valores distintos. Mantener las
dos obliga a sincronizar dos calibradores y dos tablas para siempre.

Se conserva de SN lo que era mejor: `detectionTarget = human` al escribir la regla (el primer barrio no lo
fija). Se retiran: `handlers/intrusion-handler.js`, `src/components/IntrusionCalibrator.tsx`,
`src/app/api/intrusion/geometry/route.ts`, `src/lib/isapi-smart-rules.ts`, el botón `ShieldAlert`
de devices y el listener `intrusion_alert` en monitor-lpr. `IntrusionEvent` y
`Device.intrusionEnabled/intrusionGeometry` **quedan en el schema sin uso** en este cambio
(retirarlos es una migración aparte, para poder volver atrás si hace falta).

## Decisión 2 — Importar canales como `CAMERA` (lo que el primer barrio hizo a mano)

Nueva acción `importarCanalesNvr(nvrDeviceId, canales[])` en `src/app/actions/nvr.ts`:
1. Para cada canal: `createDevice` con `deviceType: CAMERA`, `brand` del NVR, `ip` del canal,
   `name` (del NVR o "NVR 2 · ch N"), credenciales del NVR, `authType` del NVR.
2. `saveNvrChannelMapForNvr(nvrIp, [{ip, ch}])` → `NVR_CHANNEL_MAP` formato nuevo `{ip:{nvr,ch}}`.
3. `syncLprStream(dev)` → rama `CAMERA` ya existente (HD vía NVR, SD directo si responde).
4. Idempotente por IP: si ya existe un `Device` con esa IP, actualiza el mapeo y no duplica.
UI: en `CajonDispositivo` (sección NVR) el botón "escanear" ya existe; se agrega selección
múltiple + "Importar seleccionados" llamando a la acción. `crearCamaraDeCanal` deja de crear
`LPR_CAMERA`. `CAMERA` se agrega a `allowedTypes`, `TYPE_META`, `tipos.ts` y `esCamara`.

## Decisión 3 — Hikvision a través del NVR, por canal

Hoy `getAnalyticsGeometryBatch`, `/api/devices/analytics` y `/api/devices/alarm-host` hablan a la
IP de la cámara, canal 1. Se agrega la rama "Hikvision vía NVR" simétrica a la de Dahua: si
`resolveForCamera(id)` devuelve un NVR Hikvision, se usa `nvr.ip` + creds del NVR y
`/ISAPI/Smart/{Line,Field}Detection/<ch>`; `LineZoneCalibrator` pasa `ch`. Snapshot por canal:
`/ISAPI/Streaming/channels/<ch>01/picture` en el NVR (ya existe `nvrSnapshot`).

Atribución del evento: en la rama ANALÍTICAS de `server.js` se lee `channelID` / `dynChannelID`
del XML; si el emisor es un NVR, se busca en `getChannelMap()` la cámara con `{nvr, ch}`. Sin
mapeo → `Detection` sobre el NVR con `label: "canal N sin mapear"` (no se descarta).

Alarm host: `ensureAlarmHost` sobre el **NVR** (un httpHost en el NVR cubre todos sus canales),
con `EVENT_HOST_IP=192.168.1.3`, `EVENT_HOST_PORT=10000`, `EVENT_HOST_PATH=/api/webhooks/hikvision`
en Settings (no en código). `markAlarm` marca las IPs de sus canales.

## Decisión 4 — El driver por fabricante también para NVR y analíticas

Se agregan a `src/lib/drivers/`:
- `INvrDriver`: `listChannels(nvr)`, `snapshot(nvr, ch)`, `playbackUrl(nvr, ch, from, to)`,
  `recordingDays(nvr, ch, month)`.
- `IAnalyticsDriver`: `readRules(target, ch)`, `writeLine(target, ch, line)`,
  `writeField(target, ch, polygon)`, `ensureAlarmHost(target, host)`, `testAlarmHost(target)`.
`HikvisionDriver` implementa ambos moviendo el código de `isapi-analytics.ts`,
`isapi-alarmhost.ts` y `api/nvr/*`; `DahuaDriver` implementa `IAnalyticsDriver` con
`dahua-ivs.ts`. `getDriver(brand)` los expone con type guards (`isNvrDriver`,
`isAnalyticsDriver`). Las rutas API pasan a llamar al driver. Es refactor sin cambio de
comportamiento; va al final y se puede desplegar aparte.

## Riesgos

- Retirar la pila vieja: SN no la usaba en producción (0 eventos), riesgo bajo. Se deja el modelo.
- Reglas en el equipo: escribir `LineDetection/<ch>` en el NVR pisa lo que haya; antes de
  escribir se lee y se muestra lo actual (ya lo hace el calibrador).
- Carga del NVR 2 con 16 streams vía NVR + transcode ffmpeg: medir CPU/GPU tras importar; el
  monitor pide `ensure` por tile, no todos a la vez.
- NVR 1 apagado: su contenido se importa cuando vuelva; no bloquea.
