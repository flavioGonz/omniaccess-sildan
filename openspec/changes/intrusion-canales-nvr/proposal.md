# Intrusión con cámaras de canales de NVR (como Olivos), una sola pila

## Why

El monitor de intrusión está vacío en San Nicolás porque sólo muestra dispositivos tipo
`CAMERA` y en esta rama no existe forma de crearlos: en Olivos los 79 canales se cargaron a
mano en la base. Las cámaras perimetrales de San Nicolás **ya están** como canales del NVR 2
(16 canales, DS-7616NI-M2/16P) pero no son dispositivos de OmniAccess. Además conviven dos
pilas de intrusión que se pisan: la vieja de SN (`IntrusionEvent`) intercepta en `server.js`
todo cruce de línea Hikvision y nunca deja llegar nada a `Detection`, que es lo que lee el
monitor. Resultado: cero cámaras y cero eventos, con dos tablas vacías.

## What Changes

- **Importar canales de NVR como cámaras**: nueva acción de servidor + UI en Dispositivos para
  escanear un NVR (`/ISAPI/ContentMgmt/InputProxy/channels`), elegir canales y crearlos como
  `Device` tipo `CAMERA` con el mapeo `{nvr, ch}` en `NVR_CHANNEL_MAP` y el stream en go2rtc.
  `CAMERA` pasa a verse y poder elegirse en `/admin/devices`.
- **Una sola pila de intrusión, la de Olivos** (`monitor-intrusion` + `Detection` +
  `general_detection`). `server.js` deja de cortar en el handler viejo: los eventos de línea y
  zona de Hikvision crean `Detection`. **BREAKING interno**: se retira la pila vieja de SN
  (`IntrusionCalibrator`, `/api/intrusion/geometry`, `intrusion-handler`, alerta
  `intrusion_alert` en monitor-lpr). Se conserva lo bueno de SN: objetivo de detección `human`.
- **Hikvision a través del NVR**: cuando la cámara se alcanza por el NVR, geometría de
  línea/zona (`/ISAPI/Smart/{Line,Field}Detection/<ch>`), snapshot y alarm host se hacen contra
  el NVR por canal, con el mismo patrón que ya existe para Dahua; el calibrador envía `ch`.
- **Atribuir el evento al canal**: cuando el evento lo manda el NVR, se lee `channelID` /
  `dynChannelID` y se resuelve la cámara por `NVR_CHANNEL_MAP` (como hace `dahua-events.js`).
- **Alarm host del NVR** apuntando a OmniAccess (`EVENT_HOST_*` en Settings), configurable y
  verificable desde el monitor.
- **Driver por fabricante también para NVR/analíticas**: contrato `INvrDriver` (canales,
  snapshot por canal, playback) e `IAnalyticsDriver` (leer/escribir línea y zona, alarm host),
  con implementación Hikvision y Dahua, en vez de funciones sueltas en `src/lib/*`.

## Capabilities

### New Capabilities
- `nvr-camaras` — cámaras que viven como canales de un NVR: descubrimiento, alta como
  dispositivo, mapeo canal↔cámara y video a través del NVR.
- `intrusion` — detección de cruce de línea y zona: configuración de reglas por cámara/canal,
  recepción de eventos, atribución a la cámara y presentación en el monitor.

### Modified Capabilities
- (ninguna con spec previa)

## Impact

- Código: `src/app/actions/nvr.ts` (+acción de importación), `src/components/devices/
  CajonDispositivo.tsx` y `src/app/admin/devices/page.tsx` (UI y tipo `CAMERA`),
  `src/components/devices/tipos.ts`, `server.js` (despacho de analíticas), `src/lib/
  isapi-analytics.ts`, `src/lib/isapi-alarmhost.ts`, `src/app/api/devices/{analytics,
  alarm-host}/route.ts`, `src/app/actions/detections.ts`, `src/components/
  LineZoneCalibrator.tsx`, `src/lib/go2rtc-sync.ts`, nuevos `src/lib/drivers/INvrDriver.ts`,
  `IAnalyticsDriver.ts` e implementaciones. Se eliminan `handlers/intrusion-handler.js`,
  `src/components/IntrusionCalibrator.tsx`, `src/app/api/intrusion/geometry/route.ts`,
  `src/lib/isapi-smart-rules.ts` y el botón de intrusión en devices.
- Datos: nuevas filas `Device` tipo `CAMERA`; `NVR_CHANNEL_MAP` en formato `{ip: {nvr, ch}}`;
  Settings `EVENT_HOST_IP/PORT/PATH`. El modelo `IntrusionEvent` y las columnas
  `intrusionEnabled/intrusionGeometry` quedan sin uso (se retiran en una migración posterior,
  no en este cambio, para poder volver atrás).
- Infra: nada nuevo. NVR 1 (`.122`) no responde: hay que revisarlo en sitio; el cambio no
  depende de él.
- Fuera de alcance: Dahua (San Nicolás es todo Hikvision), seguimiento/franja, LPR.
