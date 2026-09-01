# Integración WAHA (WhatsApp HTTP API)

## 📡 Endpoint del Webhook

OmniAccess expone el siguiente endpoint para recibir mensajes de WhatsApp desde WAHA:

```
POST http://TU_SERVIDOR:10000/api/waha/webhook
```

**Ejemplo con IP local:**
```
http://192.168.99.108:10000/api/waha/webhook
```

## 🔧 Configuración en WAHA

### 1. Configurar el Webhook en WAHA

Debes configurar WAHA para que envíe los mensajes recibidos a OmniAccess:

```bash
POST http://waha:3000/api/sessions/default/webhook
Content-Type: application/json

{
  "url": "http://192.168.99.108:10000/api/waha/webhook",
  "events": ["message"],
  "hmac": null
}
```

### 2. Configurar OmniAccess

Ve a **Configuración → Chatbot (WAHA)** y completa:

- **URL del Servidor WAHA**: `http://waha:3000` (o la IP donde esté corriendo WAHA)
- **API Key**: (opcional, solo si configuraste autenticación en WAHA)

## 🤖 Comandos del Chatbot

El asistente virtual responde a los siguientes comandos por WhatsApp:

| Comando | Descripción |
|---------|-------------|
| `hola`, `hi`, `menu` | Muestra el menú de comandos disponibles |
| `estado` | Estado general del sistema (dispositivos, usuarios, eventos del día) |
| `últimos accesos` | Muestra los últimos 5 eventos de acceso |
| `quién está` | Lista las personas que han ingresado en las últimas 12 horas |
| `cámaras` | Estado de todos los dispositivos conectados |
| `abrir [puerta]` | Información sobre control remoto (requiere autenticación web) |

## 📋 Formato del Webhook de WAHA

WAHA enviará webhooks con el siguiente formato:

```json
{
  "event": "message",
  "session": "default",
  "payload": {
    "from": "5491112345678@c.us",
    "body": "estado",
    "timestamp": 1704672000,
    "hasMedia": false
  }
}
```

## 🔐 Seguridad

- El endpoint `/api/waha/webhook` está protegido por validación de origen
- Los comandos sensibles (como "abrir puerta") requieren autenticación adicional desde el panel web
- Se recomienda usar HTTPS en producción y configurar un API Key en WAHA

## 🚀 Flujo de Comunicación

```
Usuario WhatsApp
    ↓ (mensaje)
WAHA Server
    ↓ (webhook POST)
OmniAccess :10000/api/waha/webhook
    ↓ (procesa comando)
Base de Datos PostgreSQL
    ↓ (consulta datos)
OmniAccess
    ↓ (envía respuesta POST)
WAHA Server /api/sendText
    ↓ (mensaje)
Usuario WhatsApp
```

## 📝 Ejemplo de Uso

1. Usuario envía: `"estado"`
2. WAHA recibe el mensaje y lo envía a OmniAccess
3. OmniAccess consulta la base de datos
4. OmniAccess responde:
   ```
   📊 Estado del Sistema
   
   ✅ Sistema Operativo
   🎥 Dispositivos: 5
   👥 Usuarios: 23
   📈 Eventos hoy: 47
   ```
5. WAHA envía la respuesta al usuario por WhatsApp

## 🛠️ Troubleshooting

### El webhook no recibe mensajes
- Verifica que WAHA tenga configurada la URL correcta del webhook
- Revisa los logs del servidor con: `pm2 logs webhook`
- Asegúrate de que el puerto 10000 esté accesible desde el contenedor de WAHA

### Las respuestas no se envían
- Verifica que la URL de WAHA esté configurada correctamente en OmniAccess
- Revisa que la sesión de WhatsApp esté activa en WAHA
- Comprueba los logs para ver errores de conexión

### Comandos no reconocidos
- El chatbot busca palabras clave en minúsculas
- Asegúrate de escribir comandos como "estado", "últimos accesos", etc.
- Escribe "menu" para ver todos los comandos disponibles
