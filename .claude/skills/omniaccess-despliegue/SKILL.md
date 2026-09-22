---
name: omniaccess-despliegue
description: Cómo llegar al servidor de OmniAccess, compilar, desplegar y subir a git desde una sesión que no tiene SSH directo ni permiso de push. Incluye las reglas duras que salieron de un corte de producción. Usar SIEMPRE que haya que tocar el servidor, compilar en el LXC, reiniciar un proceso, subir un commit o levantar el lector.
---

# Llegar al servidor de OmniAccess, y no romperlo

## La topología, en tres renglones

- Host Proxmox `172.26.20.200`. La aplicación vive en el **LXC 200**, en `/opt/OmniAccess`.
- El LXC **no expone SSH**. Todo entra por el host, con `pct exec` / `pct push`.
- Dentro del LXC: pm2 (`omniaccess-web` :10001, `omniaccess-webhooks` :10000,
  `tracking-worker`, `dispatch-worker`, `omniaccess-vigia`), Postgres, Redis, y el lector
  de matrículas como contenedor Docker `omni-lpr` en `http://127.0.0.1:8000`.
- El sitio sale a internet por el Nginx Proxy Manager (`172.26.20.17`). Un **502 de
  openresty** significa que el proxy está vivo y el upstream no contesta.

## Los dos helpers

Están en `scripts/` de esta skill; en la sesión viven en `$HOME` de la VM del escritorio.
La clave de root **va por variable de entorno, nunca en un archivo versionado**.

Un comando:

```bash
cd $HOME; export PXP=$(cat .pxp); export PXT=90
cat <<'PCEOF' | timeout 150 python3 pc.py
cd /opt/OmniAccess && git log --oneline -1
PCEOF
```

Un archivo:

```bash
PXP=$(cat .pxp) python3 pf.py ./cambios.bundle /opt/OmniAccess/cambios.bundle
```

## El tope de 180 segundos, y cómo se convive con él

Cada llamada al shell del escritorio muere a los 180 s. Un `npm run build` de este
proyecto tarda más. Entonces **nunca se compila en primer plano**: se lanza al fondo, se
deja rastro en un archivo, y se consulta en llamadas siguientes.

```bash
cd /opt/OmniAccess
nohup npm run build > /tmp/build.log 2>&1 &
echo "lanzado"
```

Y después, en otra llamada:

```bash
tail -5 /tmp/build.log; pgrep -f "next build" >/dev/null && echo "sigue" || echo "terminó"
```

Un build cortado a la mitad deja `.next` inconsistente y el sitio sirve mezcla de dos
versiones. Si se cortó, se borra `.next` y se empieza de nuevo — no se "completa".

## Subir a git

La sesión en la nube **puede clonar por HTTPS pero no puede hacer push** (el proxy del
agente rechaza el repo). El push se hace **desde el LXC**, que sí tiene credencial.

El camino que funciona:

1. Commitear en el clon local.
2. `git bundle create <archivo> <desde>..HEAD` — o el rango que haga falta.
3. **Escribir el bundle con un nombre nuevo cada vez y verificar el tamaño en bytes antes
   de subirlo.** Una vez se subió un bundle viejo porque la carpeta montada entregó una
   versión en caché: llegaron ocho commits de nueve y el noveno se dio por subido.
4. `pf.py` el bundle al LXC.
5. En el LXC: `git fetch <bundle> <rama>` y `git merge --ff-only FETCH_HEAD`, después
   `git push origin <rama>`.
6. Verificar: `git log --oneline -1` en el LXC **y** que el remoto quedó igual.

## Las reglas duras

Cada una salió de algo que pasó.

### Nunca `systemctl restart docker`

`docker start omni-lpr` falló por un scope de systemd viejo. Reiniciar Docker expuso que
**containerd hace SIGSEGV** (`runtime.syscallingThread.releaseP`) cada vez que Docker se
conecta. Resultado: omni-lpr y WAHA abajo un buen rato, en producción. Lo que había que
hacer era **recrear el contenedor con su configuración capturada**, no reiniciar el demonio.

Configuración de `omni-lpr`, que **no tiene compose y está creada a mano** (pendiente):

```
imagen        omni-lpr:gpu
comando       omni-lpr --host 0.0.0.0 --port 8000
puerto        -p 127.0.0.1:8000:8000
volumen       omni_lpr_models:/root/.cache
gpu           --gpus all
entorno       EXECUTION_DEVICE=cuda  OMP_NUM_THREADS=4
restart       unless-stopped
```

### El `restart: unless-stopped` no cubre el modo de falla que tenemos

El lector salió con código 128 tras un `cudaErrorIllegalAddress` y quedó con
`RestartCount: 0`: Docker intentó y no pudo (`failed to create task ... Unavailable: EOF`).
Cuando `docker start` falla con ese mensaje, hay que **recrear**, no insistir con `start`.

### No matar procesos de la GPU por PID

Los `[Not Found]` que muestra `nvidia-smi` dentro del LXC son del host y **son del lector
que está corriendo**, no contextos zombies — reaparecen con PID nuevo después de un
reinicio limpio. Matar por PID un proceso que no es nuestro apaga otra cosa.

### Nunca versionar

`.env`, `go2rtc.yaml`, `push_subs.json`, `import_payload.json`, ni credenciales en código.

### Migraciones

`prisma migrate deploy` en el LXC, nunca `migrate dev`. Prisma **rechaza los comentarios de
bloque `/* */`** en el schema: usar `//` y `///`.

## Verificar que quedó bien

Después de cualquier despliegue, en este orden:

```bash
pm2 list
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:10001/api/health
curl -s http://127.0.0.1:8000/api/health | head -c 120
docker inspect omni-lpr --format '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}'
curl -s http://127.0.0.1:10001/api/vigia/estado | head -c 300
```

El vigía es la respuesta corta: informa los diez servicios y dice **"no sé"** cuando no
pudo mirar, que no es lo mismo que "está bien".

## Cuando algo no contesta, medir antes de concluir

Un 502 desde internet **más** un SSH que no llega al host apuntan al host o al LXC, no a un
proceso de pm2 — si fuera pm2, el vigía lo habría levantado. Si sólo falla el SSH y el
sitio anda, es la VPN de este lado.

Y la regla que ordena todo esto: **no decir que algo está arreglado sin haberlo medido
después del despliegue.** En este proyecto ya se afirmó de más una vez.
