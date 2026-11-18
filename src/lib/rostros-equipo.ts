import { authenticatedRequest } from "@/lib/digest-auth";

/**
 * Los rostros que tiene cargados un equipo Hikvision: bajarlos, pasarlos a otro, cargar nuevos y
 * borrar los elegidos.
 *
 * Pedido de Nico (18/11): «objetivo: poder descargar todos sus rostros, poder pasarlos a otros
 * porteros, cargar rostros nuevos, eliminar rostros seleccionados».
 *
 * Lo que de verdad se puede, medido contra los dos modelos de la instalación — y NO es lo mismo
 * en los dos, así que la pantalla tiene que decirlo en vez de prometer parejo:
 *
 * | | DS-KV9503 (portero) | DS-K1T343 (terminal) |
 * |---|---|---|
 * | Listar (`FDSearch`) | sí | sí |
 * | `FPID` | es el `employeeNo` | es el `employeeNo` |
 * | Bajar la FOTO | **sí**, `/LOCALS/face/<FPID>.jpg` | **no**: 404 por todos los caminos probados |
 * | `modelData` (la plantilla) | **no** la devuelve | **sí**, 364 bytes |
 *
 * O sea que los dos caminos para copiar una cara existen, pero no en el mismo equipo: del portero
 * se copia la FOTO (y el destino la vuelve a enrolar), del terminal la PLANTILLA (que es lo que
 * Hikvision usa entre equipos). Lo que no se puede, se dice; no se simula.
 *
 * El primer pedido de una foto puede contestar 503: el servicio de imágenes del equipo arranca
 * perezoso. Se reintenta una vez — medido el 18/11, el segundo pedido trae el JPEG.
 */

export type EquipoHik = { ip: string; username: string | null; password: string | null; authType?: string | null; httpPort?: number | null };

export type RostroEquipo = {
    /** El identificador de la cara en el equipo. En los dos modelos medidos es el legajo. */
    fpid: string;
    nombre: string | null;
    /** La URL que declara el equipo para su foto (interna del equipo). */
    fotoUrl: string | null;
    /** La plantilla facial, cuando el equipo la devuelve: es lo que se copia entre equipos Hikvision. */
    modelo: string | null;
};

const POR_PAGINA = 30;
/** Tope por corrida: más que esto no es una pantalla, es una exportación. */
export const ROSTROS_MAX = 2000;
const LIB = { faceLibType: "blackFD", FDID: "1" };

const cred = (d: EquipoHik) => ({ ip: d.ip, username: d.username || "admin", password: d.password || "", authType: d.authType || "DIGEST", httpPort: d.httpPort || undefined });

/** Todos los rostros del equipo, de a páginas (el equipo corta en 30 por pedido). */
export async function listarRostros(d: EquipoHik, max = ROSTROS_MAX): Promise<{ rostros: RostroEquipo[]; total: number }> {
    const out: RostroEquipo[] = [];
    let total = 0;
    for (let pos = 0; pos < max; pos += POR_PAGINA) {
        const r = await authenticatedRequest("POST", "/ISAPI/Intelligent/FDLib/FDSearch?format=json", cred(d) as never, {
            data: { searchResultPosition: pos, maxResults: POR_PAGINA, ...LIB },
            contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000,
        });
        total = Number(r?.totalMatches) || total;
        const lista = (r?.MatchList || []) as Record<string, unknown>[];
        if (!lista.length) break;
        for (const m of lista) {
            out.push({
                fpid: String(m.FPID ?? ""),
                nombre: (m.name as string) || null,
                fotoUrl: (m.faceURL as string) || null,
                modelo: (m.modelData as string) || null,
            });
        }
        if (lista.length < POR_PAGINA || out.length >= total) break;
    }
    return { rostros: out, total: total || out.length };
}

/**
 * La foto de un rostro. El equipo declara una URL suya; se pide esa ruta contra su IP (la URL
 * trae el host del equipo, que puede ser una dirección interna que desde acá no resuelve).
 */
