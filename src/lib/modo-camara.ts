/**
 * El MODO de una cámara: quién lee la matrícula, quién detecta la intrusión.
 *
 * Por qué existe (14/10): agregar una cámara no decía qué iba a hacer OmniAccess con ella. Una
 * LPR podía ser tres cosas distintas y ninguna se elegía con nombre:
 *  · la cámara lee con su ANPR (lo de siempre);
 *  · la cámara lee y OmniVision vuelve a leer cada lectura para confirmarla (doble verificación);
 *  · la cámara no tiene ANPR y la lee nuestro omni-lpr por RTSP (la .86 de la entrada de San
 *    Nicolás). Para cargar esta última había que crear una «LPR interior» y marcarle que mira un
 *    acceso: un camino que sólo conocía quien lo había programado.
 * Y en intrusión pasaba lo mismo: la verificación de OmniVision corría sobre todas las cámaras
 * por igual, y una cámara que no avisa nada (sólo video) se veía igual que una de perímetro.
 *
 * Archivo sin base ni red: lo usan las pantallas y las acciones del servidor.
 */

export type ModoLpr = "camara" | "doble" | "omnivision";
export type ModoIntrusion = "camara" | "doble" | "omnivision" | "video";

type Ficha = { rotulo: string; corto: string; que: string; quienLee: string; avisos: boolean };

export const MODOS_LPR: Record<ModoLpr, Ficha> = {
    camara: {
        rotulo: "Lee la cámara", corto: "Cámara", avisos: true,
        quienLee: "La cámara (ANPR)",
        que: "La cámara lee con su ANPR y abre con su lista. Si no lee una chapa, OmniVision la relee y la sugiere al guardia.",
    },
    doble: {
        rotulo: "Doble verificación", corto: "Doble", avisos: true,
        quienLee: "La cámara + omni-lpr",
        que: "La cámara lee y abre como siempre; omni-lpr vuelve a leer cada lectura y marca si coincide o no. No cambia la decisión de la barrera: la diferencia se ve en el monitor y el historial.",
    },
    omnivision: {
        rotulo: "Lectura OmniVision", corto: "OmniVision", avisos: false,
        quienLee: "omni-lpr (nuestro)",
        que: "La cámara sólo da el video y lee nuestro omni-lpr. Para cámaras sin ANPR. Usa GPU.",
    },
};

export const MODOS_INTRUSION: Record<ModoIntrusion, Ficha> = {
    camara: {
        rotulo: "Analítica de la cámara", corto: "Cámara", avisos: true,
        quienLee: "La cámara (AcuSense)",
        que: "La cámara avisa sola cuando alguien cruza su línea o entra a su zona. El aviso va directo al monitor, sin verificación.",
    },
    doble: {
        rotulo: "Cámara + verificación OmniVision", corto: "Doble", avisos: true,
        quienLee: "La cámara + OmniVision",
        que: "La cámara avisa y OmniVision mira la foto: confirma si hay una persona o un vehículo donde corresponde. Las reglas de aviso pueden esperar esa confirmación.",
    },
    omnivision: {
        rotulo: "Analítica OmniVision", corto: "OmniVision", avisos: false,
        quienLee: "OmniVision",
        que: "La cámara no avisa nada: OmniVision mira el video con reglas dibujadas en OmniAccess (cruce de línea, zona, merodeo). Sirve en cámaras sin analítica.",
    },
    video: {
        rotulo: "Sólo video", corto: "Video", avisos: false,
        quienLee: "Nadie",
        que: "Sin intrusión: se ve, se graba y OmniVision la registra para la búsqueda.",
    },
};

export const ORDEN_LPR: ModoLpr[] = ["camara", "doble", "omnivision"];
export const ORDEN_INTRUSION: ModoIntrusion[] = ["camara", "doble", "omnivision", "video"];

export const esModoLpr = (v: unknown): v is ModoLpr => typeof v === "string" && (ORDEN_LPR as string[]).includes(v);
export const esModoIntrusion = (v: unknown): v is ModoIntrusion => typeof v === "string" && (ORDEN_INTRUSION as string[]).includes(v);

