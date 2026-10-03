# Tasks

## 1. Marcador solo-ícono + preview al hover

- [x] 1.1 Cambiar el chip de enlace (vista) por un marcador de solo ícono (sin nombre), estilo glass
      con pulso (verificación: en vivo se ven íconos sin texto en los puntos).
- [x] 1.2 Agregar preview al hover: popover con snapshot instantáneo que pasa a vivo (sub-stream) +
      nombre de la cámara (verificación: al pasar el mouse aparece el preview en vivo y el nombre).

## 2. Saltar conservando la cámara de origen

- [x] 2.1 Padre: guardar `prevCam` al saltar y pasar `fromCam` al LiveModal; limpiar al cerrar
      (verificación: tras un salto, el modal recibe la cámara de origen).
- [x] 2.2 LiveModal: mini (PiP) del vivo de origen en "live" con nombre, botón volver y X
      (verificación: tras el salto se ve la mini de origen; tocarla vuelve a esa cámara; la X la cierra).

## 3. Estilo profesional

- [x] 3.1 Pulir marcador, popover de preview y mini (glass, anillos, tamaños, z-index) para que se
      vea profesional y no tape los controles (verificación: revisión visual).

## 4. Verificación

- [ ] 4.1 Build DONE_0 + monitor-intrusion 200 + probar el flujo de seguimiento de punta a punta
      (verificación: checklist en verde).
