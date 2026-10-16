import { authenticatedRequest } from "@/lib/digest-auth";
import type { ModoIntrusion, ModoLpr } from "@/lib/modo-camara";

/**
 * Qué sabe hacer una cámara, preguntándoselo a ella (16/10, Nico: «si es sólo ANPR de Hikvision
 * no tengo esa opción, sólo indica cruces de línea… agregar un dispositivo debe ser súper
 * intuitivo y detectar sus capacidades»).
 *
 * Hasta acá el tipo salía del nombre del canal (/matrícula|entrada|lpr/) o de lo que eligiera
 * quien la cargaba. Así «MATRICULA SALIDA» (iDS-2CD7A46G0/P-IZHS, .102) quedó como cámara de
 * intrusión: medido el 16/10, esa cámara contesta Traffic/capabilities con
 * isSupportVehicleDetection y su Smart/capabilities NO tiene cruce de línea ni zona — no puede
 * ser de intrusión. Y la .86 (DS-2CD2T26G2-2I) es al revés: Traffic da 403 y Smart tiene línea
 * y zona.
 *
 * Dos preguntas por cámara (Hikvision, ISAPI, sólo GET):
 *  · GET /ISAPI/Smart/capabilities   → isSupportLineDetection, isSupportFieldDetection,
 *                                      isSupportRegionEntrance / isSupportRegionExiting.
 *  · GET /ISAPI/Traffic/capabilities → isSupportVehicleDetection / isSupportPlateList (ANPR).
 * Si la primera da 401 no se hace la segunda: cada pedido con la clave mala es un intento de
 * login fallido, y la cámara bloquea la IP del servidor después de unos pocos (lib/probar-camara).
 *
 * Dahua y otras marcas: no se pregunta; se deduce del modelo (ITC = cámara de tránsito).
 */

export type Capacidades = {
    /** Lee matrículas con su propio ANPR. null = no se sabe. */
    anpr: boolean | null;
    /** Cruce de línea / zona / entrada y salida de zona (AcuSense, Smart). */
    cruceLinea: boolean | null;
    zona: boolean | null;
    /** Cómo se supo: preguntándole a la cámara o por el modelo. */
    fuente: "camara" | "modelo" | "nada";
    /** Por qué no se pudo preguntar, si no se pudo. */
    error: "clave" | "sin-red" | "error" | null;
    /** Lo que conviene: el tipo, el modo y la frase que lo explica. */
    sugerido: { tipo: "LPR_CAMERA" | "CAMERA"; modoLpr: ModoLpr; modoIntr: ModoIntrusion; por: string };
};

type Equipo = { ip: string; username?: string | null; password?: string | null; authType?: string | null; brand?: string | null; deviceModel?: string | null };

/** Modelos que son de tránsito / ANPR por su nombre (Hikvision iDS-TCM/TCG/TCV, DS-TCG; Dahua ITC). */
const MODELO_ANPR = /^(i?DS-TC[MGVP]|ITC|DHI-ITC)|anpr|lpr/i;
const TIEMPO_MS = 4500;

const si = (xml: string, k: string) => new RegExp(`<${k}>\\s*true\\s*</${k}>`, "i").test(xml);

async function pedir(e: Equipo, ruta: string): Promise<{ status: number; texto: string } | null> {
    try {
        const t = await authenticatedRequest("GET", ruta, { ip: e.ip, username: e.username || "admin", password: e.password || "", authType: (e.authType as any) || "DIGEST" } as any,
            { responseType: "text", accept: "application/xml", timeout: TIEMPO_MS });
        return { status: 200, texto: typeof t === "string" ? t : String(t?.data ?? t ?? "") };
    } catch (err: any) {
        const st = err?.response?.status;
        if (!err?.response) return null;
        return { status: st || 500, texto: String(err?.response?.data || "") };
    }
}

