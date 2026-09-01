# Sistema LPR & Face Access Control - Estado Actual

## ✅ Funcionalidades Implementadas

### 1. Webhooks de Acceso (Hikvision y Akuvox)
- **Hikvision**: Procesa eventos LPR y faciales desde cámaras.
- **Akuvox**: Soporta terminales de la serie R29, A05, E16, etc.
- **Lógica**: Identificación por MAC/IP, validación de credenciales en DB, guardado de capturas en S3/Local.
- **Respuesta**: Emite eventos vía Socket.io y responde a los dispositivos para abrir puertas.

### 2. Dashboard y Gestión Administrativa
- **Dashboard**: Vista en tiempo real de eventos con fotos y decisiones.
- **Dispositivos**: CRUD de cámaras y terminales con prueba de conexión ISAPI/Akuvox.
- **Usuarios/Unidades**: Gestión de residentes, visitantes y su estructura jerárquica.
- **Historial Maestro**: Tabla avanzada con filtros, scroll infinito y exportación a Excel.

### 3. Chatbot WhatsApp (WAHA Integration)
- **Comandos**: `estado`, `ultimo`, `entradas`, `salidas`, `eventos`.
- **Matrículas**: Consulta detallada enviando `ABC123.` (con punto) y gestión enviando `matricula ABC123`.
- **Registro**: Permite agregar usuarios y matrículas directamente desde WhatsApp mediante flujo de sesión.
- **Alertas**: Notificaciones en tiempo real de accesos denegados o permitidos.

### 4. Drivers de Dispositivos (Lib)
- **HikvisionDriver**: Sincronización de matrículas y rostros (múltiples estrategias de búsqueda).
- **AkuvoxDriver**: Sincronización de rostros, tags, PINs y apertura remota (relays).

## 📊 Base de Datos
- **Prisma**: Uso de PostgreSQL.
- **Modelos**: User, Vehicle, Unit, Credential, AccessGroup, Schedule, AccessEvent, WhatsAppSession, WahaRequestLog.

## 🚀 Próximos Pasos (Prioritarios)

1. **Control de Horarios (Schedules)**: Implementar la validación de horas/días en los webhooks de acceso.
2. **Autenticación**: Implementar NextAuth.js para el panel administrativo.
3. **Mejoras Chatbot**:
   - Comando `quien esta` (lista de personas presentes hoy).
   - Búsqueda de personas por nombre.
4. **Optimización**: Usar `sharp` para procesar miniaturas de eventos y ahorrar almacenamiento.
5. **Drivers restantes**: Completar implementaciones de Dahua, Intelbras y ZKTeco.
6. **App Móvil**: Iniciar desarrollo de visualizador de eventos para residentes.


## 📞 URLs Importantes

- **Dashboard**: http://localhost:10001/admin/dashboard
- **Dispositivos**: http://localhost:10001/admin/devices
- **Usuarios**: http://localhost:10001/admin/users
- **Unidades**: http://localhost:10001/admin/units
- **Grupos**: http://localhost:10001/admin/groups
- **Historial**: http://localhost:10001/admin/history
- **Webhook Hikvision**: http://[IP]:10000/api/webhooks/hikvision
- **Webhook Akuvox**: http://[IP]:10000/api/webhooks/akuvox
