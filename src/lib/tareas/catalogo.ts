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
    // Contenedores Docker
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
