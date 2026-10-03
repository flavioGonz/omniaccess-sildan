# Design

## Context

Ver proposal.md. En `LiveModal` (pestaña "live"), `linkTargets` se dibujan sobre `stageRef` según
`VISUAL_TRACK_LINKS`. En vista, cada enlace es un botón chip (ícono + nombre) que llama
`onSwitchCam(c)`; el padre hace `setLiveDev(c)` (remonta el modal por `key={liveDev.id}`). Ya existe
un patrón PiP (mini de vivo) usado en la pestaña de grabación.

## Goals / Non-Goals

**Goals:** marcador solo-ícono; preview en vivo al hover; salto que deja la cámara de origen en mini
y permite volver; estética profesional.
**Non-Goals:** rehacer el modo edición (arrastrar/agregar/quitar sigue igual); cambiar el modelo de
datos; seguimiento automático por IA (es manual).

## Decisions

- **Origen en mini vía el padre.** `onSwitchCam={(c)=>{ setPrevCam(liveDev); setLiveDev(c); }}` y se
  pasa `fromCam` al LiveModal. El modal, en "live", si hay `fromCam` renderiza una mini (PiP) con el
  vivo de origen (go2rtc sub-stream), su nombre, botón para volver (`onSwitchCam(fromCam)`) y X para
  descartar. Se reusa el patrón PiP existente. (Alternativa descartada: refactorizar todas las refs
  de `cam` a estado interno — más riesgoso.)
- **Marcador solo-ícono + preview al hover.** El chip pasa a ser un botón redondo con solo el ícono
  (Crosshair) y pulso sutil. En hover se muestra un popover con snapshot instantáneo
  (`/api/snapshot/<id>`) que se reemplaza por el sub-stream en vivo, + el nombre. Solo-ícono reduce
  ruido visual sobre la escena.

## Risks / Trade-offs

- [Varios sub-streams en vivo a la vez (preview + mini) suben carga] → el preview sólo monta su video
  en hover y se desmonta al salir; la mini es una sola. Aceptable.
- [Remonte del modal al saltar recarga el vivo destino] → es el comportamiento actual; la mini de
  origen la maneja el padre, que no se pierde en el remonte.

## Migration Plan

Deploy estándar: build → restart omniaccess-web → verificar monitor-intrusion 200 y el flujo de
seguimiento. Rollback = revertir el commit.
