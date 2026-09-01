# 🤖 Agentes y Arquitectura OmniAccess

Este documento describe los procesos autónomos, la arquitectura del sistema, los lineamientos de diseño y la estructura de datos para el desarrollo de OmniAccess.

---

## 🏗️ Arquitectura del Sistema

El sistema opera en un modelo de dos servidores para maximizar el rendimiento y la estabilidad:

### 🌐 1. Server Front-end (Cerebro Visual)
- **Stack:** React 19 + Next.js 15 (App Router) + TypeScript + Tailwind CSS 4.
- **Ejecución:** `npm run dev:web` (Puerto 10001).
- **Responsabilidad:** Interfaz de usuario, gestión de datos CRUD, lógica de negocio de alto nivel y visualización de flujos.

### 🖥️ 2. Back-end / Webhook Server (Corazón de Datos)
- **Stack:** Node.js (Vanilla HTTP) + Socket.io + Prisma + Axios.
- **Ejecución:** `npm run dev:webhooks` (Puerto 10000).
- **Responsabilidad:** Ingesta de webhooks de hardware (Hikvision, Akuvox), procesamiento de imágenes en tiempo real, proxy de video MJPEG y comunicación bidireccional vía WebSockets.

---

## 🧬 Estructura de la Base de Datos (Modelos Detallados)

OmniAccess utiliza **Prisma ORM** con **PostgreSQL**. A continuación se detallan las tablas principales y su propósito:

### 👥 Identidad y Acceso
| Tabla | Campos Clave | Descripción |
| :--- | :--- | :--- |
| **`User`** | `id`, `name`, `role`, `unitId`, `dni`, `cara` | Registro maestro de personas. Incluye residentes, visitas y staff. |
| **`Unit`** | `id`, `name`, `type` (CASA/EDIFICIO), `parentId` | Jerarquía de espacios físicos (ej: Barrio > Edificio > Departamento). |
| **`Credential`** | `id`, `type` (PLATE/FACE/PIN/TAG), `value`, `userId` | Almacena los valores técnicos que permiten el acceso. |
| **`AccessGroup`** | `id`, `name` | Agrupaciones lógicas de usuarios para asignar permisos masivos. |
| **`Schedule`** | `id`, `days`, `startTime`, `endTime` | Restricciones horarias aplicadas a los grupos de acceso. |

### 🚗 Gestión Vehicular y Espacios
| Tabla | Campos Clave | Descripción |
| :--- | :--- | :--- |
| **`Vehicle`** | `plate`, `brand`, `model`, `color`, `userId` | Vehículos vinculados a usuarios específicos. |
| **`ParkingSlot`** | `id`, `label`, `unitId`, `x, y, width, height` | Mapeo de cocheras con coordenadas para visualización en plano. |
| **`TopologyNode`** | `id`, `x, y` | Coordenadas de los nodos en el mapa de flujo dinámico. |
| **`Bitacora`** | `id`, `type`, `name`, `dni`, `plate`, `photoPath` | Registro manual de guardia. Incluye fotos, notas y asociación a eventos de acceso. |

### 🛠️ Hardware y Eventos
| Tabla | Campos Clave | Descripción |
| :--- | :--- | :--- |
| **`Device`** | `id`, `name`, `brand`, `ip`, `mac`, `deviceType` | Configuración de cámaras LPR, terminales faciales e intercoms. |
| **`AccessEvent`** | `id`, `timestamp`, `decision`, `plateDetected`, `deviceId` | Log histórico de todos los intentos de entrada/salida. |
| **`CallEvent`** | `id`, `status`, `duration`, `callerId`, `calleeId` | Registro de llamadas realizadas desde intercomunicadores. |
| **`HardwareMirror`** | `deviceId`, `hardwareId`, `syncStatus` | Caché del estado interno del hardware para asegurar la sincronización. |

### 🤖 Configuración e Integraciones
| Tabla | Campos Clave | Descripción |
| :--- | :--- | :--- |
| **`Setting`** | `key`, `value` | Configuraciones globales (API Keys, Endpoints S3, etc). |
| **`WhatsAppSession`** | `phoneNumber`, `step`, `data` | Estado de las conversaciones en curso del Bot de WhatsApp. |
| **`WahaRequestLog`** | `fromNumber`, `messageBody`, `status` | Auditoría de mensajes recibidos y enviados vía WAHA. |

---

## 📚 Catálogo de APIs Disponibles

