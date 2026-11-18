import { randomInt } from "node:crypto";

/**
 * El censo con clave por lote (pedido de Nico, 18/11).
 *
 * Hasta ahora el QR del censo era una sola dirección pública: cualquiera podía cargar que era del
 * lote 42. Para San Nicolás eso no alcanza — se manda **un correo por lote, con su propia clave**,
 * con copia a la administración, y esa copia es la prueba de que el registro se mandó.
 *
 * Acá va lo que se puede probar sin red ni base: cómo se arma una clave, cómo se lee la planilla
 * de correos y qué dice el correo. El envío está en `correo.ts` y la bandeja en la API del censo.
 */

/**
 * El alfabeto de la clave: sin las parejas que se confunden al leerlas.
 *
 * Fuera O y 0, I y 1 y L, S y 5, Z y 2 — las dos de cada pareja, no una. Dejar una sola obliga a
 * adivinar qué quiso escribir el que tipeó la otra; sacando las dos, el carácter ambiguo es
 * sencillamente inválido y se puede decir «esa clave no es». Quedan 27 símbolos: con 8 posiciones
 * son 2,8 × 10^11 combinaciones, de sobra para trescientos lotes, y el intento a ciegas lo frena
 * igual el límite por IP.
 *
 * No es prolijidad: la clave se dicta por teléfono y se tipea en un celular mirando un correo.
 */
const ALFABETO = "ABCDEFGHJKMNPQRTUVWXY346789";
export const LARGO_CLAVE = 8;

