# Spec Delta

## Purpose

Funciones que se prenden y se apagan en una instalación sin importar su modo (Matrículas, Rostro o Filas). Son Intrusión, Recepción de alarmas y Gestión de alarmas de central. Esta capacidad define su estado, su dependencia y cómo la respetan todas las partes del sistema.

## ADDED Requirements

### Requirement: Funciones independientes del modo
El sistema SHALL ofrecer tres funciones de instalación:

- **Intrusión**;
- **Recepción de alarmas**;
- **Gestión de alarmas de central**.

Ninguna SHALL depender del modo: cada una SHALL poder estar prendida o apagada en Matrículas, Rostro y Filas. Cambiar de modo MUST NOT cambiar el estado de estas funciones. Prenderlas o apagarlas MUST NOT pedir recargar la aplicación ni cambiar el modo.

#### Scenario: Intrusión en modo Filas
- **WHEN** una instalación en modo Filas tiene la función Intrusión prendida
- **THEN** el menú muestra Monitor Intrusión y la alerta global de intrusión funciona igual que en modo Matrículas

#### Scenario: Cambiar de modo no toca las funciones
- **WHEN** una instalación con Recepción de alarmas apagada pasa de Matrículas a Rostro
- **THEN** Recepción de alarmas sigue apagada después del cambio

### Requirement: Dependencia entre funciones
Gestión de alarmas de central SHALL requerir Recepción de alarmas. Con la recepción apagada, la gestión SHALL figurar como no disponible y no SHALL poder prenderse. La pantalla SHALL decir que depende de la recepción. Apagar la recepción SHALL dejar la gestión sin efecto, sin borrar su ajuste guardado.

#### Scenario: Gestión sin recepción
- **WHEN** un administrador intenta prender Gestión de alarmas con Recepción de alarmas apagada
- **THEN** el control está deshabilitado y explica que primero hay que prender Recepción de alarmas

#### Scenario: Volver a prender la recepción
- **WHEN** Gestión estaba prendida, se apagó Recepción y luego se vuelve a prender Recepción
- **THEN** Gestión vuelve a funcionar sin tener que prenderla de nuevo

### Requirement: Dónde se administran
Las funciones de instalación SHALL administrarse en Ajustes → Modos, en una sección «Funciones de la instalación», separada de los modos y de las funciones de cada modo. Para cada función, la sección SHALL mostrar:

- qué hace;
- qué deja de pasar si se apaga, dicho antes de apagarla.

Sólo SHALL poder cambiarlas quien tiene permiso de Ajustes. Cada cambio SHALL quedar en la auditoría con quién y cuándo.

#### Scenario: Apagar Intrusión
- **WHEN** un administrador apaga Intrusión
- **THEN** antes de confirmar ve qué deja de pasar (menú, alertas, vista de pared, avisos), y el cambio queda auditado con su nombre

### Requirement: Intrusión apagada
Con Intrusión apagada:

- el menú NO SHALL mostrar Monitor Intrusión;
- NO SHALL abrirse la alerta global de intrusión de cámaras;
- la vista de pared Intrusión NO SHALL ofrecerse en Monitores ni en la rotación;
- NO SHALL salir avisos de intrusión de cámaras por las reglas de notificación.

Los eventos que mandan las cámaras SHALL seguir guardándose: prender Intrusión otra vez SHALL mostrar también lo ocurrido mientras estuvo apagada. Las alarmas de central NO SHALL depender de esta función.

#### Scenario: Cámara que cruza con Intrusión apagada
- **WHEN** una cámara manda un cruce de línea con Intrusión apagada
- **THEN** el evento se guarda, no se abre ninguna alerta, no sale ningún aviso y el evento aparece en el historial al prender Intrusión

### Requirement: Recepción de alarmas apagada
Con Recepción de alarmas apagada:

- el receptor NO SHALL aceptar conexiones de centrales en sus puertos, ni DC-09 ni CMS;
- Dispositivos NO SHALL ofrecer dar de alta centrales;
- la pestaña Centrales de Gestión de alarmas NO SHALL mostrarse.

Las centrales y su registro ya guardados NO SHALL borrarse. Al prender la recepción, el receptor SHALL volver a escuchar dentro de los 30 s siguientes, sin reiniciar procesos a mano.

#### Scenario: Apagar con centrales reportando
- **WHEN** se apaga Recepción de alarmas mientras una central reporta
- **THEN** en menos de 30 s el receptor deja de aceptar conexiones, la central registra falla de comunicación y nada de lo guardado se borra

#### Scenario: Prender de nuevo
- **WHEN** se prende Recepción de alarmas
- **THEN** en menos de 30 s el receptor acepta conexiones otra vez y la siguiente señal de la central se registra

### Requirement: Gestión de alarmas apagada
Con Recepción prendida y Gestión apagada:

- el receptor SHALL seguir aceptando y registrando los mensajes;
- NO SHALL crear alarmas para tratar;
- NO SHALL abrir la ventana global de central;
- NO SHALL escalar;
- la vista de pared Alarmas NO SHALL ofrecerse;
- la cola de eventos de central NO SHALL mostrarse.

Las reglas de notificación por evento de central SHALL seguir funcionando: la recepción sin gestión es un registro con avisos.

#### Scenario: Robo con Gestión apagada
- **WHEN** llega un Robo de una central con Gestión apagada
- **THEN** el mensaje queda en el registro de Centrales y sale el aviso de la regla que lo pida, pero no aparece ninguna alarma para tomar ni se abre ninguna ventana

### Requirement: Estado al desplegar
Al instalar esta versión, cada función SHALL quedar como se comportaba la instalación:

- **Intrusión:** prendida.
- **Recepción y Gestión:** prendidas si hay al menos una central dada de alta; apagadas si no hay ninguna.

Una instalación nueva SHALL arrancar con Intrusión prendida y las otras dos apagadas.

#### Scenario: Instalación con centrales
- **WHEN** se despliega en una instalación que ya tiene dos centrales
- **THEN** Recepción y Gestión quedan prendidas y el receptor sigue escuchando sin interrupción

### Requirement: Las rutas obedecen
Una ruta o pantalla de una función apagada SHALL contestar que la función está apagada (HTTP 404 para las APIs). MUST NOT mostrar datos ni aceptar cambios. Esto incluye las rutas de las vistas de pared y las de los enlaces de pantalla. Un enlace de pantalla de una vista cuya función está apagada SHALL mostrar «Esta vista está apagada en la instalación» en lugar de un error.

#### Scenario: Enlace de pantalla de Alarmas con Gestión apagada
- **WHEN** una PC de pared abre `/monitor/alarmas` con su enlace y Gestión está apagada
- **THEN** la pantalla dice que la vista está apagada en la instalación y vuelve sola cuando se prende
