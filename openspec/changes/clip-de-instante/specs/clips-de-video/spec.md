# Spec Delta

## Purpose
Cómo el sistema produce el clip de video de un instante de una cámara (fuentes, orden, ventana, nombre y limpieza), y qué informa cuando no puede, para que alertas, descargas y envíos usen la misma pieza y nunca inventen un video.

## ADDED Requirements

### Requirement: El clip de un instante sale de la mejor fuente disponible
Dada una cámara, un instante y una ventana (segundos antes y después), el sistema SHALL producir un único archivo MP4 reproducible en navegador y WhatsApp (H.264, faststart, sin audio) tomándolo de la primera fuente disponible en este orden: (1) la grabación del grabador (NVR) al que la cámara está mapeada; (2) el anillo de grabación local de esa cámara, si existe; y SHALL informar junto con el archivo qué fuente usó.

#### Scenario: Cámara mapeada a un NVR
- **WHEN** se pide el clip de una cámara que figura en el mapa de canales de un NVR y el NVR tiene grabación de ese tramo
- **THEN** el clip sale de la grabación del NVR, cubre desde `instante − antes` hasta `instante + después`, y la respuesta indica fuente `nvr`.

#### Scenario: Cámara sin NVR pero con anillo
- **WHEN** se pide el clip de una cámara que no está en ningún NVR y tiene anillo de grabación local con ese tramo
- **THEN** el clip sale del anillo y la respuesta indica fuente `anillo`.

#### Scenario: Sin ninguna fuente
- **WHEN** se pide el clip de una cámara sin NVR y sin anillo, o el tramo pedido no existe en ninguna de las dos
- **THEN** el sistema no devuelve archivo, devuelve un motivo legible por una persona (por ejemplo "la cámara no está en ningún grabador" o "el grabador no tiene grabación de ese horario") y no produce ningún archivo de reemplazo.

### Requirement: La ventana se acota y el instante futuro se espera
El sistema SHALL acotar la ventana pedida a los topes configurados del barrio y SHALL rechazar o posponer un pedido cuyo tramo posterior todavía no existe, en vez de devolver un clip más corto como si fuera completo.

#### Scenario: Tramo posterior todavía no grabado
- **WHEN** se pide un clip cuyo `instante + después` es posterior al momento actual más el margen de grabación del origen
- **THEN** el sistema espera hasta ese momento (con tope) antes de cortar, o informa que el tramo aún no está disponible; nunca entrega un clip truncado presentado como completo.

#### Scenario: Ventana fuera de topes
- **WHEN** se piden más segundos antes o después que los topes configurados
- **THEN** el clip se produce con los topes y la respuesta informa la ventana efectiva.

### Requirement: El anillo local existe sólo donde hace falta
El sistema SHALL mantener un anillo de grabación local únicamente para las cámaras que no están mapeadas a ningún NVR y tienen al menos una regla de notificación activa que las alcanza, SHALL detenerlo cuando esa condición deja de cumplirse, y SHALL limitar su tamaño a una duración fija de los últimos segundos.

#### Scenario: Cámara sin NVR con regla activa
- **WHEN** una cámara no figura en el mapa de canales y una regla activa la incluye (explícitamente o por "cualquier cámara" de su módulo)
- **THEN** el sistema graba en anillo su stream de video de baja resolución y conserva sólo los últimos segundos configurados.

#### Scenario: La condición deja de cumplirse
- **WHEN** la cámara pasa a estar mapeada a un NVR, o ya no la alcanza ninguna regla activa
- **THEN** el anillo de esa cámara se detiene y sus archivos se eliminan.

### Requirement: Los clips producidos se nombran y se limpian
Todo clip producido SHALL nombrarse con el patrón de nombre configurado en Ajustes (cámara, matrícula, fecha, hora) y SHALL eliminarse del disco pasado un tiempo fijo desde su creación, de modo que el directorio de clips no crezca sin techo.

#### Scenario: Clip de alerta purgado
- **WHEN** pasa el tiempo de retención temporal desde que se produjo un clip de alerta o de envío
- **THEN** el archivo ya no existe en el disco y su URL interna responde "no encontrado".
