# Spec Delta

## Purpose

La lista única de matrículas vigiladas del barrio —lista negra, VIP/autorizado y en búsqueda—:
qué contiene, desde dónde se carga y se saca, cómo se vincula a una persona y qué avisos genera.

## ADDED Requirements

### Requirement: Una sola lista de vigilancia por matrícula
El sistema SHALL mantener una única lista de vigilancia donde cada matrícula tiene a lo sumo una
entrada activa con una categoría canónica: `BLACKLISTED` (lista negra), `WHITELISTED`
(VIP/autorizado) o `SEARCH` (en búsqueda). Toda pantalla, comando o proceso que consulte "¿esta
matrícula está vigilada?" SHALL leer esta lista y SHALL interpretar la categoría con el mismo
vocabulario.

#### Scenario: Categorías viejas migradas
- **WHEN** existen entradas guardadas con las categorías anteriores `negra`, `vip` o `busca`
- **THEN** tras aplicar el cambio se leen como `BLACKLISTED`, `WHITELISTED` y `SEARCH`
  respectivamente en todas las pantallas (monitor LPR, visor de cuadros, ficha del evento).

#### Scenario: Categoría desconocida no es lista negra
- **WHEN** se intenta guardar una entrada con una categoría que no es una de las tres canónicas
- **THEN** el sistema rechaza el alta con un error visible y NO la guarda como lista negra.

### Requirement: La entrada guarda el porqué y el quién
Cada entrada de la lista SHALL poder registrar un motivo, la persona del barrio a la que pertenece
(opcional), quién la cargó y cuándo, y SHALL conservar la fecha en que se desactivó.

#### Scenario: Alta desde el monitor con motivo
- **WHEN** un operador agrega `ABC1234` en lista negra con motivo "robo denunciado"
- **THEN** la entrada queda activa con ese motivo, el usuario que la cargó y la hora, y así se ve en
  la tabla de `/admin/users`.

### Requirement: Una persona en lista negra son todas sus matrículas
Marcar a una persona en lista negra desde su ficha SHALL crear o reactivar una entrada
`BLACKLISTED` por cada matrícula registrada a su nombre, vinculada a la persona y con el motivo
indicado, sin cambiar su rol. Desmarcarla SHALL desactivar esas entradas vinculadas. Agregarle una
matrícula nueva a una persona marcada SHALL crear la entrada correspondiente.

#### Scenario: Marcar a un residente con dos autos
- **WHEN** un administrador marca "Lista negra" en la ficha de una persona con matrículas `AAA111`
  y `BBB222`
- **THEN** las dos matrículas aparecen en la lista de vigilancia como `BLACKLISTED`, vinculadas a
  esa persona, y su rol sigue siendo el que tenía.

#### Scenario: Matrícula nueva a persona marcada
- **WHEN** a una persona marcada en lista negra se le agrega la matrícula `CCC333`
- **THEN** `CCC333` queda en lista negra vinculada a ella sin ningún paso adicional.

#### Scenario: Desmarcar
- **WHEN** el administrador desmarca "Lista negra" en esa ficha
- **THEN** las entradas vinculadas a la persona quedan desactivadas con su fecha de baja; una
  entrada de la misma matrícula cargada a mano sin vínculo NO se toca.

### Requirement: Compatibilidad con el rol BLACKLISTED
Mientras el módulo facial siga usando el rol `BLACKLISTED`, el sistema SHALL tratar como lista
negra a toda matrícula cuya credencial pertenezca a un usuario con ese rol, aunque no tenga entrada
en la lista, y SHALL mostrarla en la pestaña de lista de vigilancia como "por rol".

#### Scenario: Usuario con rol BLACKLISTED sin entrada manual
- **WHEN** un usuario con rol `BLACKLISTED` tiene la matrícula `DDD444` y no hay entrada manual
- **THEN** `DDD444` figura en la lista de vigilancia como lista negra con origen "por rol" y recibe
  el mismo tratamiento en la barrera, el monitor y los avisos.

### Requirement: Un lugar para administrarla, atajos que escriben lo mismo
`/admin/users` SHALL ofrecer una pestaña "Lista de vigilancia" con la tabla completa (matrícula,
categoría, motivo, persona vinculada, quién y cuándo, avisa, activa), alta por matrícula o por
persona, edición y baja. El diálogo del monitor LPR, los interruptores de la ficha de un evento y
el bot SHALL escribir la misma lista con el mismo criterio.

#### Scenario: Lo cargado en el monitor se ve en Usuarios
- **WHEN** un operador agrega una matrícula desde el diálogo del monitor LPR
- **THEN** aparece de inmediato en la pestaña Lista de vigilancia de `/admin/users` con los mismos
  datos, y viceversa.

#### Scenario: La baja desactiva, no borra
- **WHEN** se saca una matrícula de la lista desde cualquiera de los lugares
- **THEN** la entrada queda inactiva con fecha de baja y se puede ver en "inactivas"; una lectura
  posterior de esa matrícula ya no se trata como vigilada.

#### Scenario: No pisar otra categoría sin querer
- **WHEN** se intenta marcar como lista negra una matrícula que ya está activa como VIP o en
  búsqueda
- **THEN** el sistema pide confirmación explícita del cambio de categoría antes de reemplazarla.

### Requirement: Avisos por cualquier lista negra
Cuando una lectura de matrícula coincide con una entrada `BLACKLISTED` activa (manual, vinculada a
persona o por rol), el sistema SHALL emitir el evento de vigilancia al monitor en tiempo real y al
motor de notificaciones (tipo `WATCHLIST`), sin importar si la lectura vino de una lectora ANPR o
de una cámara de acceso leída por RTSP.

#### Scenario: Lista negra manual dispara la regla
- **WHEN** una matrícula cargada a mano en lista negra pasa por la LPR de entrada
- **THEN** el monitor la muestra en la pila crítica con sonido urgente y la regla `WATCHLIST`
  configurada envía su aviso (por ejemplo, WhatsApp).

#### Scenario: Después de recargar el monitor
- **WHEN** el operador recarga el monitor LPR y la lectura en lista negra se vuelve a cargar desde
  la base
- **THEN** la tarjeta sigue marcada como lista negra (no depende de haber estado conectado en el
  momento).
