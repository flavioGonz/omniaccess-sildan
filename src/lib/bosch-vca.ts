/**
 * Analíticas Bosch (IVA / IVA Pro) por RCP+ — leer y escribir la configuración completa
 * de la cámara (zonas, rebote, ventanas anti doble conteo y umbral de aforo).
 *
 * La configuración vive en el comando RCP 0x0a1b (CONF_VCD_OPERATOR_PARAMS, P_OCTET).
 * Verificado en DINION inteox 7100i IR FW 8.94 (Hospital Británico, 2026-10-15):
 *
 *   [6 bytes cabecera][len16 = 6 + gzip][4 bytes][len16 = largo del script][gzip(script)][cola fija]
 *
 * El script es el "Task Script Language" de Bosch en texto plano, por ejemplo:
 *   Field #1 := { Point(-0.040, -0.545) ... DebounceTime(1.00) ObjectSet(FootPoint) };
 *   external Event #1 := {Event #32 !before(0,20.0) Event #32 where first.oid == second.oid};
 *   external SimpleState#3:= Counter#3 within(3,*);
 *
 * Coordenadas del script: x,y en -1..1 con y = -1 ARRIBA (como la pantalla). Ojo: el servicio
 * ONVIF devuelve el mismo polígono con la y invertida (y = 1 arriba).
 *
 * Seguridad: la cámara valida lo que se escribe. Si lo rechaza, vuelve a valores de fábrica y
 * responde esos valores; por eso toda escritura compara la respuesta con lo enviado, relee, y si
 * algo no coincide restaura el backup automáticamente. Cada escritura guarda antes un backup.
 */
import zlib from "zlib";
import { authenticatedRequest } from "@/lib/digest-auth";

export type BoschConn = { ip: string; user: string; pass: string };
export type Pt = { x: number; y: number };

export interface BoschField { id: number; points: Pt[]; debounce: number | null; objectSet: string | null }
export interface BoschTask {
    id: number;            // I: de la tarea (1, 2, 3...)
    name: string;          // "Entrando a fila1"
    kind: "entrada" | "salida" | "aforo" | "otra";
    fieldId: number | null;
    window: number | null; // segundos de !before(0,X): misma persona no se cuenta dos veces
    critical: number | null; // within(N,*) del aforo
}
export interface BoschVca {
    script: string;
    fields: BoschField[];
    tasks: BoschTask[];
    raw: Buffer;
}

const RCP_CONF = "0x0a1b";
/** Respuesta de la Bosch a una escritura sin el nivel necesario, y el nivel que pide (service). */
const ERR_SIN_PERMISO = "0x70";
const NIVEL_SERVICE = 3;
export class ErrorSinPermiso extends Error {
    constructor() {
        super("La cámara atiende sin pedir usuario y en ese nivel no deja guardar: en la página web de la cámara, en la gestión de usuarios y contraseñas, poné clave a los niveles «user» y «live» (o desactivá el acceso sin clave). Así pide usuario y OmniAccess entra con el de la ficha, que tiene que ser de nivel «service». No se cambió nada en la cámara.");
        this.name = "ErrorSinPermiso";
    }
}
/** Relecturas para confirmar una escritura, y la espera antes de cada una (la cámara reinicia el motor). */
const RELECTURAS = 3;
const ESPERA_RELECTURA_MS = 2_500;

async function rcp(c: BoschConn, cmd: string, type: string, direction: "READ" | "WRITE", payload?: string, timeout = 45_000): Promise<string> {
    const q = new URLSearchParams({ command: cmd, type, direction, num: "1" });
    if (payload) q.set("payload", payload);
    const url = `/rcp.xml?${q.toString()}`;
    const txt: string = await authenticatedRequest("GET", url, { ip: c.ip, username: c.user, password: c.pass, authType: "DIGEST", secure: true }, { responseType: "text", contentType: "text/xml", timeout });
    const err = txt.match(/<err>([^<]*)<\/err>/i);
    if (err && err[1].trim() && err[1].trim() !== "0x00") {
        /* HB, 20/10: toda escritura volvía con 0x70 y la app decía «la cámara no aceptó la
           configuración». No era la configuración: la Bosch tiene los niveles «user» y «live» sin
           clave, así que atiende rcp.xml sin pedir usuario (auth 2 = user) y nunca llega a usar el
           usuario y la clave que tenemos (sin desafío, el digest no se manda). Escribir pide nivel
           «service» (3). Se dice eso, con la salida, en vez de un código. */
        const nivel = Number((txt.match(/<auth>(\d+)<\/auth>/i) || [])[1]);
        if (direction === "WRITE" && err[1].trim() === ERR_SIN_PERMISO && nivel < NIVEL_SERVICE) throw new ErrorSinPermiso();
        throw new Error(`La cámara rechazó el comando ${cmd} (${err[1].trim()}).`);
    }
    return txt;
}

