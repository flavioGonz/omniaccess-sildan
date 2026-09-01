#!/bin/bash

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Iniciando Instalación de OmniAccess ===${NC}"

# 1. Verificación de Node.js
echo -e "\n${YELLOW}[1/6] Verificando Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js no encontrado. Instalando Node.js 18+...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo -e "${GREEN}Node.js $(node -v) ya está instalado.${NC}"
fi

# 2. Verificación de PM2
echo -e "\n${YELLOW}[2/6] Verificando PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    echo "Instalando PM2 globalmente..."
    sudo npm install -g pm2
else
    echo -e "${GREEN}PM2 ya está instalado.${NC}"
fi

# 3. Instalación de Dependencias
echo -e "\n${YELLOW}[3/6] Instalando dependencias del proyecto...${NC}"
if [ -f "package.json" ]; then
    npm install
else
    echo -e "${RED}Error: No se encuentra package.json. Asegúrate de estar en la raíz del proyecto.${NC}"
    exit 1
fi

# 4. Configuración de Entorno (.env)
echo -e "\n${YELLOW}[4/6] Configurando variables de entorno...${NC}"
if [ ! -f ".env" ]; then
    echo "Copiando .env.example a .env..."
    cp .env.example .env
    echo -e "${YELLOW}IMPORTANTE: Se ha creado el archivo .env.${NC}"
    echo -e "${YELLOW}Por favor, edita el archivo .env con los datos de tu Base de Datos y MinIO antes de continuar.${NC}"
    read -p "Presiona ENTER cuando hayas editado el archivo .env..."
else
    echo -e "${GREEN}Archivo .env ya existe.${NC}"
fi

# 5. Base de Datos y Build
echo -e "\n${YELLOW}[5/6] Configurando Base de Datos y Compilando...${NC}"
echo "Generando cliente Prisma..."
npx prisma generate

echo "Sincronizando base de datos (DB Push)..."
npx prisma db push

echo "Compilando aplicación Next.js..."
npm run build

# 6. Despliegue con PM2
echo -e "\n${YELLOW}[6/6] Iniciando servicios con PM2...${NC}"
pm2 start ecosystem.config.json
pm2 save
pm2 startup

echo -e "\n${GREEN}=== Instalación Completada ===${NC}"
echo "Panel Web: http://localhost:10001"
echo "Webhooks: http://localhost:10000"
echo "Usa 'pm2 status' para ver el estado de los servicios."