export function sugerir(c: Pick<Capacidades, "anpr" | "cruceLinea" | "zona">): Capacidades["sugerido"] {
    const analitica = !!(c.cruceLinea || c.zona);
    if (c.anpr) return { tipo: "LPR_CAMERA", modoLpr: "camara", modoIntr: analitica ? "doble" : "video", por: "lee matrículas con su ANPR" };
    if (analitica) return { tipo: "CAMERA", modoLpr: "omnivision", modoIntr: "doble", por: `tiene ${[c.cruceLinea && "cruce de línea", c.zona && "zona"].filter(Boolean).join(" y ")}` };
    if (c.anpr === false && c.cruceLinea === false && c.zona === false) return { tipo: "CAMERA", modoLpr: "omnivision", modoIntr: "omnivision", por: "no tiene ANPR ni analítica: la puede mirar OmniVision" };
    return { tipo: "CAMERA", modoLpr: "camara", modoIntr: "doble", por: "no se pudo saber qué hace" };
}

export async function capacidadesCamara(e: Equipo): Promise<Capacidades> {
    const porModelo = e.deviceModel && MODELO_ANPR.test(e.deviceModel) ? true : null;
    const marca = String(e.brand || "HIKVISION").toUpperCase();
    if (marca !== "HIKVISION" || !e.ip) {
        const base = { anpr: porModelo, cruceLinea: null, zona: null };
        return { ...base, fuente: porModelo ? "modelo" : "nada", error: null, sugerido: sugerir(base) };
    }
    const smart = await pedir(e, "/ISAPI/Smart/capabilities");
    if (!smart || smart.status === 401 || smart.status === 403 && /lock/i.test(smart.texto)) {
        const base = { anpr: porModelo, cruceLinea: null, zona: null };
        return { ...base, fuente: porModelo ? "modelo" : "nada", error: !smart ? "sin-red" : "clave", sugerido: sugerir(base) };
    }
    const trafico = await pedir(e, "/ISAPI/Traffic/capabilities");
    const anpr = trafico && trafico.status === 200 ? (si(trafico.texto, "isSupportVehicleDetection") || si(trafico.texto, "isSupportPlateList") || si(trafico.texto, "isSupportHVTVehicleDetection"))
        : trafico && (trafico.status === 403 || trafico.status === 404) ? false : porModelo;
    const ok = smart.status === 200;
    const cruceLinea = ok ? si(smart.texto, "isSupportLineDetection") : null;
    const zona = ok ? (si(smart.texto, "isSupportFieldDetection") || si(smart.texto, "isSupportRegionEntrance")) : null;
    const base = { anpr, cruceLinea, zona };
    return { ...base, fuente: "camara", error: ok ? null : "error", sugerido: sugerir(base) };
}

/** Varias a la vez, de a `de` por vez: un NVR de 30 canales no tiene que tardar 30 veces más. */
export async function capacidadesDeVarias(equipos: Equipo[], de = 8): Promise<Map<string, Capacidades>> {
    const out = new Map<string, Capacidades>();
    const cola = [...equipos];
    await Promise.all(Array.from({ length: Math.min(de, cola.length) }, async () => {
        for (let e = cola.shift(); e; e = cola.shift()) out.set(e.ip, await capacidadesCamara(e).catch(() => ({ anpr: null, cruceLinea: null, zona: null, fuente: "nada", error: "error", sugerido: sugerir({ anpr: null, cruceLinea: null, zona: null }) } as Capacidades)));
    }));
    return out;
}

/** La frase corta de lo que se detectó, para un chip. */
export function textoCapacidades(c: Capacidades): string {
    if (c.error === "clave") return "No se pudo preguntar: la cámara rechaza la clave";
    if (c.error === "sin-red") return "No contesta en la red";
    const p = [c.anpr ? "ANPR" : null, c.cruceLinea ? "cruce de línea" : null, c.zona ? "zona" : null].filter(Boolean);
    if (p.length) return p.join(" · ");
    if (c.anpr === false && c.cruceLinea === false && c.zona === false) return "sin ANPR ni analítica";
    return "sin datos";
}
