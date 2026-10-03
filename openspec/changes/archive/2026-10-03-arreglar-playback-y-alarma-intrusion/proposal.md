# Proposal

## Why

En el monitor de intrusión tres cosas rompen la operación: (1) la reproducción de grabaciones
no funciona en ningún NVR (Hik ni Dahua); (2) la mini-ventana de "Vivo" superpuesta al playback
no se puede cerrar; (3) "Aceptar alarma" abre un modal distinto al de los eventos del sidebar,
rompiendo la coherencia. La reproducción es crítica para verificar una alarma.

## What Changes

- Playback: transcodificar con **decode por software + `hwupload` + encode `h264_vaapi`** en vez
  de decode full-hardware VAAPI. Causa raíz confirmada: los NVR Hik de intrusión graban en
  **HEVC/H.265** y el decode VAAPI falla (`hardware accelerator failed to decode picture`),
  entregando un MP4 corrupto; el encode sigue en GPU. Verificado que el nuevo pipeline reproduce
  en los 3 NVR (Dahua .2, Hik .248, Hik .249).
- PiP: agregar botón de cerrar (y volver a mostrar) a la mini-ventana de vivo sobre el playback.
- Alarma: "Aceptar alarma" (overlay del tile y menú) abre la **misma ficha del evento**
  (`DetailDialog`) que el sidebar, con los botones **Confirmar real / Falsa alarma** adentro
  (se conserva la clasificación que usa el servidor de alarma). Sin **BREAKING**.

## Capabilities

### New Capabilities
- `monitor-intrusion`: comportamiento del monitor de intrusión — reproducción de grabaciones del
  NVR, ventana de vivo sobre el playback, y aceptación/clasificación de alarmas desde la ficha del evento.

### Modified Capabilities
<!-- Ninguna: no hay specs previas. -->

## Impact

- `src/app/api/nvr/playback/route.ts` (pipeline ffmpeg; afecta streaming, `whole=1` y `download=1`).
- `src/app/admin/monitor-intrusion/page.tsx` (PiP, overlay/menu de aceptar alarma, `DetailDialog`,
  se deja de usar `AlarmAckModal`).
- Sin cambios de datos ni de esquema.