### 🔌 APIs de Core (Next.js - Puerto 10001)
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/events` | **GET** | Obtiene historial de eventos de acceso. |
| `/api/calendar/stats` | **GET** | Estadísticas mensuales de accesos (aprobados/denegados). |
| `/api/bitacora` | **GET/POST** | Gestión del registro manual de guardia con fotos. |
| `/api/system-status` | **GET** | Chequeo de salud del sistema (DB, S3, WAHA). |
| `/api/files/[...key]` | **GET** | Proxy para servir archivos protegidos de S3/MinIO. |
| `/api/users/[id]/face` | **POST** | Sube y actualiza foto facial de un usuario. |
| `/api/devices/[id]/faces/[uId]` | **POST** | Sincroniza una cara directamente a un dispositivo físico. |
| `/api/topology/positions` | **GET/POST** | Gestiona las posiciones de los nodos en el mapa de flujo. |
| `/api/proxy/device-image` | **GET** | Proxy para capturar imágenes en vivo desde dispositivos (Next.js). |

### 🔗 Webhooks y Streaming (Backend - Puerto 10000)
| Endpoint | Origen | Descripción |
| :--- | :--- | :--- |
| `/hikvision` | **Cámara LPR** | Ingesta de eventos ANPR y Reconocimiento Facial. |
| `/akuvox` | **Intercom** | Ingesta de eventos de acceso y llamadas de Akuvox. |
| `/whatsapp` | **WAHA** | Procesamiento de mensajes del chatbot. |
| `/api/live/[deviceId]` | **Browser** | **Stream MJPEG dinámico** para visualización de cámaras. |
| `/api/proxy/face` | **Browser** | Proxy especializado en recuperación de fotos de Doorlog. |

---

## 📡 Comunicación en Tiempo Real (Socket.io)

El servidor de webhooks (10000) emite eventos críticos a los que el Front-end se suscribe:

- `access_event`: Notificación de un nuevo evento de acceso (LPR/Faces).
- `device_status`: Actualización de estado (Online/Offline) de un dispositivo.
- `device_call`: Notificación de llamada entrante desde un intercomunicador.
- `webhook_debug`: Logs técnicos en tiempo real para depuración de ingesta.
- `system_alert`: Alertas críticas de error en drivers de hardware.
- `guard_presence`: Estado en tiempo real de las tablets (incluye IP local auto-detectada).
- `new_bitacora`: Notificación inmediata de un nuevo registro manual realizado por un guardia.

### 🚨 Eventos de Emergencia y Coordinación
- `guard_locations`: Actualización de coordenadas GPS de todos los guardias activos.
- `alert_status`: Estado global del modo de alerta (normal/emergencia).
- `active_missions`: Lista de misiones de respaldo activas.
- `backup_requested`: Notificación de nueva solicitud de apoyo.
- `backup_status_update`: Cambio de estado en una misión (aceptada/rechazada).
- `backup_resolved`: Notificación de misión resuelta.


---

## 🏎️ Sistema de Drivers
OmniAccess utiliza un sistema de drivers desacoplado en `src/lib/drivers`:
- **IDeviceDriver**: Interfaz base para todos los fabricantes.
- **Implementaciones**: `HikvisionDriver`, `AkuvoxDriver`, `DahuaDriver`, etc.
- **Regla:** Ningún componente de UI debe hablar directamente con el hardware; debe usar un Driver.

---

## 🎨 Lineamientos Estrictos de UI/UX

### 🧱 Uso de Librerías (Híbrido)
- **HeroUI** (ex NextUI): Tablas, Visualización de Datos, Feed en vivo, Animaciones.
- **shadcn/ui**: Formularios complejos, Inputs, Selects, Botones de acción estándar.

### 📏 Reglas Estrictas de Diseño
1. **Glassmorphism:** Fondos con `backdrop-blur-md` en componentes flotantes.
2. **Animaciones:** Transiciones suaves con `framer-motion`.
3. **Tipografía:** Fuentes **Inter** u **Outfit** únicamente.
4. **Floating UI (V2.1):** En interfaces de tablet (GuardConsole), priorizar botones flotantes (FAB) para acciones multimedia (Foto/Audio) para maximizar espacio de datos.

---

## 🛠️ Protocolos de Desempeño (Instrucciones para la IA)

### 🚨 Manejo de Errores y Robustez
- **Drivers:** Todo driver de hardware debe incluir un `try-catch` con reintentos automáticos (máx. 3) y timeout de 5-10s.
- **Logs:** Los errores de comunicación deben reportarse vía `system_alert`.

### 🔐 Seguridad y Privacidad
- **Credenciales:** Prohibido guardar contraseñas en texto plano. Usar `prisma.setting` o `.env`.
- **Enmascaramiento:** Datos sensibles (Claves, Tokens) deben mostrarse truncados en auditorías.

### 🏁 Checklist de Entrega (Obligatorio para Antigravity)
1. **Verificación de Tipos:** Ejecutar `npx tsc` si hay cambios en modelos de Prisma.
2. **Consistencia de UI:** Validar `backdrop-blur` y coherencia de colores.
3. **Persistencia:** Confirmar que los nuevos datos se guardan en PostgreSQL.

---

## 🛠️ Comandos de Desarrollo
```bash
npm run dev:web       # Front-end (10001)
npm run dev:webhooks  # Back-end (10000)
npx prisma studio     # DB Explorer
```

*Última actualización: 15 de Enero, 2026*

