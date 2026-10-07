# Spec Delta

## Purpose

Cómo se decide PERMITIDO o DENEGADO ante una lectura de matrícula, qué peso tiene la lista negra
frente a la credencial, el modo LPR y la lista de la cámara, y qué listas se cargan en la cámara.

## ADDED Requirements

### Requirement: La lista negra manda sobre todo lo demás
Ante una lectura de matrícula —de una lectora ANPR, de una cámara de acceso leída por RTSP o de una
matrícula cargada a mano sobre un evento— si la matrícula está en lista negra activa (entrada
manual, vinculada a persona o por rol), la decisión SHALL ser `DENY` aunque exista credencial,
aunque el modo LPR la permitiría y aunque la cámara la haya reportado como permitida. El evento
SHALL dejar constancia del motivo (`Lista negra: <motivo>`).

#### Scenario: Residente con matrícula en lista negra
- **WHEN** la matrícula `AAA111` tiene credencial de un residente y además está en lista negra
  activa, y la lectora de entrada la lee
- **THEN** el evento se guarda `DENY` con `Lista negra: <motivo>` en sus detalles y así lo muestra
  el monitor, aunque la cámara la haya devuelto como `whiteList`.

#### Scenario: Lectura por RTSP de una cámara de acceso
- **WHEN** el contenedor lee `AAA111` en una cámara de acceso y la matrícula está en lista negra
- **THEN** el evento de acceso generado es `DENY` con el mismo motivo y dispara los mismos avisos.

#### Scenario: Carga manual sobre un evento
- **WHEN** un operador corrige la matrícula de un evento "sin lectura" y escribe una que está en
  lista negra
- **THEN** la decisión recalculada es `DENY` con el motivo, no `GRANT` por tener credencial.

### Requirement: La cámara no recibe a la lista negra como permitida
Toda sincronización de matrículas hacia una lectora Hikvision SHALL excluir de la lista blanca de
la cámara las matrículas en lista negra activa y SHALL cargarlas en la lista negra de la cámara.
Al entrar o salir una matrícula de la lista negra, las lectoras SHALL actualizarse en el momento,
y el resultado por cámara SHALL informarse (hecho / no respondió), nunca asumirse.

#### Scenario: Alta en lista negra con credencial existente
- **WHEN** `AAA111` tiene credencial y un operador la pone en lista negra
- **THEN** en cada lectora Hikvision la matrícula se quita de la lista blanca y se agrega a la lista
  negra; la pantalla informa el resultado por cámara.

#### Scenario: Sincronización completa
- **WHEN** se ejecuta "sincronizar matrículas" sobre una lectora
- **THEN** las matrículas en lista negra activa quedan en la lista negra de la cámara y ninguna de
  ellas en la lista blanca.

#### Scenario: Cámara que no responde
- **WHEN** una lectora no responde al actualizar sus listas
- **THEN** la entrada queda igual en la lista de vigilancia (la barrera la deniega por servidor) y la
  pantalla dice qué cámara quedó sin actualizar, en vez de reportar éxito.

### Requirement: Baja de lista negra restituye el estado normal
Al desactivar una entrada de lista negra, la decisión SHALL volver a regirse por credencial y modo
LPR, y si la matrícula tiene credencial SHALL volver a cargarse en la lista blanca de las lectoras
y quitarse de su lista negra.

#### Scenario: Sacar de lista negra a un residente
- **WHEN** se desactiva la entrada de `AAA111`, que tiene credencial de residente
- **THEN** la siguiente lectura resuelve según credencial y modo (en modo lista blanca: `GRANT`) y
  la cámara vuelve a tenerla en la lista blanca.
