/**
 * Qué sabe hacer de verdad OmniAccess con cada marca.
 *
 * Esto existe porque el formulario de alta ofrecía diez fabricantes como si los diez
 * funcionaran igual, y no es así. Los drivers están todos escritos, pero siete de ellos
 * tienen los métodos VACÍOS —no lanzan un error, no avisan nada: devuelven sin hacer nada:
 *
 *     async upsertCredential(credential, device) {
 *     }
 *
 * El resultado es el peor de todos: dar de alta una cámara Dahua, mandarle una matrícula,
 * ver que "salió bien", y descubrir el lunes que la barrera no abre. No falla: MIENTE que
 * funcionó. Un error habría sido mejor.
 *
 * Así que este catálogo no describe lo que cada driver promete implementar, sino lo que
 * de verdad hace, leído uno por uno. La interfaz lo usa para decirlo ANTES de que alguien
 * cargue un equipo, y no después.
 *
 * **Cómo mantenerlo.** Cuando un driver se complete de verdad, se actualiza acá — y se
 * actualiza acá porque es el único lugar que la interfaz mira. Si alguien implementa
 * DahuaDriver y se olvida de esta tabla, el alta va a seguir avisando que no anda, que es
 * el lado seguro del olvido.
 */

/** Las cosas que un equipo puede hacer por OmniAccess. */
export type Capacidad = "lpr" | "rostro" | "rfid" | "bitacora" | "relé" | "conteo" | "video" | "usuarios" | "sesiones" | "alarmas" | "analiticas" | "posicion" | "comandos";

export const QUE_ES: Record<Capacidad, string> = {
    lpr: "Cargarle matrículas y que abra por patente",
    rostro: "Cargarle rostros y que abra por cara",
    rfid: "Cargarle tarjetas y llaveros",
    bitacora: "Leerle el registro de quién pasó",
    "relé": "Abrirle la puerta a distancia",
    conteo: "Leerle el aforo y los cruces de una zona",
    video: "Ver su video y sacarle cuadros",
    usuarios: "Leerle las cuentas locales (y, más adelante, crearlas y borrarlas)",
    sesiones: "Ver quién está conectado y desde qué IP",
    alarmas: "Recibir sus alarmas y traducirlas",
    analiticas: "Recibir sus analíticas (cruces, zonas, conteos) sin mirarle el video",
    posicion: "Saber dónde está, por dónde anduvo y cómo está el vehículo que lo lleva",
    comandos: "Preguntarle y mandarle órdenes por la conexión que él mismo abre, sin gastar un SMS",
};

export type EstadoDriver = "andando" | "parcial" | "sin hacer";

export type Soporte = {
    marca: string;
    rotulo: string;
    estado: EstadoDriver;
    /** Lo que se probó y funciona contra equipos reales. */
    hace: Capacidad[];
    /** Una línea honesta sobre en qué punto está. */
    nota: string;
    /**
     * Por dónde avisa el equipo.
     *
     * 18/11, Nico: «el driver debe indicar el endpoint hook que expone para cada fabricante». No
     * es un detalle de programador: es el dato que hay que poner EN EL EQUIPO para que sus
     * eventos lleguen, y cada marca tiene el suyo. `null` cuando la marca no avisa sola y somos
     * nosotros los que le preguntamos (Dahua), o cuando no hay integración de eventos.
     */
    hook: { ruta: string; como: string } | null;
};