/** Una clave nueva, en dos grupos de cuatro: así se lee y se dicta. */
export function nuevaClave(): string {
    let s = "";
    for (let i = 0; i < LARGO_CLAVE; i++) s += ALFABETO[randomInt(ALFABETO.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * La clave como la escribió la persona, llevada a su forma guardada.
 *
 * Se aceptan minúsculas, espacios y la falta del guión —eso es cómo la gente copia un código—;
 * lo que no se acepta es un carácter que el alfabeto no usa, porque no hay forma honesta de
 * adivinar cuál era. `null` significa «eso no es una clave», y la pantalla lo dice así.
 */
export function normalizarClave(texto: string | null | undefined): string | null {
    const s = String(texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length !== LARGO_CLAVE) return null;
    for (const c of s) if (!ALFABETO.includes(c)) return null;
    return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Un correo que sirve para mandarle algo. No valida que exista: valida que tenga forma. */
export const correoSirve = (v: string | null | undefined): boolean =>
    /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]{2,}$/.test(String(v ?? "").trim());

/** El lote, como lo guarda el padrón: sin la palabra «lote», sin espacios de más, en mayúsculas. */
export const normalizarLoteInv = (v: string | null | undefined): string =>
    String(v ?? "").replace(/\s+/g, " ").trim().replace(/^lote\s*/i, "").replace(/\s+/g, "").toUpperCase().slice(0, 12);

export type FilaPlanilla = { lote: string; email: string; nombre: string };
export type LecturaPlanilla = { filas: FilaPlanilla[]; errores: string[]; repetidos: number };

const CABECERA_LOTE = /^(lote|unidad|padron|padrón|casa|solar)$/i;
const CABECERA_EMAIL = /^(e-?mail|correo|mail|correo electr[oó]nico)$/i;
const CABECERA_NOMBRE = /^(nombre|apellido|titular|propietario|nombre y apellido)$/i;

/**
 * Lee la planilla de la administración.
 *
 * Entra como una lista de filas (cada fila, una lista de celdas) —el XLSX lo abre la API con
 * exceljs y el CSV se parte antes—, porque lo que hay que probar es esto: qué columna es el lote,
 * cuál el correo, y qué se hace con lo que viene mal.
 *
 * Reglas que salieron de mirar planillas de verdad:
 *  · La cabecera puede no estar. Si la primera fila no dice «lote» ni «correo», se busca la
 *    columna que PAREZCA un correo y la otra se toma como lote.
 *  · Una fila sin correo no es un error de la planilla: es un lote que todavía no lo dio. Se
 *    informa aparte y no frena la carga de los demás.
 *  · El mismo lote dos veces se queda con la última, que es lo que la administración acaba de
 *    corregir, y se cuenta.
 */
export function leerPlanilla(filas: unknown[][]): LecturaPlanilla {
    const errores: string[] = [];
    const celdas = filas.map((f) => (Array.isArray(f) ? f.map((c) => String(c ?? "").trim()) : []));
    const útiles = celdas.filter((f) => f.some((c) => c));
    if (!útiles.length) return { filas: [], errores: ["La planilla está vacía."], repetidos: 0 };

    let iLote = -1, iEmail = -1, iNombre = -1, desde = 0;
    const cab = útiles[0];
    cab.forEach((c, i) => {
        if (CABECERA_LOTE.test(c)) iLote = i;
        else if (CABECERA_EMAIL.test(c)) iEmail = i;
        else if (CABECERA_NOMBRE.test(c)) iNombre = i;
    });
    if (iLote >= 0 || iEmail >= 0) desde = 1;

    if (iEmail < 0) {
        // Sin cabecera: la columna del correo es la que tiene arrobas en la mayoría de sus filas.
        const muestra = útiles.slice(desde, desde + 20);
        let mejor = -1, mejorN = 0;
        const ancho = Math.max(...muestra.map((f) => f.length), 0);
        for (let c = 0; c < ancho; c++) {
            const n = muestra.filter((f) => correoSirve(f[c])).length;
            if (n > mejorN) { mejorN = n; mejor = c; }
        }
        if (mejor < 0) return { filas: [], errores: ["No se encontró ninguna columna con correos."], repetidos: 0 };
        iEmail = mejor;
        if (iLote < 0) iLote = iEmail === 0 ? 1 : 0;
    }
    if (iLote < 0) iLote = iEmail === 0 ? 1 : 0;

    const porLote = new Map<string, FilaPlanilla>();
    let repetidos = 0;
    for (let i = desde; i < útiles.length; i++) {
        const f = útiles[i];
        const lote = normalizarLoteInv(f[iLote]);
        const email = String(f[iEmail] ?? "").trim().toLowerCase();
        const nombre = iNombre >= 0 ? String(f[iNombre] ?? "").trim().slice(0, 80) : "";
        if (!lote && !email) continue;
        if (!lote) { errores.push(`Fila ${i + 1}: hay un correo sin lote (${email || "sin correo"}).`); continue; }
        if (!email) { errores.push(`Lote ${lote}: sin correo, queda sin invitación.`); continue; }
        if (!correoSirve(email)) { errores.push(`Lote ${lote}: «${email}» no tiene forma de correo.`); continue; }
        if (porLote.has(lote)) repetidos++;
        porLote.set(lote, { lote, email, nombre });
    }
    return { filas: [...porLote.values()], errores, repetidos };
}

/** El correo que recibe cada lote. Texto y HTML: el texto es el que llega cuando el HTML no se ve. */
export function correoDeInvitacion({ barrio, lote, url, clave, nombre }: {
    barrio: string; lote: string; url: string; clave: string; nombre?: string;
}): { asunto: string; texto: string; html: string } {
    const quien = nombre ? `${nombre}, ` : "";
    const casa = barrio || "el barrio";
    const asunto = `Censo de vehículos · lote ${lote}`;
    const texto = [
        `${quien}este es el registro de vehículos del lote ${lote} de ${casa}.`,
        ``,
        `Entrá por este enlace, que ya trae tu clave:`,
        url,
        ``,
        `Si te pide la clave, es: ${clave}`,
        ``,
        `Cargás las matrículas que entran a tu casa y quién te visita seguido. Son dos minutos y lo`,
        `hacés una sola vez. La administración revisa lo que cargues antes de darlo de alta.`,
        ``,
        `Este enlace es sólo para tu lote: no lo compartas.`,
        ``,
        `OmniAccess · Ve. Verifica. Avisa. · Un desarrollo de Ingeniería en Seguridad`,
    ].join("\n");
    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="padding:22px 24px 0">
  <div style="font-size:17px;font-weight:700;color:#0a0e14;letter-spacing:-.02em">OmniAccess</div>
  <div style="font-size:12px;color:#64748b;margin-top:2px">${escaparHtml(casa)}</div>
</td></tr>
<tr><td style="padding:18px 24px 0">
  <h1 style="margin:0;font-size:22px;line-height:1.2;color:#0a0e14;letter-spacing:-.02em">Censo de vehículos · lote ${escaparHtml(lote)}</h1>
  <p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#334155">
    ${escaparHtml(quien)}cargá las matrículas que entran a tu casa y quién te visita seguido.
    La cámara las lee en la entrada y la guardia ya sabe quién llega. Son dos minutos y lo hacés una sola vez.
  </p>
</td></tr>
<tr><td style="padding:20px 24px 0">
  <a href="${escaparHtml(url)}" style="display:inline-block;background:#1f5eff;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 22px;border-radius:10px">Cargar mis vehículos</a>
</td></tr>
<tr><td style="padding:16px 24px 0">
  <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc">
    <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b">Tu clave, si te la pide</div>
    <div style="font-size:21px;font-weight:800;letter-spacing:.12em;color:#0a0e14;margin-top:4px">${escaparHtml(clave)}</div>
  </div>
  <p style="margin:12px 0 0;font-size:12.5px;line-height:1.5;color:#64748b">
    Este enlace es sólo para el lote ${escaparHtml(lote)}: no lo compartas. Lo que cargues lo revisa la
    administración antes de darlo de alta.
  </p>
</td></tr>
<tr><td style="padding:18px 24px 24px">
  <div style="border-top:1px solid #e2e8f0;padding-top:12px;font-size:12px;color:#94a3b8">
    OmniAccess · Ve. Verifica. Avisa. · Un desarrollo de Ingeniería en Seguridad
  </div>
</td></tr>
</table></body></html>`;
    return { asunto, texto, html };
}

export const escaparHtml = (s: string): string =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