type EquipoMin = { deviceType?: string | null; trackAcceso?: boolean | null; lprVerifica?: boolean | null; intrusionModo?: string | null };

/** Una LPR de acceso: la lectora de barrera o la cámara que lee omni-lpr mirando un acceso. */
export const esLprDeAcceso = (d: EquipoMin) => d.deviceType === "LPR_CAMERA" || (d.deviceType === "LPR_INTERIOR" && !!d.trackAcceso);

/**
 * El modo LPR guardado. La lectura de OmniVision se guarda como LPR_INTERIOR con trackAcceso
 * —es como ya estaba la .86 y de eso dependen el monitor, el historial y la pasarela— y acá se
 * le pone el nombre que se elige en pantalla. Null si no es una LPR de acceso.
 */
export function modoLprDe(d: EquipoMin): ModoLpr | null {
    if (d.deviceType === "LPR_CAMERA") return d.lprVerifica ? "doble" : "camara";
    if (d.deviceType === "LPR_INTERIOR" && d.trackAcceso) return "omnivision";
    return null;
}

/**
 * El modo de intrusión. Sin elegir (null, las cámaras de antes) se resuelve como venía
 * funcionando: si la cámara avisa, la verificación de OmniVision la miraba (doble); si no
 * avisa, es sólo video. `avisa` null = no se sabe: se asume que avisa, como antes.
 */
export function modoIntrusionDe(d: EquipoMin, avisa?: boolean | null): ModoIntrusion | null {
    if (d.deviceType !== "CAMERA") return null;
    if (esModoIntrusion(d.intrusionModo)) return d.intrusionModo;
    return avisa === false ? "video" : "doble";
}

/** Si en ese modo la verificación de OmniVision mira los avisos de la cámara (vision-analisis.js lo replica). */
export const verificaIntrusion = (modo: string | null | undefined) => !modo || modo === "doble";

/** Lo que cambia al pasar de un modo LPR a otro, en palabras: se muestra antes de guardar. */
export function consecuenciasLpr(de: ModoLpr | null, a: ModoLpr, abre = false): string[] {
    const l: string[] = [];
    if (de === a) return l;
    if (a === "doble") l.push("omni-lpr va a releer cada lectura de esta cámara (usa GPU por cada auto que pasa).");
    if (de === "doble") l.push("Se deja de verificar cada lectura; sólo se releen las que la cámara no leyó.");
    if (a === "omnivision") {
        l.push("Pasa a leerla omni-lpr desde el video: hay que dibujarle la zona o la línea de lectura en el calibrador.");
        l.push(abre ? "Una lectura permitida va a accionar el relé de la cámara." : "Registra las lecturas pero no abre: la barrera la sigue manejando el guardia o la cámara.");
        l.push("Si la cámara tiene ANPR propio, conviene apagarle el envío de lecturas para que no queden dobles.");
    }
    if (de === "omnivision") l.push("omni-lpr deja de leerla: las lecturas tienen que venir del ANPR de la cámara.");
    return l;
}

export function consecuenciasIntrusion(de: ModoIntrusion | null, a: ModoIntrusion): string[] {
    const l: string[] = [];
    if (de === a) return l;
    if (MODOS_INTRUSION[a].avisos && (!de || !MODOS_INTRUSION[de].avisos)) l.push("La cámara tiene que avisarle a OmniAccess (servidor de alarmas): se configura en ella.");
    if (!MODOS_INTRUSION[a].avisos && de && MODOS_INTRUSION[de].avisos) l.push("Si la cámara sigue mandando avisos, van a seguir llegando: apagale el envío en su calibrador.");
    if (a === "doble") l.push("OmniVision va a verificar cada aviso con la foto.");
    if (de === "doble") l.push("Sus avisos dejan de pasar por la verificación de OmniVision.");
    if (a === "omnivision") l.push("La línea o la zona se dibujan en OmniVision › Reglas, sobre esta cámara.");
    return l;
}
