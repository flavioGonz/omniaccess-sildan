# Spec Delta

## Purpose

Cambiar la clave de la cuenta con la que OmniAccess maneja cada equipo, en el equipo y en OmniAccess a la vez. La clave nueva se comprueba antes de guardarla, para que ningún equipo quede fuera de control. Es la fase posterior del plan.

## ADDED Requirements

### Requirement: Rotación comprobada
Rotar la clave de servicio de un equipo SHALL seguir este orden:

1. cambiar la clave en el equipo;
2. comprobar que la clave nueva entra;
3. recién entonces guardarla, cifrada, en el dispositivo de OmniAccess.

Si la comprobación falla, la clave guardada no cambia y el resultado dice en qué estado quedó el equipo.

#### Scenario: Rotación correcta
- **WHEN** se rota la clave de una cámara y la clave nueva entra
- **THEN** el dispositivo guarda la clave nueva cifrada, la salud del equipo sigue verde y Auditoría registra la rotación sin la clave

#### Scenario: El equipo cambió la clave pero no entra
- **WHEN** el equipo aceptó el cambio y la comprobación con la clave nueva falla
- **THEN** OmniAccess conserva las dos claves cifradas y vuelve a probar con las dos. Lo que no puede pasar es quedarse sin la que anda: el equipo queda marcado «rotación sin confirmar» hasta resolverlo

### Requirement: Rotación en lote con freno
La rotación de varios equipos SHALL hacerse de a uno y detenerse ante la primera falla sin confirmar, para que un error repetido no deje sin control a muchos equipos.

#### Scenario: Falla el tercero de veinte
- **WHEN** en una rotación de 20 equipos el tercero queda «rotación sin confirmar»
- **THEN** la rotación se detiene, los dos primeros quedan rotados, los diecisiete restantes no se tocan, y se explica qué pasó

### Requirement: Grabadores con cámaras enlazadas
Antes de rotar la clave de una cámara que graba un NVR, el sistema SHALL avisar que el NVR la usa para traer su video, y ofrecer actualizarla también en el canal del NVR. Si no, la grabación se corta.

#### Scenario: Cámara grabada por un NVR
- **WHEN** se pide rotar la clave de una cámara que está en el canal 2 del NVR 1
- **THEN** el diálogo avisa «El NVR 1 entra a esta cámara con esta clave» y ofrece actualizarla en el NVR en el mismo paso
