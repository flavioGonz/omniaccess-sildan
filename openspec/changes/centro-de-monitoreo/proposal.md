# Proposal

## Why

Con el Alarm Hub (`alarm-hub-sia-dc09`) OmniAccess ya recibe centrales (DC-09, Contact ID, IPC10 de Paradox), las prioriza y obliga a tratar cada alarma con un cierre y un texto. Pero sigue pensado como **un barrio que mira sus alarmas**, no como **una central de monitoreo que atiende abonados**. Nico pidió (22/10) estudiar en detalle un software de monitoreo de referencia, Bykom («Sistema para Centros Operativos de Monitoreo», el que usa la DNIC; ver su instructivo de tratamiento de eventos), y traer sus mejores ideas.

Lo que un operador de monitoreo hace todos los días y hoy OmniAccess no resuelve:

- **Ver la cola**: cuántos eventos hay por prioridad y cuántos esperando, siempre a la vista; los eventos del mismo abonado y tipo **agrupados** («Robo · Sucursal 23 · 40 señales»), no cuarenta filas.
- **Tratar con contexto del abonado**: quiénes son los usuarios de la central (el «usuario 5» tiene nombre), a quién llamar y en qué orden según el evento, las notas y directivas de esa cuenta, sus horarios, su historial.
- **Tratar parcialmente y poner en espera**: tratar unas señales y dejar otras pendientes; dejar un evento «en espera» con un recordatorio (el titular dijo que llama en 10 minutos).
- **Cedular** con los datos que pide la operación real: tipo de señal, observaciones, **móvil enviado** y **si acudió la policía**.
- **Automatismos** de una central de monitoreo: «no abrió / no cerró / fuera de horario», «no llegó la restitución», modo prueba y modo desactivado **con vencimiento**, y el aviso de asalto cuando se desarma con un código de **emboscada**.

## What Changes

- **Casos**: las señales de un mismo abonado y clase de evento se agrupan en un **caso** abierto (Bykom: «agrupa los eventos del mismo tipo y sucursal»). El caso es la unidad que se toma, se pone en espera y se trata; puede tratarse **parcialmente** (se eligen las señales) y se vuelve a abrir si la zona vuelve a activarse.
- **Consola de monitoreo** (`/admin/centrales/consola`): la cola a la izquierda (pestañas **Todos** y **En espera**, filas en el color de su prioridad, cantidad de señales), el caso elegido a la derecha con pestañas **Señales · Abonado · Usuarios · Contactos · Zonas · Horarios · Notas · Historial**, y el tratamiento abajo. **Contadores por prioridad** (P1 · P2-3 · P4-5 · En espera) siempre visibles en la barra del panel. Atajos de teclado.
- **Cedulación ampliada**: además del cierre y el texto, **móvil enviado** (lista de móviles/guardias) y **acudió policía**; el tratamiento se registra por señal.
- **En espera**: poner un caso en espera con motivo y recordatorio (5/10/15/30 min o una hora); al vencer vuelve a la cola con prioridad y suena.
- **Ficha de abonado** sobre la central que ya existe: datos (dirección, ubicación en el mapa, partición), **usuarios** (código → nombre, tipo de alerta Normal / Nunca / Siempre / **Emboscada**), **contactos** con **listas de llamado por clase de evento** (orden, «puede acudir»), **notas** permanentes y temporales (con vencimiento) y **directivas** (instrucciones de procedimiento propias de la cuenta, que se muestran al tratar).
- **Registro de llamadas**: desde la lista de llamado, «Llamé a X → atendió / no atendió / ocupado / buzón» queda en la bitácora con hora.
- **Automatismos**: **horarios** de apertura/cierre con tolerancia → eventos «No abrió», «No cerró», «Abrió fuera de horario»; **restitución con tiempo límite** por zona → «No llegó la restitución»; **modo prueba** y **modo desactivado** (cuenta, zona o clase) **con vencimiento**; repetir la alerta de supervisión mientras siga faltando.
- **Verificación por video**: al llegar un P1/P2, guardar con el caso un **clip** de cada cámara de la zona (N s antes y después, del NVR) y abrir el **vivo** en la ficha.
- **Informes**: por abonado (señales, falsas, reales, tiempos) y por operador (ya existe «Tiempos»), con exportación.

## Capabilities

### New Capabilities
- `centro-monitoreo`: casos, consola, en espera, cedulación ampliada, ficha de abonado (usuarios, contactos, listas de llamado, notas, directivas, horarios), registro de llamadas, automatismos e informes.

### Modified Capabilities
- `alarm-hub`: la unidad que se trata deja de ser la `Detection CENTRAL` suelta y pasa a ser el **caso**; todo evento de prioridad hasta «tratar hasta» (no sólo las alarmas) entra a la cola; los eventos sintéticos (no abrió, no llegó la restitución, emboscada) entran por el mismo camino que los de la central.

## Impact

- **Base** (migración aditiva): `CasoCentral`, `SenalCaso`, `TratamientoCentral`, `UsuarioCentral`, `ContactoCentral`, `ListaLlamado`, `NotaCentral`, `HorarioCentral`, `ModoCentral` (prueba/desactivado con vencimiento), `MovilMonitoreo`; columnas nuevas en `CentralAlarma` (dirección, ubicación, directivas) y `ZonaCentral` (restitución en minutos).
- **Código**: `alarm-receiver.js` (abrir o sumar al caso), `src/lib/centrales/casos.ts` (nuevo), `tratamiento.ts` (pasa a casos), `automatismos.ts` (nuevo, en la vuelta de salud), `/api/centrales/casos/*`, `/admin/centrales/consola` (nueva), `CajonCentral` (pestañas de abonado), `AlertaCentralGlobal` y `FichaEventoCentral` (pasan a casos), barra del panel (contadores).
- **PM2**: reiniciar `alarm-receiver` y `omniaccess-web`. `server.js` no se toca.
- **Compatibilidad**: los eventos ya tratados con la ficha actual (`AlarmaGestion` con `TRATO`) se muestran en el historial; los pendientes se convierten en casos al desplegar (script de migración de datos).

## Out of scope (de Bykom, a propósito)

- Replicación de base y servidor espejo, estación remota, receptoras seriales (RS-232) y AVL/GPS de vehículos.
- Central telefónica con grabación de llamadas (DUIU). Queda anotado: IES tiene telefonía IP; el registro de llamadas de este cambio es manual y deja la puerta abierta a *click-to-call* en un cambio aparte.
- Apps propias (Hogar Seguro, verificador, técnico), Web Dealer, ERP y facturación.
- «Automonitoreo» (que el titular confirme por push o WhatsApp una señal repetitiva): necesita definir con Nico qué mensajes salen al cliente; va en un cambio aparte.
