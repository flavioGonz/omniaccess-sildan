# Tasks

## 1. Playback robusto (HEVC/H.264, Hik+Dahua)

- [x] 1.1 Cambiar los ffmpeg de `/api/nvr/playback` (streaming, whole=1, download=1) a decode por
      software + `scale=-2:720,format=nv12,hwupload` + `h264_vaapi` (verificación: `ffmpeg` del
      clip exit 0 con frames reales en Dahua .2, Hik .248 y Hik .249).
- [x] 1.2 Verificar en el navegador que un clip reproduce en un canal HEVC y en Dahua
      (verificación: el `<video>` muestra imagen, no póster ni "Sin grabación").

## 2. PiP cerrable

- [x] 2.1 Agregar estado `showPip` + botón de cerrar a la mini-ventana de vivo sobre el playback
      (verificación: al cerrar desaparece; hay forma de volver a mostrarla).

## 3. Aceptar alarma en la ficha del evento

- [x] 3.1 `DetailDialog`: reemplazar el botón único "Aceptar alarma" por Confirmar real / Falsa
      alarma vía un handler `onResolveAlarm(deviceId, kind)`, visible cuando el canal tiene alarma
      activa (verificación: en un canal en alarma aparecen ambos botones).
- [x] 3.2 Overlay del tile y menú "Aceptar alarma": abrir `DetailDialog` con la última detección
      del canal en vez de `AlarmAckModal` (verificación: al aceptar se abre la misma ficha del sidebar).
- [x] 3.3 Cablear `onResolveAlarm` a `ackAlarm(deviceId, kind)` y limpiar el overlay; dejar de
      montar `AlarmAckModal` (verificación: resolver real/falsa cierra la ficha y limpia el overlay).

## 4. Verificación integral

- [x] 4.1 Build DONE_0 + `/admin/monitor-intrusion` responde 200 + probar playback y el flujo de
      alarma de punta a punta (verificación: checklist en verde).
