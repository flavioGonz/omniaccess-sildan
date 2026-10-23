# Spec Delta

## Purpose

Que una casilla de la pared de Cámaras pueda mostrar una página web (un tablero, un mapa, una herramienta externa) en lugar de un canal de video, para armar la pared del centro con todo lo que el operario necesita a la vista.

## ADDED Requirements

### Requirement: Catálogo de fuentes web

En Monitores SHALL existir un catálogo de **fuentes web**. Cada una tiene nombre, dirección (`https://` o `http://`), cada cuántos minutos se recarga (0 = nunca) y un zoom (50 % a 200 %). Crear, editar y borrar fuentes SHALL pedir el permiso `monitores.config`. El catálogo SHALL tener un tope de 50 fuentes.

#### Scenario: Cargar una fuente
- **WHEN** un usuario con `monitores.config` carga «Tablero de tránsito» con su dirección y recarga cada 5 minutos
- **THEN** la fuente queda en el catálogo y se puede elegir en las vistas de Cámaras

#### Scenario: Sin permiso
- **WHEN** un usuario sin `monitores.config` intenta guardar una fuente
- **THEN** recibe el rechazo con el permiso que falta y el catálogo no cambia

#### Scenario: Dirección inválida
- **WHEN** la dirección no empieza con `http://` o `https://`, o tiene usuario y clave dentro
- **THEN** no se guarda y se dice por qué

### Requirement: Aviso de lo que no se va a ver

Al guardar una fuente, el sistema SHALL consultar la dirección y avisar, sin impedir el guardado, cuando:
- el sitio prohíbe que lo muestren dentro de otra página;
- la dirección es `http://` y el panel se abre por `https://`, porque el navegador la va a bloquear;
- la dirección no contestó.

#### Scenario: Sitio que no se deja enmarcar
- **WHEN** se guarda una fuente cuyo sitio prohíbe mostrarse en un marco
- **THEN** la fuente se guarda con el aviso «este sitio no se deja mostrar dentro de la pared»

#### Scenario: http en un panel https
- **WHEN** se guarda `http://10.1.1.5:3000` y el panel es `https://omniaccess…`
- **THEN** se guarda con el aviso de que el navegador la bloqueará

### Requirement: Una casilla con una fuente web

En el editor de vistas guardadas de Cámaras, cada casilla SHALL poder recibir un canal de video **o** una fuente web. La pared SHALL mostrar la página en esa casilla, con el nombre de la fuente como rótulo, recargándola según su ajuste. La página SHALL quedar aislada: no puede abrir ventanas emergentes, navegar la pared ni leer la sesión de OmniAccess.

#### Scenario: Vista con un tablero
- **WHEN** una vista guardada tiene la fuente «Tablero de tránsito» en la casilla grande
- **THEN** la pared muestra el tablero ahí y el video en las demás casillas

#### Scenario: Fuente borrada
- **WHEN** se borra del catálogo una fuente que usaba una vista
- **THEN** esa casilla muestra «Fuente web que ya no existe» y el resto de la vista sigue igual

#### Scenario: Recarga
- **WHEN** una fuente tiene recarga cada 5 minutos
- **THEN** la casilla vuelve a cargar la página cada 5 minutos, sin recargar la pared

### Requirement: La fuente web no cambia el comportamiento de alarma

Una casilla con fuente web SHALL quedar fuera del orden automático, de las alertas y de la búsqueda de parecidos: no se pone roja, no pasa adelante y no se ofrece como canal para buscar. En la vista automática (sin vista guardada) las fuentes web no aparecen.

#### Scenario: Alerta con una casilla web
- **WHEN** detecta una cámara en una vista guardada que también tiene una fuente web
- **THEN** la cámara se marca como siempre y la fuente web sigue igual en su casilla
