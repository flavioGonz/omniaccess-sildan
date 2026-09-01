# Configuración de Cámaras Hikvision

## Direcciones del Webhook

### Desde la Red Local
Usa la IP local del servidor:
- `http://192.168.196.191:10000/api/webhooks/hikvision`
- `http://10.106.111.130:10000/api/webhooks/hikvision`

### Prueba de Conectividad

**Desde el navegador de la cámara o cualquier dispositivo en la red:**
```
http://[IP_DEL_SERVIDOR]:10000/api/webhooks/hikvision
```

Deberías ver:
```json
{
  "status": "ok",
  "message": "Hikvision webhook endpoint is active",
  "timestamp": "..."
}
```

## Configuración en la Cámara Hikvision

1. Accede a la interfaz web de la cámara
2. Ve a **Configuration → Event → Smart Event**
3. Busca **HTTP Listening** o **HTTP Notification**
4. Configura:
   - **URL**: `http://[IP_SERVIDOR]:10000/api/webhooks/hikvision`
   - **Method**: `POST`
   - **Protocol**: `HTTP/1.1`

## Firewall de Windows

Si la cámara no puede conectarse, necesitas abrir el puerto 10000:

**Ejecuta PowerShell como Administrador:**
```powershell
netsh advfirewall firewall add rule name="Next.js Port 10000" dir=in action=allow protocol=TCP localport=10000
```

## Solución de Problemas

### 1. Verifica que el servidor esté escuchando
En el navegador local:
```
http://localhost:10000/api/webhooks/hikvision
```

### 2. Verifica desde otro dispositivo en la red
```
http://[IP_SERVIDOR]:10000/api/webhooks/hikvision
```

### 3. Revisa los logs del servidor
La consola mostrará:
```
=== Hikvision Webhook Received ===
```

### 4. Dominio mynetname.net
Si usas `2f7a0121f1af.sn.mynetname.net`, asegúrate de:
- El dominio apunta a la IP correcta
- El router tiene port forwarding configurado (10000 → IP del servidor)
- El firewall permite conexiones entrantes en el puerto 10000
