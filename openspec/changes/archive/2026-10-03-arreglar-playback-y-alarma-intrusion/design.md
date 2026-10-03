# Design

## Context

Ver proposal.md (Why). `/api/nvr/playback` arma un RTSP time-based al NVR y transcodifica con
ffmpeg a MP4 fragmentado por pipe. `monitor-intrusion/page.tsx` renderiza el tile con overlay de
alarma, un `LiveModal` con pestañas (vivo/grabación/evidencia) y PiP de vivo sobre la grabación,
un `DetailDialog` (ficha de evento, abierto desde el sidebar) y un `AlarmAckModal` aparte.

## Goals / Non-Goals

**Goals:** playback robusto en H.264 y HEVC (Hik+Dahua); PiP cerrable; aceptación de alarma en la
misma ficha del sidebar con real/falsa.
**Non-Goals:** rediseñar el reproductor; cambiar el servidor de alarma; tocar el vivo.

## Decisions

- **Playback decode por software.** Quitar `-hwaccel vaapi -hwaccel_output_format vaapi` y
  `scale_vaapi`; decodificar en CPU y subir a GPU para el encode: `-vf scale=-2:720,format=nv12,hwupload -c:v h264_vaapi`.
  Motivo (verificado en los 3 NVR): el decode VAAPI de HEVC falla con "hardware accelerator failed
  to decode picture"; el pipeline SW-decode+hwupload reproduce bien y el encode sigue en GPU.
  Aplicar el mismo criterio a los tres ffmpeg de la ruta (streaming, `whole=1`, `download=1`).
- **PiP cerrable.** Estado local `showPip` (default true) + botón X sobre la mini-ventana.
- **Alarma unificada.** El overlay/menu de "Aceptar alarma" abre `DetailDialog` con la última
  detección de ese canal; `DetailDialog` recibe un handler `onResolveAlarm(deviceId, kind)` y
  muestra Confirmar real / Falsa alarma cuando el canal tiene alarma activa. Se deja de montar
  `AlarmAckModal` (se puede quitar luego).

## Risks / Trade-offs

- [Decode SW de HEVC 2688x1520 usa más CPU] → el clip es corto (pre+dur) y el encode va por GPU;
  aceptable. Mitigación: mantener escala a 720p para arranque rápido.
- [Construir la ficha desde un AlarmChip puede faltar datos] → `DetailDialog` ya busca hermanos por
  `deviceId` vía historial; con id/deviceId/type/timestamp alcanza para abrir y navegar.

## Migration Plan

Deploy estándar: build → restart `omniaccess-web` → verificar `/admin/monitor-intrusion` 200 y que
un clip reproduce. Rollback = revertir el commit.
