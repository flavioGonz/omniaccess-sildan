# Spec Delta

## ADDED Requirements

### Requirement: La ficha muestra la verificación del detector
La ficha de una detección SHALL mostrar el veredicto del detector (confirmada, no confirmada, animal, sin dato) y, sobre la captura, las cajas de los objetos que encontró en el área, con su clase y confianza.

#### Scenario: Ficha con cajas
- **WHEN** se abre la ficha de una detección confirmada por el detector
- **THEN** la captura muestra la caja de la persona encontrada y el rótulo "confirmada por el detector · persona 91 %"

### Requirement: Filtrar por veredicto del detector
La lista de detecciones del monitor SHALL poder filtrarse por veredicto del detector, y cada renglón SHALL mostrar el suyo.

#### Scenario: Sólo confirmadas
- **WHEN** el operador filtra "confirmadas por el detector"
- **THEN** la lista deja afuera las no confirmadas y las sin dato
