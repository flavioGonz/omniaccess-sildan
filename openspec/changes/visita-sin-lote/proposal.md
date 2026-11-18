# Visita sin lote, con seguimiento

## Por qué
A veces entra un auto y nadie sabe a qué lote va (la persona sabe llegar, pero no da el número).
Hoy el guardia puede registrar una visita "sin lote", pero no hay nada que le recuerde volver a
completarla: queda sin lote para siempre y el monitor no la distingue.

## Qué cambia
- **Tablet del guardia (PWA y APK, misma consola `/guard`):** botón «Visita sin lote» en Visitas.
  Matrícula precargada con la última lectura de la cámara de entrada, tipo, nombre opcional. Al
  guardar arranca una cuenta atrás de **10 min** (ajustable) y la visita queda arriba de todo como
  tarjeta fija, con tres acciones: **Asignar lote**, **+5 min**, **Cerrar** (sin lote, con motivo).
- **Monitor LPR:** franja «Visitas sin lote en seguimiento» arriba de Entradas/Salidas, con foto,
  matrícula, guardia y cuenta atrás. Ámbar corriendo, rojo latiendo al vencer (suena una vez). La
  lectura de entrada de esa matrícula lleva la etiqueta «En seguimiento».
- **Vencimiento:** no se cierra sola. Al llegar a cero se crea el aviso `SIN_LOTE_VENCIDA` para el
  guardia (tablet + monitor), y sigue en rojo hasta que se resuelva.
- **Cierre automático:** si la cámara de Salida lee la matrícula antes de asignar lote, se cierra
  como «salió sin lote». Si una cámara interior la lee, la tarjeta muestra «Visto en: …».
- **Al asignar lote:** el seguimiento termina, queda registrado quién y cuándo, y la visita sigue
  como cualquier otra con el tiempo de su tipo.
- **Ajustes → Visitas:** minutos para asignar lote (10) y minutos de cada prórroga (5).

## Fuera de alcance
- No cambia el registro normal de visitas con lote, ni invitaciones, ni proveedores.
- No hay cambios en las cámaras ni en go2rtc.

## Impacto
- Base: 4 columnas nuevas en `Visita` (sin tocar datos existentes).
- Procesos a reiniciar: `omniaccess-web` (build) y `omniaccess-webhooks` (cierre por cámara de salida).
- Páginas a verificar: `/guard` (tablet), `/admin/monitor-lpr`, Ajustes → Visitas.
