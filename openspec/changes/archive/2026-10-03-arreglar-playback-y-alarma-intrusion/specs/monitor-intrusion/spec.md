# Spec Delta

## Purpose

Define el comportamiento del monitor de intrusión al reproducir grabaciones del NVR, mostrar el
vivo sobre el playback y aceptar/clasificar alarmas, de forma consistente con la ficha de eventos.

## ADDED Requirements

### Requirement: Reproducción de grabaciones del NVR
El sistema DEBE reproducir la grabación de un canal del NVR en el navegador independientemente de
si el NVR graba en H.264 o H.265/HEVC, y en NVR Hikvision y Dahua.

#### Scenario: NVR que graba en HEVC
- **WHEN** el guardia abre el playback de un canal cuya grabación es HEVC
- **THEN** el video se reproduce (no queda en póster ni en "Sin grabación")

#### Scenario: Sin grabación en ese horario
- **WHEN** no hay grabación para el instante elegido
- **THEN** el sistema muestra "Sin grabación en este horario" en vez de quedar cargando

### Requirement: Ventana de vivo sobre el playback
La mini-ventana de vivo superpuesta al playback DEBE poder cerrarse y volver a mostrarse.

#### Scenario: Cerrar la mini-ventana
- **WHEN** el guardia toca el cierre de la mini-ventana de vivo
- **THEN** la mini-ventana desaparece y el playback queda sin obstrucción

### Requirement: Aceptación de alarma desde la ficha del evento
Aceptar una alarma DEBE abrir la misma ficha de evento que el listado de detecciones del sidebar,
y permitir clasificarla como real o falsa desde esa ficha.

#### Scenario: Aceptar desde el overlay del canal
- **WHEN** el guardia toca "Aceptar alarma" en el overlay de un canal en alarma
- **THEN** se abre la ficha del evento (misma que el sidebar) con los botones Confirmar real / Falsa alarma

#### Scenario: Clasificación registrada
- **WHEN** el guardia elige Confirmar real o Falsa alarma en la ficha
- **THEN** la alarma se resuelve con esa clasificación y el overlay del canal se limpia
