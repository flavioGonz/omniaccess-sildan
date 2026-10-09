# Spec Delta

## Purpose

Un detector de objetos propio, corriendo en el servidor del barrio, que mira un cuadro y dice qué hay y dónde, para que los demás módulos de OmniAccess (intrusión, LPR, Face, Filas, búsqueda) lo usen sin depender de la analítica de cada cámara.

## ADDED Requirements

### Requirement: Detectar objetos en un cuadro
El sistema SHALL detectar objetos en una imagen y devolver, por cada uno, su clase, su confianza (0 a 1) y su caja en coordenadas normalizadas (0 a 1) respecto del cuadro. Las clases mínimas son persona, auto, camioneta, camión, ómnibus, moto, bicicleta, perro, gato, mochila, bolso y valija.

#### Scenario: Cuadro con una persona
- **WHEN** se le da un cuadro donde hay una persona caminando
- **THEN** la respuesta incluye un objeto de clase persona con su caja y su confianza

#### Scenario: Cuadro sin nada
- **WHEN** se le da un cuadro de una calle vacía
- **THEN** la respuesta es una lista vacía y no un error

### Requirement: Contrato independiente del modelo
El sistema SHALL exponer el mismo contrato de detección sea cual sea el modelo cargado, y SHALL informar qué modelo, versión y licencia está usando.

#### Scenario: Cambio de modelo
- **WHEN** se reemplaza el modelo cargado por otro con el mismo contrato
- **THEN** los módulos que lo usan siguen funcionando sin cambios y Ajustes muestra el modelo nuevo

### Requirement: La lectura de matrículas tiene prioridad en la GPU
El sistema MUST NOT degradar la lectura de matrículas: con la GPU compartida, el detector SHALL ceder turno cuando omni-lpr tiene trabajo pendiente y SHALL respetar un presupuesto de inferencias por minuto configurable.

#### Scenario: Ráfaga de lecturas
- **WHEN** omni-lpr está procesando una ráfaga y el detector tiene cuadros en cola
- **THEN** el detector espera y la latencia de la lectura de matrículas no aumenta

#### Scenario: Presupuesto agotado
- **WHEN** se alcanzó el presupuesto de inferencias del minuto
- **THEN** los cuadros de muestreo se descartan con su cuenta, y los de verificación de una alarma se encolan primero

### Requirement: Activación por modo
El sistema SHALL permitir activar el detector por separado para Intrusión, LPR, Face, Filas y Búsqueda, y con el módulo apagado ninguna pantalla SHALL mostrar resultados del detector ni ofrecer funciones que dependan de él.

#### Scenario: Búsqueda apagada
- **WHEN** el detector está activo sólo para Intrusión
- **THEN** la pantalla de búsqueda no ofrece la fuente propia y lo dice

### Requirement: Estado visible y honesto
El sistema SHALL mostrar el estado del detector (activo, sin GPU, caído, sin modelo), su consumo de GPU y su cola, y cuando no responde las verificaciones SHALL quedar como "sin dato", nunca como confirmadas ni descartadas.

#### Scenario: Contenedor caído
- **WHEN** el contenedor del detector no responde
- **THEN** Salud lo marca en rojo y las detecciones nuevas quedan "sin dato del detector"
