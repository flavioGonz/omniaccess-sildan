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

/** Lo corto y lo largo que puede ser un código puesto a mano por la administración. */
export const CLAVE_MIN = 6;
export const CLAVE_MAX = 12;

/**
 * La clave como la escribió la persona, llevada a su forma guardada.
 *
 * Se aceptan minúsculas, espacios y la falta del guión —eso es cómo la gente copia un código—.
 * `null` significa «eso no tiene forma de clave», y la pantalla lo dice así.
 *
 * Hasta el 21/11 también se rechazaba todo carácter fuera del alfabeto de arriba. Eso valía
 * mientras todas las claves las generaba el sistema; desde que la administración puede ponerle a
 * una persona el código que quiera («editar los códigos del censo a mano»), una clave puede tener
 * cualquier letra o número y entre 6 y 12 de largo. Para quien entra no cambia nada: una clave mal
 * tipeada y una que no existe siempre dieron el mismo cartel.
 *
 * Las de ocho —todas las generadas— se guardan en dos grupos de cuatro, como siempre.
 */
export function normalizarClave(texto: string | null | undefined): string | null {
    const s = String(texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length < CLAVE_MIN || s.length > CLAVE_MAX) return null;
    return s.length === LARGO_CLAVE ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Los caracteres de un código que se confunden al leerlo o dictarlo. Para avisar, no para prohibir. */
export function seConfunden(clave: string): string[] {
    return [...new Set(clave.toUpperCase().replace(/[^A-Z0-9]/g, "").split("").filter((c) => !ALFABETO.includes(c)))];
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

/**
 * Con qué nombre viaja el logo adentro del correo. El HTML lo cita como `cid:` y quien manda lo
 * adjunta en línea (`censo-envio.ts`). Va adentro y no como una dirección de este servidor porque
 * una imagen de afuera el programa de correo la esconde hasta que la persona acepta «mostrar
 * imágenes», y un correo que llega sin su marca es justo lo que no se quería.
 */
export const CID_LOGO = "logo@omniaccess";
/** El tamaño al que se ve el logo, en px. El archivo viaja al triple para que no se vea borroso en un teléfono. */
export const LOGO_ANCHO = 122;
export const LOGO_ALTO = 30;

/** El correo que recibe cada lote. Texto y HTML: el texto es el que llega cuando el HTML no se ve. */
export function correoDeInvitacion({ barrio, lote, lotes, url, clave, nombre, conLogo, recordatorio }: {
    barrio: string; lote: string; url: string; clave: string; nombre?: string;
    /** El segundo correo, a quien no completó (27/11): lo dice en el asunto y arriba de todo. */
    recordatorio?: boolean;
    /** Cuando la persona tiene más de un lote (el código es por persona): todos, como se leen. */
    lotes?: string[];
    /** El logo viaja adjunto con `CID_LOGO`. Sin eso la marca va escrita, que es lo que se ve si la imagen falta. */
    conLogo?: boolean;
}): { asunto: string; texto: string; html: string } {
    const quien = nombre ? `${nombre}, ` : "";
    const casa = barrio || "el barrio";
    const varios = (lotes?.length || 0) > 1;
    /* «A 2 (4-5) y C 1a (6ª)»: con dos o tres lotes se nombran todos, y el correo lo dice en plural. */
    if (varios) lote = `${lotes!.slice(0, -1).join(", ")} y ${lotes![lotes!.length - 1]}`;
    const asunto = `${recordatorio ? "Recordatorio · " : ""}Censo de vehículos · ${varios ? "lotes" : "lote"} ${lote}`;
    const aviso = recordatorio ? `Te escribimos de nuevo porque ${varios ? "tus lotes todavía no tienen" : "tu lote todavía no tiene"} el censo completo.` : "";
    const texto = [
        ...(aviso ? [aviso, ``] : []),
        `${quien ? `${quien}este` : "Este"} es el registro de vehículos ${varios ? `de tus lotes ${lote}` : `del lote ${lote}`} de ${casa}.`,
        ...(varios ? [``, `El enlace sirve para todos: al entrar elegís para cuál cargás, y volvés a entrar para el otro.`] : []),
        ``,
        `Entrá por este enlace, que ya trae tu clave:`,
        url,
        ``,
        `Si te pide la clave, es: ${clave}`,
        ``,
        `Cargás las matrículas que entran a tu casa y quién te visita seguido. Son dos minutos y lo`,
        `hacés una sola vez. La administración revisa lo que cargues antes de darlo de alta.`,
        ``,
        `Este enlace es personal: no lo compartas.`,
        ``,
        `OmniAccess · Ve. Verifica. Avisa. · Un desarrollo de Ingeniería en Seguridad`,
    ].join("\n");
    /* La cabecera es la barra oscura del panel, con el barrio a la izquierda y el logo a la derecha
       (pedido de Nico, 21/11). Oscura a propósito: el logo vigente es el claro, y un teléfono en
       modo oscuro da vuelta los fondos blancos pero deja las imágenes como están — un logo de tinta
       sobre una tarjeta que el teléfono oscureció no se lee. Una barra que ya es oscura no la toca. */
    const marca = conLogo
        ? `<img src="cid:${CID_LOGO}" width="${LOGO_ANCHO}" height="${LOGO_ALTO}" alt="OmniAccess" style="display:block;border:0;outline:none;color:#ffffff;font-size:17px;font-weight:700">`
        : `<span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-.02em">OmniAccess</span>`;
    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td bgcolor="#0a0e14" style="padding:15px 24px;background:#0a0e14">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;font-size:14px;font-weight:600;color:#ffffff;letter-spacing:-.01em">${barrio ? escaparHtml(barrio) : ""}</td>
    <td align="right" style="vertical-align:middle">${marca}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:20px 24px 0">
  ${aviso ? `<p style="margin:0 0 12px;display:inline-block;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:6px 10px;font-size:13px;font-weight:600">${escaparHtml(aviso)}</p>` : ""}
  <h1 style="margin:0;font-size:22px;line-height:1.2;color:#0a0e14;letter-spacing:-.02em">Censo de vehículos · ${varios ? "lotes" : "lote"} ${escaparHtml(lote)}</h1>
  <p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#334155">
    ${quien ? `${escaparHtml(quien)}cargá` : "Cargá"} las matrículas que entran a tu casa y quién te visita seguido.
    La cámara las lee en la entrada y la guardia ya sabe quién llega. Son dos minutos y lo hacés una sola vez.${varios ? " El enlace sirve para todos tus lotes: al entrar elegís para cuál cargás." : ""}
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
    Este enlace es personal, para ${varios ? "tus lotes" : "el lote"} ${escaparHtml(lote)}: no lo compartas. Lo que cargues lo revisa la
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
