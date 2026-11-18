# Tareas

## 1. Datos y ajustes
- [ ] 1.1 Columnas nuevas en `Visita` + `db push` (con respaldo previo de la base).
- [ ] 1.2 Ajuste `VISITA_SIN_LOTE` (10 / 5 min) con su bloque en Ajustes → Visitas.

## 2. Servidor
- [ ] 2.1 `abrirVisita` con seguimiento; `asignarLote`, `prorrogarSeguimiento`, cierre con motivo.
- [ ] 2.2 Acciones de la consola (`app/actions/visitas.ts`) con el mismo control de guardia/PIN.
- [ ] 2.3 Tick: aviso `SIN_LOTE_VENCIDA`.
- [ ] 2.4 Motor: salida cierra «salió sin lote»; interior marca «visto en».
- [ ] 2.5 Consulta del monitor LPR: `enSeguimiento`.

## 3. Tablet
- [ ] 3.1 Botón y hoja «Visita sin lote» (matrícula precargada con la última lectura).
- [ ] 3.2 Tarjeta con cuenta atrás, colores y vibración/sonido al vencer.
- [ ] 3.3 Hojas «Asignar lote» y «Cerrar sin lote».

## 4. Monitor LPR
- [ ] 4.1 Franja «Visitas sin lote en seguimiento» + etiqueta en la lectura de entrada + sonido al vencer.

## 5. Verificación
- [ ] 5.1 Build `DONE_0`, restart `omniaccess-web` y `omniaccess-webhooks`, 200 en `/guard`, `/admin/monitor-lpr`, Ajustes.
- [ ] 5.2 Prueba real: alta sin lote desde la tablet → aparece en el monitor → +5 → asignar lote → desaparece; otra que vence → aviso; otra cerrada por la cámara de Salida.
