# Spec Delta

## Purpose

Definir qué permisos existen en OmniAccess, cómo se agrupan por módulo y nivel, qué incluye cada uno y cómo se traducen los permisos viejos, para que un rol diga con precisión qué puede ver, operar y configurar una persona.

## ADDED Requirements

### Requirement: Catálogo por módulo, sección y nivel

El sistema SHALL ofrecer un catálogo único de permisos. Cada permiso pertenece a un módulo y a una sección y tiene un nivel: **Ver** (abrir y mirar), **Operar** (hacer la tarea del día: atender, tratar, crear, marcar) o **Configurar** (cambiar cómo funciona: reglas, catálogos, alta de equipos). Cada permiso tiene un rótulo y una descripción en una frase que un administrador entienda. El catálogo SHALL cubrir, como mínimo, estas secciones:

- **Operación**: Gestión de alarmas (ver, atender), Historial y lecturas (ver, exportar), Mapa y seguimiento (ver, editar mapas), Monitores de pared (ver, crear enlaces de pantalla).
- **LPR**: Monitor LPR (ver, operar), Lista de vigilancia (operar), Invitados (ver, gestionar), Plazas (ver, configurar).
- **Video**: Monitor CCTV y vivo (ver), Grabaciones y clips (operar), Búsqueda inteligente (ver).
- **Intrusión**: ver, atender, configurar reglas en las cámaras.
- **Alarm Hub**: ver eventos y mensajes, tratar eventos, armar y desarmar centrales, configurar centrales, zonas, cámaras, prioridades y procedimientos.
- **OmniVision**: ver (detecciones, búsqueda, calor, analíticas), configurar (reglas, entrenamiento, verificación).
- **Rostro**: ver, gestionar listas y cargas.
- **Filas**: ver y operar, configurar.
- **Guardia**: consola y bitácora, visitas y proveedores registrados, configurar puestos.
- **Padrón**: personas, unidades, vehículos y credenciales (cada una ver y editar), grupos de acceso.
- **Equipos**: dispositivos (ver, editar).
- **Administración**: ajustes, notificaciones, auditoría, mantenimiento (respaldos, base de datos, almacenamiento, borrado de datos), accesos al panel.

#### Scenario: Cada sección tiene su permiso
- **WHEN** se lista el catálogo
- **THEN** aparece un permiso para cada sección de la lista, con su módulo, su nivel, su rótulo y su descripción

#### Scenario: Ver sin editar en el padrón
- **WHEN** un rol tiene «Personas · ver» y no «Personas · editar»
- **THEN** quien tiene ese rol abre la lista de personas y no puede dar de alta, editar ni borrar a nadie

### Requirement: Los niveles se incluyen

Operar y Configurar de una sección SHALL incluir Ver de esa misma sección. Un rol guardado con Operar o Configurar sin Ver SHALL quedar con Ver.

#### Scenario: Tratar incluye ver
- **WHEN** se guarda un rol con «Alarm Hub · tratar» sin «Alarm Hub · ver»
- **THEN** el rol queda con los dos

### Requirement: Permisos delicados

El catálogo SHALL marcar como delicados los permisos que dan acceso permanente o que no tienen vuelta atrás: Accesos al panel, Mantenimiento, crear enlaces de pantalla y armar y desarmar centrales. Un permiso delicado se muestra distinto y su descripción dice por qué es delicado.

#### Scenario: Accesos marcado
- **WHEN** se mira el permiso Accesos al panel
- **THEN** figura como delicado, con la advertencia de que quien lo tiene puede darse cualquier otro permiso

### Requirement: Los permisos viejos se traducen sin quitar nada

Cada permiso del catálogo anterior al 23/10 (`monitor`, `intrusion`, `historial`, `mapa`, `invitados`, `vigilancia`, `guardia`, `acuseek`, `monitores`, `usuarios`, `unidades`, `vehiculos`, `grupos`, `plazas`, `dispositivos`, `centrales`, `filas`, `notificaciones`, `ajustes`, `accesos`) SHALL traducirse al conjunto de permisos nuevos que habilita exactamente las mismas pantallas y acciones que habilitaba. La traducción SHALL valer para los roles guardados y para las sesiones abiertas antes del cambio.

#### Scenario: Un rol con Monitor sigue viendo lo mismo
- **WHEN** un rol tenía sólo `monitor`
- **THEN** después del cambio sigue abriendo el Monitor LPR, el facial, el de filas, el CCTV y Gestión de alarmas, y sigue pudiendo atender alarmas

#### Scenario: Ajustes conserva OmniVision y mantenimiento
- **WHEN** un rol tenía `ajustes`
- **THEN** sigue abriendo la configuración, OmniVision, Auditoría y las tareas de mantenimiento

#### Scenario: Sesión abierta antes del cambio
- **WHEN** alguien entró antes del despliegue y su sesión trae permisos viejos
- **THEN** el sistema le aplica los permisos traducidos sin pedirle que vuelva a entrar

### Requirement: Administrador ve todo

El rol Administrador SHALL tener siempre todo el catálogo vigente, incluidos los permisos que se agreguen después, sin que haga falta editarlo ni volver a entrar.

#### Scenario: Permiso nuevo
- **WHEN** se agrega un permiso al catálogo
- **THEN** un administrador ya lo tiene en su sesión abierta

### Requirement: Toda pantalla tiene su permiso o es libre a propósito

Cada página de `/admin` y `/monitor` SHALL pedir un permiso del catálogo o estar en una lista explícita de páginas libres con sesión (el inicio del panel, «sin permiso», las novedades). Una página nueva sin permiso y fuera de esa lista SHALL hacer fallar las pruebas.

#### Scenario: Auditoría deja de estar abierta
- **WHEN** alguien sin el permiso Auditoría abre `/admin/audit`
- **THEN** va a la pantalla «sin permiso», que dice qué permiso falta

#### Scenario: Página nueva olvidada
- **WHEN** se agrega `src/app/admin/<nueva>/page.tsx` sin asignarle permiso
- **THEN** la prueba de cobertura falla y nombra la página
