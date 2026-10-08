# Spec Delta

## Purpose

Avisa a la guardia —y sólo a ella— cuando algo se aparta de lo esperado: una visita que se pasó de su tiempo o un comportamiento fuera del patrón de una matrícula, diciendo siempre por qué, para que actúe sobre lo que importa y no sobre cada lectura.

## ADDED Requirements

### Requirement: Avisos sólo a la guardia
Los avisos de esta capacidad SHALL mostrarse en la consola del guardia y en la fila de atención del monitor LPR, en tiempo real, y MUST NOT enviarse por WhatsApp, Telegram, correo ni push.

#### Scenario: Visita excedida
- **WHEN** una visita registrada se pasa de su tiempo
- **THEN** aparece un aviso en la consola del guardia y en la fila de atención del monitor, y no sale ningún mensaje por WhatsApp

### Requirement: Cada aviso dice por qué
Cada aviso SHALL incluir el tipo, la matrícula o la visita, la hora, la cámara si corresponde y una frase con el motivo y el dato que lo disparó (por ejemplo, "llegó a las 03:10; su rutina es lun a vie 06:50 ±2 min").

#### Scenario: Fuera de rutina
- **WHEN** se genera un aviso por fuera de rutina
- **THEN** el texto compara la lectura con la rutina guardada

### Requirement: Patrones que generan aviso
El sistema SHALL generar estos avisos, cada uno habilitable y con su umbral configurable: visita excedida; fuera de rutina (por defecto, a más de 90 min de su rutina o en un día que no es de su rutina); permanencia mayor a la habitual (supera su p90); primera vez de noche (por defecto 23:00–06:00); da vueltas (por defecto 4 lecturas en 60 min); y, sólo en modo ABIERTO, entró sin registrarse.

#### Scenario: Primera vez de noche
- **WHEN** a las 02:30 entra una matrícula que nunca fue vista
- **THEN** se genera un aviso "primera vez de noche"

#### Scenario: Fuera de rutina
- **WHEN** una matrícula con rutina "lun a vie · 06:50 ±2 min" entra un domingo a las 03:10
- **THEN** se genera un aviso "fuera de rutina"

### Requirement: Quién no genera "da vueltas"
El aviso "da vueltas" MUST NOT generarse para residentes, matrículas con visita en curso o con rutina detectada, ni para las frecuentes (vistas 4 días o más, como un ómnibus que cruza el barrio).

#### Scenario: Habitual que da vueltas no avisa
- **WHEN** una matrícula con rutina pasa 5 veces en una hora
- **THEN** no se genera el aviso "da vueltas"

### Requirement: Permanencia estimada no dispara avisos
Una permanencia calculada sin salida leída ni visita registrada SHALL mostrarse como estimada y MUST NOT disparar por sí sola un aviso de permanencia.

#### Scenario: No registrado que no se vio salir
- **WHEN** una matrícula no registrada entró hace 9 horas y no hay salida leída
- **THEN** no se genera aviso de permanencia

### Requirement: Sin repetir el mismo aviso
El sistema MUST NOT generar dos avisos del mismo tipo para la misma matrícula o visita mientras el primero no esté atendido o dentro de una ventana configurable (por defecto 60 minutos).

#### Scenario: Merodeo sostenido
- **WHEN** una matrícula sigue cumpliendo "da vueltas" durante dos horas
- **THEN** hay un solo aviso abierto para ella, no uno por lectura

### Requirement: Atender un aviso
El guardia SHALL poder marcar un aviso como atendido, opcionalmente con una nota; el aviso MUST guardar quién y cuándo, y deja de mostrarse como pendiente en la consola y el monitor.

#### Scenario: Guardia atiende
- **WHEN** el guardia toca "Atendido" en un aviso de visita excedida
- **THEN** el aviso queda atendido con su nombre y la hora, y desaparece de pendientes en todas las pantallas
