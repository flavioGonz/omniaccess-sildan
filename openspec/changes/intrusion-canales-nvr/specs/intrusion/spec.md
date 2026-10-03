# intrusion

Detección de cruce de línea y de zona (intrusión) sobre las cámaras del barrio: configuración
de la regla en el equipo, recepción del evento, atribución a la cámara correcta y presentación
en un único monitor.

## ADDED Requirements

### Requirement: One intrusion pipeline
The system SHALL have exactly one intrusion pipeline: line/zone events are persisted as
`Detection`, emitted as `general_detection`, and shown in `/admin/monitor-intrusion`. There
SHALL NOT be a second handler that intercepts the same events into another table.

#### Scenario: Cruce de línea Hikvision
- **WHEN** una cámara o NVR Hikvision envía un evento `linedetection` o `fielddetection`
- **THEN** se crea una fila `Detection` con la cámara correcta, el monitor la muestra en vivo y
  no se crea nada en otra tabla.

### Requirement: Events from an NVR are attributed to the channel's camera
When an intrusion event is sent by an NVR, the system SHALL resolve the originating channel
(`channelID`/`dynChannelID`) to the mapped `CAMERA` device via `NVR_CHANNEL_MAP`, and SHALL
attribute the detection to that camera, never to the NVR itself.

#### Scenario: Evento desde el NVR 2
- **WHEN** el NVR 2 reporta un cruce de línea en su canal 7
- **THEN** la detección queda asociada a la cámara mapeada al canal 7 del NVR 2, con su nombre y
  su captura.

#### Scenario: Canal sin mapear
- **WHEN** llega un evento de un canal que no está en el mapa
- **THEN** el sistema lo registra como "canal sin mapear" del NVR (no lo descarta en silencio) y
  lo señala en el monitor.

### Requirement: Rule geometry can be read and written through the NVR, per channel
For a Hikvision camera reached through an NVR, the system SHALL read and write the line/zone
rule on the NVR for that channel (`/ISAPI/Smart/LineDetection/<ch>`,
`/ISAPI/Smart/FieldDetection/<ch>`), and the calibrator SHALL send the channel. For a camera
reached directly it keeps using the camera's own IP.

#### Scenario: Calibrar una perimetral por el NVR
- **WHEN** el operador dibuja una línea en el calibrador de una cámara mapeada al NVR 2 canal 7
- **THEN** la regla se escribe en el NVR 2, canal 7, y al releerla coincide con lo dibujado.

### Requirement: Detection target is human by default
When writing a line/zone rule for intrusion, the system SHALL set the detection target to
`human` (the setting San Nicolás already used), so vehicles passing do not raise intrusion.

#### Scenario: Auto que cruza la línea
- **WHEN** un vehículo cruza una línea de intrusión configurada por el sistema
- **THEN** no se genera una detección de intrusión.

### Requirement: Alarm host is configured on the NVR and verifiable
The system SHALL configure the NVR's HTTP alarm host to OmniAccess (`EVENT_HOST_IP`,
`EVENT_HOST_PORT`, `EVENT_HOST_PATH` from Settings), SHALL be able to send a test notification,
and the monitor SHALL show whether each camera's source has the alarm host configured.

#### Scenario: Configurar el NVR 2
- **WHEN** el operador pulsa "Configurar alarma" para el NVR 2
- **THEN** el NVR 2 queda con un httpHost hacia OmniAccess, la prueba llega al webhook y el
  monitor marca sus cámaras como "alarma OK".

### Requirement: Monitor shows NVR-backed cameras with their rules
`/admin/monitor-intrusion` SHALL show every `CAMERA` device, draw its current line/zone rule
on the tile, and SHALL indicate NVR and channel for NVR-backed cameras.

#### Scenario: Muro con las perimetrales
- **WHEN** se importaron las perimetrales del NVR 2
- **THEN** el monitor muestra un tile por cámara con "NVR 2 · ch N", su regla dibujada y el
  vivo.
