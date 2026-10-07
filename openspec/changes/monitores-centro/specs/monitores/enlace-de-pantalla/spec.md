# Spec Delta

## Purpose
Un enlace de pantalla es una URL con token que abre una vista de monitor sin usuario ni contraseña, para que la PC de la pared arranque sola. Esta capacidad define cómo se emite, qué abre, qué no puede hacer y cómo se revoca.

## ADDED Requirements

### Requirement: Emisión desde Monitores
Un usuario con el permiso `monitores` SHALL poder crear un enlace de pantalla eligiendo la vista y un nombre (por ejemplo "Monitor 2 · garita"). El sistema MUST mostrar la URL completa una sola vez al crearla y guardar únicamente un hash del token.

#### Scenario: Crear un enlace
- **WHEN** el usuario crea el enlace "Monitor 2 · garita" para la vista Intrusión
- **THEN** se muestra la URL `https://<dominio>/monitor/intrusion?pantalla=<token>` con un botón de copiar, y en la lista queda el enlace con su nombre, vista, quién lo creó y cuándo

### Requirement: Alcance de sólo lectura
Un token de pantalla SHALL dar acceso únicamente a la vista para la que fue emitido y a las lecturas (APIs y socket) que esa vista necesita. MUST ser rechazado en cualquier ruta del panel (`/admin/*`), en cualquier API que escriba, y en las vistas que no son la suya.

#### Scenario: Token usado en el panel
- **WHEN** se abre `/admin/history?pantalla=<token válido>`
- **THEN** se responde como sin sesión (redirección al login)

#### Scenario: Token de otra vista
- **WHEN** un token emitido para Mapa se usa en `/monitor/lpr`
- **THEN** se muestra "Este enlace no abre esta vista" sin revelar datos

#### Scenario: Token de rotación
- **WHEN** un token emitido para Rotación se usa
- **THEN** abre la rotación y cualquiera de las vistas de pantalla (la rotación puede componerse con cualquiera, y su composición se cambia en cualquier momento), y nada del panel

### Requirement: Persistencia en el navegador del monitor
Al abrir una vista con `?pantalla=<token>` válido, el sistema SHALL recordar el token en ese navegador (cookie propia, distinta de la sesión del panel) para que la vista pueda recargarse y navegar la rotación sin el parámetro en la URL, y MUST quitar el token de la barra de direcciones.

#### Scenario: Recarga
- **WHEN** la PC del monitor se reinicia y el navegador vuelve a abrir `/monitor/intrusion`
- **THEN** la vista abre sin pedir nada

### Requirement: Revocación
Un enlace SHALL poder revocarse desde Monitores; desde ese momento MUST dejar de abrir la vista en todos los navegadores donde se haya usado, en el próximo pedido.

#### Scenario: Revocar
- **WHEN** se revoca "Monitor 2 · garita"
- **THEN** la pantalla de la garita pasa, en su próxima actualización, a "Este enlace fue revocado" con la hora, y el enlace queda listado como revocado (no se borra)

### Requirement: Último uso
El sistema SHALL registrar cuándo se usó por última vez cada enlace y desde qué dirección IP, y mostrarlo en Monitores.

#### Scenario: Enlace sin uso
- **WHEN** un enlace nunca se usó
- **THEN** figura "sin uso todavía"

### Requirement: Sin privilegios heredados
Un enlace de pantalla MUST NOT otorgar el permiso `monitores` ni ningún otro: quien tenga la URL ve esa pantalla y nada más.

#### Scenario: Intento de crear otro enlace con un token
- **WHEN** se llama a la acción de crear enlace con un token de pantalla en vez de una sesión
- **THEN** se rechaza
