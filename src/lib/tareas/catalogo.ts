/**
 * Qué es cada cosa que corre de fondo, en palabras de quien opera el barrio.
 *
 * Es un catálogo y no algo que se lee de los procesos porque PM2, Docker y el cron sólo
 * saben nombres técnicos ("tracking-worker", "* * * * * curl …"). Lo que el operador
 * necesita es saber QUÉ deja de pasar si eso se cae, y eso no lo dice ningún proceso.
 * Lo que NO está acá igual se muestra, con su nombre técnico: el catálogo explica, no filtra.
 *
 * Las tareas internas de cada servicio (los setInterval) están medidas leyendo el código de
 * cada archivo; si se cambia un intervalo allá, se cambia acá.
 */

export type TareaInterna = { nombre: string; cada: string };

export type Servicio = {
    nombre: string;
    queHace: string;
    /** Qué deja de pasar si está caído. Es lo primero que hay que saber antes de reiniciar. */
    siCae: string;
    internas?: TareaInterna[];
    /** Reiniciar esto corta lo que el operador está mirando. Se avisa en el cajón. */
    cortaElPanel?: boolean;
};

export const SERVICIOS: Record<string, Servicio> = {
    "camara-log": {
        nombre: "Registro de las cámaras LPR",
        queHace: "Copia el registro de lecturas de cada cámara LPR (lo que la cámara dice que leyó) para compararlo con lo que recibió OmniAccess, en «Lecturas de cámara».",
        siCae: "La comparación deja de sumar lecturas. La cámara guarda sólo sus últimas ~20: lo que pase mientras está caído no se recupera. El acceso y las lecturas siguen igual.",
        internas: [{ nombre: "Copia del registro de cada cámara", cada: "10 s" }, { nombre: "Borra lo copiado de más de 30 días", cada: "6 h" }],
    },
    "omniaccess-web": {
        nombre: "Panel y API",
        queHace: "El panel de administración, los monitores, la consola del guardia y la API que usan los demás procesos (Next.js).",
        siCae: "No abre el panel ni los monitores, y las tareas programadas no corren porque llaman a esta API.",
        cortaElPanel: true,
    },
    "omniaccess-webhooks": {
        nombre: "Receptor de eventos",
        queHace: "Recibe lo que mandan las cámaras y lectoras (matrículas, rostros, alarmas), decide el acceso y lo reparte en tiempo real a pantallas y consolas.",
        siCae: "No entran lecturas nuevas: los monitores y la consola del guardia se quedan quietos.",
        internas: [
            { nombre: "Presencia de guardias conectados", cada: "30 s" },
            { nombre: "Revocaciones de guardias", cada: "12 s" },
            { nombre: "Sondeo de alcance de cada equipo (TCP 554)", cada: "60 s" },
        ],
    },
    "dispatch-worker": {
        nombre: "Envíos y grabación",
        queHace: "Manda los avisos por WhatsApp y Telegram desde la cola de envíos, y mantiene las grabaciones de clips.",
        siCae: "Los avisos quedan esperando en la cola y no se arman los clips de los eventos.",
        internas: [
            { nombre: "Revisar grabadoras", cada: "30 s" },
            { nombre: "Barrer clips vencidos", cada: "60 s" },
        ],
    },
    "tracking-worker": {
        nombre: "Seguimiento",
        queHace: "Saca cuadros de las cámaras interiores y se los pasa a Omni-LPR para leer matrículas dentro del barrio.",
        siCae: "La cámara interior deja de leer: no hay recorridos ni estadías nuevas.",
        internas: [
            { nombre: "Tomar cambios de configuración", cada: "60 s" },
            { nombre: "Resumen de avisos", cada: "2 min" },
            { nombre: "Vigilar el disparo de las cámaras", cada: "60 s" },
            { nombre: "Cerrar estadías vencidas", cada: "60 s" },
            { nombre: "Muestra de salud", cada: "60 s" },
        ],
    },
    "omniaccess-vigia": {
        nombre: "Vigía",
        queHace: "Mira a todos los demás (procesos, lector, base, Redis) y avisa cuando algo se cae y cuando vuelve.",
        siCae: "Nadie avisa si se cae otro servicio, y el estado del sistema queda viejo.",
        internas: [{ nombre: "Vuelta de control", cada: "30 s" }],
    },
    "vision-worker": {
        nombre: "OmniVision · registro",
        queHace: "Mira las cámaras con OmniVision (el detector de objetos): registra lo que ve para la búsqueda, verifica las detecciones de intrusión y relee las matrículas que la cámara no pudo leer.",
        siCae: "No se registra nada nuevo para la búsqueda, las intrusiones quedan sin doble verificación y las NO_LEIDA no se releen.",
        internas: [
            { nombre: "Cuadro de cada cámara", cada: "2 s" },
            { nombre: "Tomar cambios de configuración", cada: "30 s" },
            { nombre: "Publicar su estado", cada: "15 s" },
            { nombre: "Limpieza del registro viejo", cada: "1 h" },
        ],
    },
    "omniaccess-entrenador": {
        nombre: "Entrenador",
        queHace: "Corre los entrenamientos del detector propio (clases nuevas) cuando hay uno pedido, cuidando la temperatura de la GPU y de la CPU, y guarda la telemetría del equipo.",
        siCae: "Los entrenamientos pedidos quedan en cola sin empezar, y no se registra la salud del equipo.",
        internas: [
            { nombre: "Revisar la cola de entrenamientos", cada: "20 s" },
            { nombre: "Medir GPU y CPU (entrenando: cada 5 s)", cada: "60 s" },
            { nombre: "Podar entrenamientos viejos", cada: "1 h" },
        ],
    },
    // Contenedores Docker
    "omni-vision": {
        nombre: "OmniVision",
        queHace: "El detector de objetos (RF-DETR), los atributos, el texto y la búsqueda por descripción. Lo usan el registro, la intrusión y la relectura de matrículas.",
        siCae: "No hay detección de objetos: la búsqueda no encuentra nada nuevo y la intrusión queda sin doble verificación.",
    },
    "omni-entrenando": {
        nombre: "Entrenamiento en curso",
        queHace: "El contenedor de UN entrenamiento: lo crea el Entrenador al empezar y desaparece al terminar.",
        siCae: "Ese entrenamiento termina en falla; el Entrenador lo anota y libera la GPU.",
    },
    "omni-lpr": {
        nombre: "Omni-LPR",
        queHace: "El lector de matrículas: recibe un cuadro y devuelve la matrícula. Lo usa Seguimiento.",
        siCae: "Seguimiento sigue sacando cuadros pero no lee ninguna matrícula.",
    },
    waha: {
        nombre: "WhatsApp (OpenWA)",
        queHace: "La sesión de WhatsApp del barrio: el chatbot y los avisos por WhatsApp salen por acá.",
        siCae: "No sale ni entra ningún WhatsApp. Al volver puede pedir escanear el QR de nuevo si la sesión se perdió.",
    },
    // Servicios del sistema (systemd). Se leen, no se reinician desde el panel: ver procesos.ts.
    postgresql: {
        nombre: "Base de datos",
        queHace: "PostgreSQL: usuarios, accesos, lecturas, eventos, ajustes. Todo lo que el sistema recuerda.",
        siCae: "Se cae todo: el panel no abre y ningún proceso puede guardar ni leer.",
    },
    "redis-server": {
        nombre: "Redis",
        queHace: "La cola de envíos (BullMQ) y la memoria rápida que comparten los procesos.",
        siCae: "Los avisos no salen y la cola de envíos queda trabada hasta que vuelva.",
    },
    minio: {
        nombre: "Almacenamiento",
        queHace: "MinIO (compatible S3): las fotos de los eventos, capturas y archivos.",
        siCae: "Los eventos se registran sin foto y las fotos viejas no se ven.",
    },
    go2rtc: {
        nombre: "Video en vivo",
        queHace: "go2rtc: toma el RTSP de cada cámara y lo sirve al navegador (vivo, seguimiento, cuadros).",
        siCae: "No hay video en vivo y el seguimiento no recibe cuadros.",
    },
    docker: {
        nombre: "Docker",
        queHace: "El motor de contenedores donde corren el lector, OmniVision y WhatsApp.",
        siCae: "Se caen todos los contenedores a la vez.",
    },
    containerd: {
        nombre: "containerd",
        queHace: "El que de verdad ejecuta los contenedores por debajo de Docker.",
        siCae: "Docker no puede arrancar ni mantener ningún contenedor.",
    },
    cron: {
        nombre: "Cron",
        queHace: "El reloj del sistema: dispara las tareas programadas de abajo.",
        siCae: "Ninguna tarea programada corre.",
    },
};