export async function bajarFoto(d: EquipoHik, r: RostroEquipo): Promise<Buffer | null> {
    const ruta = (r.fotoUrl || `/LOCALS/face/${r.fpid}.jpg`).replace(/^https?:\/\/[^/]*/, "").split("@")[0];
    for (let i = 0; i < 2; i++) {
        try {
            const data = await authenticatedRequest("GET", ruta, cred(d) as never, { accept: "image/jpeg", responseType: "arraybuffer", timeout: 12000 });
            const buf = Buffer.from(data as ArrayBuffer);
            if (buf.length > 500 && buf[0] === 0xff && buf[1] === 0xd8) return buf;
        } catch { /* 503 la primera vez: el servicio de imágenes del equipo arranca perezoso */ }
        await new Promise((x) => setTimeout(x, 700));
    }
    return null;
}

/** El cuerpo multipart que pide Hikvision para dar de alta una cara: un JSON y el JPEG. */
function multipart(json: unknown, jpeg: Buffer): { cuerpo: Buffer; tipo: string } {
    const b = `----oa${Date.now().toString(16)}`;
    const partes = [
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="FaceDataRecord"\r\nContent-Type: application/json\r\n\r\n`),
        Buffer.from(JSON.stringify(json)),
        Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="FaceImage"; filename="cara.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        jpeg,
        Buffer.from(`\r\n--${b}--\r\n`),
    ];
    return { cuerpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${b}` };
}

/**
 * Da de alta (o reemplaza) una cara en el equipo. `fpid` es el legajo de la persona: si ya tiene
 * una cara, el equipo la pisa.
 *
 * ESCRIBE en el equipo: pasa por el guardia de sólo lectura (lib/solo-lectura), que lo corta si
 * ese equipo está marcado.
 */
export async function altaRostro(d: EquipoHik, fpid: string, nombre: string | null, jpeg: Buffer): Promise<{ ok: boolean; error?: string }> {
    const { cuerpo, tipo } = multipart({ ...LIB, FPID: fpid, ...(nombre ? { name: nombre } : {}) }, jpeg);
    try {
        const r = await authenticatedRequest("POST", "/ISAPI/Intelligent/FDLib/FDSetUp?format=json", cred(d) as never, {
            data: cuerpo, contentType: tipo, accept: "application/json", responseType: "json", timeout: 20000,
        });
        if (r?.statusCode && Number(r.statusCode) !== 1) return { ok: false, error: String(r.subStatusCode || r.statusString || "el equipo lo rechazó") };
        return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "no se pudo cargar" }; }
}

/** Borra una cara del equipo por su FPID. También escribe: mismo guardia. */
export async function borrarRostro(d: EquipoHik, fpid: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const r = await authenticatedRequest("PUT", `/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD`, cred(d) as never, {
            data: { FPID: [{ value: fpid }] }, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000,
        });
        if (r?.statusCode && Number(r.statusCode) !== 1) return { ok: false, error: String(r.subStatusCode || r.statusString || "el equipo lo rechazó") };
        return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "no se pudo borrar" }; }
}

/**
 * Copia una cara de un equipo a otro. Con la foto si el origen la da (porteros); con la plantilla
 * si no la da pero sí el modelo (terminales). Sin ninguna de las dos, no se puede: se dice.
 */
export async function copiarRostro(origen: EquipoHik, destino: EquipoHik, r: RostroEquipo): Promise<{ ok: boolean; via?: "foto" | "plantilla"; error?: string }> {
    const jpeg = await bajarFoto(origen, r);
    if (jpeg) {
        const a = await altaRostro(destino, r.fpid, r.nombre, jpeg);
        return a.ok ? { ok: true, via: "foto" } : { ok: false, error: a.error };
    }
    if (r.modelo) {
        try {
            const x = await authenticatedRequest("POST", "/ISAPI/Intelligent/FDLib/FDSetUp?format=json", cred(destino) as never, {
                data: { ...LIB, FPID: r.fpid, ...(r.nombre ? { name: r.nombre } : {}), modelData: r.modelo },
                contentType: "application/json", accept: "application/json", responseType: "json", timeout: 20000,
            });
            if (x?.statusCode && Number(x.statusCode) !== 1) return { ok: false, error: String(x.subStatusCode || x.statusString || "el destino la rechazó") };
            return { ok: true, via: "plantilla" };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "no se pudo copiar" }; }
    }
    return { ok: false, error: "el equipo de origen no entrega ni la foto ni la plantilla de esta cara" };
}
