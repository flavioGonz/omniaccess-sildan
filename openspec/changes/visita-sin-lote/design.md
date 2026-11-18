# Diseño

## Datos (`Visita`)
- `seguimientoVence DateTime?` — mientras no sea null y `unitId` sea null, la visita está «en seguimiento».
- `loteAsignadoAt DateTime?`, `loteAsignadoPor String?` — cuándo y quién cerró el seguimiento.
- `cierreMotivo String?` — motivo al cerrar sin lote (salió / no ingresó / se equivocó / otro).
Migración aditiva (`prisma db push`), columnas opcionales.

## Ajustes (`VISITA_TIPOS`/`AVISOS_GUARDIA` existentes + clave nueva `VISITA_SIN_LOTE`)
`{ minutos: 10, prorrogaMin: 5, sonarEnMonitor: true }`.

## Servidor
- `lib/visitas/registro.ts`: `abrirVisita` acepta `seguimiento: true` → `seguimientoVence = entra + minutos`.
  Nuevas `asignarLote(id, unitId, quien)` y `prorrogarSeguimiento(id, quien)` (misma lógica que
  `extenderVisita`: si ya venció, desde ahora). Todas avisan por socket `visita`.
- `lib/visitas/tick.ts`: vencidas en seguimiento sin aviso → aviso `SIN_LOTE_VENCIDA` una sola vez.
- Motor de lecturas: cámara de Salida con visita en seguimiento → `cerrarVisita(..., cierreMotivo: "SALIO_SIN_LOTE")`;
  cámara interior → actualiza `vistoAdentroAt` y la cámara (ya existe el campo).
- `/api/monitor/lpr` (consulta del monitor): suma `enSeguimiento[]` con foto de la lectura de entrada.

## Cliente
- `components/guard/PanelVisitas.tsx`: botón, hoja de alta, tarjeta de seguimiento, hojas «Asignar
  lote» (buscador por lote o titular) y «Cerrar sin lote». La cuenta atrás corre con la hora del
  servidor (`vence` viene del servidor), así una tablet que se apaga no pierde el tiempo.
- `components/monitor/vistas/VistaLpr.tsx`: franja con las tarjetas; un sonido al pasar a vencida.
