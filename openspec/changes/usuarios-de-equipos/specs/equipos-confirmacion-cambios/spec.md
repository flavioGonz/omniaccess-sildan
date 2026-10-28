# Spec Delta

## Purpose

Ningún cambio en las cuentas locales de un equipo sale sin una confirmación que diga, antes, exactamente qué se va a hacer, en qué equipos y qué se sobrescribe o se pierde. Lo grave pide una confirmación reforzada.

## ADDED Requirements

### Requirement: Confirmación previa obligatoria
Antes de enviar a un equipo cualquier alta, cambio de clave o de nivel, baja, adopción o rotación de cuentas, el sistema SHALL mostrar una confirmación y MUST NOT enviar nada hasta que se acepte. Vale igual para la acción a mano, la de un área entera y la sincronización por un cambio en el panel.

#### Scenario: Cancelar
- **WHEN** se abre la confirmación de borrar una cuenta y se elige «Cancelar» o se presiona Esc
- **THEN** no sale ningún pedido al equipo y no queda nada en Auditoría

#### Scenario: Una sincronización disparada desde Accesos
- **WHEN** se le cambia el rol a una persona con cuenta en equipos
- **THEN** antes de guardar se muestra la confirmación con lo que cambia en los equipos; si se cancela, no se guarda el rol

### Requirement: Qué dice la confirmación
La confirmación SHALL mostrar:

- un título con la acción;
- un ícono y un color según la gravedad: crear en tono información; cambiar en tono aviso; borrar, sobrescribir, adoptar o rotar en tono mal;
- la cantidad de equipos y la lista de cada uno, con el efecto que tiene en él;
- las advertencias que correspondan, escritas con el nombre de la cuenta;
- lo que queda afuera y por qué: sólo lectura, sin soporte, área sin gestionar o equipo apagado.

#### Scenario: Sincronizar un área
- **WHEN** se pide sincronizar «Accesos» y el plan crea 3 cuentas, cambia la clave de 1 y borra 1
- **THEN** la confirmación muestra «Sincronizar 12 equipos de Accesos» y la lista equipo por equipo («Cámara Acceso 1: crear jperez (Operador)», «NVR 1: borrar exempleado»). Se lee «2 equipos quedan afuera: sólo lectura en este servidor» y «Las cuentas no gestionadas no se tocan»

### Requirement: Advertencia de sobrescritura
Cuando la acción reemplaza algo que ya existe en el equipo y no creó OmniAccess, la confirmación SHALL decirlo de forma explícita, nombrando la cuenta. Hay tres casos: adoptar una cuenta con la clave de equipos, cambiar la clave de una cuenta no gestionada y rotar la clave de la cuenta de servicio o del administrador local.

#### Scenario: Adoptar una cuenta existente
- **WHEN** se elige «Adoptar» para `jperez`, que ya existía en la cámara
- **THEN** la confirmación advierte «Se sobrescribe la clave de la cuenta local jperez de Cámara Acceso 1: quien la use con la clave anterior deja de entrar»

#### Scenario: Rotar la clave del admin local
- **WHEN** se pide rotar la cuenta de servicio de 8 equipos, que es la `admin` de cada uno
- **THEN** la confirmación advierte «Se sobrescribe la clave del administrador local (admin) en 8 equipos: el instalador y cualquier sistema que entre con la clave anterior pierden el acceso», y nombra los NVR que entran a esas cámaras

### Requirement: Confirmación reforzada
Para las acciones en tono mal (borrar, sobrescribir, adoptar y rotar), aceptar SHALL requerir un paso más: tildar «Entiendo lo que se va a sobrescribir» y, si afecta a más de un equipo, escribir el nombre del área o la cantidad de equipos. Mientras eso no esté, el botón de aceptar queda deshabilitado.

#### Scenario: Borrar en 5 equipos
- **WHEN** se van a borrar cuentas en 5 equipos
- **THEN** «Borrar en 5 equipos» queda deshabilitado hasta tildar la casilla y escribir «5»

### Requirement: Resultado después de aceptar
Después de aceptar, la misma ventana SHALL mostrar el avance equipo por equipo y el resultado final: hecho y verificado, pendiente con el motivo, o error con el motivo del equipo. Se puede cerrar y el trabajo sigue.

#### Scenario: Un equipo falla
- **WHEN** de 12 equipos, 11 salen bien y uno responde error
- **THEN** la ventana termina en «11 hechos · 1 con error», con el motivo de ese equipo y «Reintentar ese equipo»
