# Spec Delta

## Purpose

La vista de pared `/monitor/alarmas`: muestra en una pantalla del centro de monitoreo las alarmas de las centrales para verificarlas con video. Pone al frente la más urgente, la recibe al instante y no permite decidir nada desde la pared.

## ADDED Requirements

### Requirement: La alarma al frente
La vista SHALL poner al frente la alarma de central sin tratar más urgente: menor prioridad numérica y, entre iguales, la más nueva. Para esa alarma SHALL mostrar:

- su prioridad, con su color;
- qué pasó, la zona, el abonado y el área;
- un reloj que cuenta desde el evento;
- quién la tiene, o que nadie la tomó.

#### Scenario: Llega un P1 mientras se mira un P2
- **WHEN** al frente hay un Sabotaje P2 y llega un Robo P1
- **THEN** el Robo pasa al frente con un destello de su color y el Sabotaje vuelve a la cola

### Requirement: Lo que acompaña a la alarma al frente
La alarma al frente SHALL mostrar la escena animada de su clase de evento, la verificación por video (`verificacion-video-alarmas`) y el avance de su procedimiento (`procedimientos-alarmas`).

#### Scenario: Robo con cámaras
- **WHEN** al frente hay un Robo de una zona con cámaras
- **THEN** se ven la escena de robo, las cámaras en vivo y los pasos del procedimiento con su estado

### Requirement: Elegir otra alarma
Tocar una alarma de la cola SHALL traerla al frente durante un minuto; después SHALL volver el orden por prioridad.

#### Scenario: Mirar una de la cola
- **WHEN** alguien toca en la cola un Pánico P1 que no está al frente
- **THEN** el Pánico pasa al frente y, al minuto sin tocar, vuelve el orden por prioridad

### Requirement: Recepción inmediata
Una alarma nueva SHALL aparecer al frente y empezar su video en vivo en menos de 2 s desde que la central la manda al receptor, sin esperar la consulta periódica. La consulta periódica, cada 10 s como máximo, SHALL completar los datos y SHALL sacar de la vista las alarmas que se trataron en el panel, aunque se haya perdido un aviso en tiempo real.

#### Scenario: Aviso en tiempo real
- **WHEN** el receptor recibe un Robo de la zona 3, que tiene dos cámaras
- **THEN** en menos de 2 s la pared muestra el Robo al frente con los dos videos arrancando

#### Scenario: Tratada en el panel con la pared sin conexión en vivo
- **WHEN** la pared perdió la conexión en tiempo real y un operador trata la alarma al frente
- **THEN** la pared la saca en la siguiente consulta, en 10 s como máximo

### Requirement: Cola de espera
Junto a la alarma al frente, la vista SHALL mostrar las otras alarmas sin tratar, cada una con su prioridad, su reloj y quién la tiene.

#### Scenario: Dos alarmas más
- **WHEN** hay tres alarmas sin tratar
- **THEN** la más urgente está al frente y las otras dos en la cola, con su prioridad y su reloj

### Requirement: Lo que llega de las centrales
La vista SHALL mostrar lo último que llegó de las centrales, evento por evento, sin la supervisión periódica.

#### Scenario: Desarmado
- **WHEN** una central manda un desarmado
- **THEN** aparece arriba de lo que llega, con la central, la partición y la hora

### Requirement: Estado de las centrales y calma
En la base, una tira SHALL mostrar cada central con:

- si reporta o no tiene supervisión;
- su último armado o desarmado, con la partición y hace cuánto;
- cuántas alarmas tiene abiertas.

Sin alarmas pendientes, la vista SHALL mostrar un estado de calma con cuántas centrales reportan y los números del día (alarmas, tratadas, falsas).

#### Scenario: Central sin supervisión
- **WHEN** una central pasa dos períodos sin reportar
- **THEN** su tarjeta en la tira dice «Sin supervisión» en rojo, con hace cuánto habló por última vez

### Requirement: Sonido
La vista SHALL tener tres modos de sonido, que se eligen en Monitores:

- un tono por cada alarma nueva, fuerte si es P1 o P2;
- repetir mientras haya una P1 o P2 que nadie tomó;
- sin sonido.

El modo por defecto SHALL ser un tono por alarma.

#### Scenario: Repetir hasta que se tome
- **WHEN** el modo es «repetir» y hay un Robo P1 que nadie tomó
- **THEN** la pared suena cada 8 s hasta que alguien lo toma en el panel

### Requirement: Sólo mirar
La vista MUST NOT permitir tomar, pasar, tratar, escalar ni tildar pasos, ni con sesión del panel ni con enlace de pantalla. Las decisiones SHALL tomarse en la ficha del evento del panel.

#### Scenario: Tocar la alarma al frente
- **WHEN** alguien toca la alarma al frente en la pared
- **THEN** sólo se agranda el video o se abre la grabación del momento; no aparece ningún botón de decisión

### Requirement: Disponible según la función
La vista SHALL ofrecerse en Monitores y en la rotación sólo con la función Gestión de alarmas de central prendida (`funciones-instalacion`). Una rotación que la incluye SHALL quedarse en ella mientras haya una alarma P1 o P2 sin tratar.

#### Scenario: Rotación con alarma crítica
- **WHEN** la rotación alterna Mapa, Resumen y Alarmas, y llega un Pánico P1
- **THEN** la rotación se detiene en Alarmas hasta que el Pánico se trata
