# Spec Delta

## Purpose
La vista Mapa es el plano del barrio en la pared: dónde están las cámaras, qué vehículos se mueven, cuáles están detenidos y dónde hay una alarma.

## ADDED Requirements

### Requirement: Mapa a pantalla completa
La vista SHALL mostrar el mapa del barrio ocupando toda la pantalla debajo del encabezado, con el encuadre guardado para el barrio (sin controles de edición, sin buscador, sin paneles laterales del panel), y con los controles de zoom ocultos junto con el cursor.

#### Scenario: Encuadre
- **WHEN** se abre la vista
- **THEN** el mapa arranca en el encuadre del barrio y no en el último que dejó un operador en el panel

### Requirement: Vehículos y estacionados
La vista SHALL mostrar los vehículos en seguimiento moviéndose entre cámaras y los estacionados con su cronómetro, con la misma semántica de color que el panel.

#### Scenario: Vehículo visto en dos cámaras
- **WHEN** una matrícula se lee en una cámara interior y luego en otra
- **THEN** su marcador se desplaza de una a otra en el mapa

### Requirement: Alarma sobre la cámara
Cuando una cámara de intrusión tiene una alarma pendiente o confirmada, su marcador en el mapa SHALL titilar en rojo con un halo, y la tarjeta al pie SHALL mostrar la foto y el tipo de esa alarma hasta que se resuelva.

#### Scenario: Dos alarmas
- **WHEN** hay alarmas en dos cámaras
- **THEN** ambas titilan y la tarjeta al pie muestra la más reciente con "+1 más"

### Requirement: Tarjeta del último evento
La vista SHALL mostrar al pie una tarjeta con el último evento del barrio (acceso o detección): foto, qué, dónde, hora, que se reemplaza al llegar uno nuevo.

#### Scenario: Sin eventos recientes
- **WHEN** no hubo eventos en la última hora
- **THEN** la tarjeta dice "Sin movimiento desde las HH:MM" en vez de quedar vacía
