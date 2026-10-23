# Spec Delta

## Purpose

Verificar con video cada evento de una central de alarma. Define qué cámaras se usan (las de la zona, las de su área o las del abonado), y cómo se ven en vivo y en la grabación del momento, en el panel y en la pared.

## ADDED Requirements

### Requirement: Cámaras del abonado
Cada central (abonado) SHALL poder tener una lista de cámaras propias. La lista SHALL admitir equipos cámara y canales de un NVR que no están dados de alta como equipo. Al editarla, las cámaras del área de la central SHALL ofrecerse primero.

#### Scenario: Canal de NVR como cámara del abonado
- **WHEN** un administrador agrega a la central «Club House» el canal 5 del NVR «Club», que no es un equipo
- **THEN** el canal queda en las cámaras del abonado y se ve en vivo en sus eventos

### Requirement: Cámaras de una zona
Cada zona SHALL poder tener hasta 4 cámaras elegidas, equipos o canales de NVR. Las cámaras con que se verifica un evento de una zona SHALL ser, en este orden:

1. las elegidas para la zona;
2. si no tiene, las cámaras del área de la zona (hasta 4);
3. si no hay, las del abonado (hasta 4).

El editor de zonas SHALL mostrar, para cada zona, qué cámaras va a usar y de dónde salen («elegidas», «del área Perímetro norte», «del abonado» o «ninguna»).

#### Scenario: Zona con área y sin cámaras elegidas
- **WHEN** la zona 3 tiene el área «Perímetro norte», que contiene dos cámaras, y no tiene cámaras elegidas
- **THEN** un evento de la zona 3 se verifica con esas dos cámaras y el editor dice «2 cámaras del área Perímetro norte»

#### Scenario: Zona sin nada
- **WHEN** una zona no tiene cámaras elegidas ni área, y el abonado no tiene cámaras
- **THEN** el evento dice que no hay video para verificar y dónde se asocian las cámaras

### Requirement: Video en vivo al abrir el evento
Al abrir un evento de central, tanto en la ficha del panel como en la vista de pared, las cámaras de la verificación SHALL verse **en vivo**. El vivo SHALL arrancar sin que el operador toque nada. Si el navegador no puede mostrar el códec, SHALL usarse la versión convertida. Si el vivo no arranca en 12 s, SHALL mostrarse la foto de la cámara renovándose cada 2 s, con el rótulo «foto».

#### Scenario: Robo con dos cámaras
- **WHEN** un operador abre un Robo de la zona 3, que tiene dos cámaras
- **THEN** los dos videos en vivo arrancan solos en la ficha, cada uno con el nombre de su cámara y el rótulo «en vivo»

#### Scenario: Cámara que no da video
- **WHEN** una de las cámaras no entrega video en 12 s
- **THEN** su lugar muestra la foto de la cámara cada 2 s con el rótulo «foto» y la otra sigue en vivo

### Requirement: Grabación del momento
Cada cámara de la verificación SHALL ofrecer **«Ver el momento»**: la grabación desde N segundos antes de la hora del evento, donde N es el «antes» de Ajustes → Reproducción. La grabación SHALL salir del grabador de esa cámara: su NVR, o la propia cámara si graba. Una cámara sin grabación accesible SHALL decirlo («Esta cámara no tiene grabador: sólo hay vivo») en lugar de un reproductor vacío. Volver al vivo SHALL ser un toque.

#### Scenario: Ver el momento del robo
- **WHEN** el evento fue a las 21:47:10, el «antes» es 10 s y el operador toca «Ver el momento» en una cámara del NVR
- **THEN** se reproduce la grabación de esa cámara desde las 21:47:00, con la hora sobre el video

#### Scenario: Sin grabador
- **WHEN** el operador toca «Ver el momento» en una cámara que no está en ningún NVR y no graba
- **THEN** se informa que no hay grabación para esa cámara y el vivo sigue disponible

### Requirement: Otras cámaras del abonado
Además de las de la zona, la verificación SHALL dejar a mano las demás cámaras del abonado: una tira que se abre con un toque y muestra cada una en vivo. Abrir una SHALL ponerla junto a las de la zona sin sacar ninguna.

#### Scenario: Seguir al intruso
- **WHEN** el operador ve en la zona 3 a alguien que se va hacia el fondo y abre «Fondo» de las otras cámaras del abonado
- **THEN** «Fondo» se suma en vivo a las cámaras que ya estaba mirando

### Requirement: Sólo lectura en la pared
En la vista de pared, el vivo, la grabación del momento y las otras cámaras SHALL funcionar con un enlace de pantalla, con el mismo alcance de video que ya tienen las vistas de pared. El enlace MUST NOT poder tomar, tratar, tildar pasos ni cambiar cámaras.

#### Scenario: Enlace de pantalla y grabación
- **WHEN** la pared con enlace de pantalla toca «Ver el momento»
- **THEN** reproduce la grabación de esa cámara y no ofrece tomar ni tratar el evento
