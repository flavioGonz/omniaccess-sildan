# Tareas

## 1. Datos y ajustes
- [x] 1.1 Columnas nuevas en `Visita` + `db push` (con respaldo previo de la base).
- [x] 1.2 Ajuste `VISITA_SIN_LOTE` (10 / 5 min) con su bloque en Ajustes → Visitas.

## 2. Servidor
- [x] 2.1 `abrirVisita` con seguimiento; `asignarLote`, `prorrogarSeguimiento`, cierre con motivo.
- [x] 2.2 Acciones de la consola (`app/actions/visitas.ts`) con el mismo control de guardia/PIN.
- [x] 2.3 Tick: aviso `SIN_LOTE_VENCIDA`.
- [x] 2.4 Motor: salida cierra «salió sin lote»; interior marca «visto en».
- [x] 2.5 Consulta del monitor LPR: `enSeguimiento`.

## 3. Tablet
- [x] 3.1 Botón y hoja «Visita sin lote» (matrícula precargada con la última lectura).
- [x] 3.2 Tarjeta con cuenta atrás, colores y vibración/sonido al vencer.
- [x] 3.3 Hojas «Asignar lote» y «Cerrar sin lote».

## 4. Monitor LPR
- [x] 4.1 Franja «Visitas sin lote en seguimiento» + etiqueta en la lectura de entrada + sonido al vencer.

## 5. Verificación
- [x] 5.1 Build `DONE_0`, restart `omniaccess-web` y `omniaccess-webhooks`, 200 en `/guard`, `/admin/monitor-lpr`, Ajustes.
- [x] 5.2 Prueba real: alta sin lote desde la tablet → aparece en el monitor → +5 → asignar lote → desaparece; otra que vence → aviso; otra cerrada por la cámara de Salida.
