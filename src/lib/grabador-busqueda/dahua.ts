import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { rpc2Sesion } from "@/lib/dahua-rpc2";
import { authenticatedRequest } from "@/lib/digest-auth";
import { ZONA } from "@/lib/fechas";
import type { AvanceBusqueda, CanalesBusqueda, ConexionGrabador, DriverBusqueda, HallazgoGrabador, ParamsBusqueda } from "./tipos";

/**
 * Búsqueda inteligente en NVR Dahua WizSense (change openspec `nvr-dahua-wizsense`).
 *
 * Dahua no tiene búsqueda por texto libre (el AcuSeek de Hikvision). Lo que sí tiene, y es lo que
 * usa su propia web V5 en «Búsqueda IA → SMD», es la búsqueda de PERSONAS y VEHÍCULOS por la
 * detección inteligente de movimiento: `SmdDataFinder.startFind({ Condition: { StartTime, EndTime,
 * Channels, Order, SmdType: ["smdTypeHuman","smdTypeVehicle"] } })` → `doFind` → `SmdInfo[]`
 * (canal 0-based, inicio, fin, tipo). Los parámetros salieron del JS del propio NVR.
 *
 * La frase se traduce a esos filtros: qué objeto (persona / vehículo / ambos) y qué cámaras (si la
 * frase nombra una, por su título en el NVR). El rango sale de la pantalla.
 *
 * Los resultados del SMD no traen foto. Para mostrarla se baja por HTTP (loadfile.cgi, el puerto 80;
 * sirve aunque el cliente no publique el RTSP) el primer par de segundos de ese tramo y se saca un
 * cuadro con ffmpeg. La URL de la foto es una "pseudo-URL" del propio grabador (`/omni-cuadro`) que
 * `imagen()` sabe resolver, así el proxy /api/grabador/imagen sigue igual.
 */

const RUTA_CUADRO = "/omni-cuadro";
const VIGENCIA_TAREA_MS = 30 * 60_000;
const MAX_RESULTADOS = 400;
const DIR_CUADROS = path.join(os.tmpdir(), "omni-dahua-cuadros");

type Tarea = { hallazgos: HallazgoGrabador[]; total: number; t: number };
const g = globalThis as unknown as { __dahuaTareas?: Map<string, Tarea> };
const tareas = (g.__dahuaTareas ??= new Map());
const limpiar = () => { const ya = Date.now(); for (const [k, v] of tareas) if (ya - v.t > VIGENCIA_TAREA_MS) tareas.delete(k); };

const host = (c: ConexionGrabador) => c.ip.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
const dev = (c: ConexionGrabador) => ({ ip: c.ip, username: c.username, password: c.password, authType: c.authType || "DIGEST" } as any);
/*
 * El logout de rpc2Sesion manda `params: null`, y este firmware (V5, NVR5464-EI) deja colgada
 * cualquier llamada con params null hasta el timeout. No se espera: se manda y se sigue.
 */
const cerrar = (s: { close: () => Promise<void> }) => { s.close().catch(() => { }); };
const sesion = (c: ConexionGrabador, ms = 12000) => rpc2Sesion({ ip: c.ip, username: c.username, password: c.password }, ms);