export const SOPORTE: Soporte[] = [
    {
        marca: "HIKVISION", rotulo: "Hikvision", estado: "andando",
        hace: ["lpr", "rostro", "rfid", "bitacora", "relé", "video", "usuarios", "sesiones"],
        hook: { ruta: "POST /api/webhooks/hikvision", como: "En el equipo: Red › Servicios avanzados › HTTP listening (o Event › Notificación por HTTP). Es lo que hay que apuntar a OmniAccess para que sus pasadas lleguen solas." },
        nota: "Es la marca sobre la que se construyó el sistema y la que más cosas tiene probadas. Hoy es la única que sabe cargarle matrículas a un equipo. Sus controles de acceso y porteros (medidos el 18/11 contra un DS-K1T343MFWX y un DS-KV9503-WBE1) manejan tarjetas y rostros por ISAPI, y la bitácora del terminal se trae al historial. El portero NO tiene bitácora para consultar: avisa en el momento y hay que escucharlo.",
    },
    {
        marca: "AKUVOX", rotulo: "Akuvox", estado: "andando",
        hace: ["rostro", "rfid", "bitacora", "relé"],
        hook: { ruta: "POST /api/webhooks/akuvox", como: "En el portero: Intercom › Action URL / HTTP Event." },
        nota: "Porteros y terminales de rostro andando. No lee matrículas.",
    },
    {
        marca: "GRANDSTREAM", rotulo: "Grandstream (portero GDS)", estado: "parcial",
        hace: ["video"],
        hook: { ruta: "POST /api/webhooks/grandstream", como: "En el portero: Alarm Action › HTTP." },
        nota: "Portero IP GDS (GDS3710/37xx). Hoy anda su video por RTSP, y el reconocimiento facial lo hace OmniVision+CompreFace sobre ese stream (modo face). El driver tiene la autenticación challenge/response VERIFICADA contra el equipo real (login con credenciales: ResCode 0) y lee su configuración. El manejo de tarjetas usa /goform/config según la API; falta una tarjeta cargada para confirmar el formato de la lista. Falta probar: abrir la puerta (hay que habilitar «HTTP API Remote Open Door» en el equipo y hacer una prueba controlada), su base de rostros nativa y la bitácora. No simula lo que no probó: esas acciones avisan en vez de hacer de cuenta que funcionaron.",
    },
    {
        marca: "BOSCH", rotulo: "Bosch", estado: "parcial",
        hace: ["conteo", "video", "analiticas"],
        hook: { ruta: "POST /api/webhooks/bosch", como: "En la cámara: Alarm Task Script / HTTP, o el envío de eventos ONVIF." },
        nota: "Cuenta gente de verdad: el aforo y los cruces salen de SUS analíticas por ONVIF (perfil M, el de metadatos/analítica), no de mirarle el video. Eso es lo que la hace distinta de una cámara genérica: la cámara ya hizo la cuenta y nosotros la leemos. No maneja credenciales ni abre nada.",
    },
    {
        /*
         * La cámara sin marca.
         *
         * Faltaba, y su ausencia obligaba a mentir: quien instalaba una cámara que no está
         * en la lista tenía que elegir una marca cualquiera para poder cargarla, y a partir
         * de ahí el sistema creía que podía hablarle por el driver de esa otra marca.
         *
         * Y sobre todo: para una cámara interior de seguimiento la marca no importa. No se
         * le manda nada — se le PIDE video, y eso se hace por RTSP con ffmpeg, que habla
         * con cualquiera. Lo que decide si sirve no es el fabricante sino el flujo:
         * resolución, códec y cuadros por segundo. Eso lo mide la prueba del canal.
         */
        marca: "GENERICA", rotulo: "Genérica · RTSP", estado: "parcial",
        hace: ["video"],
        hook: null,
        nota: "No tiene driver: OmniAccess no le manda nada ni le abre nada, y sólo le lee el video por RTSP — que es todo lo que necesita una cámara interior de seguimiento. (18/11: se llamaba «Genérica / ONVIF», y eso confundía. ONVIF no es una sola cosa: el perfil S es video, y el M es analítica. De una cámara acá no se usa ONVIF para nada; donde sí se usa es en Bosch, para leerle sus analíticas.) Probá el canal antes de darla de alta: lo que decide si sirve es la resolución y no la marca.",
    },
    {
        marca: "AXIS", rotulo: "Axis", estado: "sin hacer", hace: [], hook: null,
        nota: "No tiene driver escrito. Si sólo hace falta su video, cargála como genérica.",
    },
    {
        marca: "AVICAM", rotulo: "Avicam", estado: "sin hacer",
        hace: [],
        hook: { ruta: "POST /api/webhooks/avicam", como: "La ruta existe y recibe; el driver no le manda nada al equipo." },
        nota: "El driver está empezado pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "DAHUA", rotulo: "Dahua", estado: "parcial",
        hace: ["video", "analiticas"],
        hook: null,
        nota: "Lo que anda es de LECTURA y va al revés que las demás: Dahua no nos avisa por un hook, nosotros le dejamos una conexión abierta y él manda por ahí (dahua-events.js, modelo attach). Con eso llegan sus eventos de intrusión, y se le leen las analíticas IVS y la salud del grabador por RPC2. Lo que NO hace: cargarle credenciales ni abrirle la puerta — esas funciones del driver siguen vacías y avisan en vez de simular. En la rama `sst` hay bastante más hecho para el NVR WizSense (búsqueda IA, vivo y playback por HTTP sin RTSP, clips, PTZ por modelo): está medido allá y todavía no se trajo acá.",
    },
    {
        marca: "INTELBRAS", rotulo: "Intelbras", estado: "sin hacer", hace: [], hook: null,
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "MILESIGHT", rotulo: "Milesight", estado: "sin hacer", hace: [], hook: null,
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "UNIFI", rotulo: "Ubiquiti UniFi", estado: "sin hacer", hace: [], hook: null,
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "UNIVIEW", rotulo: "Uniview", estado: "sin hacer", hace: [], hook: null,
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "ZKTECO", rotulo: "ZKTeco", estado: "sin hacer", hace: [], hook: null,
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        /*
         * Paradox faltaba en esta tabla y ya estaba integrado (18/11, Nico: «creo que te faltó la
         * Paradox alarm hub que ya integramos»). Su integración no se parece a las demás porque
         * no hay un equipo al que hablarle: es un RECEPTOR que nos habla a nosotros.
         */
        marca: "PARADOX", rotulo: "Paradox (central de alarma)", estado: "andando",
        hace: ["alarmas"],
        hook: { ruta: "TCP :10011 (ALARMAS_PUERTO_CMS)", como: "En el receptor IPC10: salida a automatización / CMS, apuntada a la IP de OmniAccess. También escucha SIA DC-09 en TCP y UDP :10010 para las centrales que lo hablan." },
        nota: "Las centrales Paradox con comunicador PCS/IP no hablan SIA DC-09: reportan a su receptor IPC10, y ese receptor le pasa los eventos al software de monitoreo. OmniAccess hace de software de monitoreo: escucha el puerto, contesta ACK a cada trama y traduce el Contact ID (lib-cms-salida). Entiende los tres formatos que saca el IPC10 —Sur-Gard MLR2-DG, Ademco CID-TCP y Ademco 685— y el lector es tolerante a propósito: Paradox no publica la trama exacta, así que se busca el bloque de cuenta, calificador, evento, grupo y zona esté donde esté, y cada trama cruda queda anotada para ajustarlo con la primera real. A la central NO se le manda nada: esto es de una sola mano.",
    },
    {
        /*
         * Los rastreadores GPS (20/11). Como Paradox, no es una marca del enum sino un PROTOCOLO:
         * GT06 lo hablan Concox, Jimi y una cantidad de clones sin nombre, y lo que importa para
         * integrarlos no es quién los fabricó sino qué idioma hablan. Y como Paradox, no hay un
         * equipo al que ir a buscar: es el rastreador el que se conecta a nosotros.
         */
        marca: "GT06", rotulo: "Rastreadores GPS · GT06 (Concox y clones)", estado: "parcial",
        hace: ["posicion", "comandos", "relé"],
        hook: {
            ruta: "TCP :1341 (GPS_PUERTO) — no es HTTP",
            como: "Por SMS al rastreador: SERVER,0,<IP pública de OmniAccess>,1341,0# y el APN de la SIM con APN,<apn>#. Se verifica con GPRSSET# (qué servidor tiene) y STATUS# (tiene que decir «GPRS:Link Up»). En el router hay que reenviar el TCP 1341 al servidor. El rastreador aparece solo en Dispositivos › GPS la primera vez que se conecta, y ahí se lo da de alta.",
        },
        nota: "Probado contra un clon con firmware W16_NP: login, latido (motor, batería, señal), posición con satélites, voltaje del vehículo, y comandos por GPRS (estado, posición, consulta y accionamiento del relé). El equipo NO pasa del login si el servidor no le contesta el acuse: por SMS dice «GPRS:Link Down» con señal fuerte, y parece roto cuando sólo está esperando. Parcial porque falta: que sus alarmas (SOS, corte de alimentación) generen un aviso, geocercas, y verificar una posición en movimiento. El relé no se acciona con el vehículo andando (lib/gps-rele). Otros protocolos de rastreadores (Teltonika, Queclink, TK103) no están hechos: cada uno es un decodificador distinto.",
    },
];

