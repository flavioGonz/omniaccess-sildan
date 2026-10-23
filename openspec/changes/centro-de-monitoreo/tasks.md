# Tasks

Orden pensado para que cada fase deje algo usable en el lab y no rompa lo que ya trata eventos. Cada tarea dice cómo se verifica.

## 1. Base y casos (sin cambiar todavía la pantalla)

- [ ] 1.1 Migración aditiva: `CasoCentral` (central, clase, prioridad, estado ABIERTO | EN_ESPERA | TRATADO, abierto, última señal, cantidad, operador, espera hasta y motivo), `SenalCaso` (caso, mensaje, índice del evento, hora, texto, zona, usuario, tipo SEÑAL | RESTAURACION, tratada, tratamiento), `TratamientoCentral` (caso, por, cierre, texto, móvil, acudió policía, hora). Verificar: `migrate deploy` en el lab sin tocar tablas existentes.
- [ ] 1.2 `src/lib/centrales/casos.ts` (puro donde se pueda): abrir o sumar señal por (central, clase); restauración a un caso abierto; prioridad de la clase; cerrar si no quedan pendientes. Verificar: pruebas con las tramas reales de la 2989 (zonas 10/17/16 → un caso de 3 señales).
- [ ] 1.3 `alarm-receiver` abre o suma al caso para todo evento con prioridad ≤ «tratar hasta» (ajuste nuevo, P4); la `Detection CENTRAL` de las alarmas queda ligada al caso. Verificar: simulador y CMS → casos correctos; P5 no abre caso.
- [ ] 1.4 Script `scripts/centrales-a-casos.js`: pendientes de hoy → casos. Verificar: en el lab, los pendientes aparecen como casos y los tratados en el historial.

## 2. Tratamiento sobre el caso

- [ ] 2.1 `tratamiento.ts` pasa a casos: tomar / pasar / quitar con motivo / pasos / tratar (señales elegidas, cierre, texto, móvil, acudió policía); clave de bitácora `k:<caso>`. Verificar: las mismas pruebas del 22/10 (texto corto, exclusividad, doble tratamiento) más tratamiento parcial.
- [ ] 2.2 En espera: poner, vencer (en la vuelta de salud), volver con sonido. Verificar: espera de 1 min en el lab vuelve a la cola y suena.
- [ ] 2.3 `MovilMonitoreo` (lista simple: nombre, teléfono, activo) y su ABM en Ajustes › Centrales de alarma. Verificar: aparece en la cedulación.
- [ ] 2.4 `FichaEventoCentral` → ficha del caso: señales con casillas (todas por defecto), cedulación ampliada, en espera. `AlertaCentralGlobal` y «Abrir ficha» (Gestión de alarmas, pestaña Centrales) abren el caso. Verificar: un robo de la 2989 salta, se trata parcial, queda abierto con lo restante.

## 3. Consola y contadores

- [ ] 3.1 `/admin/centrales/consola`: cola (Todos / En espera), filas en color de prioridad con cantidad, filtro por área, ficha del caso al costado con pestañas Señales · Abonado · Usuarios · Contactos · Zonas · Horarios · Notas · Historial. Verificar: con 5 casos de prioridades distintas el orden y los colores son correctos.
- [ ] 3.2 Contadores P1 · P2-3 · P4-5 · En espera en la barra del panel (socket + relectura); tocar abre la consola filtrada. Verificar: aparecen y desaparecen con los casos.
- [ ] 3.3 Atajos de teclado (↑/↓, Enter, T, E, C, Esc). Verificar: se puede tomar y tratar un caso sin mouse.

## 4. Ficha de abonado

- [ ] 4.1 Migración: `UsuarioCentral`, `ContactoCentral`, `ListaLlamado` (clase → contactos en orden), `NotaCentral` (permanente | temporal con vencimiento), columnas de `CentralAlarma` (dirección, ubicación, partición, directivas). Verificar: migración aditiva en el lab.
- [ ] 4.2 Pestañas de la ficha de la central (`CajonCentral`) y de la consola: Abonado, Usuarios (con «copiar de otra central»), Contactos y listas, Notas, Directivas. Verificar: carga completa de la 2989.
- [ ] 4.3 Nombre del usuario en armados y desarmados (registro, ficha, Gestión de alarmas). Verificar: «Desarmado · usuario 5 (Nombre)».
- [ ] 4.4 Emboscada: desarmado con usuario Emboscada → caso Coacción P1. Verificar: con la 2989 y un usuario marcado.
- [ ] 4.5 Lista de llamado en la ficha del caso según la clase, con enlace `tel:` y «Llamé → resultado» a la bitácora (`LLAMO`). Verificar: queda en la actividad con hora y quién.

## 5. Automatismos

- [ ] 5.1 `HorarioCentral` (día, ventana de apertura y de cierre, tolerancia) y `lib/centrales/automatismos.ts` en la vuelta de salud: No abrió / No cerró / Abrió fuera de horario como mensajes `sistema`. Arranca «en prueba» por cuenta (registro sin cola) hasta activarlo. Verificar: ventana de cierre a 2 min con la 2989 desarmada → «No cerró».
- [ ] 5.2 Restitución con tiempo límite por zona (`ZonaCentral.restitucionMin`). Verificar: zona en alarma sin restaurar → señal a los N min.
- [ ] 5.3 `ModoCentral` (prueba | desactivado; cuenta, zona o clase; hasta). Reemplaza la marca «de prueba» fija (que pasa a modo prueba sin vencimiento). Verificar: 60 min en prueba y vuelve solo.
- [ ] 5.4 Falta de test como caso, repetido cada período mientras falte. Verificar: con la central de prueba callada.

## 6. Verificación por video e informes

- [ ] 6.1 Clip automático P1/P2 por cámara de la zona (NVR, N s antes y después), guardado con el caso; sin NVR, foto y motivo. Verificar: zona con cámara en NVR del lab.
- [ ] 6.2 Informe por abonado (casos, señales, falsas, reales, tiempos; exportable) junto al de operadores. Verificar: datos de la prueba en el lab.

## 7. Cierre

- [ ] 7.1 Manual de operador (Manuales): tratar, en espera, listas de llamado, modos. Verificar: lo revisa Nico.
- [ ] 7.2 Revisión de pantallas con sesión y prueba completa con la Paradox de IES (disparo, agrupación, parcial, en espera, emboscada, horario). Verificar: Nico.
