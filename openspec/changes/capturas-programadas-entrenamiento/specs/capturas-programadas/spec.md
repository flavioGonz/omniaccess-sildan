# Spec Delta

## Purpose

Que el conjunto de fotos para entrenar el detector propio se pueda juntar solo desde las cámaras, cada cierto tiempo, con variedad real de horas y de luz, sin llenarse de cuadros repetidos y sin que nadie tenga que estar frente a la pantalla.

## ADDED Requirements

### Requirement: Programar capturas de cámaras
Quien puede cambiar el conjunto de entrenamiento SHALL poder crear una programación de capturas indicando: una o más cámaras (equipos o canales de grabador), cada cuánto se toma una foto (entre 5 minutos y 24 horas), una franja horaria opcional, un tope de fotos y una fecha de fin. El sistema SHALL proponer por defecto cada 30 minutos, sin franja, 200 fotos y 7 días. SHALL poder haber varias programaciones a la vez.

#### Scenario: Crear una programación con los valores propuestos
- **WHEN** se eligen dos cámaras y se guarda sin tocar nada más
- **THEN** queda una programación activa que toma una foto de cada cámara cada 30 minutos, hasta 200 fotos o 7 días, lo que ocurra primero

#### Scenario: Intervalo fuera de rango
- **WHEN** se intenta guardar un intervalo menor a 5 minutos o mayor a 24 horas
- **THEN** el sistema no guarda y dice cuál es el rango permitido

#### Scenario: Sin permiso
- **WHEN** alguien que sólo puede mirar el conjunto intenta crear, editar, pausar o borrar una programación
- **THEN** el sistema lo rechaza y la programación no cambia

### Requirement: Las fotos programadas entran al conjunto como fotos de cámara
Cada foto tomada por una programación SHALL guardarse en el conjunto sin dibujar, con el mismo cuadro y la misma resolución que «Sacar foto ahora» para esa cámara, con su cámara de origen, y SHALL quedar identificada como tomada por esa programación. SHALL contar como foto de cámara en la mezcla del conjunto.

#### Scenario: Una vuelta normal
- **WHEN** llega la hora de una programación activa con dos cámaras que dan imagen
- **THEN** aparecen hasta dos fotos nuevas en «Sin dibujar», cada una con el nombre de su cámara y la marca de programada

#### Scenario: Fuera de la franja horaria
- **WHEN** una programación tiene franja de 20:00 a 06:00 y son las 14:00, hora de Uruguay
- **THEN** no se toma ninguna foto y la programación muestra cuándo es la próxima

### Requirement: No se guardan escenas repetidas
El sistema SHALL comparar cada cuadro con la última foto guardada de esa misma cámara por esa programación y, si la escena no cambió, SHALL saltearlo sin guardarlo y contarlo como salteado. Un cambio de iluminación entre día y noche SHALL contar como cambio.

#### Scenario: Escena quieta
- **WHEN** una cámara muestra la misma escena, sin nada nuevo, en dos vueltas seguidas
- **THEN** la segunda no agrega foto y el contador de salteadas de la programación sube en uno

#### Scenario: Algo cambió
- **WHEN** entre dos vueltas aparece o se va un vehículo, una persona o un objeto de tamaño apreciable, o la cámara pasó a visión nocturna
- **THEN** la segunda vuelta guarda la foto

### Requirement: Las programaciones se frenan solas
Una programación SHALL terminar al alcanzar su tope de fotos guardadas o su fecha de fin, y SHALL quedar visible como terminada, con el motivo. Mientras la cantidad de fotos sin dibujar del conjunto supere el máximo de la cola (500), todas las programaciones SHALL esperar sin tomar fotos y SHALL reanudar solas cuando la cola baje. El sistema SHALL NOT borrar fotos por su cuenta para hacer lugar.

#### Scenario: Llega al tope
- **WHEN** una programación con tope 200 guarda su foto número 200
- **THEN** deja de tomar fotos y se muestra «Terminó: llegó a 200 fotos»

#### Scenario: La cola está llena
- **WHEN** hay más de 500 fotos sin dibujar y llega la hora de una programación
- **THEN** no se toma ninguna foto y la programación muestra que está esperando a que se dibujen o descarten fotos

#### Scenario: La cola baja
- **WHEN** se dibujan o descartan fotos y quedan menos de 500 sin dibujar
- **THEN** la programación vuelve a tomar fotos en su próxima vuelta, sin que nadie la reanude

### Requirement: Una cámara que no da imagen no frena a las demás
Si una cámara no entrega cuadro, el sistema SHALL registrar el fallo con su motivo para esa cámara, SHALL seguir con las demás cámaras de la programación y SHALL volver a intentar en la próxima vuelta. SHALL NOT guardar una foto vacía, rota o de otra cámara en su lugar.

#### Scenario: Una de tres no responde
- **WHEN** una programación tiene tres cámaras y una no entrega cuadro
- **THEN** se guardan las fotos de las otras dos y la programación muestra esa cámara como sin imagen, con el motivo y desde cuándo

### Requirement: Estado y control de cada programación
La pantalla SHALL mostrar, por programación: si está activa, en pausa, esperando o terminada; cuándo es la próxima vuelta; cuántas fotos guardó y cuántas salteó por repetidas; y las cámaras que no están dando imagen. Quien puede cambiar el conjunto SHALL poder pausar, reanudar, editar, borrar y pedir una vuelta inmediata. Si el proceso que toma las fotos no está corriendo, la pantalla SHALL decirlo en lugar de mostrar una próxima vuelta que no va a ocurrir.

#### Scenario: Pedir una vuelta ya
- **WHEN** se toca «Tomar ahora» en una programación activa
- **THEN** en menos de dos minutos se intenta una foto por cámara, con las mismas reglas de repetidas y de topes

#### Scenario: Pausar y reanudar
- **WHEN** se pausa una programación y más tarde se reanuda
- **THEN** mientras está en pausa no toma fotos, y al reanudar conserva sus contadores, su tope y su fecha de fin

#### Scenario: El proceso de visión está caído
- **WHEN** hay programaciones activas y el proceso que las ejecuta no reporta actividad
- **THEN** la pantalla avisa que las capturas no se están tomando

### Requirement: Descartar las fotos sin dibujar de una programación
Quien puede cambiar el conjunto SHALL poder descartar, en un solo paso y con confirmación que diga cuántas son, las fotos sin dibujar que tomó una programación. Las fotos ya dibujadas o marcadas «No hay ninguno» SHALL NOT descartarse por esta vía. Borrar una programación SHALL NOT borrar sus fotos.

#### Scenario: Descartar lo pendiente
- **WHEN** una programación tomó 80 fotos, 30 ya se dibujaron, y se confirma «Descartar las 50 sin dibujar»
- **THEN** se quitan esas 50 del conjunto y las 30 dibujadas siguen

#### Scenario: Borrar la programación
- **WHEN** se borra una programación que tomó fotos
- **THEN** sus fotos siguen en el conjunto, en el estado en que estaban