export const soporteDe = (marca: string) => SOPORTE.find((s) => s.marca === marca);

/**
 * Qué necesita cada clase de equipo para servir de algo.
 *
 * No es lo mismo "esta marca no está implementada" que "esta marca no sirve PARA ESTO".
 * Una Bosch anda perfecto contando gente y no sirve para una barrera; decir sólo "parcial"
 * no ayuda a decidir. Lo que hay que contestar es: el equipo que estoy por cargar, ¿va a
 * hacer lo que vine a que haga?
 */
export const NECESITA: Record<string, Capacidad[]> = {
    LPR_CAMERA: ["lpr"],
    LPR_INTERIOR: ["video"],
    NVR: ["video"],
    FACE_TERMINAL: ["rostro"],
    ACCESS_CONTROL: ["rfid"],
    DOOR_INTERCOM: ["relé"],
    QUEUE_COUNTER: ["conteo"],
    GPS: ["posicion"],
};

export type Veredicto = {
    sirve: boolean;
    /** Lo que hace falta y el driver no hace. */
    faltan: Capacidad[];
    soporte?: Soporte;
};

/** ¿Esta marca sirve para esta clase de equipo? */
export function evaluar(marca: string, tipo: string): Veredicto {
    const soporte = soporteDe(marca);
    const necesita = NECESITA[tipo] || [];
    if (!soporte) return { sirve: false, faltan: necesita };
    const faltan = necesita.filter((c) => !soporte.hace.includes(c));
    return { sirve: faltan.length === 0, faltan, soporte };
}

/** ¿Se pueden leer las cuentas locales de esta marca? (openspec usuarios-de-equipos) */
export const leeUsuarios = (marca: string) => !!soporteDe(marca)?.hace.includes("usuarios");
