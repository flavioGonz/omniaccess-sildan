# Spec Delta

## Purpose

Que los usuarios del panel que lo necesiten tengan cuenta en los equipos, creada y mantenida desde OmniAccess. Su rol decide el nivel y los equipos; los cambios y las bajas llegan a cada equipo, y las diferencias se ven y se corrigen.

## ADDED Requirements

### Requirement: Cuenta en equipos marcada por persona
Un usuario del panel SHALL tener cuenta en los equipos sólo si alguien con el permiso `accesos` le prendió «Cuenta en equipos». Tener rol de panel no basta.

#### Scenario: Usuario del panel sin la marca
- **WHEN** un usuario con rol Técnico no tiene «Cuenta en equipos»
- **THEN** no se le crea ninguna cuenta en ningún equipo

### Requirement: Política por rol
Cada rol del panel SHALL definir con qué nivel se crea la cuenta («ninguno», «visualizador» u «operador») y en qué tipos de equipo. Las áreas deciden después en cuáles equipos (ver `equipos-moderacion-por-area`). Pedir un nivel que la marca no permite para una cuenta adicional (Hikvision sólo admite un Administrador) MUST rechazarse al guardar el rol.

#### Scenario: Técnico en cámaras y grabadores
- **WHEN** el rol Técnico dice «operador» en cámaras, LPR y grabadores
- **THEN** quien tenga ese rol y la marca recibe una cuenta Operador en esos tipos de equipo, dentro de las áreas gestionadas que habilitan a Técnico, y en ningún otro

#### Scenario: Rol sin cuenta en equipos
- **WHEN** el rol Auditor dice «ninguno»
- **THEN** sus usuarios no tienen cuenta en ningún equipo, aunque tengan la marca

### Requirement: Clave de equipos cifrada
La clave de equipos SHALL ser propia de cada persona, distinta de la del panel, y guardarse cifrada como las de los dispositivos. MUST NOT mostrarse ni devolverse después de guardada. Si OmniAccess la genera, se muestra una sola vez para copiarla.

#### Scenario: Clave generada
- **WHEN** al prender «Cuenta en equipos» se elige «Generar»
- **THEN** se muestra una clave que cumple las reglas de los equipos con un botón para copiarla, y al cerrar el diálogo no se vuelve a mostrar

#### Scenario: Sin clave de cifrado en el servidor
- **WHEN** el servidor no tiene `OMNI_CLAVE_DATOS`
- **THEN** no se puede prender «Cuenta en equipos» y se explica por qué; nunca se guarda una clave en claro

### Requirement: Los cambios del panel llegan a los equipos
Cuando se prende la marca, cambia el rol, cambia la clave de equipos, se apaga la marca o se borra un usuario del panel, el sistema SHALL calcular qué hay que crear, cambiar o borrar en cada equipo. Lo muestra en la confirmación previa, lo aplica al aceptar y deja el resultado por equipo.

#### Scenario: Alta de una persona
- **WHEN** se le prende «Cuenta en equipos» a un Técnico y hay 12 equipos de los tipos de su rol
- **THEN** antes de guardar, la confirmación dice «Se crea la cuenta en 12 equipos» con la lista; al aceptar se crea en cada uno y la persona muestra «12 de 12 al día»

#### Scenario: Baja de una persona
- **WHEN** se borra un usuario del panel que tenía cuenta en 12 equipos
- **THEN** el diálogo de borrado dice «También se quitan sus cuentas de 12 equipos», y al confirmar se borran de cada equipo y queda en Auditoría

#### Scenario: Un equipo que no contesta
- **WHEN** uno de los equipos está caído al aplicar
- **THEN** los demás se aplican, ese queda «pendiente» con el motivo, y se reintenta en la revisión siguiente sin que nadie tenga que volver a pedirlo

### Requirement: Un nombre que ya existe en el equipo
Si el equipo ya tiene una cuenta no gestionada con el nombre que se quiere crear, el sistema MUST NOT apropiarse de ella. Queda como conflicto, que sólo se resuelve adoptándola explícitamente (lo que le cambia la clave a la de equipos) o con otro nombre.

#### Scenario: jperez ya existe en la cámara
- **WHEN** se sincroniza `jperez` y la cámara ya tiene una `jperez` creada a mano
- **THEN** esa cámara queda en «conflicto: el nombre ya existe», la cuenta del equipo no cambia, y la ficha ofrece «Adoptar» con confirmación

### Requirement: Revisión de diferencias
Una revisión periódica SHALL comparar, por equipo, las cuentas que deberían existir según el panel con las leídas. Muestra lo que falta, lo que sobra entre las gestionadas y lo que tiene otro nivel, y permite volver a aplicar.

#### Scenario: Equipo reseteado de fábrica
- **WHEN** un equipo vuelve de fábrica y ya no tiene las cuentas gestionadas
- **THEN** la revisión lo muestra con «faltan 3 cuentas», y «Volver a aplicar» las crea con las claves de equipos guardadas, sin pedirlas

#### Scenario: Una cuenta gestionada con otro nivel
- **WHEN** alguien cambió en el equipo el nivel de una cuenta gestionada de Operador a Visualizador
- **THEN** la revisión lo marca como diferencia y no la corrige sola; «Volver a aplicar» la deja como dice el rol

### Requirement: Las no gestionadas no se tocan al sincronizar
La sincronización MUST NOT borrar, cambiar ni adoptar cuentas no gestionadas, de servicio ni de fábrica.

#### Scenario: Sincronizar un equipo con cuentas ajenas
- **WHEN** se aplica la sincronización en un grabador que tiene dos cuentas no gestionadas
- **THEN** las dos siguen igual después de aplicar
