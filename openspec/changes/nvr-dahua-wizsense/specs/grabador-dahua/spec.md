# Spec Delta

## Purpose

Integrar los NVR Dahua WizSense como grabadores de primera clase: alta por dominio, sus canales, vivo y playback aunque el cliente sólo publique HTTP, y su búsqueda con IA dentro de la misma pantalla de "buscar en el grabador" que usa Hikvision.

## ADDED Requirements

### Requirement: Alta de NVR Dahua por dominio

OmniAccess SHALL permitir dar de alta un NVR Dahua por IP o por nombre de dominio, con puerto HTTP y puerto RTSP separados, y SHALL validar el acceso con el login RPC2 del equipo.

#### Scenario: Alta por dominio
- **WHEN** se da de alta un NVR Dahua con `nicolas.dvrdns.org`, usuario y clave correctos
- **THEN** queda guardado, y el sistema lee modelo, firmware y nombres de canales

### Requirement: Vivo y playback sin RTSP publicado

Cuando el puerto RTSP del NVR no es alcanzable, OmniAccess SHALL mostrar el vivo por fotos periódicas del sub-stream (indicándolo) y SHALL reproducir lo grabado descargando el tramo por HTTP.

#### Scenario: Sólo HTTP
- **WHEN** el 554 está cerrado y se abre el vivo de un canal del NVR
- **THEN** se ve la imagen actualizándose por fotos con el aviso "vista por fotos"

#### Scenario: Playback por HTTP
- **WHEN** se pide el video de un evento de las 10:15 en un canal del NVR sin RTSP
- **THEN** se descarga ese tramo por HTTP y se reproduce como MP4

### Requirement: Búsqueda IA del grabador Dahua

OmniAccess SHALL buscar personas y vehículos en lo grabado por el NVR Dahua usando su propia IA, y SHALL devolver los resultados en el mismo formato que los demás grabadores. Una búsqueda por texto SHALL traducirse a filtros (objeto, atributos, canales, rango) antes de enviarse al NVR.

#### Scenario: Por atributos
- **WHEN** se busca "persona" en el canal "ALERO CARGA FRENTE" en las últimas 6 horas
- **THEN** aparecen hallazgos con canal, momento, foto, recorte y caja

#### Scenario: Por texto
- **WHEN** se busca "camioneta blanca ayer a la tarde"
- **THEN** se envía al NVR vehículo + color blanco + rango de ayer 12–20 h y se muestran sus hallazgos

#### Scenario: Equipo sin la función
- **WHEN** el firmware no acepta la búsqueda o no tiene canales con IA
- **THEN** el grabador figura sin búsqueda y el resto de la integración sigue andando
