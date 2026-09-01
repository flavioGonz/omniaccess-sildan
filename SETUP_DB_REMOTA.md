# Configuración Rápida - Base de Datos Remota
# Servidor PostgreSQL: 192.168.1.232
# Usuario: postgres
# Password: Flavio20

## PASO 1: Configurar PostgreSQL Remoto (192.168.1.232)

### En el servidor 192.168.1.232, ejecutar:

```bash
# 1. Editar postgresql.conf para permitir conexiones externas
sudo nano /etc/postgresql/14/main/postgresql.conf

# Buscar y cambiar:
listen_addresses = '*'

# 2. Editar pg_hba.conf para permitir conexiones desde tu red
sudo nano /etc/postgresql/14/main/pg_hba.conf

# Añadir al final (permitir desde toda la red local):
host    all             postgres        192.168.1.0/24          md5
host    omniaccess      postgres        192.168.1.0/24          md5

# 3. Crear la base de datos omniaccess
sudo -u postgres psql

# Dentro de PostgreSQL:
CREATE DATABASE omniaccess;
\q

# 4. Abrir puerto 5432 en el firewall
sudo ufw allow from 192.168.1.0/24 to any port 5432

# 5. Reiniciar PostgreSQL
sudo systemctl restart postgresql
```

## PASO 2: Verificar Conexión desde el Equipo Remoto

```bash
# Instalar cliente PostgreSQL (si no está instalado)
sudo apt install -y postgresql-client

# Probar conexión
psql -h 192.168.1.232 -U postgres -d omniaccess

# Cuando pida password, ingresar: Flavio20
# Si conecta, verás: omniaccess=>
# Salir con: \q
```

## PASO 3: Configurar .env en el Equipo Remoto

```bash
# Editar archivo .env
nano .env
```

**Configuración del .env:**
```env
# Database Remota
DATABASE_URL="postgresql://postgres:Flavio20@192.168.1.232:5432/omniaccess"

# Webhook Server
WEBHOOK_PORT=10000
HOST=0.0.0.0

# Next.js (cambiar por la IP del servidor de aplicación)
NEXT_PUBLIC_API_URL=http://IP_SERVIDOR_APP:10001
```

## PASO 4: Desplegar Tablas en la Base de Datos Remota

```bash
# 1. Generar cliente Prisma
npx prisma generate

# 2. Aplicar esquema (crear todas las tablas)
npx prisma db push

# Verás algo como:
# ✔ Generated Prisma Client
# 
# The following migration(s) have been created and applied from new schema changes:
# 
# migrations/
#   └─ 20250129_create_all_tables/
#       └─ migration.sql
# 
# Your database is now in sync with your schema.
```

## PASO 5: Verificar que las Tablas se Crearon

```bash
# Conectar a PostgreSQL
psql -h 192.168.1.232 -U postgres -d omniaccess

# Listar todas las tablas
\dt

# Deberías ver:
#  Schema |       Name        | Type  |  Owner   
# --------+-------------------+-------+----------
#  public | AccessEvent       | table | postgres
#  public | AccessGroup       | table | postgres
#  public | Credential        | table | postgres
#  public | Device            | table | postgres
#  public | ParkingSlot       | table | postgres
#  public | Schedule          | table | postgres
#  public | Setting           | table | postgres
#  public | Unit              | table | postgres
#  public | User              | table | postgres
#  public | Vehicle           | table | postgres

# Ver estructura de una tabla específica
\d "User"

# Salir
\q
```

## PASO 6: Compilar y Ejecutar la Aplicación

```bash
# 1. Compilar para producción
npm run build

# 2. Iniciar con PM2
pm2 start ecosystem.config.json

# 3. Verificar estado
pm2 status

# 4. Ver logs
pm2 logs
```

## ✅ VERIFICACIÓN FINAL

Acceder a: **http://IP_SERVIDOR_APP:10001/admin/dashboard**

Si todo está correcto, deberías ver el dashboard funcionando (vacío porque no hay datos aún).

## 🔧 SOLUCIÓN DE PROBLEMAS

### Error: "Connection refused"
```bash
# Verificar que PostgreSQL esté escuchando en todas las interfaces
sudo netstat -plnt | grep 5432

# Debería mostrar:
# tcp  0  0.0.0.0:5432  0.0.0.0:*  LISTEN
```

### Error: "password authentication failed"
```bash
# Verificar password del usuario postgres
sudo -u postgres psql
\password postgres
# Ingresar: Flavio20
```

### Error: "no pg_hba.conf entry"
```bash
# Verificar que pg_hba.conf tiene la línea correcta
sudo cat /etc/postgresql/14/main/pg_hba.conf | grep 192.168.1
```

### Ver logs de PostgreSQL
```bash
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

## 📊 COMANDOS ÚTILES

```bash
# Ver todas las bases de datos
psql -h 192.168.1.232 -U postgres -l

# Hacer backup de la base de datos
pg_dump -h 192.168.1.232 -U postgres omniaccess > backup.sql

# Restaurar backup
psql -h 192.168.1.232 -U postgres omniaccess < backup.sql

# Eliminar todas las tablas (CUIDADO!)
psql -h 192.168.1.232 -U postgres -d omniaccess -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

---

**Resumen de Credenciales:**
- **Host**: 192.168.1.232
- **Puerto**: 5432
- **Usuario**: postgres
- **Password**: Flavio20
- **Base de Datos**: omniaccess
- **DATABASE_URL**: `postgresql://postgres:Flavio20@192.168.1.232:5432/omniaccess`
