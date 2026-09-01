# Akuvox HTTP API - Referencia Completa

## Descripción General

La API HTTP de Akuvox permite controlar y sincronizar dispositivos de videoportero e intercomunicación. Todos los endpoints usan el protocolo HTTP con autenticación Basic.

## Configuración Base

### URL Base
```
http://DEVICE_IP
```

### Autenticación
```
Authorization: Basic base64(username:password)
```

**Ejemplo:**
```javascript
const auth = btoa('admin:admin'); // YWRtaW46YWRtaW4=
headers: {
  'Authorization': 'Basic ' + auth
}
```

### Credenciales por Defecto
- **Usuario**: `admin` o `api`
- **Contraseña**: `admin` o `Api*2011`

---

## Endpoints Principales

### 1. Control de Relé (Apertura de Puerta)

**Endpoint:**
```
POST /api/relay/trig
```

**Descripción:** Activa el relé para abrir la puerta.

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
- `num` (int): Número de relé (1-4, depende del modelo)
- `level` (int): Nivel de activación (0=Bajo, 1=Alto)
- `delay` (int): Duración en segundos (0-255)

**Respuesta Exitosa:**
```json
{
  "retcode": 0,
  "retmsg": "success"
}
```

**Ejemplo cURL:**
```bash
curl -X POST http://192.168.1.100/api/relay/trig \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"target":"relay","action":"trig","data":{"num":1,"level":1,"delay":5}}'
```

---

### 2. Agregar Tarjeta RFID

**Endpoint:**
```
POST /api/rfkey/add
```

**Descripción:** Registra una nueva tarjeta RFID en el dispositivo.

**Payload:**
```json
{
  "target": "rfkey",
  "action": "add",
  "data": {
    "item": [
      {
        "ID": "12345",
        "Code": "1234567890",
        "DoorNum": "1",
        "Tags": "0",
        "Mon": "1",
        "Tue": "1",
        "Wed": "1",
        "Thur": "1",
        "Fri": "1",
        "Sat": "1",
        "Sun": "1",
        "TimeStart": "00:00",
        "TimeEnd": "00:00"
      }
    ]
  }
}
```

**Parámetros:**
- `ID` (string): ID único interno (1-999999)
- `Code` (string): Número de tarjeta (8-10 dígitos)
- `DoorNum` (string): Número de puerta asociada (1-4)
- `Tags` (string): Estado (0=Permitido, 1=Bloqueado)
- `Mon-Sun` (string): Días activos (0=No, 1=Sí)
- `TimeStart/TimeEnd` (string): Horario válido (HH:MM)
  - `00:00-00:00` = Siempre válido

**Respuesta:**
```json
{
  "retcode": 0,
  "retmsg": "success",
  "data": {
    "success": 1,
    "failed": 0
  }
}
```

---

### 3. Eliminar Tarjeta RFID

**Endpoint:**
```
POST /api/rfkey/delete
```

**Payload:**
```json
{
  "target": "rfkey",
  "action": "delete",
  "data": {
    "item": [
      {
        "ID": "12345"
      }
    ]
  }
}
```

---

### 4. Listar Tarjetas RFID

**Endpoint:**
```
POST /api/rfkey/list
```

**Payload:**
```json
{
  "target": "rfkey",
  "action": "list",
  "data": {
    "start": 0,
    "count": 100
  }
}
```

**Respuesta:**
```json
{
  "retcode": 0,
  "data": {
    "total": 5,
    "item": [
      {
        "ID": "12345",
        "Code": "1234567890",
        "DoorNum": "1",
        ...
      }
    ]
  }
}
```

---

### 5. Agregar Rostro (Face Recognition)

**Endpoint:**
```
POST /api/face/add
```

**Descripción:** Registra un rostro para reconocimiento facial.

**Payload (Multipart Form-Data):**
```
POST /api/face/add
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="ID"
12345
--boundary
Content-Disposition: form-data; name="Name"
Juan Pérez
--boundary
Content-Disposition: form-data; name="UserCode"
12345
--boundary
Content-Disposition: form-data; name="image"; filename="face.jpg"
Content-Type: image/jpeg

[BINARY IMAGE DATA]
--boundary--
```

