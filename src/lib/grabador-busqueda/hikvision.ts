import {
    getAcuSeekStatus, createTextSearch, getTextSearchStatus, deleteTextSearch,
    createImageSearch, getImageSearchProgress, getImageSearchResults, deleteImageSearch, fetchAcuSeekImage,
} from "@/lib/acuseek";
import type { DriverBusqueda, HallazgoGrabador } from "./tipos";

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
    async imagen(c, url) { const r = await fetchAcuSeekImage(c, url); return { buf: r.buf, tipo: r.contentType }; },
    async cerrar(c, tarea, tipo, objeto) {
        if (tipo === "texto") await deleteTextSearch(c, tarea).catch(() => { });
        else await deleteImageSearch(c, tarea, objeto === "vehiculo" ? "vehicle" : "human").catch(() => { });
    },
};
