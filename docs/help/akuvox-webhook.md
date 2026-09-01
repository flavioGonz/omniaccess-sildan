# Webhook Akuvox - Configuración y Uso

## Descripción General

Los dispositivos Akuvox (videoporteros, intercomunicadores) envían notificaciones HTTP GET cuando ocurren eventos de acceso. Este documento detalla cómo configurar y procesar estos webhooks.

## URL del Webhook

```
http://TU_SERVIDOR:10000/api/webhooks/akuvox
```

**Ejemplo Real:**
```
http://2f7a0121f1af.sn.mynetname.net:10000/api/webhooks/akuvox
```

## Eventos Soportados

### 1. Puerta Abierta (Door Open)

**Cuándo se dispara:** Cuando alguien cuelga el teléfono o se abre la puerta remotamente.

**URL de Configuración:**
```
http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=door_open&mac=$mac
```

**Parámetros:**
- `event`: `door_open`
- `mac`: Dirección MAC del dispositivo (variable automática `$mac`)

**Ejemplo de Request:**
```
GET /api/webhooks/akuvox?event=door_open&mac=00:1A:2B:3C:4D:5E
```

**Procesamiento:**
- Se registra como evento de acceso `GRANT`
- Se emite notificación WebSocket al dashboard
- Se actualiza el estado de la puerta en tiempo real

---

### 2. Tarjeta Válida (Card Valid)

**Cuándo se dispara:** Cuando se pasa una tarjeta RFID autorizada.

**URL de Configuración:**
```
http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=card_valid&mac=$mac&card=$card_sn
```

**Parámetros:**
- `event`: `card_valid`
- `mac`: Dirección MAC del dispositivo
- `card`: Número de serie de la tarjeta (variable `$card_sn`)

**Ejemplo de Request:**
```
GET /api/webhooks/akuvox?event=card_valid&mac=00:1A:2B:3C:4D:5E&card=1234567890
```

**Procesamiento:**
1. Busca la tarjeta en la base de datos (`Credential` tipo `TAG`)
2. Si encuentra el usuario asociado, lo vincula al evento
3. Registra como `GRANT` (acceso permitido)
4. Aparece en el dashboard en la sección **"Accesos RFID"**

---

### 3. Tarjeta Inválida (Card Invalid)

**Cuándo se dispara:** Cuando se pasa una tarjeta no autorizada o desconocida.

**URL de Configuración:**
```
http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=card_invalid&mac=$mac&card=$card_sn
```

**Parámetros:**
- `event`: `card_invalid`
- `mac`: Dirección MAC del dispositivo
- `card`: Número de serie de la tarjeta

**Ejemplo de Request:**
```
GET /api/webhooks/akuvox?event=card_invalid&mac=00:1A:2B:3C:4D:5E&card=9999999999
```

**Procesamiento:**
1. Intenta buscar la tarjeta en la BD
2. Registra como `DENY` (acceso denegado)
3. Útil para auditoría de intentos no autorizados

---

### 4. Reconocimiento Facial Válido (Face Valid)

**URL de Configuración:**
```
http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=face_valid&mac=$mac&user=$name
```

**Parámetros:**
- `event`: `face_valid`
- `mac`: Dirección MAC
- `user`: Nombre del usuario reconocido (opcional)

**Procesamiento:**
- Registra como `GRANT`
- Aparece en **"Reco Facial"** del dashboard

---

### 5. Reconocimiento Facial Inválido (Face Invalid)

**URL de Configuración:**
```
http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=face_invalid&mac=$mac
```

**Procesamiento:**
- Registra como `DENY`
- Usuario desconocido o no autorizado

---

## Configuración en el Dispositivo Akuvox

### Paso 1: Acceder a la Interfaz Web
1. Abrir navegador: `http://IP_DEL_DISPOSITIVO`
2. Login: `admin` / `admin` (o credenciales configuradas)

### Paso 2: Configurar Action URLs
Navegar a: **Phone > Action URL** (o **Settings > Action URL**)

### Paso 3: Asignar URLs a Eventos

| Evento en Akuvox | URL a Configurar |
|------------------|------------------|
| **Colgar (Hang Up)** | `http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=door_open&mac=$mac` |
| **Tarjeta Válida** | `http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=card_valid&mac=$mac&card=$card_sn` |
| **Tarjeta Inválida** | `http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=card_invalid&mac=$mac&card=$card_sn` |

### Paso 4: Guardar y Probar
- Hacer clic en **Save** o **Apply**
- Probar pasando una tarjeta o colgando el teléfono
- Verificar en `http://localhost:10001/admin/debug` que lleguen los eventos

---

## Depuración

### Ver Webhooks en Tiempo Real
Acceder a: `http://localhost:10001/admin/debug`

Esta página muestra:
- ✅ Todos los webhooks entrantes
- ✅ Parámetros completos
- ✅ Timestamp
- ✅ Filtros por fabricante

### Logs del Servidor
Los eventos se registran en la consola del servidor:
```bash
node server.js
```

Buscar líneas como:
```
[2024-12-24T11:00:00.000Z] === Akuvox Webhook Received ===
[2024-12-24T11:00:00.000Z] Akuvox Params: { event: 'card_valid', mac: '...', card: '...' }
```

---

## Solución de Problemas

### ❌ No llegan eventos
1. **Verificar conectividad**: Hacer ping desde el dispositivo al servidor
2. **Firewall**: Asegurar que el puerto 10000 esté abierto
3. **URL correcta**: Verificar que la URL no tenga espacios ni caracteres especiales
4. **MAC registrada**: El dispositivo debe estar registrado en `/admin/devices`

### ❌ Eventos llegan pero no se procesan
1. Verificar en `/admin/debug` que los parámetros sean correctos
2. Revisar logs del servidor para errores
3. Confirmar que la MAC del dispositivo coincida con la registrada en la BD

### ❌ Usuario no se vincula al evento
- La tarjeta debe estar registrada en `/admin/users` como credencial tipo `TAG`
- El valor debe coincidir exactamente con `$card_sn`

---

## Ejemplo Completo de Flujo

1. **Usuario pasa tarjeta** en el portero Akuvox
2. **Dispositivo envía**: `GET /api/webhooks/akuvox?event=card_valid&mac=001122334455&card=1234567890`
3. **Servidor procesa**:
   - Normaliza MAC: `001122334455`
   - Busca dispositivo en BD
   - Busca credencial con `value=1234567890` y `type=TAG`
   - Encuentra usuario asociado
4. **Crea evento** en `AccessEvent`:
   ```json
   {
     "deviceId": "...",
     "userId": "...",
     "decision": "GRANT",
     "details": "Valid RFID Card: 1234567890 - User: Juan Pérez",
     "direction": "ENTRY"
   }
   ```
5. **Notifica dashboard** vía WebSocket
6. **Aparece en tiempo real** en la sección "Accesos RFID"

---

## Referencias
- [Manual API Akuvox](../akuvox/API%20-%20Akuvox%20HTTP%20API%20Manual%2020220610.txt)
- [Callbacks Akuvox](../akuvox/AKUVOX_CALLBACKS.md)
