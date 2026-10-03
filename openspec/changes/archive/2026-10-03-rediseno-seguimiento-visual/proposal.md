# Proposal

## Why

El seguimiento visual sirve para **seguir a una persona entre cámaras**. Hoy muestra un chip
con ícono + nombre y, al tocarlo, **reemplaza** el video por el de la cámara destino: se pierde
de vista la cámara de origen y no hay forma de previsualizar adónde lleva cada enlace. Para una
operación profesional de seguimiento falta: marcador limpio, preview al pasar el mouse, y
conservar la cámara anterior en mini al saltar.

## What Changes

- Marcadores **solo ícono** (sin el texto del nombre) en los puntos de paso de la escena.
- **Hover**: preview en vivo (mini) de la cámara destino + su nombre, para saber adónde salta.
- **Click**: traer esa cámara al visor principal y **dejar la cámara de origen en una mini (PiP)**
  clickable para volver — cadena de seguimiento sin perder de dónde venís.
- Estilo profesional (glass, anillo, pulso sutil); el modo edición (arrastrar/agregar/quitar) no cambia.

## Capabilities

### New Capabilities
- `seguimiento-visual`: seguir a una persona entre cámaras desde el visor en vivo — marcadores de
  paso, preview al hover y salto conservando la cámara de origen en mini.

## Impact

- `src/app/admin/monitor-intrusion/page.tsx` (LiveModal: marcadores, hover-preview, `onSwitchCam`,
  mini de origen). Usa go2rtc sub-stream (`/go2rtc/api/stream.mp4?src=lpr_<id>`) y `/api/snapshot/<id>`
  como placeholder instantáneo. Sin cambios de datos (sigue el Setting VISUAL_TRACK_LINKS).
