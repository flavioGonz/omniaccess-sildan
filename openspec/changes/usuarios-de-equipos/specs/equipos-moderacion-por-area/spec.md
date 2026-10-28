# Spec Delta

## Purpose

La gestión de cuentas de equipos se modera por las áreas de Dispositivos: cada área decide si sus equipos se gestionan y qué roles tienen cuenta en ellos. Ahí mismo, en el área, están la revisión, la sincronización, el alta de cuentas y la auditoría de esos equipos.

## ADDED Requirements

### Requirement: Área gestionada
Cada área de Dispositivos SHALL tener un ajuste «Cuentas gestionadas», apagado por defecto. Una sub-área hereda el de su área madre salvo que tenga uno propio. En un equipo cuya área no está gestionada, sólo se leen sus cuentas y sesiones: no se crea, cambia ni borra ninguna cuenta, ni a mano ni por sincronización.

#### Scenario: Área sin gestionar
- **WHEN** el área «Perímetro» no tiene «Cuentas gestionadas»
- **THEN** sus equipos muestran cuentas, sesiones y alertas, sin ninguna acción de escritura, y la sincronización no los incluye

#### Scenario: Sub-área que hereda
- **WHEN** «Accesos» está gestionada y su sub-área «Barrera norte» no tiene ajuste propio
- **THEN** los equipos de «Barrera norte» se gestionan con la política de «Accesos», y el panel dice «heredado de Accesos»

#### Scenario: Equipo sin área
- **WHEN** un equipo está en «Sin área»
- **THEN** se trata como un área no gestionada

### Requirement: Roles por área
Un área gestionada SHALL decir qué roles del panel tienen cuenta en sus equipos. Una persona recibe cuenta en un equipo sólo si cumple las tres condiciones: tiene «Cuenta en equipos», su rol tiene un nivel distinto de «ninguno» para ese tipo de equipo, y ese rol está habilitado en el área del equipo.

#### Scenario: Técnico sí, Supervisor no
- **WHEN** el área «Accesos» habilita Técnico y no Supervisor
- **THEN** los Técnicos marcados tienen cuenta en las cámaras de «Accesos», y los Supervisores no, aunque estén marcados

#### Scenario: Se quita un rol del área
- **WHEN** se deshabilita Técnico en «Accesos»
- **THEN** la confirmación dice cuántas cuentas gestionadas se van a borrar en esa área, y al aceptar se borran sólo esas

### Requirement: Controles en el área
La vista de un área en Dispositivos SHALL reunir, para sus equipos y sub-áreas:

- el estado de las cuentas: al día, pendientes, conflictos, no gestionadas y sesiones desconocidas;
- «Revisar», que muestra las diferencias sin cambiar nada;
- «Sincronizar»;
- «Crear cuenta en el área»;
- la auditoría del área;
- el ajuste de gestión y de roles.

Los controles de escritura piden `dispositivos.usuarios`, y el ajuste del área pide además `dispositivos.editar`.

#### Scenario: Abrir el área
- **WHEN** se abre el área «Accesos», con 12 equipos
- **THEN** el encabezado muestra «Cuentas: 10 al día · 1 pendiente · 1 no gestionada» y los botones Revisar, Sincronizar, Crear cuenta y Auditoría

#### Scenario: Sin permiso de escritura
- **WHEN** abre el área un usuario con `dispositivos` y sin `dispositivos.usuarios`
- **THEN** ve el estado, la revisión y la auditoría, pero no Sincronizar, Crear cuenta ni el ajuste del área

### Requirement: Crear una cuenta en toda el área
«Crear cuenta en el área» SHALL crear la misma cuenta (nombre, nivel y clave) en los equipos compatibles del área que se elijan. Equipo por equipo, deja el resultado y la marca como gestionada por un alta manual.

#### Scenario: Cuenta de mantenimiento en 12 cámaras
- **WHEN** se crea `mantenimiento` como Visualizador en las 12 cámaras de «Accesos» y una no contesta
- **THEN** 11 quedan creadas y verificadas, una queda pendiente con el motivo, y la auditoría del área registra el alta con los 12 resultados

### Requirement: Auditoría del área
La auditoría del área SHALL listar, de los equipos del área y sus sub-áreas:

- las acciones sobre cuentas (quién, qué, en qué equipo y el resultado);
- las cuentas nuevas no gestionadas;
- las sesiones desde IP desconocidas.

Se puede filtrar por fecha, por equipo y por tipo.

#### Scenario: Qué pasó en Accesos esta semana
- **WHEN** se abre la auditoría de «Accesos» filtrada a los últimos 7 días
- **THEN** se ven las altas, bajas y cambios de cuentas, las cuentas nuevas no gestionadas y las sesiones desconocidas de sus equipos, cada una con fecha, equipo y quién
