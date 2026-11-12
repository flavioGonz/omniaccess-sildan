# Tasks

## 1. Alta y canales

- [x] 1.1 Relevar el NVR (modelo, firmware, puertos, servicios RPC2, SMD, snapshot, grabaciones).
- [x] 1.2 Dar de alta el NVR en `omniaccess.sst.uy` (dominio `nicolas.dvrdns.org`, HTTP 80, RTSP 554).
- [ ] 1.3 Importar los canales con su nombre real (`ChannelTitle`) y verificar los 39 con nombre.
  - Verificación: aparecen en Dispositivos con su NVR/canal y la foto (snapshot) se ve.

## 2. Vivo y playback

- [ ] 2.1 Detectar si el RTSP es alcanzable; si no, vivo por fotos del sub-stream con aviso.
- [ ] 2.2 Investigar `rtspoverwebsocket` (web V5) como vivo real por el puerto 80.
- [ ] 2.3 Playback por HTTP: `mediaFileFind` + `RPC_Loadfile` + ffmpeg (dhav → mp4), con caché y sub-stream.
  - Verificación: la ficha de un evento reproduce el tramo y descarga el clip, con y sin 554.

## 3. Búsqueda IA del NVR (`lib/grabador-busqueda/dahua.ts`)

- [ ] 3.1 Sacar del JS del web V5 los parámetros exactos de `SmdDataFinder` y `objectMediaFind` (y de `faceRecognitionServer.startFind` para imagen).
- [ ] 3.2 Implementar `capacidades`, `buscarTexto` (frase → filtros con el parser existente), `avanceTexto`, `imagen`, `canales`, `ponerCanales`; y `buscarImagen`/`avanceImagen` si el equipo lo acepta.
- [ ] 3.3 Registrar el driver (`DAHUA`) en `lib/grabador-busqueda/index.ts`.
  - Verificación: "persona" y "vehículo" en un rango de 6 h en el canal Alero de carga devuelve hallazgos con foto y caja.

## 4. Verificación final

- [ ] 4.1 Build `DONE_0`, restart `omniaccess-web`, HTTP 200 en `/admin/devices`, la búsqueda del grabador y la ficha de evento; prueba real contra el NVR de Nicolás.
