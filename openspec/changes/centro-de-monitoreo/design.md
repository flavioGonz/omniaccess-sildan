# Design

## Context

### Qué es Bykom y de dónde sale lo que sigue
Bykom (Bykom S.A., Mar del Plata, desde 2001; base MySQL) es un software para centros operativos de monitoreo. Fuentes:
- **Instructivo DNIC** (feb. 2023, el que mandó Nico): pantalla principal, cola con prioridades, agrupación por tipo y sucursal, tratamiento parcial de señales pendientes, cedulación.
- **Manual «Bykom Operativo»** (copia parcial, páginas 1–63 de 291): https://pdfcoffee.com/manual-bykom-2-pdf-free.html — módulos, abonado, usuarios, teléfonos, zonas, testeo, modos.
- Sitio del fabricante: https://bykom.com/productos-y-servicios/ , https://bykom.com/empresa/organizacion-funcional/ , https://bykom.com/partners/ ; Ajax + Bykom por DC-09: https://ajax.systems/es/blog/bykom-monitoring-software/ ; app Bykom Tracker en App Store.
- Lo que **no** está publicado (detalle de la pestaña Horarios, tabla de códigos por protocolo, pantalla de cedulación completa) se toma de las capturas del instructivo y se marca como inferido.

### Comparación: Bykom ↔ OmniAccess hoy ↔ este cambio

