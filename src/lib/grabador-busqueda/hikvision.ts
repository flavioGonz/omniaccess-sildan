import {
    getAcuSeekStatus, createTextSearch, getTextSearchStatus, deleteTextSearch,
    createImageSearch, getImageSearchProgress, getImageSearchResults, deleteImageSearch, fetchAcuSeekImage,
} from "@/lib/acuseek";
import { authenticatedRequest } from "@/lib/digest-auth";
import type { CambioCanales, ConexionGrabador, DriverBusqueda, HallazgoGrabador } from "./tipos";

/**
 * Hikvision: AcuSeek (texto, NVR VPro) y AcuSearch (imagen, también los AcuSense como el K2).
 * Toda la parte de ISAPI vive en lib/acuseek; esto la traduce al idioma común.
 */
const caja = (r: any): HallazgoGrabador["caja"] => {
    if (!r) return null;
    const x = Number(r.x), y = Number(r.y), w = Number(r.width ?? r.w), h = Number(r.height ?? r.h);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    // AcuSeek manda la caja en 0–1; si viniera en 0–1000 (otras versiones), se normaliza.
    const k = Math.max(x, y, w, h) > 1.5 ? 1000 : 1;
    return { x: x / k, y: y / k, w: w / k, h: h / k };
};

/*
 * Qué canales analiza el NVR para cada búsqueda. Medido en los dos VPro de Otto Villa (21/10): es
 * lo que la web del NVR muestra en «AcuSeek › canales» y se lee y escribe así:
 *   texto  (AcuSeek):   /ISAPI/ContentMgmt/PicSearchByText          { enabled, channelList }
 *   imagen (AcuSearch): /ISAPI/ContentMgmt/PicSearchByCoordinate    { searchPicEnabled, channelList }
 * Antes de cambiarla, la web prueba con TestPicSearchBy…Channel, que contesta qué cámaras se
 * reinician para aplicarlo (channelNeedReboot): eso se avisa antes de guardar.
 *
 * El ORDEN importa (medido el 21/10 en el NVR 02): la búsqueda por texto vive encima de la de
 * imagen. Sacar un canal del texto antes que de la imagen da «deviceError», y al revés anda; para
 * sumar uno, la web del NVR pide lo mismo («enableAcusearchForTheCorrespondingChannelsFirst»).
 * Así que siempre primero imagen, después texto (lo ordena /api/grabador/canales).
 *
 * Qué canales pueden: /ISAPI/Streaming/channels/dualVCA lista las cámaras que le dan su análisis
 * al grabador (dualVCAType «remote»), prendidas o no. Las que no están ahí no se pueden prender.
 */
const RUTA_CANALES = {
    texto: { ruta: "/ISAPI/ContentMgmt/PicSearchByText?format=json", prueba: "/ISAPI/Intelligent/AcuSeek/TestPicSearchByTextChannel?format=json", prendido: "enabled" },
    imagen: { ruta: "/ISAPI/ContentMgmt/PicSearchByCoordinate?format=json", prueba: "/ISAPI/ContentMgmt/TestPicSearchByCoordinateChannel?format=json", prendido: "searchPicEnabled" },
} as const;
const conexion = (c: ConexionGrabador): any => ({ ip: c.ip, username: c.username, password: c.password, authType: (c.authType || "DIGEST").toUpperCase() });
const json = { responseType: "json", accept: "application/json", contentType: "application/json", timeout: 12000 } as const;
const lista = (x: any): number[] => (Array.isArray(x) ? x.map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b) : []);
const errorDe = (e: any, porDefecto: string): string => {
    const b = e?.response?.data;
    const t = typeof b === "string" ? b : b ? JSON.stringify(b) : "";
    if (/notSupport|Invalid Operation/i.test(t)) return "El grabador no acepta ese cambio (no lo soporta, o supera los canales que puede analizar).";
    if (/deviceError/i.test(t)) return "El grabador rechazó la lista (deviceError): puede que algún canal no ofrezca análisis, o que supere los que puede analizar.";
    const sub = t.match(/"subStatusCode"\s*:\s*"([^"]+)"/)?.[1] || t.match(/<subStatusCode>([^<]+)/)?.[1];
    return sub ? `${porDefecto} (${sub})` : e?.message || porDefecto;
};

async function leerCanales(c: ConexionGrabador, tipo: "texto" | "imagen"): Promise<number[] | null> {
    const r = RUTA_CANALES[tipo];
    try {
        const d = await authenticatedRequest("GET", r.ruta, conexion(c), json);
        if (!d || typeof d !== "object") return null;
        return d[r.prendido] === false ? [] : lista(d.channelList);
    } catch { return null; }
}

