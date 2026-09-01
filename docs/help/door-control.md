# Control de Puertas - Apertura Remota

## Descripción General

El sistema permite abrir puertas remotamente desde el dashboard o mediante API. Esta funcionalidad está disponible para dispositivos Akuvox y otros que soporten control de relé.

## Métodos de Apertura

### 1. Desde el Dashboard

**Ubicación:** Monitor en Vivo (`/admin/dashboard`)

**Pasos:**
1. Localizar el dispositivo en la lista
2. Hacer clic en el botón de apertura (ícono de puerta)
3. Confirmación visual del comando enviado

**Requisitos:**
- Dispositivo registrado en `/admin/devices`
- Tipo: `FACE_TERMINAL` (Akuvox) o compatible
- IP y credenciales configuradas

---

### 2. Mediante API HTTP

**Endpoint:**
```
POST /api/devices/{deviceId}/open
```

**Ejemplo con cURL:**
```bash
curl -X POST http://localhost:10001/api/devices/abc123/open \
  -H "Content-Type: application/json"
```

**Respuesta Exitosa:**
```json
{
  "success": true,
  "message": "Door opened successfully",
  "deviceId": "abc123"
}
```

---

## Implementación por Fabricante

### Akuvox

**Protocolo:** HTTP API

**Endpoint del Dispositivo:**
```
POST http://DEVICE_IP/api/relay/trig
```

**Payload:**
```json
{
  "target": "relay",
  "action": "trig",
  "data": {
    "num": 1,
    "level": 1,
    "delay": 5
  }
}
```

**Parámetros:**
- `num`: Número de relé (1 = Relé principal)
- `level`: Nivel de activación (1 = Alto, 0 = Bajo)
- `delay`: Tiempo en segundos que permanece abierto (5 = 5 segundos)

**Autenticación:**
```
Authorization: Basic base64(username:password)
```

**Ejemplo Completo:**
```javascript
const response = await fetch('http://192.168.1.100/api/relay/trig', {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + btoa('admin:admin'),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    target: "relay",
    action: "trig",
    data: { num: 1, level: 1, delay: 5 }
  })
});
```

---

### Hikvision (Futuro)

**Protocolo:** ISAPI

**Endpoint:**
```
PUT http://DEVICE_IP/ISAPI/AccessControl/RemoteControl/door/1
```

**Payload:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<RemoteControlDoor>
  <cmd>open</cmd>
</RemoteControlDoor>
```

---

## Código del Driver

### AkuvoxDriver.ts

```typescript
async triggerRelay(device: Device): Promise<void> {
    console.log(`[Akuvox] Triggering relay on ${device.ip}`);

    const url = `${this.getBaseUrl(device)}/api/relay/trig`;

    const payload = {
        "target": "relay",
        "action": "trig",
        "data": {
            "num": 1,    // Relay 1
            "level": 1,  // High level (Active)
            "delay": 5   // 5 seconds
        }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: this.getAuthHeader(device),
            timeout: 5000
        });

        if (response.data && response.data.retcode === 0) {
            console.log(`[Akuvox] Relay triggered successfully`);
        } else {
            console.warn(`[Akuvox] Relay trigger failed`);
        }
    } catch (error: any) {
        console.error(`[Akuvox] Error triggering relay:`, error.message);
    }
}
```

---

## Seguridad

### Permisos Requeridos
- Solo usuarios con rol `ADMIN` o `OPERATOR` pueden abrir puertas
- Se registra cada apertura en el log de auditoría

### Registro de Eventos
Cada apertura remota genera un evento:
```json
{
  "type": "DOOR_OPEN_REMOTE",
  "deviceId": "...",
  "userId": "...",
  "timestamp": "2024-12-24T11:00:00Z",
  "method": "dashboard" // o "api"
}
```

---

## Configuración de Dispositivos

### Paso 1: Registrar Dispositivo
1. Ir a `/admin/devices`
2. Agregar nuevo dispositivo
3. Completar:
   - **Nombre**: Ej. "Portero Principal"
   - **Tipo**: `FACE_TERMINAL`
   - **Marca**: `AKUVOX`
   - **IP**: `192.168.1.100`
   - **Usuario**: `admin`
   - **Contraseña**: `admin`
   - **MAC**: `00:11:22:33:44:55`

### Paso 2: Probar Conexión
1. Guardar dispositivo
2. Ir al dashboard
3. Hacer clic en "Abrir Puerta"
4. Verificar que el relé se active

---

## Solución de Problemas

### ❌ Error: "Device not found"
- Verificar que el dispositivo esté registrado
- Confirmar que el `deviceId` sea correcto

### ❌ Error: "Connection timeout"
- Verificar conectividad de red
- Hacer ping al dispositivo: `ping 192.168.1.100`
- Confirmar que el puerto HTTP esté abierto (generalmente 80)

### ❌ Error: "Authentication failed"
- Verificar usuario y contraseña en `/admin/devices`
- Probar login manual en `http://DEVICE_IP`

### ❌ Relé no se activa
- Verificar cableado del relé
- Confirmar configuración de salida en el dispositivo
- Revisar logs del dispositivo

---

## Monitoreo

### Dashboard en Tiempo Real
El dashboard muestra el estado de las puertas:
- 🟢 **Verde**: Puerta cerrada
- 🔴 **Rojo**: Puerta abierta
- ⚪ **Gris**: Estado desconocido

### Logs del Servidor
```bash
tail -f server.log | grep "Relay"
```

Salida esperada:
```
[Akuvox] Triggering relay on 192.168.1.100
[Akuvox] Relay triggered successfully on 192.168.1.100
```

---

## Automatización

### Apertura Programada
Crear script para abrir puertas automáticamente:

```bash
#!/bin/bash
# Abrir puerta todos los días a las 8:00 AM

curl -X POST http://localhost:10001/api/devices/abc123/open
```

Agregar a crontab:
```
0 8 * * * /path/to/open-door.sh
```

---

## Referencias
- [Driver Akuvox](../../src/lib/drivers/AkuvoxDriver.ts)
- [API Manual Akuvox](../akuvox/API%20-%20Akuvox%20HTTP%20API%20Manual%2020220610.txt)
