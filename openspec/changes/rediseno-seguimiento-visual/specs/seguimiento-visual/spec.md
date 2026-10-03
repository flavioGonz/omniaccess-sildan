# Spec Delta

## Purpose

Define cómo un operador sigue a una persona entre cámaras desde el visor en vivo: marcadores de
paso, preview al hover y salto que conserva la cámara de origen en mini.

## ADDED Requirements

### Requirement: Marcador de paso solo ícono
En el visor en vivo, cada cámara enlazada DEBE mostrarse como un marcador de solo ícono ubicado en
el punto de paso de la escena, sin el texto del nombre.

#### Scenario: Ver los marcadores
- **WHEN** el operador mira una cámara con enlaces de seguimiento
- **THEN** ve un ícono por cada cámara destino en su punto, sin etiquetas de texto

### Requirement: Preview al pasar el mouse
Al pasar el mouse por un marcador, el sistema DEBE mostrar una vista previa en vivo de la cámara
destino junto con su nombre.

#### Scenario: Hover sobre un marcador
- **WHEN** el operador pasa el mouse sobre un marcador
- **THEN** aparece un preview en vivo (mini) de esa cámara y su nombre

### Requirement: Saltar conservando la cámara de origen
Al hacer clic en un marcador, el visor principal DEBE pasar a la cámara destino y la cámara de
origen DEBE quedar como mini (PiP), desde la cual se pueda volver.

#### Scenario: Seguir a otra cámara
- **WHEN** el operador hace clic en un marcador
- **THEN** el visor principal muestra la cámara destino en vivo y la de origen queda en una mini

#### Scenario: Volver a la cámara de origen
- **WHEN** el operador toca la mini de la cámara de origen
- **THEN** el visor principal vuelve a esa cámara
