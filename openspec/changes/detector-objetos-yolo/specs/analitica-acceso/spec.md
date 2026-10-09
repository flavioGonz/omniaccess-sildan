# Spec Delta

## Purpose

Lo que el detector de objetos agrega a los modos de acceso que ya existen (LPR, Face, Filas): ver lo que las cámaras de acceso no reportan, sin cambiar cómo se decide quién entra.

## ADDED Requirements

### Requirement: Tipo y color del vehículo
Cuando la lectora no informa tipo o color, el sistema SHALL completarlos con el detector en la lectura, marcados como estimados.

#### Scenario: Lectura sin tipo
- **WHEN** llega una lectura con tipo "unknown"
- **THEN** la lectura muestra el tipo estimado por el detector, rotulado como estimado

### Requirement: Motos que no se leen
El sistema SHALL contar las motos que pasan frente a las cámaras de acceso aunque ninguna lectora las lea.

#### Scenario: Moto sin parar
- **WHEN** una moto pasa por la entrada sin detenerse
- **THEN** cuenta en "motos hoy" del monitor aunque no haya lectura

### Requirement: Vehículo sin lectura
Cuando el detector ve pasar un vehículo por una cámara de acceso y ninguna lectora produce una lectura en ese margen, el sistema SHALL registrar un "vehículo sin lectura" con su recorte.

#### Scenario: De noche sin leer
- **WHEN** entra un auto de noche y la lectora de entrada no lo lee
- **THEN** queda un "vehículo sin lectura" en el monitor LPR con la foto

### Requirement: Dos vehículos con una lectura
El sistema SHALL marcar "posible colado" cuando en una misma pasada el detector ve dos vehículos y hubo una sola lectura.

#### Scenario: Pegado atrás
- **WHEN** un auto entra pegado a otro que fue leído
- **THEN** la lectura queda marcada "posible colado" con el recorte del segundo vehículo

### Requirement: Personas en el acceso peatonal
En las cámaras de Face, el sistema SHALL contar las personas presentes en el momento de cada reconocimiento y marcar "acompañado" cuando hay más de una.

#### Scenario: Entra con alguien
- **WHEN** un residente es reconocido y detrás pasa otra persona
- **THEN** el evento queda marcado "acompañado · 2 personas"

### Requirement: Conteo de fila por zona
Para cámaras sin analítica de filas, el sistema SHALL contar personas dentro de una zona dibujada y alimentar el módulo de Filas con ese número.

#### Scenario: Cámara común en la caja
- **WHEN** hay 5 personas en la zona dibujada de una cámara sin analítica
- **THEN** el módulo de Filas muestra 5 para esa fila

### Requirement: La decisión de acceso no cambia
Nada de lo que agregue el detector SHALL cambiar si una barrera se abre o una persona es admitida; son datos para el operador.

#### Scenario: Colado no cierra
- **WHEN** se marca "posible colado"
- **THEN** la barrera se comporta igual que sin detector
