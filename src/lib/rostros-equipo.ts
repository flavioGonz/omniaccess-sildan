import crypto from "crypto";
import http from "http";
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
 * **La foto no sale por digest.** Medido el 19/11: `GET /LOCALS/face/<FPID>.jpg` con autenticación
 * digest contesta **503** siempre; el mismo pedido con la cookie de una sesión web
 * (`/ISAPI/Security/sessionLogin`) contesta **200** con el JPEG. El servicio de imágenes del
 * equipo sólo le habla a una sesión del panel, no a ISAPI. Por eso acá se abre esa sesión y se
 * guarda su cookie un rato: sin eso, «bajar los rostros» no baja nada y parecía un problema del
 * equipo cuando era de autenticación.
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

/* ── La sesión web del equipo, sólo para bajar fotos (ver el comentario de arriba) ────────── */

const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const etiqueta = (xml: string, t: string) => (new RegExp("<" + t + ">([^<]*)<").exec(xml) || [])[1] || "";

/** Un pedido crudo (sin digest): hace falta para el login de sesión y para la foto con cookie. */
function crudo(ip: string, puerto: number, ruta: string, metodo: string, cab?: Record<string, string>, cuerpo?: string) {
    return new Promise<{ code: number; headers: http.IncomingHttpHeaders; body: Buffer }>((res) => {
        const h: Record<string, string> = { ...(cab || {}) };
        if (cuerpo) { h["Content-Type"] = "application/xml"; h["Content-Length"] = String(Buffer.byteLength(cuerpo)); }
        const r = http.request({ host: ip, port: puerto, path: ruta, method: metodo, headers: h, timeout: 12000 }, (x) => {
            const b: Buffer[] = [];
            x.on("data", (d) => b.push(d as Buffer));
            x.on("end", () => res({ code: x.statusCode || 0, headers: x.headers, body: Buffer.concat(b) }));
        });
        r.on("error", () => res({ code: 0, headers: {}, body: Buffer.alloc(0) }));
        r.on("timeout", () => { r.destroy(); res({ code: 0, headers: {}, body: Buffer.alloc(0) }); });
        if (cuerpo) r.write(cuerpo);
        r.end();
    });
}

/** La cookie de sesión por equipo. Dura poco a propósito: si caduca, se vuelve a pedir y listo. */
const sesiones = new Map<string, { cookie: string; at: number }>();
const SESION_MS = 4 * 60_000;

async function cookieDe(d: EquipoHik): Promise<string | null> {
    const ip = d.ip, puerto = d.httpPort || 80, usuario = d.username || "admin", clave = d.password || "";
    const ya = sesiones.get(`${ip}:${puerto}`);
    if (ya && Date.now() - ya.at < SESION_MS) return ya.cookie;
    try {
        const cap = await crudo(ip, puerto, `/ISAPI/Security/sessionLogin/capabilities?username=${encodeURIComponent(usuario)}`, "GET");
        const x = cap.body.toString();
        const sid = etiqueta(x, "sessionID"), reto = etiqueta(x, "challenge"), sal = etiqueta(x, "salt");
        const vueltas = Number(etiqueta(x, "iterations")) || 100;
        if (!sid || !reto) return null;
        /* El hash que pide Hikvision: usuario+sal+clave, después con el reto, y después las vueltas
           que el equipo diga. Es su esquema, no uno nuestro. */
        let h = sha(usuario + sal + clave);
        h = sha(h + reto);
        for (let i = 2; i < vueltas; i++) h = sha(h);
        const log = await crudo(ip, puerto, `/ISAPI/Security/sessionLogin?timeStamp=${Date.now()}`, "POST", undefined,
            `<SessionLogin><userName>${usuario}</userName><password>${h}</password><sessionID>${sid}</sessionID><isSessionIDValidLongTerm>false</isSessionIDValidLongTerm><sessionIDVersion>2</sessionIDVersion></SessionLogin>`);
        const cookie = ((log.headers["set-cookie"] as string[] | undefined) || []).map((s) => s.split(";")[0]).join("; ");
        if (log.code !== 200 || !cookie) return null;
        sesiones.set(`${ip}:${puerto}`, { cookie, at: Date.now() });
        return cookie;
    } catch { return null; }
}

/**
 * La foto de un rostro. El equipo declara una URL suya; se pide esa ruta contra su IP (la URL
 * trae el host del equipo, que puede ser una dirección interna que desde acá no resuelve) y con
 * la cookie de la sesión web, que es la única forma en que el equipo la entrega.
 */
