# Instalación y Configuración de PM2 en Servidor Remoto

## Opción 1: Instalar PM2 (RECOMENDADO)

PM2 es un gestor de procesos que mantiene tu aplicación corriendo 24/7, reinicia automáticamente si falla, y facilita el monitoreo.

### Instalación Rápida:

```bash
# Instalar PM2 globalmente
sudo npm install -g pm2

# Verificar instalación
pm2 --version
```

### Uso Básico:

```bash
# Ir al directorio de la aplicación
cd /opt/OmniAccess  # o donde hayas clonado el repo

# Iniciar aplicación con PM2
pm2 start ecosystem.config.json

# Ver estado
pm2 status

# Ver logs en tiempo real
pm2 logs

# Reiniciar
pm2 restart all

# Detener
pm2 stop all

# Configurar inicio automático al arrancar el servidor
pm2 save
pm2 startup
# Ejecutar el comando que PM2 te muestre
```

---

## Opción 2: Sin PM2 - Usando systemd (Nativo de Linux)

Si prefieres no instalar PM2, puedes usar systemd que viene incluido en Linux.

### Crear Servicio para Web UI:

```bash
sudo nano /etc/systemd/system/omniaccess-web.service
```

**Contenido del archivo:**
```ini
[Unit]
Description=OmniAccess Web UI
After=network.target postgresql.service

[Service]
Type=simple
User=TU_USUARIO
WorkingDirectory=/opt/OmniAccess
Environment="NODE_ENV=production"
Environment="PORT=10001"
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

# Logs
StandardOutput=append:/var/log/omniaccess-web.log
StandardError=append:/var/log/omniaccess-web-error.log

[Install]
WantedBy=multi-user.target
```

### Crear Servicio para Webhooks:

```bash
sudo nano /etc/systemd/system/omniaccess-webhooks.service
```

**Contenido del archivo:**
```ini
[Unit]
Description=OmniAccess Webhooks Server
After=network.target postgresql.service

[Service]
Type=simple
User=TU_USUARIO
WorkingDirectory=/opt/OmniAccess
Environment="NODE_ENV=production"
Environment="WEBHOOK_PORT=10000"
Environment="HOST=0.0.0.0"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

# Logs
StandardOutput=append:/var/log/omniaccess-webhooks.log
StandardError=append:/var/log/omniaccess-webhooks-error.log

[Install]
WantedBy=multi-user.target
```

### Activar y Usar los Servicios:

```bash
# Recargar systemd
sudo systemctl daemon-reload

# Habilitar inicio automático
sudo systemctl enable omniaccess-web
sudo systemctl enable omniaccess-webhooks

# Iniciar servicios
sudo systemctl start omniaccess-web
sudo systemctl start omniaccess-webhooks

# Ver estado
sudo systemctl status omniaccess-web
sudo systemctl status omniaccess-webhooks

# Ver logs
sudo journalctl -u omniaccess-web -f
sudo journalctl -u omniaccess-webhooks -f

# Reiniciar
sudo systemctl restart omniaccess-web
sudo systemctl restart omniaccess-webhooks

# Detener
sudo systemctl stop omniaccess-web
sudo systemctl stop omniaccess-webhooks
```

---

## Opción 3: Sin PM2 - Usando screen (Temporal)

Para pruebas rápidas o desarrollo, puedes usar `screen`:

```bash
# Instalar screen
sudo apt install -y screen

# Crear sesión para web
screen -S omniaccess-web
cd /opt/OmniAccess
npm start
# Presionar Ctrl+A, luego D para desconectar

# Crear sesión para webhooks
screen -S omniaccess-webhooks
cd /opt/OmniAccess
node server.js
# Presionar Ctrl+A, luego D para desconectar

# Listar sesiones
screen -ls

# Reconectar a una sesión
screen -r omniaccess-web

# Matar una sesión
screen -X -S omniaccess-web quit
```

---

## Opción 4: Sin PM2 - Usando nohup (Muy Básico)

```bash
cd /opt/OmniAccess

# Iniciar web en background
nohup npm start > web.log 2>&1 &

# Iniciar webhooks en background
nohup node server.js > webhooks.log 2>&1 &

# Ver procesos
ps aux | grep node

# Ver logs
tail -f web.log
tail -f webhooks.log

# Detener (encontrar PID primero)
ps aux | grep node
kill PID_DEL_PROCESO
```

---

## Comparación de Opciones:

| Característica | PM2 | systemd | screen | nohup |
|----------------|-----|---------|--------|-------|
| Auto-reinicio | ✅ | ✅ | ❌ | ❌ |
| Inicio automático | ✅ | ✅ | ❌ | ❌ |
| Logs centralizados | ✅ | ✅ | ⚠️ | ⚠️ |
| Monitoreo | ✅ | ⚠️ | ❌ | ❌ |
| Fácil de usar | ✅ | ⚠️ | ✅ | ✅ |
| Producción | ✅ | ✅ | ❌ | ❌ |

**Recomendación:** 
- **Producción**: PM2 o systemd
- **Desarrollo/Pruebas**: screen
- **Temporal**: nohup

---

## Instalación Completa Paso a Paso (CON PM2):

```bash
# 1. Instalar PM2
sudo npm install -g pm2

# 2. Ir al directorio
cd /opt/OmniAccess

# 3. Compilar
npm run build

# 4. Iniciar con PM2
pm2 start ecosystem.config.json

# 5. Guardar configuración
pm2 save

# 6. Configurar inicio automático
pm2 startup
# Ejecutar el comando que te muestre

# 7. Verificar
pm2 status
pm2 logs
```

---

## Comandos Útiles de PM2:

```bash
# Ver estado
pm2 status

# Ver logs en tiempo real
pm2 logs

# Ver logs de un proceso específico
pm2 logs omniaccess-web

# Reiniciar todo
pm2 restart all

# Reiniciar un proceso
pm2 restart omniaccess-web

# Detener todo
pm2 stop all

# Eliminar procesos
pm2 delete all

# Monitor interactivo
pm2 monit

# Ver información detallada
pm2 show omniaccess-web

# Ver uso de recursos
pm2 list
```

---

## Solución de Problemas:

### PM2 no encuentra npm/node
```bash
# Verificar rutas
which node
which npm

# Actualizar PM2 con las rutas correctas
pm2 update
```

### Permisos denegados
```bash
# Dar permisos al directorio
sudo chown -R $USER:$USER /opt/OmniAccess
```

### Puerto ya en uso
```bash
# Ver qué usa el puerto
sudo lsof -i :10001
sudo lsof -i :10000

# Matar proceso
sudo kill -9 PID
```
