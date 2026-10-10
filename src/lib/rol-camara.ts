/**
 * Qué hace OmniAccess con una cámara: el ROL.
 *
 * El tipo de equipo (LPR_CAMERA, LPR_INTERIOR, CAMERA) no alcanzaba para decirlo: una CAMERA
 * puede ser de intrusión (la cámara nos avisa por AcuSense cuando alguien cruza) o sólo video
 * para que lo analice OmniVision, y son cosas distintas de configurar. El rol junta las tres
 * preguntas que importan —qué tipo es, si la cámara nos manda sus avisos, si el video va a
 * omni-vision— en una sola elección con nombre, y cada una se puede ajustar después.
 *
 * Por qué existe (10/10): al importar un canal del grabador se creaba siempre como CAMERA. Nico
 * importó «MATRICULA SALIDA», una iDS-2CD7A46G0/P-IZHS (ANPR), y quedó como cámara común.
 */
export type RolCamara = "acceso" | "seguimiento" | "intrusion" | "video";
export type TipoCamara = "LPR_CAMERA" | "LPR_INTERIOR" | "CAMERA";

export const ROLES: Record<RolCamara, {
    tipo: TipoCamara; rotulo: string; que: string;
    /** Si se configura la cámara para que nos mande sus eventos (Hikvision: servidor HTTP). */
    avisos: boolean;
    /** Si por defecto el video va a omni-vision. */
    vision: boolean;
}> = {
    acceso: {
        tipo: "LPR_CAMERA", rotulo: "LPR de acceso", avisos: true, vision: true,
        que: "Lee la matrícula en la entrada o la salida y decide si se abre la barrera. Necesita sentido y grupo.",
    },
    seguimiento: {
        tipo: "LPR_INTERIOR", rotulo: "Seguimiento interior", avisos: false, vision: true,
        que: "No abre nada: mira una calle de adentro y lee matrículas para seguir por dónde anduvo cada vehículo.",
    },
    intrusion: {
        tipo: "CAMERA", rotulo: "Intrusión", avisos: true, vision: true,
        que: "La cámara avisa sola (AcuSense) cuando alguien cruza su línea o entra a su zona. Va al monitor de intrusión.",
    },
    video: {
        tipo: "CAMERA", rotulo: "Sólo video para OmniVision", avisos: false, vision: true,
        que: "La cámara no avisa nada: OmniAccess mira su video y lo analiza (siluetas, búsqueda, reglas propias).",
    },
};

/** Lo que dice el modelo o el nombre. Se sugiere sólo cuando es claro; si no, hay que elegir. */
const ES_ANPR = /\b(lpr|anpr)\b|matr[ií]cula|patente|chapa|\/p-|\/p\b|-p-/i;
const ES_PERIMETRO = /perim|intrus|cerco|muro|alambrado/i;

export function sugerirRol(c: { name?: string | null; model?: string | null }): { rol: RolCamara; por: string } | null {
    const nombre = c.name || "", modelo = c.model || "";
    if (ES_ANPR.test(modelo)) return { rol: "acceso", por: `el modelo ${modelo} es de lectura de matrículas` };
    if (ES_ANPR.test(nombre)) return { rol: "acceso", por: `el nombre «${nombre}» habla de matrículas` };
    if (ES_PERIMETRO.test(nombre)) return { rol: "intrusion", por: `el nombre «${nombre}» es de perímetro` };
    return null;
}

/** El rol de un equipo que ya existe (para mostrarlo y para cambiarlo). */
export function rolDe(tipo: string, avisaAOmni: boolean | null): RolCamara | null {
    if (tipo === "LPR_CAMERA") return "acceso";
    if (tipo === "LPR_INTERIOR") return "seguimiento";
    if (tipo === "CAMERA") return avisaAOmni === false ? "video" : "intrusion";
    return null;
}

/** Lo que cambia al pasar de un tipo a otro, en palabras: es lo que se confirma antes de hacerlo. */
export function consecuencias(de: TipoCamara, a: TipoCamara): string[] {
    const l: string[] = [];
    if (de === a) return l;
    if (a === "LPR_CAMERA") l.push("Sus lecturas de matrícula pasan a decidir el acceso: si tiene una barrera, la va a abrir según el grupo.");
    if (de === "LPR_CAMERA") l.push("Deja de decidir el acceso: sus lecturas ya no abren la barrera ni cuentan como entradas o salidas.");
    if (a === "LPR_INTERIOR") l.push("Entra al seguimiento: la pasarela le toma cuadros y omni-lpr lee las matrículas (usa GPU).");
    if (de === "LPR_INTERIOR") l.push("Sale del seguimiento: se deja de leer su video para seguir vehículos.");
    if (a === "CAMERA") l.push("Pasa al monitor de intrusión y al registro de OmniVision; no lee matrículas.");
    return l;
}
