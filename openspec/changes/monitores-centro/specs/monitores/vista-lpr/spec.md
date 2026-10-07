# Spec Delta

## Purpose
La vista Control LPR muestra en la pared lo que pasa en la barrera: la última lectura grande y clara, si se abrió y por qué, y los números del día.

## ADDED Requirements

### Requirement: Última lectura protagonista
La vista SHALL mostrar la última lectura de acceso con: recorte de la matrícula, cuadro completo, matrícula en texto grande (mínimo 72 px a 1080p), nombre de la persona o "desconocido", cámara, sentido, hora con segundos, método y confianza, y el resultado (PERMITIDO en verde / DENEGADO en rojo con el motivo).

#### Scenario: Denegado por lista negra
- **WHEN** llega un acceso denegado cuyo detalle dice "Lista negra: <motivo>"
- **THEN** el resultado se muestra en rojo con "LISTA NEGRA" y el motivo, y la fila de atención se enciende

### Requirement: Tira de últimas lecturas
La vista SHALL mostrar una tira con las últimas 10 lecturas (miniatura, matrícula, hora, resultado) que se desplaza al llegar una nueva.

#### Scenario: Nueva lectura
- **WHEN** llega una lectura nueva
- **THEN** entra por la izquierda, la más vieja sale y la protagonista se reemplaza con una transición de menos de 400 ms

### Requirement: Contadores del día
La vista SHALL mostrar entradas, salidas, denegados y "adentro ahora" del día del barrio, actualizados con cada lectura, y MUST indicar la hora de la última actualización.

#### Scenario: Cambio de día
- **WHEN** pasa la medianoche del barrio
- **THEN** los contadores vuelven a cero sin recargar la página

### Requirement: Fila de atención
La vista SHALL mostrar una fila de atención con las lecturas de las últimas 24 h que estén en lista negra, en búsqueda o marcadas por merodeo, con la matrícula, el motivo y hace cuánto; vacía, dice "Sin novedades".

#### Scenario: Matrícula en búsqueda leída
- **WHEN** se lee una matrícula de la lista de vigilancia en categoría "en búsqueda"
- **THEN** aparece en la fila de atención con "EN BÚSQUEDA" y el motivo cargado

### Requirement: Sonido configurable
La vista SHALL poder emitir un tono en denegado y otro distinto en lista negra / en búsqueda, configurable desde Monitores y silenciable desde la pantalla, con el mismo aviso de audio bloqueado que la vista Intrusión.

#### Scenario: Sólo lista negra
- **WHEN** el sonido está configurado "sólo lista negra"
- **THEN** un denegado por matrícula desconocida no suena y una lectura de lista negra sí