export async function bajarFoto(d: EquipoHik, r: RostroEquipo): Promise<Buffer | null> {
    const ruta = (r.fotoUrl || `/LOCALS/face/${r.fpid}.jpg`).replace(/^https?:\/\/[^/]*/, "").split("@")[0];
    for (let i = 0; i < 2; i++) {
        const cookie = await cookieDe(d);
        if (!cookie) return null;
        const f = await crudo(d.ip, d.httpPort || 80, ruta, "GET", { Cookie: cookie, Accept: "image/jpeg" });
        if (f.body.length > 500 && f.body[0] === 0xff && f.body[1] === 0xd8) return f.body;
        // Cookie vieja o servicio dormido: se tira la sesión y se vuelve a intentar una vez.
        sesiones.delete(`${d.ip}:${d.httpPort || 80}`);
        await new Promise((x) => setTimeout(x, 600));
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
 * Da de alta a la PERSONA en el control de acceso. Hace falta antes de cargarle la cara: medido
 * el 19/11 contra el DS-KV9503, subir un rostro con un legajo que el equipo no conoce devuelve
 * `deviceUserNotExist`. Una cara no vive sola: cuelga de un usuario.
 */
export async function altaUsuario(d: EquipoHik, fpid: string, nombre: string | null): Promise<{ ok: boolean; error?: string }> {
    const data = {
        UserInfo: {
            employeeNo: fpid, name: nombre || fpid, userType: "normal",
            Valid: { enable: true, beginTime: "2026-01-01T00:00:00", endTime: "2037-01-01T00:00:00", timeType: "local" },
            doorRight: "1", RightPlan: [{ doorNo: 1, planTemplateNo: "1" }],
        },
    };
    try {
        const r = await authenticatedRequest("POST", "/ISAPI/AccessControl/UserInfo/Record?format=json", cred(d) as never, {
            data, contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000,
        });
        if (r?.statusCode && Number(r.statusCode) !== 1) return { ok: false, error: String(r.subStatusCode || r.statusString || "el equipo lo rechazó") };
        return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "no se pudo dar de alta a la persona" }; }
}

/** Borra a la persona del control de acceso (con su cara, sus tarjetas y sus permisos). */
export async function borrarUsuario(d: EquipoHik, fpid: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const r = await authenticatedRequest("PUT", "/ISAPI/AccessControl/UserInfo/Delete?format=json", cred(d) as never, {
            data: { UserInfoDelCond: { EmployeeNoList: [{ employeeNo: fpid }] } },
            contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000,
        });
        if (r?.statusCode && Number(r.statusCode) !== 1) return { ok: false, error: String(r.subStatusCode || r.statusString || "el equipo lo rechazó") };
        return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "no se pudo borrar a la persona" }; }
}

/**
 * Da de alta (o reemplaza) una cara en el equipo. `fpid` es el legajo de la persona: si ya tiene
 * una cara, el equipo la pisa.
 *
 * Dos cosas medidas el 19/11 contra el DS-KV9503 y que no son las que uno escribiría de memoria:
 *  · el método es **PUT** sobre `FDSetUp` con la biblioteca en la URL; con POST contesta
 *    `methodNotAllowed`;
 *  · el legajo tiene que existir como usuario. Si no existe, en vez de fallar con
 *    `deviceUserNotExist` se lo crea y se reintenta: cargar una cara nueva es, para quien lo
 *    hace, una sola cosa.
 *
 * ESCRIBE en el equipo: pasa por el guardia de sólo lectura (lib/solo-lectura), que lo corta si
 * ese equipo está marcado.
 */
export async function altaRostro(d: EquipoHik, fpid: string, nombre: string | null, jpeg: Buffer): Promise<{ ok: boolean; error?: string; creoPersona?: boolean }> {
    const subir = async () => {
        const { cuerpo, tipo } = multipart({ ...LIB, FPID: fpid, ...(nombre ? { name: nombre } : {}) }, jpeg);
        return authenticatedRequest("PUT", "/ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD", cred(d) as never, {
            data: cuerpo, contentType: tipo, accept: "application/json", responseType: "json", timeout: 20000,
        });
    };
    try {
        let r = await subir();
        let creoPersona = false;
        if (String(r?.subStatusCode || "") === "deviceUserNotExist") {
            const u = await altaUsuario(d, fpid, nombre);
            if (!u.ok) return { ok: false, error: `el equipo no conoce al legajo ${fpid} y no se lo pudo dar de alta: ${u.error}` };
            creoPersona = true;
            r = await subir();
        }
        if (r?.statusCode && Number(r.statusCode) !== 1) return { ok: false, error: String(r.subStatusCode || r.statusString || "el equipo lo rechazó") };
        return { ok: true, creoPersona };
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
            const x = await authenticatedRequest("PUT", "/ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD", cred(destino) as never, {
                data: { ...LIB, FPID: r.fpid, ...(r.nombre ? { name: r.nombre } : {}), modelData: r.modelo },
                contentType: "application/json", accept: "application/json", responseType: "json", timeout: 20000,
            });
            if (x?.statusCode && Number(x.statusCode) !== 1) return { ok: false, error: String(x.subStatusCode || x.statusString || "el destino la rechazó") };
            return { ok: true, via: "plantilla" };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "no se pudo copiar" }; }
    }
    return { ok: false, error: "el equipo de origen no entrega ni la foto ni la plantilla de esta cara" };
}

