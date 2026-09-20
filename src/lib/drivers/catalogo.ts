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
export type Capacidad = "lpr" | "rostro" | "rfid" | "bitacora" | "relé" | "conteo" | "video";

export const QUE_ES: Record<Capacidad, string> = {
    lpr: "Cargarle matrículas y que abra por patente",
    rostro: "Cargarle rostros y que abra por cara",
    rfid: "Cargarle tarjetas y llaveros",
    bitacora: "Leerle el registro de quién pasó",
    "relé": "Abrirle la puerta a distancia",
    conteo: "Leerle el aforo y los cruces de una zona",
    video: "Ver su video y sacarle cuadros",
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
};

export const SOPORTE: Soporte[] = [
    {
        marca: "HIKVISION", rotulo: "Hikvision", estado: "andando",
        hace: ["lpr", "rostro", "bitacora", "relé", "video"],
        nota: "Es la marca sobre la que se construyó el sistema y la que más cosas tiene probadas. Hoy es la única que sabe cargarle matrículas a un equipo.",
    },
    {
        marca: "AKUVOX", rotulo: "Akuvox", estado: "andando",
        hace: ["rostro", "rfid", "bitacora", "relé"],
        nota: "Porteros y terminales de rostro andando. No lee matrículas.",
    },
    {
        marca: "BOSCH", rotulo: "Bosch", estado: "parcial",
        hace: ["conteo", "video"],
        nota: "Sólo para contar gente: lee el aforo y los cruces por ONVIF. No maneja credenciales.",
    },
    {
        marca: "AVICAM", rotulo: "Avicam", estado: "sin hacer",
        hace: [],
        nota: "El driver está empezado pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "DAHUA", rotulo: "Dahua", estado: "sin hacer", hace: [],
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "INTELBRAS", rotulo: "Intelbras", estado: "sin hacer", hace: [],
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "MILESIGHT", rotulo: "Milesight", estado: "sin hacer", hace: [],
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "UNIFI", rotulo: "Ubiquiti UniFi", estado: "sin hacer", hace: [],
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "UNIVIEW", rotulo: "Uniview", estado: "sin hacer", hace: [],
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
    },
    {
        marca: "ZKTECO", rotulo: "ZKTeco", estado: "sin hacer", hace: [],
        nota: "El driver existe pero sus funciones están vacías: no le va a llegar nada al equipo.",
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
