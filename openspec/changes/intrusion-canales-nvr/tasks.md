# Tareas — intrusion-canales-nvr

Por fases; cada fase compila, se despliega y se verifica antes de la siguiente.

## Fase 1 — Importar canales de NVR como cámaras (hace aparecer las cámaras)
- [x] 1.1 `parseInputProxy` tolerante a los XML de V4.63 (M2) y V4.83 (NXI): probar contra NVR 2 y NVR 6.
- [x] 1.2 Acción `importarCanalesNvr(nvrDeviceId, canales[])` en `src/app/actions/nvr.ts`: crea
  `Device` tipo `CAMERA` (brand/creds del NVR), guarda `NVR_CHANNEL_MAP` `{ip:{nvr,ch}}`,
  `syncLprStream`; idempotente por IP.
- [x] 1.3 UI en `CajonDispositivo` (sección NVR): selección múltiple de canales + "Importar
  seleccionados"; `crearCamaraDeCanal` deja de crear `LPR_CAMERA`.
- [x] 1.4 `CAMERA` visible/elegible en `/admin/devices`: `allowedTypes`, `TYPE_META`, `tipos.ts`,
  `esCamara`.
- [x] 1.5 Verificar: importar las perimetrales del NVR 2 → aparecen en Dispositivos y en
  `monitor-intrusion` con "NVR 2 · ch N" y vivo.

## Fase 2 — Una sola pila de intrusión
- [x] 2.1 `server.js`: quitar el despacho a `handleIntrusionEvent`; la rama ANALÍTICAS crea
  `Detection` para `linedetection`/`fielddetection`/`regionentrance`/`regionexiting`.
- [x] 2.2 Atribución por canal: leer `channelID`/`dynChannelID`; si el emisor es NVR, resolver la
  cámara por `getChannelMap()`; sin mapeo → `Detection` sobre el NVR con `label "canal N sin mapear"`.
- [x] 2.3 Retirar la pila vieja: `handlers/intrusion-handler.js`, `IntrusionCalibrator.tsx`,
  `/api/intrusion/geometry`, `isapi-smart-rules.ts`, botón `ShieldAlert` en devices, listener
  `intrusion_alert` en monitor-lpr. (El modelo `IntrusionEvent` queda; migración aparte.)
- [x] 2.4 Conservar `detectionTarget = human` en `writeLine`/`writeField` de la pila nueva.
- [ ] 2.5 Verificar: un cruce real en una perimetral → fila en `Detection` con la cámara correcta,
  `general_detection` en el monitor, captura guardada. `IntrusionEvent` sigue en 0.

## Fase 3 — Hikvision a través del NVR + alarm host
- [ ] 3.1 Rama "Hikvision vía NVR" en `/api/devices/analytics` y `getAnalyticsGeometryBatch`
  (`/ISAPI/Smart/{Line,Field}Detection/<ch>` sobre el NVR con creds del NVR).
- [ ] 3.2 `LineZoneCalibrator` envía `ch`; snapshot por canal vía NVR.
- [ ] 3.3 Settings `EVENT_HOST_IP/PORT/PATH` cargados (192.168.1.3 / 10000 / `/api/webhooks/hikvision`).
- [ ] 3.4 `/api/devices/alarm-host` sobre el **NVR** (no la cámara) cuando la cámara es vía NVR;
  `markAlarm` marca las IPs de sus canales; botón "Configurar alarma" + prueba desde el monitor.
- [ ] 3.5 Verificar: calibrar una perimetral por el NVR 2 → la regla se relee igual; prueba de
  alarm host llega al webhook; monitor marca "alarma OK".

## Fase 4 — Driver por fabricante para NVR y analíticas (refactor, sin cambio de comportamiento)
- [ ] 4.1 `src/lib/drivers/INvrDriver.ts` e `IAnalyticsDriver.ts` + type guards en `getDriver`.
- [ ] 4.2 `HikvisionDriver` implementa ambos (mover `isapi-analytics`, `isapi-alarmhost`, `api/nvr/*`).
- [ ] 4.3 `DahuaDriver` implementa `IAnalyticsDriver` con `dahua-ivs`.
- [ ] 4.4 Rutas API y acciones llaman al driver; `tsc` + build sin errores nuevos; verificación
  de regresión de las fases 1–3.

## Transversal
- [ ] T.1 Revisar NVR 1 (`.122`) en sitio: encendido, IP, puerto. Importar sus canales cuando vuelva.
- [ ] T.2 Medir CPU/GPU del server tras importar los 16 canales del NVR 2 (transcode ffmpeg).
- [ ] T.3 Actualizar `claude/intrusion-estado.md` e `inventario-camaras-sannicolas.md` con el
  resultado; archivar el cambio.