function hexDe(txt: string): Buffer {
    const m = txt.match(/<str>([^<]*)<\/str>/i);
    if (!m) throw new Error("La cámara no devolvió datos de configuración.");
    return Buffer.from(m[1].replace(/[^0-9a-fA-F]/g, ""), "hex");
}

export async function leerBlob(c: BoschConn): Promise<Buffer> {
    return hexDe(await rcp(c, RCP_CONF, "P_OCTET", "READ"));
}

/** Separa el blob en sus partes. Falla si el formato no es el conocido (no se escribe nada a ciegas). */
export function partir(raw: Buffer) {
    const gz = raw.indexOf(Buffer.from([0x1f, 0x8b, 0x08]));
    if (gz !== 14) throw new Error("Formato de configuración Bosch desconocido (no se encontró el script en la posición esperada).");
    const lenBloque = raw.readUInt16BE(6);
    const lenScript = raw.readUInt16BE(12);
    const comprimidoLen = lenBloque - 6;
    const comprimido = raw.subarray(gz, gz + comprimidoLen);
    const script = zlib.gunzipSync(comprimido).toString("utf8");
    if (Buffer.byteLength(script, "utf8") !== lenScript) throw new Error("El largo del script no coincide con la cabecera.");
    return { cab1: raw.subarray(0, 6), cab2: raw.subarray(8, 12), script, cola: raw.subarray(gz + comprimidoLen) };
}

export function armar(raw: Buffer, scriptNuevo: string): Buffer {
    const p = partir(raw);
    const datos = Buffer.from(scriptNuevo, "utf8");
    const gz = zlib.gzipSync(datos, { level: 9 });
    if (gz.length + 6 > 0xffff || datos.length > 0xffff) throw new Error("El script quedó demasiado grande.");
    const l1 = Buffer.alloc(2); l1.writeUInt16BE(gz.length + 6);
    const l2 = Buffer.alloc(2); l2.writeUInt16BE(datos.length);
    return Buffer.concat([p.cab1, l1, p.cab2, l2, gz, p.cola]);
}

const num = (s: string) => Number.parseFloat(s);

export function analizar(script: string): { fields: BoschField[]; tasks: BoschTask[] } {
    const fields: BoschField[] = [];
    const reField = /Field\s*#(\d+)\s*:=\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = reField.exec(script))) {
        const cuerpo = m[2];
        const points = [...cuerpo.matchAll(/Point\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)].map((p) => ({ x: num(p[1]), y: num(p[2]) }));
        const deb = cuerpo.match(/DebounceTime\(\s*([\d.]+)\s*\)/);
        const os = cuerpo.match(/ObjectSet\(\s*(\w+)\s*\)/);
        fields.push({ id: Number(m[1]), points, debounce: deb ? num(deb[1]) : null, objectSet: os ? os[1] : null });
    }
    const tasks: BoschTask[] = [];
    const reTask = /\/\/@Task\s+T:(\d+)\s+V:\d+\s+I:(\d+)\s+"([^"]*)"\s*\{([\s\S]*?)\/\/@\}/g;
    while ((m = reTask.exec(script))) {
        const cuerpo = m[4];
        const tipoT = Number(m[1]);
        const win = cuerpo.match(/!before\(\s*0\s*,\s*([\d.]+)\s*\)/);
        const crit = cuerpo.match(/within\(\s*(\d+)\s*,\s*\*\s*\)/);
        const fld = cuerpo.match(/(?:EnteredField|LeftField|InsideField)\s*#(\d+)/);
        const kind: BoschTask["kind"] = /EnteredField/.test(cuerpo) ? "entrada" : /LeftField/.test(cuerpo) ? "salida" : (tipoT === 18 || /ObjectsInState/.test(cuerpo)) ? "aforo" : "otra";
        tasks.push({ id: Number(m[2]), name: m[3], kind, fieldId: fld ? Number(fld[1]) : null, window: win ? num(win[1]) : null, critical: crit ? Number(crit[1]) : null });
    }
    return { fields, tasks };
}

export async function leerVca(c: BoschConn): Promise<BoschVca> {
    const raw = await leerBlob(c);
    const { script } = partir(raw);
    return { script, raw, ...analizar(script) };
}

