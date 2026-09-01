# Guía de Despliegue en Producción - OmniAccess

Esta aplicación está diseñada con una arquitectura modular de **3 componentes**, que pueden ejecutarse en un solo servidor monolítico o distribuirse en 3 servidores dedicados para mayor rendimiento y seguridad.

## 🏗️ Arquitectura del Sistema

| Componente | Servicio | Puerto Default | Descripción |
|------------|----------|----------------|-------------|
| **Server 1** | **PostgreSQL** | `5432` | Base de datos relacional (Usuarios, Eventos, Config). |
| **Server 2** | **MinIO (S3)** | `9000` / `9001` | Almacenamiento de fotos de evidencias (LPR y Rostros). |
| **Server 3** | **OmniAccess** | `10001` / `10000` | Panel Web (Next.js) y Servidor de Webhooks. |

---

## 🖥️ Server 1: Base de Datos (PostgreSQL)

### 1. Instalación
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
```

### 2. Crear Usuario y Base de Datos
```bash
sudo -u postgres psql

# En la consola SQL:
CREATE DATABASE omniaccess;
CREATE USER omniaccess_user WITH ENCRYPTED PASSWORD 'DB_PASSWORD_SEGURO';
GRANT ALL PRIVILEGES ON DATABASE omniaccess TO omniaccess_user;
\q
```

### 3. Permitir Conexiones Remotas (Si la App está en otro servidor)
Si la App y la BD están en servidores distintos, debes abrir PostgreSQL a la red.

**A. Editar `postgresql.conf`**:
```bash
sudo nano /etc/postgresql/14/main/postgresql.conf
# Cambiar: listen_addresses = '*'
```

**B. Editar `pg_hba.conf`**:
```bash
sudo nano /etc/postgresql/14/main/pg_hba.conf
# Agregar al final:
# host  omniaccess  omniaccess_user  IP_DEL_SERVER_APP/32  md5
host    omniaccess  omniaccess_user  0.0.0.0/0             md5  # (O restringir a la IP específica)
```

**C. Reiniciar**:
```bash
sudo systemctl restart postgresql
```

---

## 🗄️ Server 2: Almacenamiento (MinIO S3)

MinIO es necesario para guardar las fotos de los eventos. Recomendamos usar Docker.

### 1. Instalación (Vía Docker)
```bash
# Instalar Docker si no existe
curl -fsSL https://get.docker.com | sh

# Crear carpetas de datos
mkdir -p ~/minio/data

# Correr MinIO Server
docker run -d \
   -p 9000:9000 \
   -p 9001:9001 \
   --name minio \
   --restart always \
   -e "MINIO_ROOT_USER=admin_s3" \
   -e "MINIO_ROOT_PASSWORD=S3_PASSWORD_SEGURO" \
   -v ~/minio/data:/data \
   quay.io/minio/minio server /data --console-address ":9001"
```

### 2. Configuración de Buckets
1. Accede a la consola web: `http://IP_SERVER_MINIO:9001`
2. Ingresa con el usuario (`admin_s3`) y contraseña (`S3_PASSWORD_SEGURO`).
3. Ve a la sección **Buckets** y crea dos buckets:
   - `lpr` (Para matrículas)
   - `face` (Para rostros)
4. **IMPORTANTE**: Asegúrate de que los buckets sean **Públicos** (Access Policy: Public) o configura un usuario con permisos de lectura/escritura si prefieres más seguridad (la app usa las credenciales para firmar URLs o hacer proxy, pero public facilita el debug). **Recomendado: Private, la app gestiona el acceso vía proxy.**

---

## 🚀 Server 3: Aplicación OmniAccess

### 1. Prerrequisitos
```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs git

# PM2 (Gestor de Procesos)
sudo npm install -g pm2
```

### 2. Despliegue del Código
```bash
cd /opt
sudo git clone https://github.com/flavioGonz/OmniAccess.git
cd OmniAccess
sudo chown -R $USER:$USER .
```

### 3. Conexión de los 3 Servidores (.env)
Crea el archivo `.env` production-ready.

```bash
cp .env.example .env
nano .env
```

Configura las variables apuntando a las IPs de los Servidores 1 y 2:

```env
# === SERVER 1: DATABASE ===
DATABASE_URL="postgresql://omniaccess_user:DB_PASSWORD_SEGURO@IP_SERVER_POSTGRES:5432/omniaccess"

# === SERVER 2: MINIO STORAGE ===
S3_ENDPOINT="http://IP_SERVER_MINIO:9000"  # Puerto API (no consola)
S3_ACCESS_KEY="admin_s3"
S3_SECRET_KEY="S3_PASSWORD_SEGURO"
S3_BUCKET="lpr"
S3_BUCKET_FACE="face"

# === SERVER 3: APP CONFIG ===
WEBHOOK_PORT=10000
HOST=0.0.0.0
# URL pública donde los usuarios acceden al panel
NEXT_PUBLIC_API_URL="http://IP_SERVER_APP:10001"
```

### 4. Instalación Automática (Recomendada)
Hemos incluido un script que automatiza todo el proceso de instalación y configuración:

```bash
chmod +x install_app.sh
./install_app.sh
```

Este script ejecutará automáticamente los pasos de instalación de dependencias, sincronización de base de datos, compilación y configuración de PM2.

### 5. Instalación Manual (Alternativa)
Si prefieres hacerlo paso a paso:

```bash
# Instalar dependencias
npm install

# Sincronizar esquema con la Base de Datos Remota
npx prisma generate
npx prisma db push

# Compilar la aplicación web
npm run build
```

### 6. Iniciar Servicios (PM2 - Solo si fue Manual)
Usamos PM2 para mantener la app y el servidor de webhooks activos 24/7.

```bash
# Iniciar todo (usa ecosystem.config.json)
pm2 start ecosystem.config.json

# Guardar configuración para reinicios automáticos
pm2 save
pm2 startup
```

---

## 🔄 Flujo de Actualización

Cuando hagas cambios en el código y quieras actualizar el servidor de producción:

```bash
# 1. En tu PC local:
git add .
git commit -m "Mejoras..."
git push origin main

# 2. En el SERVER APP (Server 3):
cd /opt/OmniAccess
git pull origin main
npm install             # Si cambiaron dependencias
npx prisma generate     # Siempre recomendado
npx prisma db push      # Si cambiaste el esquema de BD
npm run build           # Recompilar Next.js
pm2 restart all         # Reiniciar procesos
```

## �️ Debugging y Logs

```bash
# Ver estado de los servicios
pm2 status

# Ver logs en tiempo real
pm2 logs

# Ver logs solo de web (Next.js)
pm2 logs omniaccess-web

# Ver logs solo de webhooks (Hikvision/Akuvox)
pm2 logs omniaccess-webhooks
```
