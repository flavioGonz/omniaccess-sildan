# Tasks

## 1. Alta y canales

- [x] 1.1 Relevar el NVR (modelo, firmware, puertos, servicios RPC2, SMD, snapshot, grabaciones).
- [x] 1.2 Dar de alta el NVR en `omniaccess.sst.uy` (dominio `nicolas.dvrdns.org`, HTTP 80, RTSP 554).
- [x] 1.3 Importar los canales con su nombre real (`ChannelTitle`) y verificar los 39 con nombre.
  - Verificación: aparecen en Dispositivos con su NVR/canal y la foto (snapshot) se ve.

## 2. Vivo y playback

- [x] 2.1 Detectar si el RTSP es alcanzable; si no, vivo por fotos del sub-stream con aviso.
- [ ] 2.2 Investigar `rtspoverwebsocket` (web V5) como vivo real por el puerto 80.
- [x] 2.3 Playback por HTTP: `mediaFileFind` + `RPC_Loadfile` + ffmpeg (dhav → mp4), con caché y sub-stream.
  - Verificación: la ficha de un evento reproduce el tramo y descarga el clip, con y sin 554.

## 3. Búsqueda IA del NVR (`lib/grabador-busqueda/dahua.ts`)

- [x] 3.1 Sacar del JS del web V5 los parámetros exactos de `SmdDataFinder` y `objectMediaFind` (y de `faceRecognitionServer.startFind` para imagen).
- [x] 3.2 Implementar `capacidades`, `buscarTexto` (frase → filtros con el parser existente), `avanceTexto`, `imagen`, `canales`, `ponerCanales`; y `buscarImagen`/`avanceImagen` si el equipo lo acepta.
- [x] 3.3 Registrar el driver (`DAHUA`) en `lib/grabador-busqueda/index.ts`.
  - Verificación: "persona" y "vehículo" en un rango de 6 h en el canal Alero de carga devuelve hallazgos con foto y caja.

## 4. Verificación final

- [x] 4.1 Build `DONE_0`, restart `omniaccess-web`, HTTP 200 en `/admin/devices`, la búsqueda del grabador y la ficha de evento; prueba real contra el NVR de Nicolás.

## Notas de la implementación (12/11)

- Búsqueda: `SmdDataFinder` con `Condition: { StartTime, EndTime, Channels (0-based), Order: "descOrder", SmdType: ["smdTypeHuman","smdTypeVehicle"] }` (sacado del chunk 57 del web V5). Probado: "personas" 4 h → 247 hallazgos; "vehículos en el frente del estacionamiento" → 38, con cámara y foto.
- Foto de cada hallazgo: 3 s bajados por `loadfile.cgi?action=startLoad&channel=N&startTime=&endTime=` (sin `subtype`, que da 400) + ffmpeg → JPEG (~1 s, cacheado en disco).
- Firmware V5: una llamada RPC2 con `params: null` queda colgada hasta el timeout (incluido `global.logout`). El driver no espera el logout y manda `{}`; `dahua-rpc2.ts` además envía la cookie `WebClientHttpSessionID`.
- Vivo sin 554: `ffmpeg:http://…/cgi-bin/mjpg/video.cgi?channel=N&subtype=1#video=h264` en go2rtc (primer cuadro ~12 s). `rtspoverwebsocket` responde 101: queda para una fase siguiente (2.2).
- Playback sin 554: `/api/nvr/playback` → `loadfile.cgi` + libx264 720p (10 s en ~6 s).
- 39 cámaras importadas con su nombre y mapeadas NVR/canal (`NVR_CHANNEL_MAP`).
- Pendiente: 2.2 (vivo real por WebSocket), búsqueda por imagen/atributos (requiere IA de cámara/NVR habilitada por canal; hoy `intelli.getEnableInfo` vacío).

## Pulido (12/11, tarde)

- [x] 5.1 Salud del NVR Dahua por RPC2 (`lib/salud-dahua.ts`, caché 20 s): CPU (`magicBox.getCPUUsage`), memoria, hora y deriva (`global.getCurrentTime`), discos (`storage.getDeviceAllInfo`), estado de cada canal (`LogicDeviceManager.getCameraState`). Alimenta el panel del NVR, `/api/devices/health` y el tick de alertas (`device-health`). Las cámaras Dahua toman su estado del canal en el NVR; si el NVR no contesta no se las marca caídas (lo avisa el NVR). Probado: NVR 46 ms, CPU 41 %, memoria 86 %, deriva 0 s, disco sda 2,9 TB al 100 % (sobrescritura); 39/39 cámaras Connected.
- [x] 5.2 Retención: `mediaFileFind` (canal 1-based) — 4 días en las 39 cámaras (desde 08/11).
- [x] 5.3 Clips y reproducción por HTTP: copia H.265 cuando el visor la acepta (`hevc=1`: 10 s en 0,6 s), libx264 más rápido (`skip_loop_filter`, `fast_bilinear`, hilos auto), marca de agua en el corte para clips enviados, caché de 10 min por tramo (repetición en ~50 ms). Probado: 10 s H.264 720p en 7,3 s (4K H.265 por CPU, sin GPU); clip con logo e intro en 2,8 s.
- Hallazgo en campo (no es del driver): 7 canales devuelven 400 en tramos recientes (huecos de grabación: 4, 7, 9, 11, 20, 21, 23) y unos 17 canales graban sólo cuadros I (0,1–0,5 cuadros/s; p. ej. 3, 5, 8, 10, 16, 22, 24–30, 35–37) con la misma configuración de codificación que los sanos → pérdida de paquetes en el enlace cámara-NVR o ancho de banda de entrada del NVR. Los clips de esos canales salen "a saltos".