| Función de Bykom | OmniAccess hoy (22/10) | Este cambio |
|---|---|---|
| Recepción de receptoras (teléfono, radio, IP, seriales) | DC-09 (SIA/CID, AES), salida a CMS (IPC10, Sur-Gard) | — (suficiente) |
| Procesador: señal → evento, eventos propios del sistema (falta de test, restitución) | Traducción CID/SIA; supervisión «Sin supervisión» como alerta de salud | Eventos sintéticos en la cola: no abrió/no cerró, restitución, emboscada, test faltante repetido |
| Cola de tratamiento con prioridades 1 / 2-3 / 4-9 y «En espera» | Prioridad 1–5 por clase (editable), ventana P1-P2, pila de avisos, pestaña Centrales (registro) | **Consola** con cola, **En espera** con recordatorio, **contadores** siempre visibles |
| Agrupa señales del mismo tipo y sucursal («#257») | Una alarma = una `Detection` | **Casos** por abonado + clase, con cantidad de señales |
| Tratamiento parcial (elegir señales pendientes) | No | Sí, por señal |
| Cedulación: tipo de señal + observaciones + móvil + acudió policía | Cierre del catálogo + texto obligatorio | + **móvil** + **acudió policía**, por señal |
| Tomar / asignar | Exclusivo, quitar con motivo, pasar, auditoría (más que Bykom) | Se mantiene, sobre el caso |
| Procedimiento | Pasos por prioridad con hora y quién | + **directivas** propias de la cuenta |
| Abonado: datos, partición, dirección, mapa | Central: nombre, cuenta, área | + dirección, ubicación, partición, directivas |
| Usuarios con código, nombre y tipo de alerta (Normal/Nunca/Siempre/Emboscada) | «usuario 5» sin nombre | **Usuarios** con nombre y tipo de alerta; **emboscada** = asalto |
| Teléfonos con listas por tipo de evento, orden, «posee móvil para acudir» | Personas del barrio (padrón) sin relación con la central | **Contactos** y **listas de llamado** por clase de evento; **registro de llamadas** |
| Zonas: nombre, cámara, foto, restitución con tiempo límite | Zonas con nombre, área y cámaras | + **restitución con tiempo límite** |
| Horarios y control de apertura/cierre con tolerancia | No | **Horarios** con tolerancia y sus eventos |
| Modo Prueba / Modo Desactivado (cuenta, zona, evento, hasta N min) | «Central de prueba» sin vencimiento | **Modos con vencimiento** por cuenta, zona o clase |
| Testeo (período, tolerancia, solo armado, repetir) | Supervisión por período | + repetir mientras falte; «solo armado» queda abierto (ver Open Questions) |
| Notas permanentes y temporales, tareas agendadas | Notas por alarma | **Notas de cuenta** permanentes y temporales |
| Videoverificación: vivo, grabado, fotos antes/después, cámara automática | Foto de las cámaras de la zona (go2rtc), ficha con foto cada 5 s; grabación por NVR en otras pantallas | **Clip automático** antes/después guardado con el caso; vivo en la ficha |
| Reportes, exportación, estadística por operador (TCI) | Informe de tiempos por operador; tablas exportables | **Informe por abonado** |
| SMS/email automáticos, Web Cliente, apps, dealer, ERP, replicación, AVL, telefonía con grabación | Reglas de notificación (Telegram, WhatsApp, email, push) | Fuera de alcance (ver proposal) |
| Atajos de teclado (Alt+F3 tratamiento…) | No | Atajos en la consola |

## Goals / Non-Goals

**Goals**
- Que un operador pueda atender **muchos abonados** sin perder el hilo: una cola corta (casos, no señales), el contexto del abonado en la misma pantalla y nada que se trate sin dejar registro.
- Que lo que hoy funciona (recepción, prioridades, ventana, tratamiento exclusivo) siga funcionando y se apoye en el caso, sin una segunda forma de tratar.
- Automatismos que una central de monitoreo da por hechos (horarios, restitución, modos con vencimiento, emboscada).

**Non-Goals**
- Ser un ERP de monitoreo (altas comerciales, facturación, dealers).
- Telefonía integrada (sólo el registro manual de llamadas).
- Reemplazar la pestaña Centrales: sigue siendo el **registro** crudo; la consola es la **operación**.

## Decisions

### D1. El caso agrupa por abonado + clase, mientras esté abierto
Un caso se identifica por `(centralId, clase de evento)` y está **abierto** desde la primera señal hasta que se tratan todas sus señales. Una señal nueva de la misma central y clase con un caso abierto **se suma** (sube la cantidad y la hora de la última); si el caso ya se trató, abre uno nuevo (Bykom: «puede volver a aparecer si se activa nuevamente»). La clase es la de `lib/centrales/prioridades` (robo, pánico, fallos…), así la prioridad del caso es la de su clase.
*Alternativa descartada*: agrupar por zona — un robo que dispara tres zonas es UN robo para el operador.

### D2. Qué entra a la cola
Entra todo evento cuya prioridad sea ≤ «tratar hasta» (ajuste nuevo, por defecto P4: alarmas, sabotaje, técnicas y fallos); P5 (armado, pruebas, restauraciones) sólo queda en el registro, salvo que la restauración pertenezca a un caso abierto: entonces se suma como señal «restauración» (dato útil al tratar, no pide tratamiento propio). Las `Detection CENTRAL` se siguen creando para las alarmas (overlay en Monitor Intrusión, Gestión de alarmas) y quedan ligadas al caso.

### D3. Tratar es por señal; el caso se cierra cuando no quedan pendientes
`TratamientoCentral` guarda cierre, texto, móvil, acudió policía, quién y cuándo, y las señales que cubre. El caso queda **tratado** si no le quedan señales pendientes; si quedan, sigue abierto con las restantes. Las reglas de hoy (exclusivo, quitar con motivo, texto mínimo) pasan tal cual al caso. `AlarmaGestion` sigue siendo la bitácora (clave `k:<casoId>`).

### D4. En espera con recordatorio
«En espera» saca el caso de la cola principal (pestaña En espera, contador azul) hasta la hora elegida; al vencer vuelve a la cola, suena y queda marcado «volvió de espera». Lo tiene quien lo puso en espera; otro puede tomarlo con motivo, como siempre.

### D5. La ficha de abonado vive en la central que ya existe
No se crea un «abonado» aparte: `CentralAlarma` es el abonado (cuenta + partición). Se le agregan dirección, ubicación (punto en el mapa del barrio o lat/lng), partición, **directivas** (texto) y las tablas de usuarios, contactos, listas de llamado, notas, horarios y modos. Un barrio con un solo cliente no ve nada distinto de hoy; una central de monitoreo carga lo que necesita.

### D6. Usuarios y emboscada
`UsuarioCentral` (posición/código, nombre, documento opcional, tipo de alerta). Al traducir un armado o desarmado con usuario, se le pone el nombre. Tipo **Emboscada**: un desarmado con ese código genera además un evento sintético **COACCION** (P1) — para paneles que no tienen código de coacción. **Nunca** no avisa sus aperturas fuera de horario; **Siempre** avisa todas.

### D7. Contactos, listas de llamado y registro de llamadas
`ContactoCentral` (nombre, teléfono, tipo: titular, contacto, policía, bomberos, emergencia médica, guardia; «puede acudir»). `ListaLlamado` por clase de evento con orden. En el tratamiento se muestra la lista que corresponde a la clase del caso; cada «llamé a X → resultado» va a la bitácora (`LLAMO`). El teléfono se muestra como enlace `tel:` (en el celular, llama). Sin telefonía integrada.

### D8. Automatismos en la vuelta de salud (cada minuto)
`lib/centrales/automatismos.ts`, junto a la supervisión y el escalado:
- **Horarios**: por día de semana, ventana de apertura y de cierre con tolerancia en minutos. Si al pasar la ventana no llegó el desarmado → «No abrió»; el armado → «No cerró»; un desarmado fuera de toda ventana → «Abrió fuera de horario». Se evalúan con la hora de Montevideo.
- **Restitución**: si una zona con «restitución en N min» no restauró en ese plazo → «No llegó la restitución».
- **Modos con vencimiento**: prueba (las señales entran marcadas «modo prueba», no disparan reglas ni ventana) y desactivado (de la cuenta, una zona o una clase: se registran pero no entran a la cola). Al vencer, vuelven solos y queda en la bitácora.
- **Supervisión**: además de la alerta de salud de hoy, un caso «Falta de test» en la cola, que se repite cada período mientras siga faltando.
Los eventos sintéticos se guardan como `MensajeCentral` con transporte `sistema` (se ven en el registro igual que los de la central) y entran por el mismo camino.

### D9. Clip automático
Para un caso P1/P2, por cada cámara de la zona (hasta 4) se pide al NVR el clip de N s antes y después (la misma vía que la «grabación del evento» de Intrusión) y se guarda con el caso. Si la cámara no está en un NVR, queda la foto de go2rtc de hoy y se dice por qué.

### D10. Contadores siempre visibles
En la barra superior del panel, cuatro números en los tonos del sistema: **P1** (rojo), **P2-3** (ámbar), **P4-5** (azul info), **En espera** (gris). Tocar uno abre la consola filtrada. Sin casos, no ocupan lugar.

### D11. Atajos de teclado en la consola
`↑/↓` mover en la cola · `Enter` abrir · `T` tomar · `E` en espera · `C` tratar (cedular) · `Esc` cerrar. Se muestran en la ayuda de cada botón.

## Risks / Trade-offs

- **Migración del modelo de tratamiento**: hoy la unidad es la `Detection`. Se convierte con un script (pendientes → casos con su señal; tratados quedan como historial) y se prueba en el lab antes que nada.
- **Horarios mal cargados = falsos «No abrió»**: arrancan apagados por cuenta; el primer día se muestran como «aviso de prueba» (sin cola) para validar.
- **Agrupar puede esconder**: una zona nueva dentro de un caso abierto suma una señal y sube la cantidad; la fila del caso marca «+N nuevas desde que lo tomaste» y suena.
- **Ruido de fallas** (P4 entrando a la cola): «tratar hasta» es ajustable; de fábrica P4 para que las fallas no se pierdan, como en Bykom.

## Migration Plan

1. Migración aditiva de tablas y columnas; ningún dato existente cambia.
2. Script `scripts/centrales-a-casos.js`: cada `Detection CENTRAL` sin tratar → caso con su señal; los tratados con `TRATO` quedan visibles en el historial del abonado.
3. Desplegar el receptor que abre casos y la consola; la ficha de evento actual pasa a abrir el caso.
4. En el lab con la Paradox de IES (cuenta 2989): disparo, agrupación, tratamiento parcial, en espera, horario de prueba.

## Open Questions

- **Testeo «solo cuando está armado»** (Bykom): ¿lo necesitan los clientes de IES? Implica seguir el estado armado/desarmado por partición.
- **Móviles**: ¿lista simple (nombre y teléfono) o con estado (libre/en camino/en el lugar) y tiempos? Este cambio propone la lista simple.
- **Quién ve qué**: ¿un operador ve todos los abonados o por área? Hoy el filtro es por área de Dispositivos; ¿hace falta un permiso por cuenta?
- **Automonitoreo** y aviso automático al titular por WhatsApp: fuera de este cambio hasta definir los mensajes.