export interface CambiosVca {
    fields?: { id: number; points?: Pt[]; debounce?: number }[];
    tasks?: { id: number; window?: number; critical?: number }[];
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Aplica los cambios sobre el texto del script, tocando solo los números editados. */
export function aplicar(script: string, cambios: CambiosVca): string {
    let s = script;
    for (const f of cambios.fields || []) {
        const re = new RegExp(`(Field\\s*#${f.id}\\s*:=\\s*\\{)([^}]*)(\\})`);
        const m = s.match(re);
        if (!m) throw new Error(`La zona #${f.id} no existe en la cámara.`);
        let cuerpo = m[2];
        if (f.points) {
            if (f.points.length < 3 || f.points.length > 16) throw new Error("Una zona necesita entre 3 y 16 puntos.");
            const pts = f.points.map((p) => `Point(${f3(lim(p.x, -1, 1))}, ${f3(lim(p.y, -1, 1))})`).join(" ");
            cuerpo = cuerpo.replace(/(Point\([^)]*\)\s*)+/, pts + " ");
        }
        if (f.debounce !== undefined) {
            const d = f2(lim(f.debounce, 0, 30));
            cuerpo = /DebounceTime\(/.test(cuerpo) ? cuerpo.replace(/DebounceTime\(\s*[\d.]+\s*\)/, `DebounceTime(${d})`) : cuerpo.replace(/\s*$/, ` DebounceTime(${d}) `);
        }
        s = s.replace(re, `$1${cuerpo}$3`);
    }
    for (const t of cambios.tasks || []) {
        const re = new RegExp(`(\\/\\/@Task\\s+T:\\d+\\s+V:\\d+\\s+I:${t.id}\\s+"[^"]*"\\s*\\{)([\\s\\S]*?)(\\/\\/@\\})`);
        const m = s.match(re);
        if (!m) throw new Error(`La tarea ${t.id} no existe en la cámara.`);
        let cuerpo = m[2];
        if (t.window !== undefined) {
            const w = f1(lim(t.window, 0, 600));
            // la ventana aparece en el comentario de config (11.a=o:20.0) y en la regla (!before(0,20.0))
            cuerpo = cuerpo.replace(/!before\(\s*0\s*,\s*[\d.]+\s*\)/g, `!before(0,${w})`).replace(/11\.a=o:[\d.]+/g, `11.a=o:${w}`);
        }
        if (t.critical !== undefined) {
            const n = Math.round(lim(t.critical, 1, 999));
            cuerpo = cuerpo.replace(/within\(\s*\d+\s*,\s*\*\s*\)/, `within(${n},*)`);
        }
        s = s.replace(re, `$1${cuerpo}$3`);
    }
    return s;
}

/**
 * Escribe un blob y confirma que la cámara lo aceptó tal cual. Si la respuesta o la relectura
 * no coinciden, restaura `respaldo` y lanza error.
 */
export async function escribirBlob(c: BoschConn, blob: Buffer, respaldo: Buffer): Promise<void> {
    /* La respuesta de la escritura no es la verdad: en la DINION 7100i de HB (19/10) la cámara
       contestó err 0x70 a una escritura que SÍ aplicó (la relectura traía la zona nueva) y la app
       decía «No se guardó». Lo que manda es la relectura; el error de la respuesta sólo se
       informa si la relectura tampoco coincide. */
    let errorEscritura: string | null = null;
    let ok = false;
    try {
        const resp = await rcp(c, RCP_CONF, "P_OCTET", "WRITE", "0x" + blob.toString("hex"), 90_000);
        try { ok = hexDe(resp).equals(blob); } catch { ok = false; }
    } catch (e: any) {
        // Sin permiso no se escribió nada: no hay que releer ni restaurar.
        if (e instanceof ErrorSinPermiso) throw e;
        errorEscritura = e?.message || String(e);
    }
    // Después de escribir, el motor de analíticas se reinicia: se relee unas veces con espera.
    for (let i = 0; i < RELECTURAS; i++) {
        await new Promise((r) => setTimeout(r, ESPERA_RELECTURA_MS));
        try { ok = (await leerBlob(c)).equals(blob); } catch { ok = false; }
        if (ok) break;
    }
    if (!ok) {
        try { await rcp(c, RCP_CONF, "P_OCTET", "WRITE", "0x" + respaldo.toString("hex"), 90_000); } catch { /* se informa abajo */ }
        throw new Error(`La cámara no aceptó la configuración nueva${errorEscritura ? ` (${errorEscritura})` : ""}; se restauró la anterior.`);
    }
}

/** ¿El motor de analíticas está corriendo? (falso si la cámara se quedó sin CPU para IVA) */
export async function vcaCorriendo(c: BoschConn): Promise<boolean | null> {
    try {
        const t = await rcp(c, "0x0a96", "F_FLAG", "READ");
        const m = t.match(/<result>\s*<hex>\s*0x([0-9a-f]+)/i);
        return m ? parseInt(m[1], 16) === 1 : null;
    } catch { return null; }
}
