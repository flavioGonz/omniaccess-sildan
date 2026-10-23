# Spec Delta

## Purpose

Que cada evento de central se atienda con el procedimiento de actuación que le corresponde a su clase (robo, pánico, incendio…). Cada paso queda marcado con quién y cuándo, y un evento no se da por tratado salteando lo obligatorio sin decir por qué.

## ADDED Requirements

### Requirement: Procedimiento por clase de evento
Cada clase de evento de central (Robo, Pánico, Coacción, Incendio, Emergencia médica, Sabotaje, Alarmas técnicas, Fallos del sistema) SHALL poder tener su propio procedimiento: una lista ordenada de hasta 12 pasos. Un evento SHALL usar el procedimiento de su clase. Si su clase no tiene uno, SHALL usar el procedimiento de su prioridad, el de hoy, que se mantiene como respaldo. La ficha SHALL decir de dónde sale el procedimiento («Procedimiento de Incendio» o «Procedimiento de prioridad 1»).

#### Scenario: Incendio con procedimiento propio
- **WHEN** llega un Incendio P1 y la clase Incendio tiene «Llamar a bomberos (104)» como primer paso
- **THEN** la ficha muestra el procedimiento de Incendio, no el de prioridad 1

#### Scenario: Clase sin procedimiento
- **WHEN** llega un Sabotaje y la clase Sabotaje no tiene procedimiento
- **THEN** la ficha muestra el procedimiento de su prioridad y lo dice

### Requirement: Pasos obligatorios
Cada paso SHALL poder marcarse **obligatorio**. TRATAR un evento SHALL exigir que cada paso obligatorio esté tildado o salteado con un motivo escrito (al menos 4 letras). Mientras falte alguno, el botón TRATAR SHALL explicar qué falta. El control SHALL hacerlo el servidor; la pantalla sólo informa.

#### Scenario: Tratar sin mirar las cámaras
- **WHEN** «Mirar las cámaras de la zona» es obligatorio, no está tildado, y el operador intenta tratar el evento
- **THEN** el servidor rechaza el tratamiento y la ficha indica que falta ese paso o el motivo para saltearlo

#### Scenario: Saltear con motivo
- **WHEN** el operador saltea «Llamar al titular» con el motivo «El titular está en el lugar con la guardia»
- **THEN** el paso queda como salteado con ese motivo, su nombre y la hora, y el evento puede tratarse

### Requirement: Registro de cada paso
Tildar, destildar o saltear un paso SHALL quedar en la bitácora del evento con quién, a qué hora y, si se salteó, el motivo. Sólo quien tiene el evento tomado SHALL poder hacerlo (regla de exclusividad vigente). La ficha SHALL mostrar cada paso con su estado (pendiente, hecho o salteado), quién y hace cuánto.

#### Scenario: Auditoría de un evento tratado
- **WHEN** un supervisor abre un Robo ya tratado
- **THEN** ve cada paso con quién lo hizo y a qué hora, cuáles se saltearon y por qué, y el cierre con su texto

### Requirement: Edición de procedimientos
En Ajustes → Centrales de alarma → Procedimiento, un administrador SHALL poder:

- editar el procedimiento de cada clase y el de cada prioridad;
- ordenar los pasos y marcar cuáles son obligatorios;
- volver una clase a «usar el de su prioridad».

Los cambios SHALL valer para los eventos que se abran después. Un evento abierto antes SHALL conservar el procedimiento con que se abrió, para que la auditoría coincida con lo que vio el operador.

#### Scenario: Cambiar el procedimiento con un evento abierto
- **WHEN** se agrega un paso al procedimiento de Robo mientras hay un Robo sin tratar
- **THEN** ese Robo sigue mostrando el procedimiento con que se abrió, y el próximo Robo trae el paso nuevo

### Requirement: Avance visible en la pared
La vista de pared Alarmas SHALL mostrar, para la alarma al frente, el avance del procedimiento: pasos hechos sobre el total, cuáles faltan y quién la tiene. La pared MUST NOT poder tildar ni saltear pasos.

#### Scenario: Supervisor mirando la pared
- **WHEN** el operador tilda «Llamar a la policía (911)» en su puesto
- **THEN** en menos de 2 s la pared muestra ese paso como hecho, con su nombre
