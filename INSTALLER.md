# GUÍA DE INSTALACIÓN - LPR ACCESS CONTROL SYSTEM

Este documento detalla los pasos necesarios para instalar y desplegar el sistema en un nuevo servidor o PC.

## PRERREQUISITOS

Asegúrese de tener instalado el siguiente software antes de comenzar:

1.  **Node.js**: Versión 18 o superior (LTS recomendado). [Descargar aquí](https://nodejs.org/).
2.  **PostgreSQL**: Base de datos relacional. [Descargar aquí](https://www.postgresql.org/download/).
3.  **Git**: Para clonar el repositorio. [Descargar aquí](https://git-scm.com/).

## PASO 1: OBTENER EL CÓDIGO

Clone el repositorio en la carpeta deseada:

```bash
git clone <URL_DEL_REPO>
cd LPR-Node
```

## PASO 2: CONFIGURACIÓN DE ENTORNO

1.  En la raíz del proyecto, localice el archivo `.env.example`.
2.  Haga una copia de este archivo y renómbrelo a `.env`.
3.  Abra el archivo `.env` y configure las variables según su entorno:

    ```env
    DATABASE_URL="postgresql://usuario:password@localhost:5432/nombre_db?schema=public"
    
    # Puertos
    WEBHOOK_PORT=10000  # Puerto para eventos de cámaras
    PORT=10001          # Puerto para el panel web
    HOST=0.0.0.0
    ```

    *Asegúrese de que la base de datos (ej: `lpr_db`) exista en su servidor PostgreSQL.*

## PASO 3: INSTALACIÓN DE DEPENDENCIAS

Ejecute el siguiente comando para instalar todas las librerías necesarias:

```bash
npm install
```

## PASO 4: EJECUCIÓN DEL SCRIPT DE INSTALACIÓN AUTOMÁTICA (RECOMENDADO)

Hemos incluido un script que automatiza la instalación de dependencias, configuración de base de datos y despliegue con PM2.

```bash
chmod +x install_app.sh
./install_app.sh
```

Este script se encargará de:
1.  Verificar e instalar Node.js y PM2 si no existen.
2.  Instalar las dependencias del proyecto (`npm install`).
3.  Generar el cliente de Prisma y sincronizar la base de datos.
4.  Compilar la aplicación ("build").
5.  Iniciar los servicios con PM2 y configurar el inicio automático.

*Si prefiere la instalación manual, continúe con los pasos siguientes.*

## PASO 5: CONFIGURACIÓN MANUAL (Si no usó el script)

### Configuración de la Base de Datos

Sincronice el esquema de Prisma con su base de datos:

```bash
npx prisma generate
npx prisma db push
```

*Opcional: Si desea cargar datos iniciales (seed):*
```bash
node seed-devices.js
```

## PASO 6: EJECUCIÓN DEL SISTEMA

### Para iniciar todos los servicios:
Necesitará dos terminales (o ejecutar en segundo plano):

**Terminal 1 (Webhooks/Socket Server):**
```bash
npm run dev:webhooks
```
*Escuchando en puerto 10000*

**Terminal 2 (Panel Web):**
```bash
npm run dev:web
```
*Acceso web en http://localhost:10001*

### Modo Producción
Para entornos productivos, compile y ejecute la versión optimizada:

```bash
npm run build
npm run start:web
# En otra terminal:
npm run start:webhooks
```

## PASO 6: CONFIGURACIÓN DE CÁMARAS

1.  Acceda al panel de administración en `/admin/devices`.
2.  Agregue sus cámaras LPR o terminales faciales.
3.  Configure los dispositivos físicos para apuntar al webhook del servidor:
    *   **URL Webhook**: `http://<IP_SERVIDOR>:10000/api/webhooks/hikvision`

## SOLUCIÓN DE PROBLEMAS

*   **Error de conexión a DB**: Verifique `DATABASE_URL` y que el servicio de PostgreSQL esté corriendo.
*   **Webhooks no recibidos**: Asegúrese de que el firewall de Windows permita el tráfico en el puerto 10000 y que las cámaras tengan acceso a la IP del servidor.