**Parámetros:**
- `ID` (string): ID único (1-999999)
- `Name` (string): Nombre del usuario
- `UserCode` (string): Código de usuario
- `image` (file): Imagen JPG del rostro (< 200KB)

**Requisitos de la Imagen:**
- Formato: JPG
- Tamaño: < 200KB
- Resolución mínima: 640x480
- Fondo claro y uniforme
- Rostro frontal, sin lentes oscuros

---

### 6. Eliminar Rostro

**Endpoint:**
```
POST /api/face/delete
```

**Payload:**
```json
{
  "target": "face",
  "action": "delete",
  "data": {
    "item": [
      {
        "ID": "12345"
      }
    ]
  }
}
```

---

### 7. Obtener Información del Dispositivo

**Endpoint:**
```
GET /api/device/info
```

**Respuesta:**
```json
{
  "retcode": 0,
  "data": {
    "model": "R20A",
    "firmware": "30.50.1.20",
    "mac": "00:11:22:33:44:55",
    "ip": "192.168.1.100",
    "sn": "ABC123456789"
  }
}
```

---

### 8. Reiniciar Dispositivo

**Endpoint:**
```
POST /api/device/reboot
```

**Payload:**
```json
{
  "target": "device",
  "action": "reboot"
}
```

⚠️ **Advertencia:** El dispositivo se reiniciará inmediatamente.

---

## Códigos de Respuesta

| retcode | Significado |
|---------|-------------|
| 0 | Éxito |
| -1 | Error genérico |
| -2 | Parámetros inválidos |
| -3 | Autenticación fallida |
| -4 | Recurso no encontrado |
| -5 | Operación no permitida |
| -10 | Memoria llena |

---

## Límites del Dispositivo

| Recurso | Límite |
|---------|--------|
| Tarjetas RFID | 10,000 |
| Rostros | 3,000 - 10,000 (según modelo) |
| Relés | 1-4 (según modelo) |
| Tamaño imagen rostro | 200 KB |

---

## Ejemplo de Implementación (TypeScript)

```typescript
import axios from 'axios';

class AkuvoxAPI {
  private baseUrl: string;
  private auth: string;

  constructor(ip: string, username: string, password: string) {
    this.baseUrl = `http://${ip}`;
    this.auth = Buffer.from(`${username}:${password}`).toString('base64');
  }

  private getHeaders() {
    return {
      'Authorization': `Basic ${this.auth}`,
      'Content-Type': 'application/json'
    };
  }

  async openDoor(relayNum: number = 1, delay: number = 5) {
    const response = await axios.post(
      `${this.baseUrl}/api/relay/trig`,
      {
        target: "relay",
        action: "trig",
        data: { num: relayNum, level: 1, delay }
      },
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  async addCard(cardNumber: string, userId: string) {
    const response = await axios.post(
      `${this.baseUrl}/api/rfkey/add`,
      {
        target: "rfkey",
        action: "add",
        data: {
          item: [{
            ID: userId,
            Code: cardNumber,
            DoorNum: "1",
            Tags: "0",
            Mon: "1", Tue: "1", Wed: "1",
            Thur: "1", Fri: "1", Sat: "1", Sun: "1",
            TimeStart: "00:00",
            TimeEnd: "00:00"
          }]
        }
      },
      { headers: this.getHeaders() }
    );
    return response.data;
  }
}

// Uso
const api = new AkuvoxAPI('192.168.1.100', 'admin', 'admin');
await api.openDoor();
await api.addCard('1234567890', '12345');
```

---

## Depuración

### Logs del Dispositivo
Acceder vía web: `http://DEVICE_IP/log.html`

### Probar Endpoints
Usar Postman o cURL para probar cada endpoint individualmente.

### Errores Comunes

**401 Unauthorized:**
- Verificar credenciales
- Confirmar que el usuario tenga permisos API

**Timeout:**
- Verificar conectividad de red
- Confirmar que el dispositivo esté encendido

**retcode: -10 (Memoria llena):**
- Eliminar tarjetas/rostros antiguos
- Reiniciar el dispositivo

---

## Referencias
- [Manual Oficial API Akuvox](../akuvox/API%20-%20Akuvox%20HTTP%20API%20Manual%2020220610.txt)
- [Driver Implementado](../../src/lib/drivers/AkuvoxDriver.ts)
- [Configuración de Webhooks](./akuvox-webhook.md)