async function leerPosibles(c: ConexionGrabador): Promise<number[] | null> {
    try {
        const d = await authenticatedRequest("GET", "/ISAPI/Streaming/channels/dualVCA?format=json", conexion(c), json);
        if (!Array.isArray(d?.dualVCAList)) return null;
        return lista(d.dualVCAList.filter((x: any) => !x?.dualVCAType || x.dualVCAType === "remote").map((x: any) => x?.channelID));
    } catch { return null; }
}

async function ponerCanales(c: ConexionGrabador, tipo: "texto" | "imagen", canales: number[], soloProbar?: boolean): Promise<CambioCanales> {
    const r = RUTA_CANALES[tipo];
    const channelList = lista(canales);
    let reinician: number[] = [];
    // La prueba sólo tiene sentido con los que se prenden: es lo que hace la web del NVR.
    const antes = (await leerCanales(c, tipo)) || [];
    const nuevos = channelList.filter((n) => !antes.includes(n));
    if (nuevos.length) {
        try {
            const p = await authenticatedRequest("POST", r.prueba, conexion(c), { ...json, data: { channelList: nuevos, [r.prendido]: true } });
            reinician = lista(p?.channelNeedReboot);
        } catch (e: any) {
            // Hay firmwares sin la prueba: no impide guardar, sólo no se sabe de antemano.
            if (e?.response?.status !== 403 && e?.response?.status !== 404) return { ok: false, reinician: [], error: errorDe(e, "El grabador rechazó la prueba") };
        }
    }
    if (soloProbar) return { ok: true, reinician };
    try {
        const d = await authenticatedRequest("PUT", r.ruta, conexion(c), { ...json, data: { [r.prendido]: channelList.length > 0, channelList } });
        // Hay respuestas 200 que dicen que no: statusCode distinto de 1 (OK).
        if (d && typeof d === "object" && d.statusCode != null && Number(d.statusCode) !== 1) return { ok: false, reinician, error: errorDe({ response: { data: d } }, "El grabador no aceptó el cambio") };
        return { ok: true, reinician };
    } catch (e: any) { return { ok: false, reinician, error: errorDe(e, "El grabador no aceptó el cambio") }; }
}

export const hikvision: DriverBusqueda = {
    motor: "AcuSeek",
    async capacidades(c) {
        const s = await getAcuSeekStatus(c);
        return { texto: s.supported, imagen: s.capabilities.acuSearchCapPresent, activa: s.supported ? s.activated : s.capabilities.acuSearchCapPresent, motivo: s.reason };
    },
    async buscarTexto(c, texto, p) {
        return (await createTextSearch(c, { text: texto, from: p.desde, to: p.hasta, similarity: p.similitud, channels: p.canales })).taskID;
    },
    async avanceTexto(c, tarea, max) {
        const st = await getTextSearchStatus(c, tarea, { maxResults: max });
        return {
            terminada: st.status !== "working", progreso: Number(st.progress) || 0, total: st.totalMatches,
            error: st.status === "error" ? "El grabador cortó la búsqueda." : undefined,
            hallazgos: st.matches.map((m) => ({ id: `t${m.id}-${m.channel}`, canal: Number(m.channel), momento: m.time, puntaje: m.score ?? null, foto: m.imagePath || null, recorte: m.targetImagePath || null, caja: caja(m.rect), clase: m.targetType || null })),
        };
    },
    async buscarImagen(c, imagen, p) {
        return (await createImageSearch(c, imagen, { from: p.desde, to: p.hasta, similarity: p.similitud != null ? p.similitud / 100 : undefined, engine: p.objeto === "vehiculo" ? "vehicle" : "human" })).taskID;
    },
    async avanceImagen(c, tarea, max, objeto) {
        const motor = objeto === "vehiculo" ? "vehicle" : "human";
        const pr = await getImageSearchProgress(c, tarea, motor);
        const terminada = pr.progress >= 100;
        const r = terminada ? await getImageSearchResults(c, tarea, 0, max, motor) : { matches: [], total: pr.matches };
        return {
            terminada, progreso: pr.progress, total: r.total,
            hallazgos: r.matches.map((m) => ({ id: `i${m.id}-${m.channel}`, canal: Number(m.channel), momento: m.time, puntaje: m.score ?? null, foto: m.imagePath || null, recorte: m.targetImagePath || null, caja: caja(m.rect), atributos: m.attrs })),
        };
    },
    async canales(c) {
        const [texto, imagen, posibles] = await Promise.all([leerCanales(c, "texto"), leerCanales(c, "imagen"), leerPosibles(c)]);
        return { texto, imagen, posibles };
    },
    ponerCanales,
    async imagen(c, url) { const r = await fetchAcuSeekImage(c, url); return { buf: r.buf, tipo: r.contentType }; },
    async cerrar(c, tarea, tipo, objeto) {
        if (tipo === "texto") await deleteTextSearch(c, tarea).catch(() => { });
        else await deleteImageSearch(c, tarea, objeto === "vehiculo" ? "vehicle" : "human").catch(() => { });
    },
};
