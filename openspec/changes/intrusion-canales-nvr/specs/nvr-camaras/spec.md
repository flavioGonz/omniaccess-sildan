# nvr-camaras

Cámaras que existen como canales de un NVR: cómo se descubren, se dan de alta como dispositivos
de OmniAccess, se mapean a su canal y se les sirve video a través del NVR.

## ADDED Requirements

### Requirement: Discover the channels of an NVR
The system SHALL list the IP channels of a registered NVR device (number, IP, name, online
state) using the NVR's own credentials, for the brands with an NVR driver (Hikvision, Dahua).

#### Scenario: Escanear un NVR Hikvision
- **WHEN** un administrador pide escanear el NVR 2 desde Dispositivos
- **THEN** el sistema devuelve sus 16 canales con IP y nombre, sin exponer la clave del NVR.

#### Scenario: NVR que no responde
- **WHEN** el NVR no contesta por HTTP
- **THEN** el sistema informa "no responde" con la IP consultada, y no crea nada.

### Requirement: Import NVR channels as CAMERA devices
The system SHALL let an administrator select channels of a scanned NVR and create one `Device`
of type `CAMERA` per selected channel, with brand inherited from the NVR, and SHALL record the
channel mapping `{nvr: <nvrDeviceId>, ch: <n>}` for that camera IP in `NVR_CHANNEL_MAP`.

#### Scenario: Importar varios canales
- **WHEN** el administrador selecciona 12 canales del NVR 2 y confirma
- **THEN** existen 12 dispositivos `CAMERA` nuevos, cada uno mapeado a su NVR y canal, y
  aparecen en la lista de Dispositivos y en el monitor de intrusión.

#### Scenario: Canal ya importado
- **WHEN** se vuelve a importar un canal cuya IP ya es un dispositivo
- **THEN** el sistema no lo duplica: actualiza el mapeo y lo informa.

### Requirement: CAMERA is a first-class device type in the UI
The devices screen SHALL list, filter and edit devices of type `CAMERA` like any other type.

#### Scenario: Ver cámaras importadas
- **WHEN** el administrador abre Dispositivos
- **THEN** las cámaras `CAMERA` se ven, se pueden filtrar por tipo y editar su nombre.

### Requirement: Video for NVR-backed cameras goes through the NVR
For a `CAMERA` mapped to an NVR channel, the system SHALL register its live streams in go2rtc
using the NVR's RTSP for that channel (HD always via NVR; SD direct to the camera only if the
camera's RTSP port answers), so live view works even when the camera is not reachable directly.

#### Scenario: Cámara sólo alcanzable por el NVR
- **WHEN** la cámara no responde en RTSP pero su canal está en el NVR
- **THEN** el vivo SD y HD se sirven desde el NVR y el monitor la muestra en vivo.