/* ── La base local del equipo: sus personas, sus tarjetas y qué tiene cada una ─────────────────
 *
 * Pedido de Nico (19/11): «tema lectura de rostros, base de datos locales de cada lector, logs,
 * registros, rostros».
 *
 * Medido el 19/11 contra los tres equipos, y corrige lo que decía el relevamiento anterior: el
 * portero SÍ lista personas y tarjetas (`UserInfo/Search` y `CardInfo/Search` contestan 200 con
 * 417 y 998). El 400 de la primera vez era el cuerpo del pedido mal armado, no una limitación del
 * equipo — otra vez el mismo error: dar por falla del otro lo que era nuestro.
 *
 *   | | terminal DS-K1T343 | portero DS-KV9503 |
 *   |---|---|---|
 *   | personas | 402 | 417 |
 *   | tarjetas | 987 | 998 |
 *   | rostros  | 71  | 66  |
 *   | bitácora | sí  | no  |
 *   | huellas  | sí  | no  |
 */

export type PersonaEquipo = {
    legajo: string;
    nombre: string | null;
    tarjetas: number;
    rostros: number;
    huellas: number;
    /** `normal`, `visitor`, `blackList`… tal como lo dice el equipo. */
    tipo: string | null;
    /** Hasta cuándo vale, si el equipo lo declara. */
    vence: string | null;
};

const POR_PAGINA_PERSONAS = 30;

/** Las personas cargadas en el equipo, de a páginas (el equipo corta en 30 por pedido). */
export async function listarPersonas(d: EquipoHik, desde = 0, cuantos = POR_PAGINA_PERSONAS): Promise<{ personas: PersonaEquipo[]; total: number }> {
    const r = await authenticatedRequest("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", cred(d) as never, {
        data: { UserInfoSearchCond: { searchID: `oa-${(d.ip || "").replace(/\./g, "")}`, searchResultPosition: desde, maxResults: Math.min(30, cuantos) } },
        contentType: "application/json", accept: "application/json", responseType: "json", timeout: 15000,
    });
    const b = r?.UserInfoSearch || {};
    const lista = (b.UserInfo || []) as Record<string, unknown>[];
    return {
        total: Number(b.totalMatches) || lista.length,
        personas: lista.map((u) => ({
            legajo: String(u.employeeNo ?? ""),
            nombre: (u.name as string) || null,
            tarjetas: Number(u.numOfCard) || 0,
            rostros: Number(u.numOfFace) || 0,
            huellas: Number(u.numOfFP) || 0,
            tipo: (u.userType as string) || null,
            vence: ((u.Valid as Record<string, unknown> | undefined)?.endTime as string) || null,
        })),
    };
}

/** Lo que el equipo tiene guardado, en números. Lo que no sabe hacer contesta `null`, no cero. */
export async function contarBase(d: EquipoHik): Promise<{ personas: number | null; tarjetas: number | null; rostros: number | null; bitacora: boolean; huellas: boolean }> {
    const uno = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };
    const personas = await uno(async () => {
        const r = await authenticatedRequest("GET", "/ISAPI/AccessControl/UserInfo/Count?format=json", cred(d) as never, { accept: "application/json", responseType: "json", timeout: 10000 });
        return Number(r?.UserInfoCount?.userNumber) || 0;
    });
    const tarjetas = await uno(async () => {
        const r = await authenticatedRequest("GET", "/ISAPI/AccessControl/CardInfo/Count?format=json", cred(d) as never, { accept: "application/json", responseType: "json", timeout: 10000 });
        return Number(r?.CardInfoCount?.cardNumber) || 0;
    });
    const rostros = await uno(async () => {
        const r = await authenticatedRequest("GET", "/ISAPI/Intelligent/FDLib/Count?format=json&FDID=1&faceLibType=blackFD", cred(d) as never, { accept: "application/json", responseType: "json", timeout: 10000 });
        return Number(r?.recordDataNumber) || 0;
    });
    const bitacora = !!(await uno(() => authenticatedRequest("GET", "/ISAPI/AccessControl/AcsEvent/capabilities?format=json", cred(d) as never, { accept: "application/json", responseType: "json", timeout: 8000 })));
    const huellas = !!(await uno(() => authenticatedRequest("GET", "/ISAPI/AccessControl/FingerPrintCfg/capabilities?format=json", cred(d) as never, { accept: "application/json", responseType: "json", timeout: 8000 })));
    return { personas, tarjetas, rostros, bitacora, huellas };
}

/** Las tarjetas de una persona, para poder cruzarlas con el padrón de OmniAccess. */
export async function tarjetasDe(d: EquipoHik, legajo: string): Promise<string[]> {
    try {
        const r = await authenticatedRequest("POST", "/ISAPI/AccessControl/CardInfo/Search?format=json", cred(d) as never, {
            data: { CardInfoSearchCond: { searchID: "oa-tar", searchResultPosition: 0, maxResults: 30, EmployeeNoList: [{ employeeNo: legajo }] } },
            contentType: "application/json", accept: "application/json", responseType: "json", timeout: 12000,
        });
        return ((r?.CardInfoSearch?.CardInfo || []) as Record<string, unknown>[]).map((c) => String(c.cardNo ?? "")).filter(Boolean);
    } catch { return []; }
}
