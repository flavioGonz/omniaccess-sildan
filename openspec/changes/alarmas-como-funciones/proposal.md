# Proposal

## Why

Hoy la intrusión y las alarmas cuelgan del modo de la instalación sin que nadie lo haya decidido. El Monitor de Intrusión sólo aparece en modo Matrículas (`admin/layout.tsx`: `MODULE_LPR && !MODULE_QUEUE`). Gestión de alarmas desaparece en modo Filas. El receptor de centrales (Alarm Hub) corre siempre, haya o no centrales. Nico (23/10): «la recepción de alarmas y el manejo de las alarmas deben ser una función activable, igual que hicimos con el resto, pero no atadas a un modo: intrusión, alarmas SIA, etc. son funciones de los tres modos; intrusión también activable en cada modo». También pidió que la recepción tenga «un condimento» en el panel y en `/monitor/alarmas`:

- vincular cámaras a la zona o al área;
- al abrir el evento, traer las cámaras de ese cliente en vivo y la grabación del momento (video verificación);
- que el procedimiento de actuación quede marcado.

Todo, «profesional».

Lo que existe y no alcanza:

- La ficha del evento muestra **una foto cada 5 s** de las cámaras de la zona, sin video en vivo ni grabación. El monitor de pared «Alarmas» (lab96) ya abre el vivo, pero tampoco tiene la grabación.
- Una zona sólo se vincula con **equipos** cámara. No acepta canales de NVR que no son equipo, y no usa el área que ya tiene asignada: una zona con área y sin cámaras elegidas a mano queda sin video.
- El procedimiento es **una lista por prioridad**: un robo y un incendio P1 piden los mismos pasos. Ningún paso es obligatorio y se puede tratar sin haber tildado nada.

## What Changes

- **Funciones de la instalación** (nuevas, independientes del modo; conviven con Matrículas, Rostro y Filas igual que la capa Guardia):
  - **Intrusión**: analíticas de cámara, Monitor Intrusión, alerta global, vista de pared Intrusión.
  - **Recepción de alarmas**: el receptor SIA DC-09 / Contact ID / IPC10, centrales en Dispositivos, registro «Centrales».
  - **Gestión de alarmas de central**: cola, tomar y tratar, procedimientos, escalado, ventana global, vista de pared Alarmas. Requiere Recepción.

  Se prenden y se apagan en Ajustes → Modos, en una sección propia «Funciones de la instalación», y el menú, las alertas globales, las vistas de pared y las rutas obedecen. **Cambio de comportamiento:** en modo Filas aparecen Intrusión y Gestión de alarmas si sus funciones están prendidas (hoy están ocultas por el modo).
- **Cámaras del abonado**: cada central puede tener sus cámaras (equipos y canales de NVR). Cada zona usa, en este orden:
  1. sus cámaras elegidas;
  2. si no tiene, las cámaras de su área;
  3. si tampoco hay, las del abonado.

  En el editor de zonas se ve de dónde salen las cámaras de cada zona.
- **Video verificación en el evento**: al abrir un evento (ficha del panel y vista de pared) se ven en vivo las cámaras de la zona y, con un toque, la **grabación del momento** (desde N s antes del evento, el «antes» de Ajustes → Reproducción). Las demás cámaras del abonado quedan a mano. Sin grabador, se dice por qué y se ofrece el vivo.
- **Procedimientos por clase de evento**: Robo, Pánico, Coacción, Incendio, Médica, Sabotaje, Técnicas y Fallas tienen cada uno su lista; si una clase no tiene lista, se usa la de su prioridad (lo de hoy). Cada paso puede ser **obligatorio**: TRATAR exige tildar los obligatorios o escribir por qué se saltean. Cada paso queda con quién y a qué hora. La vista de pared muestra el avance del procedimiento (sólo lectura).
- **Monitor de pared «Alarmas»**: suma la grabación del momento, las otras cámaras del abonado y el avance del procedimiento; se oculta del catálogo si la función Gestión está apagada.

## Capabilities

### New Capabilities

- `funciones-instalacion`: funciones activables que no dependen del modo (Intrusión, Recepción de alarmas, Gestión de alarmas de central). Cubre su estado por defecto, su dependencia, lo que deja de pasar al apagarlas y cómo las respetan el menú, las alertas globales, las vistas de pared, las rutas y el receptor.
- `verificacion-video-alarmas`: de qué cámaras se arma la verificación de un evento de central (zona → área → abonado; equipos y canales de NVR), y cómo se ven en vivo y en la grabación del momento, en el panel y en la pared.
- `procedimientos-alarmas`: procedimientos de actuación por clase de evento con respaldo por prioridad, pasos obligatorios, tratamiento condicionado y registro de cada paso.
- `monitor-alarmas`: la vista de pared `/monitor/alarmas` (alarma al frente, video, cola, lo que llega, centrales), con la grabación y el avance del procedimiento.

### Modified Capabilities

(Ninguna en `openspec/specs/`: no hay specs archivadas. Este cambio se apoya en dos cambios en curso: `alarm-hub-sia-dc09`, que define «Zonas de la central» con cámaras asociadas, y `centro-de-monitoreo`, que planea el clip automático del caso y las directivas por cuenta. Este cambio **toma** la verificación por video en vivo y en grabación a pedido; el clip automático guardado con el caso y las directivas siguen en `centro-de-monitoreo`.)

## Impact

- **Base**: migración aditiva.
  - `CentralAlarma.camaras String[]`: las cámaras del abonado.
  - `ZonaCentral.camaras` pasa a aceptar canales de NVR con la clave `nvrch-<nvr>-<ch>` (la misma del Monitor CCTV), además de ids de equipo.
  - Ajustes nuevos en `Setting`: `FUNC_INTRUSION`, `FUNC_ALARMAS_RECEPCION`, `FUNC_ALARMAS_GESTION`, `CENTRALES_PROCEDIMIENTOS` (por clase). `CENTRALES_PROCEDIMIENTO` (por prioridad) se mantiene como respaldo.
- **Código**:
  - `lib/funciones.ts`: funciones sin módulo, con la clave `alcance: "instalacion"`.
  - `actions/funciones.ts`, `funciones-cliente.ts`, `ModosSection.tsx`.
  - `admin/layout.tsx`: menú y alertas globales.
  - `lib/monitor/vistas.ts`: el catálogo filtra por función.
  - `alarm-receiver.js`: deja de escuchar con la recepción apagada y no crea alarmas con la gestión apagada.
  - `lib/centrales/tratamiento.ts` y `tratamiento-tipos.ts`: procedimientos por clase y pasos obligatorios.
  - `lib/centrales/camaras.ts` (nuevo): resolución zona → área → abonado.
  - `CajonCentral.tsx`: cámaras del abonado y de dónde salen las de cada zona.
  - `FichaEventoCentral.tsx`: vivo y grabación.
  - `VistaAlarmas.tsx` y `/api/monitor/centrales`.
  - `PrioridadesCentralesSection.tsx`: editor de procedimientos por clase.
- **PM2**: reiniciar `alarm-receiver` y `omniaccess-web`. `server.js` no se toca: los eventos de cámara siguen guardándose con Intrusión apagada; lo que se apaga es mostrarlos y avisarlos.
- **Compatibilidad**: al desplegar, las funciones quedan como se comporta hoy cada instalación.
  - Intrusión prendida.
  - Recepción y Gestión prendidas si hay al menos una central dada de alta; apagadas si no hay ninguna.
  - Los procedimientos por prioridad guardados siguen valiendo para las clases sin lista propia.
- **Producción**: todo en el lab hasta que Nico diga «pasar a San Nicolás».
