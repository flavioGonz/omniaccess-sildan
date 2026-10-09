# Spec Delta

## Purpose

La segunda opinión del detector sobre cada detección de una cámara (cruce de línea, zona): si en ese instante y en ese lugar había de verdad una persona o un vehículo, para que el operador decida con más información y las falsas alarmas pesen menos.

## ADDED Requirements

### Requirement: Verificar cada detección de cámara
Para cada detección analítica nueva (cruce, intrusión, entrada o salida de zona) de una cámara con la verificación activa, el sistema SHALL analizar los cuadros de ese instante y dejar un veredicto: confirmada por el detector, no confirmada, o sin dato.

#### Scenario: Persona cruzando
- **WHEN** la cámara avisa un cruce de línea y el detector encuentra una persona sobre la línea en los cuadros de ese instante
- **THEN** la detección queda "confirmada por el detector" con la clase y la confianza

#### Scenario: Sombra
- **WHEN** la cámara avisa un cruce y el detector no encuentra persona, vehículo ni animal en el área
- **THEN** la detección queda "no confirmada por el detector"

#### Scenario: Sin cuadros
- **WHEN** no se pudo obtener ningún cuadro de ese instante
- **THEN** la detección queda "sin dato del detector"

### Requirement: Sólo cuenta lo que está en la línea o la zona
El veredicto SHALL considerar sólo los objetos cuya caja toca la línea o la zona configurada en la cámara; un objeto en otra parte del cuadro MUST NOT confirmar la detección.

#### Scenario: Auto estacionado
- **WHEN** hay un auto estacionado lejos de la línea y la cámara avisa un cruce
- **THEN** ese auto no confirma la detección

### Requirement: Animal es un veredicto propio
Cuando lo único que el detector encuentra en el área es un animal, el veredicto SHALL decirlo ("animal") en lugar de confirmar o no confirmar.

#### Scenario: Perro
- **WHEN** un perro cruza la línea
- **THEN** la detección queda marcada "animal" y la ficha lo muestra

### Requirement: El detector nunca decide la alarma
El sistema MUST NOT aceptar, descartar ni resolver una alarma por el veredicto del detector. La decisión sigue siendo de una persona.

#### Scenario: No confirmada sigue pendiente
- **WHEN** una detección queda "no confirmada por el detector"
- **THEN** sigue pendiente en el monitor hasta que alguien la acepte o la marque

### Requirement: Qué cambia según la regla
Cada regla de notificación de intrusión SHALL poder elegir qué hace con una detección no confirmada: avisar igual (por defecto), no mandar el aviso externo (WhatsApp/Telegram) dejando la alarma en pantalla, o esperar el veredicto hasta un tiempo máximo antes de avisar.

#### Scenario: Silenciar externos
- **WHEN** la regla está en "no avisar afuera si no confirma" y llega una detección no confirmada
- **THEN** no sale WhatsApp, la alarma aparece igual en el monitor y el despacho registra por qué no salió

#### Scenario: Espera con tope
- **WHEN** la regla espera el veredicto con un tope de 5 s y el detector no contestó a tiempo
- **THEN** el aviso sale igual, marcado "sin verificar"

### Requirement: Medir el aporte
El sistema SHALL registrar, por cámara, cuántas detecciones confirmó y cuántas no, y cómo las clasificó después el operador, para medir cuántas falsas alarmas habría evitado.

#### Scenario: Reporte por cámara
- **WHEN** se abre el resumen de verificación de una cámara
- **THEN** se ve la matriz detector (confirma/no) contra operador (real/falsa) del período
