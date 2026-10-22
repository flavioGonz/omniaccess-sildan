# Spec Delta

## ADDED Requirements

### Requirement: Casos que agrupan señales
Las señales de una misma central y clase de evento SHALL agruparse en un caso mientras ese caso esté abierto. Una señal de la misma central y clase con un caso abierto SHALL sumarse a él; con el caso ya tratado SHALL abrir uno nuevo. La prioridad del caso SHALL ser la de su clase.

#### Scenario: Tres zonas de robo, un caso
- **WHEN** la central de la cuenta 2989 manda robo en las zonas 10, 17 y 16 en menos de un minuto
- **THEN** la cola muestra un solo caso «Robo · cuenta 2989» con 3 señales, prioridad P1

#### Scenario: Vuelve a dispararse después de tratado
- **WHEN** el caso de robo de la 2989 se trató y la zona 10 vuelve a dispararse
- **THEN** se abre un caso nuevo y el anterior queda en el historial

#### Scenario: Restauración dentro de un caso abierto
- **WHEN** llega la restauración de la zona 10 con el caso de robo abierto
- **THEN** se suma como señal «restauración» al caso, sin pedir tratamiento propio

### Requirement: Qué entra a la cola
Todo evento con prioridad menor o igual a «tratar hasta» (ajuste del administrador, de fábrica P4) SHALL entrar a la cola de casos. Los de prioridad mayor SHALL quedar sólo en el registro.

#### Scenario: Falla de corriente
- **WHEN** llega un corte de corriente (P4) con «tratar hasta» en P4
- **THEN** aparece un caso «Fallos del sistema» en la cola

#### Scenario: Armado
- **WHEN** llega un armado (P5)
- **THEN** queda en el registro de la central y no abre caso

### Requirement: Tratamiento parcial y cedulación ampliada
Tratar un caso SHALL pedir las señales a tratar (todas por defecto), un cierre del catálogo, un texto de al menos 8 letras, y SHALL permitir indicar el móvil enviado y si acudió la policía. El caso SHALL quedar tratado sólo si no le quedan señales pendientes. Las reglas de exclusividad vigentes (sólo quien lo tiene; quitarlo pide motivo) SHALL aplicarse al caso.

#### Scenario: Tratar dos de tres señales
- **WHEN** el operador que tiene el caso trata las señales de las zonas 10 y 17 con «Robo confirmado — Se envió a la guardia», móvil «Guardia 2» y acudió policía
- **THEN** esas dos señales quedan tratadas con esos datos, el caso sigue abierto con la zona 16 pendiente y la bitácora lo registra con su nombre y la hora

### Requirement: En espera con recordatorio
Un caso SHALL poder ponerse en espera con un motivo y un plazo (5, 10, 15, 30 o 60 min). En espera SHALL salir de la cola principal y aparecer en la pestaña En espera; al vencer el plazo SHALL volver a la cola, sonar y marcarse «volvió de espera».

#### Scenario: El titular llama en 10 minutos
- **WHEN** el operador pone el caso en espera 10 min con «el titular verifica y llama»
- **THEN** el caso pasa a En espera y a los 10 min vuelve a la cola con sonido

### Requirement: Consola y contadores
La consola SHALL mostrar la cola con pestañas Todos y En espera, cada caso en el color de su prioridad con su cantidad de señales, y el caso elegido con pestañas Señales, Abonado, Usuarios, Contactos, Zonas, Horarios, Notas e Historial. La barra del panel SHALL mostrar en todas las pantallas los contadores P1, P2-3, P4-5 y En espera cuando haya casos.

#### Scenario: Contadores
- **WHEN** hay 1 caso P1, 2 P3 y 1 en espera
- **THEN** la barra muestra P1 1 (rojo), P2-3 2 (ámbar), En espera 1, y tocar P1 abre la consola filtrada

### Requirement: Usuarios de la central y emboscada
Cada central SHALL poder tener usuarios (código, nombre, tipo de alerta Normal, Nunca, Siempre o Emboscada). Los armados y desarmados SHALL mostrar el nombre del usuario. Un desarmado con un usuario de tipo Emboscada SHALL generar además un caso de coacción P1.

