# 🚀 Configuración Rápida - Nginx Proxy Manager GUI

## ⚠️ Problema Actual
El navegador intenta conectarse a `https://omniaccess.infratec.com.uy:10000/socket.io/` pero el proxy no está configurado para ese puerto.

## ✅ Solución en 3 Pasos

### **Paso 1: Edita tu Proxy Host Existente**

1. Abre **Nginx Proxy Manager** en tu navegador
2. Ve a **"Hosts" → "Proxy Hosts"**
3. Encuentra `omniaccess.infratec.com.uy` y haz clic en los **3 puntos** → **"Edit"**

### **Paso 2: Agrega Custom Location para Socket.IO**

1. En el diálogo de edición, ve a la pestaña **"Custom Locations"**
2. Haz clic en **"Add Location"**
3. Configura así:

```
┌─────────────────────────────────────────┐
│ Define Location:  /socket.io/          │
│ Scheme:           http                  │
│ Forward Hostname: localhost             │
│ Forward Port:     10000                 │
│ ☑ Websockets Support (IMPORTANTE!)     │
└─────────────────────────────────────────┘
```

4. Haz clic en el ícono de **engranaje** ⚙️ (Advanced)
5. En **"Custom Nginx Configuration"** pega esto:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
proxy_set_header Host $host;
proxy_cache_bypass $http_upgrade;
proxy_read_timeout 86400;
```

6. Haz clic en **"Save"**

### **Paso 3: Verifica la Configuración Principal**

Asegúrate de que en la pestaña **"Details"** tengas:

```
┌─────────────────────────────────────────┐
│ Domain Names:     omniaccess.infratec.com.uy
│ Scheme:           http                  │
│ Forward Hostname: localhost             │
│ Forward Port:     3000                  │
│ ☑ Websockets Support                   │
│ ☑ Block Common Exploits                │
└─────────────────────────────────────────┘
```

## 🎯 Resultado Esperado

Después de guardar, cuando recargues la página:

- ✅ No verás más errores `ERR_CONNECTION_REFUSED`
- ✅ Socket.IO se conectará correctamente
- ✅ Los sensores funcionarán
- ✅ El dashboard mostrará eventos en tiempo real

## 📸 Referencia Visual

Tu configuración debería verse así:

**Custom Locations:**
```
┌──────────────────────────────────────────────────┐
│ Location          Scheme    Forward To           │
├──────────────────────────────────────────────────┤
│ /socket.io/       http      localhost:10000      │
└──────────────────────────────────────────────────┘
```

## 🔍 Verificación

1. Guarda los cambios en Nginx Proxy Manager
2. Recarga la página: `https://omniaccess.infratec.com.uy/guard`
3. Abre la consola del navegador (F12)
4. Deberías ver: `✅ Socket connected` (sin errores)

## ❓ Si Sigue Sin Funcionar

Verifica que:
- El puerto 10000 esté corriendo: `pm2 list` (debe mostrar `omniaccess-webhooks`)
- Nginx Proxy Manager esté en la misma red que la aplicación
- No haya firewall bloqueando el puerto 10000 localmente