const p2 = (n: number) => String(n).padStart(2, "0");
/** ISO (UTC) → "YYYY-MM-DD HH:mm:ss" en la hora del barrio, que es la que guarda el NVR. */
function aLocal(iso: string): string {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(iso));
    const v = (t: string) => f.find((x) => x.type === t)?.value || "00";
    return `${v("year")}-${v("month")}-${v("day")} ${p2(Number(v("hour")) % 24)}:${v("minute")}:${v("second")}`;
}
/** "YYYY-MM-DD HH:mm:ss" local → ISO con el desfase de la zona en ese momento. */
function deLocal(s: string): string {
    const base = new Date(`${s.replace(" ", "T")}Z`);
    const enZona = new Date(base.toLocaleString("en-US", { timeZone: ZONA }));
    const enUtc = new Date(base.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(base.getTime() - (enZona.getTime() - enUtc.getTime())).toISOString();
}
const sumarSeg = (local: string, seg: number) => aLocal(new Date(new Date(deLocal(local)).getTime() + seg * 1000).toISOString());

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Qué objetos pide la frase. */
function tiposDe(texto: string): string[] {
    const t = sinTildes(texto);
    const persona = /\b(persona|personas|gente|hombre|hombres|mujer|mujeres|nino|nina|chico|chica|peaton|peatones|alguien|individuo|sujeto|operario|guardia|empleado)/.test(t);
    const vehiculo = /\b(auto|autos|vehiculo|vehiculos|camion|camiones|camioneta|camionetas|moto|motos|furgon|furgoneta|utilitario|coche|carro|bus|omnibus|pickup|camionet)/.test(t);
    if (persona && !vehiculo) return ["smdTypeHuman"];
    if (vehiculo && !persona) return ["smdTypeVehicle"];
    return ["smdTypeHuman", "smdTypeVehicle"];
}

const GENERICAS = new Set(["frente", "lateral", "fondo", "calle", "canal", "planta", "baja", "alta", "medio", "desde", "entrada", "salida", "interior"]);
/** Si la frase nombra una cámara por su título en el NVR, sólo esos canales (0-based). */
function canalesDe(texto: string, titulos: string[]): number[] {
    const t = sinTildes(texto);
    const exactos: number[] = [], porPalabra: number[] = [];
    titulos.forEach((nom, i) => {
        const n = sinTildes(nom || "").trim();
        if (!n || /^canal\d+$|^ipc$/.test(n)) return;
        if (t.includes(n)) exactos.push(i);
        else if (n.split(/[^a-z0-9]+/).some((w) => w.length >= 5 && !GENERICAS.has(w) && t.includes(w))) porPalabra.push(i);
    });
    return exactos.length ? exactos : porPalabra;
}

async function titulosCanales(c: ConexionGrabador): Promise<string[]> {
    const s = await sesion(c, 20000);
    try {
        const r = await s.call("configManager.getConfig", { name: "ChannelTitle" });
        return (r?.table || []).map((x: any) => String(x?.Name || ""));
    } finally { cerrar(s); }
}

/*
 * Qué canales tienen la detección inteligente (SMD) prendida. Leer esa configuración en el
 * NVR5464-EI puede tardar 5–25 s (12/11), así que se recuerda por grabador un buen rato y se
 * refresca en segundo plano; mientras tanto se busca en todos (el NVR ignora los que no tienen SMD).
 */
const VIGENCIA_SMD_MS = 30 * 60_000;
const gs = globalThis as unknown as { __dahuaSmd?: Map<string, { todos: number[]; activos: number[]; t: number }>; __dahuaSmdEnCurso?: Set<string> };
const cacheSmd = (gs.__dahuaSmd ??= new Map());
const enCurso = (gs.__dahuaSmdEnCurso ??= new Set());
async function leerSmd(c: ConexionGrabador): Promise<{ todos: number[]; activos: number[] }> {
    const s = await sesion(c, 45000);
    try {
        const r = await s.call("configManager.getConfig", { name: "SmartMotionDetect" });
        const tabla: any[] = r?.table || [];
        const v = { todos: tabla.map((_, i) => i), activos: tabla.map((x, i) => (x?.Enable ? i : -1)).filter((i) => i >= 0) };
        cacheSmd.set(host(c), { ...v, t: Date.now() });
        return v;
    } finally { cerrar(s); }
}
function refrescarSmd(c: ConexionGrabador) {
    const k = host(c);
    if (enCurso.has(k)) return;
    enCurso.add(k);
    leerSmd(c).catch(() => { }).finally(() => enCurso.delete(k));
}
async function canalesSmd(c: ConexionGrabador, esperar = false): Promise<{ todos: number[]; activos: number[] } | null> {
    const ya = cacheSmd.get(host(c));
    if (ya && Date.now() - ya.t < VIGENCIA_SMD_MS) return ya;
    if (esperar) { try { return await leerSmd(c); } catch { return ya || null; } }
    refrescarSmd(c);
    return ya || null;
}

export const dahua: DriverBusqueda = {
    motor: "WizSense",

    async capacidades(c) {
        // Rápido (login + lista de servicios): la lista de canales con SMD se trae aparte.
        const s = await sesion(c, 6000);
        let tiene = false;
        try { tiene = ((await s.call("system.listService", {}))?.service || []).includes("SmdDataFinder"); } finally { cerrar(s); }
        const smd = tiene ? await canalesSmd(c) : null;
        const activa = tiene && (!smd || smd.activos.length > 0);
        return { texto: tiene, imagen: false, activa, motivo: !tiene ? "El firmware no tiene búsqueda SMD." : activa ? undefined : "El NVR no tiene la detección inteligente (SMD) prendida en ningún canal." };
    },

    async buscarTexto(c, texto, p: ParamsBusqueda) {
        limpiar();
        const [smd, titulos] = await Promise.all([canalesSmd(c), titulosCanales(c).catch(() => [] as string[])]);
        const activos = smd?.activos ?? (titulos.length ? titulos.map((_, i) => i) : Array.from({ length: 64 }, (_, i) => i));
        let canales = p.canales?.length ? p.canales.map((n) => n - 1) : canalesDe(texto, titulos);
        canales = (canales.length ? canales : activos).filter((n) => activos.includes(n));
        const id = crypto.randomUUID();
        if (!canales.length) { tareas.set(id, { hallazgos: [], total: 0, t: Date.now() }); return id; }
        const s = await sesion(c, 30000);
        try {
            const r = await s.call("SmdDataFinder.startFind", { Condition: { StartTime: aLocal(p.desde), EndTime: aLocal(p.hasta), Channels: canales, Order: "descOrder", SmdType: tiposDe(texto) } });
            const total = Number(r?.Count) || 0, token = r?.Token;
            const filas: any[] = [];
            try {
                while (filas.length < Math.min(total, MAX_RESULTADOS)) {
                    const d = await s.call("SmdDataFinder.doFind", { Token: token, Offset: filas.length, Count: Math.min(100, MAX_RESULTADOS - filas.length) });
                    const lote: any[] = d?.SmdInfo || [];
                    if (!lote.length) break;
                    filas.push(...lote);
                }
            } finally { await s.call("SmdDataFinder.stopFind", { Token: token }).catch(() => { }); }
            const h = host(c);
            const hallazgos: HallazgoGrabador[] = filas.map((x, i) => {
                const canal = Number(x.Channel) + 1;
                const persona = x.Type === "smdTypeHuman";
                const foto = `http://${h}${RUTA_CUADRO}?ch=${canal}&t=${encodeURIComponent(x.StartTime)}`;
                const seg = Math.max(0, Math.round((new Date(deLocal(x.EndTime)).getTime() - new Date(deLocal(x.StartTime)).getTime()) / 1000));
                return {
                    id: `s${i}-${canal}-${String(x.StartTime).replace(/\D/g, "")}`, canal, momento: deLocal(x.StartTime), puntaje: null,
                    foto, recorte: null, caja: null, clase: persona ? "persona" : "vehiculo",
                    atributos: { Objeto: persona ? "Persona" : "Vehículo", Duración: `${seg} s`, Hasta: String(x.EndTime).slice(11) },
                };
            });
            tareas.set(id, { hallazgos, total, t: Date.now() });
            return id;
        } finally { cerrar(s); }
    },

    async avanceTexto(_c, tarea, max): Promise<AvanceBusqueda> {
        const t = tareas.get(tarea);
        if (!t) return { terminada: true, progreso: 100, total: 0, hallazgos: [], error: "La búsqueda venció; hacela de nuevo." };
        return { terminada: true, progreso: 100, total: t.total, hallazgos: t.hallazgos.slice(0, max) };
    },

    async canales(c): Promise<CanalesBusqueda> {
        const smd = await canalesSmd(c, true);
        if (!smd) return { texto: null, imagen: null, posibles: null };
        return { texto: smd.activos.map((n) => n + 1), imagen: null, posibles: smd.todos.map((n) => n + 1) };
    },

    async imagen(c, url) {
        const u = new URL(url);
        if (u.pathname === RUTA_CUADRO) return cuadro(c, Number(u.searchParams.get("ch")), String(u.searchParams.get("t") || ""));
        const buf = Buffer.from(await authenticatedRequest("GET", u.pathname + u.search, dev(c), { responseType: "arraybuffer", timeout: 20000 }));
        return { buf, tipo: "image/jpeg" };
    },

    async cerrar(_c, tarea) { tareas.delete(tarea); },
};

/** Un cuadro de lo grabado: baja 3 s por HTTP y saca una foto con ffmpeg. Cacheado en disco. */
async function cuadro(c: ConexionGrabador, ch: number, tLocal: string): Promise<{ buf: Buffer; tipo: string }> {
    if (!ch || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(tLocal)) throw new Error("cuadro inválido");
    fs.mkdirSync(DIR_CUADROS, { recursive: true });
    const clave = crypto.createHash("sha1").update(`${host(c)}|${ch}|${tLocal}`).digest("hex");
    const jpg = path.join(DIR_CUADROS, `${clave}.jpg`);
    if (fs.existsSync(jpg)) return { buf: fs.readFileSync(jpg), tipo: "image/jpeg" };
    const q = (s: string) => encodeURIComponent(s);
    const dav: ArrayBuffer = await authenticatedRequest("GET", `/cgi-bin/loadfile.cgi?action=startLoad&channel=${ch}&startTime=${q(tLocal)}&endTime=${q(sumarSeg(tLocal, 3))}`, dev(c), { responseType: "arraybuffer", timeout: 30000 });
    if (!dav || (dav as any).byteLength < 1000) throw new Error("sin grabación en ese momento");
    const tmp = path.join(DIR_CUADROS, `${clave}.dav`);
    fs.writeFileSync(tmp, Buffer.from(dav));
    await new Promise<void>((ok, no) => {
        const ff = spawn("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", jpg], { stdio: "ignore" });
        const tope = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } no(new Error("ffmpeg tardó")); }, 25000);
        ff.on("close", (code) => { clearTimeout(tope); code === 0 ? ok() : no(new Error(`ffmpeg ${code}`)); });
        ff.on("error", (e) => { clearTimeout(tope); no(e); });
    }).finally(() => { try { fs.unlinkSync(tmp); } catch { } });
    return { buf: fs.readFileSync(jpg), tipo: "image/jpeg" };
}
