# Design

## Relevamiento del equipo (12/11)

| Punto | Resultado |
|---|---|
| Modelo / firmware | DHI-NVR5464-EI · 5.001.0000000.2.R (2026-03-31) · web V5 |
| Puertos externos | 80 abierto · 37777 abierto · **554 cerrado** · 443 cerrado |
| Login | `/RPC2_Login` en dos pasos: `md5(user:realm:pass)` en mayúsculas → `md5(user:random:h1)` |
| Canales | 64 (`ChannelTitle`), 39 con nombre |
| Snapshot | `GET /cgi-bin/snapshot.cgi?channel=N` → 200 (JPEG) |
| Grabaciones | `mediaFileFind.cgi` factory.create → findFile → findNextFile: archivos `.dav` por hora/canal |
| SMD | `SmartMotionDetect` habilitado, `ObjectTypes: Human/Vehicle` |
| Servicios IA | `SmdDataFinder`, `objectMediaFind`, `faceRecognitionServer`, `RecordSecondaryAnalyse`, `intelli` |
| `intelli.getEnableInfo` | vacío → no hay canales con IVS/IA de cámara activos; la búsqueda se apoya en SMD |

## Decisiones

1. **Todo por HTTP/RPC2** (puerto 80). Nada del SDK binario (37777).
2. **Driver de búsqueda `dahua.ts`** implementa `DriverBusqueda` (`motor: "WizSense"`). `capacidades()` = `texto: true` (traducido), `imagen: <según faceRecognitionServer/objectMediaFind>`, `activa` = SMD habilitado en ≥1 canal.
3. **Parámetros de `SmdDataFinder`/`objectMediaFind`**: la doc pública no los trae; se sacan del JS del web V5 del propio NVR (mismo método que se usó para AcuSeek en Hikvision). Primer intento probado sin éxito: `{Condition:{Channel,StartTime,EndTime,SmdType}}` → error `-267976701` (parámetros inválidos).
4. **Vivo sin 554**: fallback a fotos (1–2 fps del sub-stream por `snapshot.cgi?subtype=1`). Investigar `rtspoverwebsocket` como vivo real; si funciona, un pequeño puente WS→RTSP local para go2rtc.
5. **Playback sin 554**: `mediaFileFind` (con `Types=dav`, rango) → `RPC_Loadfile/<FilePath>` con rango de bytes → ffmpeg `-f dhav` → MP4. Cachear el tramo bajado.
6. **Credenciales**: igual que el resto de dispositivos (campo `password` del Device); el dominio va en `ip`.

## Riesgos

- Ancho de banda: bajar tramos `.dav` (≈1 GB/hora en main stream) por internet es pesado → usar **sub-stream** para playback remoto y recortar por byte-range.
- Firmware V5 puede cambiar parámetros RPC2 entre versiones → el driver detecta capacidades y se degrada (sin búsqueda) en vez de fallar.
