# 🎯 Detección Automática de Socket.IO - Solución Universal

## ✅ Problema Resuelto

La aplicación ahora **detecta automáticamente** si debe conectarse a Socket.IO usando:
- **Puerto 10000 directo** (para instalaciones sin proxy)
- **Ruta proxy** (para instalaciones con Nginx Proxy Manager u otros proxies)

## 🔍 Cómo Funciona

El código detecta automáticamente el escenario basándose en el **puerto desde el que se accede**:

```typescript
// Si accedes desde puerto estándar (80/443) → Usa proxy
// Si accedes desde otro puerto (ej: 3000) → Usa puerto 10000 directo

const isStandardPort = window.location.port === '' || 
                       window.location.port === '80' || 
                       window.location.port === '443';

const socketUrl = isStandardPort 
    ? `${protocol}://${window.location.hostname}`        // Con proxy
    : `${protocol}://${window.location.hostname}:10000`; // Sin proxy
```

## 📊 Escenarios Soportados

### **Escenario 1: Con Nginx Proxy Manager (Tu caso actual)**
```
URL de acceso: https://omniaccess.infratec.com.uy
Puerto detectado: '' (vacío, puerto estándar 443)
Socket.IO se conecta a: https://omniaccess.infratec.com.uy/socket.io/
✅ Funciona con la configuración de Custom Location en NPM
```

### **Escenario 2: Acceso Directo (Sin proxy)**
```
URL de acceso: http://192.168.1.100:3000
Puerto detectado: '3000' (no estándar)
Socket.IO se conecta a: http://192.168.1.100:10000/socket.io/
✅ Funciona conectándose directamente al puerto 10000
```

### **Escenario 3: Acceso Local**
```
URL de acceso: http://localhost:3000
Puerto detectado: '3000' (no estándar)
Socket.IO se conecta a: http://localhost:10000/socket.io/
✅ Funciona en desarrollo local
```

## 🚀 Configuración Requerida por Escenario

### **Con Proxy (Puerto 80/443):**
1. Configurar Custom Location en Nginx Proxy Manager:
   - Location: `/socket.io/`
   - Forward to: `localhost:10000`
   - ✅ Websockets Support

### **Sin Proxy (Acceso directo):**
1. Asegurarse de que el puerto 10000 esté abierto en el firewall
2. No se requiere configuración adicional

## 🔧 Verificación

Abre la consola del navegador (F12) y busca:

```
🔌 Connecting to socket: https://omniaccess.infratec.com.uy (Standard port: true)
```

O para acceso directo:

```
🔌 Connecting to socket: http://192.168.1.100:10000 (Standard port: false)
```

## ✨ Beneficios

- ✅ **Funciona en cualquier escenario** sin cambios de código
- ✅ **No requiere variables de entorno** adicionales
- ✅ **Detección automática** basada en el contexto
- ✅ **Compatible con HTTPS y HTTP**
- ✅ **Funciona con y sin proxy**

## 📝 Archivos Actualizados

Todos los componentes que usan Socket.IO ahora tienen esta lógica:

- `/src/app/guard/GuardConsole.tsx`
- `/src/app/admin/dashboard/page.tsx`
- `/src/app/admin/history/page.tsx`
- `/src/app/admin/consolas/page.tsx`
- `/src/app/admin/debug/page.tsx`
- `/src/components/dashboard/SystemFlow.tsx`

## 🎯 Resultado Final

**Tu instalación actual (con proxy):**
- ✅ Socket.IO se conecta a `https://omniaccess.infratec.com.uy/socket.io/`
- ✅ Nginx Proxy Manager redirige a `localhost:10000`
- ✅ No más errores `ERR_CONNECTION_REFUSED`
- ✅ Sensores y eventos en tiempo real funcionando

**Otras instalaciones (sin proxy):**
- ✅ Socket.IO se conecta directamente a `:10000`
- ✅ Funciona sin configuración adicional
