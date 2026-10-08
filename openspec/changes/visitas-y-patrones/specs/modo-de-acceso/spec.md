# Spec Delta

## Purpose

Define cómo se comporta el sistema según el barrio tenga barrera (cerrado) o no (abierto): qué significa una lectura, qué cuenta cada contador y qué alertas aplican, con un mismo motor para los dos casos.

## ADDED Requirements

### Requirement: Modo de acceso configurable por barrio
El sistema SHALL tener un ajuste de modo de acceso con dos valores, ABIERTO y CERRADO, editable desde Ajustes. Sin ajuste cargado el modo MUST ser CERRADO, para que una instalación con barrera no cambie de comportamiento al actualizar.

#### Scenario: Instalación sin el ajuste
- **WHEN** el sistema arranca en un barrio que nunca configuró el modo
- **THEN** se comporta como CERRADO y Ajustes lo muestra así

#### Scenario: Cambio de modo
- **WHEN** un administrador cambia el modo a ABIERTO
- **THEN** el monitor, la consola del guardia y los avisos usan el comportamiento de barrio abierto desde la siguiente lectura, sin reiniciar procesos

### Requirement: Vocabulario de la lectura según el modo
En modo ABIERTO el monitor LPR y la consola del guardia SHALL presentar cada lectura como REGISTRADO (la matrícula pertenece al padrón, a una visita en curso o a una invitación vigente) o NO REGISTRADO, y MUST NOT mostrar "Permitido" ni "Denegado". En modo CERRADO SHALL mantener PERMITIDO / DENEGADO con su motivo. La lista negra se muestra como LISTA NEGRA en ambos modos.

#### Scenario: Auto sin padrón en barrio abierto
- **WHEN** en modo ABIERTO se lee una matrícula que no está en el padrón ni en una visita ni en una invitación
- **THEN** el monitor la muestra como NO REGISTRADO, sin color de error ni la palabra "Denegado"

#### Scenario: Mismo auto en barrio cerrado
- **WHEN** en modo CERRADO se lee la misma matrícula y la barrera la deniega
- **THEN** el monitor la muestra como DENEGADO con el motivo

### Requirement: Contadores según el modo
En modo ABIERTO los contadores del día SHALL contar todas las lecturas de entrada y de salida, registradas o no, y el contador de denegados MUST reemplazarse por "No registrados". En modo CERRADO SHALL contar como hoy (entradas y salidas permitidas, y denegados).

#### Scenario: Día normal en barrio abierto
- **WHEN** en modo ABIERTO hubo 300 lecturas de entrada en el día y ninguna fue "permitida"
- **THEN** el contador de entradas muestra 300 y no 0

### Requirement: Alertas propias de cada modo
En modo ABIERTO el sistema MUST NOT generar avisos por "acceso denegado" y SHALL ofrecer el aviso "entró sin registrarse". En modo CERRADO MUST NOT ofrecer "entró sin registrarse" y SHALL conservar los avisos de denegado existentes.

#### Scenario: Lectura no registrada en barrio abierto
- **WHEN** en modo ABIERTO entra una matrícula no registrada
- **THEN** no sale ningún aviso de "denegado"; si el aviso "entró sin registrarse" está habilitado, se genera ese