export type TareaProgramada = { clave: string; nombre: string; queHace: string; siFalla: string };

/** Las tareas que llama el cron, por la ruta que llaman. */
export const TAREAS: Record<string, TareaProgramada> = {
    "/api/devices/health/tick": {
        clave: "salud-equipos", nombre: "Salud de los equipos",
        queHace: "Sondea cada equipo, guarda la muestra y dispara las alertas de equipo caído.",
        siFalla: "No se detecta un equipo caído y la gráfica de salud queda con un hueco.",
    },
    "/api/visitas/tick": {
        clave: "visitas", nombre: "Visitas y patrones",
        queHace: "Vence visitas, avisa permanencias largas, cierra el día y recalcula los perfiles de las matrículas cada 10 minutos.",
        siFalla: "La guardia no recibe el aviso de visita excedida y los perfiles se quedan viejos.",
    },
    "/api/queue/report/tick": {
        clave: "reportes-filas", nombre: "Reportes de filas",
        queHace: "Manda los reportes programados del módulo de filas a la hora configurada.",
        siFalla: "Los reportes programados no salen.",
    },
    "/api/queue/schedule/tick": {
        clave: "horarios-filas", nombre: "Horarios de filas",
        queHace: "Prende y apaga los contadores de filas según su horario.",
        siFalla: "Los contadores no cambian de estado a su hora.",
    },
};

export const tareaPorClave = (clave: string) => Object.entries(TAREAS).find(([, t]) => t.clave === clave);

/** El catálogo de un nombre real: exacto, o por su base (`postgresql@17-main` → `postgresql`). */
export function servicioDe(nombre: string): Servicio | undefined {
    return SERVICIOS[nombre] || SERVICIOS[nombre.split("@")[0]] || SERVICIOS[nombre.replace(/[-.]service$/, "")];
}
