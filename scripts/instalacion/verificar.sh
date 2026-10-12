#!/bin/bash
# Verificación de una instalación de OmniAccess, pieza por pieza, adentro del CT.
#
#   bash /opt/OmniAccess/scripts/instalacion/verificar.sh
#
# Por qué existe: «la app abre» no dice nada de lo que hay detrás. En el laboratorio (12/10) el
# login andaba mientras MinIO y WhatsApp salían caídos en la topología, Modos mostraba dos modos
# a la vez y el detector de objetos no estaba corriendo. Esto pregunta a cada pieza lo mismo que
# le pregunta la app, y lo dice en una línea: OK, AVISO (anda, pero no como debería) o FALLA.
# Termina con código 1 si hay alguna FALLA, para poder usarlo al final de un instalador.
#
# No muestra claves: las lee del .env sólo para preguntar.

cd /opt/OmniAccess || exit 1
FALLAS=0; AVISOS=0
ok()    { printf "  \033[32mOK\033[0m     %-22s %s\n" "$1" "$2"; }
aviso() { printf "  \033[33mAVISO\033[0m  %-22s %s\n" "$1" "$2"; AVISOS=$((AVISOS+1)); }
falla() { printf "  \033[31mFALLA\033[0m  %-22s %s\n" "$1" "$2"; FALLAS=$((FALLAS+1)); }
http()  { curl -s -o /dev/null -m "${3:-5}" -w "%{http_code}" "$1" ${2:+-H "$2"}; }
val()   { grep "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"'; }

echo "Servicios del sistema"
for s in postgresql redis-server minio go2rtc docker; do
  systemctl is-active --quiet "$s" && ok "$s" "activo" || falla "$s" "$(systemctl is-active "$s" 2>&1)"
done

echo "Procesos de la app (pm2)"
for p in omniaccess-web omniaccess-webhooks tracking-worker dispatch-worker omniaccess-vigia vision-worker omniaccess-entrenador; do
  st=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys;d={x['name']:x['pm2_env']['status'] for x in json.load(sys.stdin)};print(d.get('$p','no está'))")
  [ "$st" = "online" ] && ok "$p" "online" || falla "$p" "$st"
done

echo "Puntos de entrada"
c=$(http http://127.0.0.1:10001/login); [ "$c" = 200 ] && ok "panel :10001" "200" || falla "panel :10001" "HTTP $c"
c=$(http http://127.0.0.1:10000/); [ "$c" != 000 ] && ok "webhooks :10000" "contesta ($c)" || falla "webhooks :10000" "no contesta"
c=$(http http://127.0.0.1:9000/minio/health/live); [ "$c" = 200 ] && ok "minio :9000" "vivo" || falla "minio :9000" "HTTP $c"
c=$(http http://127.0.0.1:1984/api); [ "$c" = 200 ] && ok "go2rtc :1984" "200" || falla "go2rtc :1984" "HTTP $c"
redis-cli -t 3 ping 2>/dev/null | grep -q PONG && ok "redis :6379" "PONG" || falla "redis :6379" "no contesta"

echo "Base de datos y ajustes"
DB="$(val DATABASE_URL | sed 's/?schema=public//')"
if psql "$DB" -Atc "select 1" >/dev/null 2>&1; then
  ok "postgres" "$(psql "$DB" -Atc "select count(*) from pg_tables where schemaname='public'") tablas"
  pend=$(./node_modules/.bin/prisma migrate status 2>&1 | grep -c "not yet been applied")
  [ "$pend" = 0 ] && ok "migraciones" "al día" || falla "migraciones" "hay migraciones sin aplicar"
  modos=$(psql "$DB" -Atc "select count(*) from \"Setting\" where key in ('MODULE_LPR','MODULE_FACE','MODULE_QUEUE') and value='true'")
  [ "$modos" = 1 ] && ok "modo" "uno prendido" || falla "modo" "$modos modos prendidos (tiene que haber exactamente uno) — node scripts/instalacion/ajustes-iniciales.js"
  for k in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET_LPR; do
    n=$(psql "$DB" -Atc "select count(*) from \"Setting\" where key='$k' and value<>''")
    [ "$n" = 1 ] || falla "ajuste $k" "falta — node scripts/instalacion/ajustes-iniciales.js"
  done
  admins=$(psql "$DB" -Atc "select count(*) from \"User\" where role='ADMIN'")
  [ "$admins" -ge 1 ] && ok "administrador" "$admins" || aviso "administrador" "no hay ninguno — node scripts/crear-admin.js"
else
  falla "postgres" "no se pudo conectar con DATABASE_URL"
fi

echo "GPU"
if nvidia-smi -L >/dev/null 2>&1; then
  ok "nvidia-smi" "$(nvidia-smi --query-gpu=name,driver_version,temperature.gpu --format=csv,noheader)"
else
  falla "nvidia-smi" "sin driver en el CT (¿driver cargado en el host? ¿Secure Boot sin la llave enrolada?)"
fi

echo "Contenedores"
for img in omni-lpr:gpu omni-vision:gpu omni-entrenador:gpu devlikeapro/waha:latest; do
  docker image inspect "$img" >/dev/null 2>&1 && ok "imagen $img" "construida" || falla "imagen $img" "no está"
done
# Lector de matrículas
if [ "$(docker inspect -f '{{.State.Running}}' omni-lpr 2>/dev/null)" = true ]; then
  c=$(http http://127.0.0.1:8000/api/health)
  dev=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' omni-lpr | grep ^EXECUTION_DEVICE= | cut -d= -f2)
  if [ "$c" != 200 ]; then falla "omni-lpr" "corre pero /api/health da $c"
  elif docker logs omni-lpr 2>&1 | grep -q "CUDAExecutionProvider"; then ok "omni-lpr" "contesta · GPU (CUDA)"
  else aviso "omni-lpr" "contesta · en CPU (EXECUTION_DEVICE=$dev) — con GPU: SIN_BUILD=1 sh services/omni-lpr/run.sh"; fi
else falla "omni-lpr" "no corre — sh services/omni-lpr/run.sh"; fi
# OmniVision (detector de objetos: RF-DETR + atributos + texto + búsqueda)
if [ "$(docker inspect -f '{{.State.Running}}' omni-vision 2>/dev/null)" = true ]; then
  sal=$(curl -s -m 8 http://127.0.0.1:8010/salud)
  prov=$(echo "$sal" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('modelo'),d.get('proveedor'))" 2>/dev/null)
  case "$prov" in
    *CUDA*) ok "omni-vision" "$prov" ;;
    "")     falla "omni-vision" "corre pero /salud no contesta" ;;
    *)      aviso "omni-vision" "$prov (en CPU) — con GPU: SIN_BUILD=1 sh services/omni-vision/run.sh" ;;
  esac
  # Una detección de verdad, no sólo «contesta»: una foto conocida tiene que dar al menos un objeto.
  if [ -f /tmp/omni-prueba.jpg ] || curl -fsSL -m 20 -o /tmp/omni-prueba.jpg http://images.cocodataset.org/val2017/000000000785.jpg; then
    n=$(curl -s -m 60 -F "imagen=@/tmp/omni-prueba.jpg" http://127.0.0.1:8010/detectar | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d.get('objetos',[])))" 2>/dev/null)
    [ -n "$n" ] && [ "$n" -ge 1 ] && ok "omni-vision detecta" "$n objeto(s) en la foto de prueba" || aviso "omni-vision detecta" "la foto de prueba no dio objetos (respuesta: ${n:-ninguna})"
  fi
else falla "omni-vision" "no corre — sh services/omni-vision/run.sh"; fi
# WhatsApp
if [ "$(docker inspect -f '{{.State.Running}}' waha 2>/dev/null)" = true ]; then
  KEY=$(grep ^WAHA_API_KEY= /root/waha.env 2>/dev/null | cut -d= -f2)
  ses=$(curl -s -m 5 -H "X-Api-Key: $KEY" http://127.0.0.1:3000/api/sessions | python3 -c "import json,sys;d=json.load(sys.stdin);print(','.join(s.get('status','?') for s in d) or 'sin sesión')" 2>/dev/null)
  case "$ses" in *WORKING*) ok "whatsapp" "sesión $ses" ;; "") falla "whatsapp" "la API no contesta (¿clave?)" ;; *) aviso "whatsapp" "pasarela arriba, $ses (falta escanear el QR)" ;; esac
else falla "whatsapp" "el contenedor waha no corre"; fi

echo
echo "Resultado: $FALLAS falla(s), $AVISOS aviso(s)."
[ "$FALLAS" = 0 ]