#### Scenario: Desarmado bajo amenaza
- **WHEN** llega un desarmado con el usuario 9, marcado Emboscada
- **THEN** el registro muestra «Desarmado · usuario 9 (nombre)» y se abre un caso «Coacción» P1 que salta en la ventana

### Requirement: Contactos, listas de llamado y registro de llamadas
Cada central SHALL tener contactos (nombre, teléfono, tipo, puede acudir) y listas de llamado ordenadas por clase de evento. Al tratar un caso SHALL mostrarse la lista de su clase, y cada llamada registrada (atendió, no atendió, ocupado, buzón) SHALL quedar en la bitácora con quién y cuándo.

#### Scenario: Lista de robo
- **WHEN** se abre un caso de robo de una central con lista de robo «titular, esposa, vecino, policía»
- **THEN** la ficha muestra esos contactos en ese orden con su teléfono, y «Llamé al titular → no atendió» queda en la actividad

### Requirement: Notas y directivas de la cuenta
Cada central SHALL tener directivas (instrucciones propias de la cuenta) y notas permanentes o temporales (con vencimiento). Al abrir un caso SHALL mostrarse las directivas y las notas vigentes.

#### Scenario: Nota temporal
- **WHEN** hay una nota «De vacaciones hasta el 30/10, llamar al vecino» con vencimiento 30/10
- **THEN** se muestra en cada caso de esa central hasta el 30/10 y después desaparece sola

### Requirement: Horarios de apertura y cierre
Una central con horarios SHALL generar «No abrió», «No cerró» y «Abrió fuera de horario» según sus ventanas por día y su tolerancia, con la hora de Montevideo. Un usuario de tipo Nunca SHALL no generar «Abrió fuera de horario».

#### Scenario: No cerró
- **WHEN** el lunes la ventana de cierre es 19:00–19:30 con 10 min de tolerancia y a las 19:40 no llegó el armado
- **THEN** se abre un caso «No cerró» con la prioridad de su clase

### Requirement: Restitución con tiempo límite
Una zona con restitución en N minutos SHALL generar «No llegó la restitución» si su restauración no llega en ese plazo después de la alarma.

#### Scenario: Puerta que no cierra
- **WHEN** la zona 3 (restitución 5 min) entra en alarma y a los 5 min no restauró
- **THEN** se suma al caso (o abre uno) la señal «No llegó la restitución · zona 3»

### Requirement: Modos prueba y desactivado con vencimiento
Una central, una zona o una clase SHALL poder ponerse en modo prueba o desactivado hasta una hora. En prueba las señales SHALL entrar marcadas «modo prueba» sin ventana ni reglas; desactivadas SHALL registrarse sin entrar a la cola. Al vencer SHALL volver solas y quedar en la bitácora.

#### Scenario: Técnico trabajando
- **WHEN** se pone la cuenta 2989 en modo prueba por 60 min
- **THEN** sus robos de esa hora se ven «modo prueba» en el registro, no abren ventana ni disparan reglas, y a los 60 min vuelve sola

### Requirement: Clip automático del caso
Un caso P1 o P2 SHALL guardar, por cada cámara de la zona (hasta 4) en un NVR, el clip de N segundos antes y después de la primera señal; sin NVR, la foto de go2rtc con el motivo.

#### Scenario: Robo con cámara
- **WHEN** se abre un caso de robo en una zona con dos cámaras en NVR
- **THEN** la ficha del caso muestra los dos clips desde N s antes

### Requirement: Informe por abonado
SHALL existir un informe por abonado en un período: casos, señales, falsas, reales, tiempo de toma y de tratamiento (medianas), exportable.

#### Scenario: Abonado con muchas falsas
- **WHEN** se pide el informe de los últimos 30 días
- **THEN** cada abonado muestra cuántos casos tuvo, cuántos falsos y sus tiempos, ordenable por falsas
