/**
 * La planilla del padrón de un complejo con varias administraciones (21/11, San Nicolás).
 *
 * San Nicolás se construyó por etapas y cada grupo de etapas tiene su comisión: «Etapas 1, 2 y 3»,
 * «Etapas 4 y 5», «6ª Etapa», «7ª Etapa». La planilla que arma la administración trae dos hojas
 * que son las que valen acá:
 *
 *   · «Buscar lote»: un renglón por lote — etapa, manzana, solar, unidad, edificio (Proa), área,
 *     titular según la administración y en qué estado está (con mail, terreno sin construir,
 *     del desarrollador…).
 *   · «Envío de códigos»: un renglón por PERSONA con correo, con todos sus lotes y qué es de cada
 *     uno: «C 4 (4-5) propietario; E 14 (4-5) propietario».
 *
 * Lo que hay que saber para leerla bien, y que es la razón de este archivo:
 *
 *   · **El código del lote se repite entre etapas.** «A 2» existe en las etapas 1-3 y en las 4-5;
 *     84 de los 426 códigos están repetidos. Un lote es su etapa MÁS su código, y por eso se lo
 *     nombra como lo nombra la propia administración: «A 2 (4-5)».
 *   · **El código es por persona, no por lote.** Lo resolvió la administración: reciben código
 *     propietarios e inquilinos, y un matrimonio recibe uno cada uno. Una persona puede tener dos
 *     o tres lotes y recibe UN código para todos.
 *   · El titular es texto, no una persona: «X - Y» es un matrimonio y «X / Y» propietario e
 *     inquilino. Se guarda como viene; las personas salen de la hoja de envíos, que es la que
 *     tiene los correos revisados.
 *
 * Puro: filas adentro, objetos afuera. Lo que toca la base está en padron-importar.ts.
 */

export type Situacion = "TERRENO" | "DESARROLLADOR" | "SIN_TITULAR" | null;
export type Vinculo = "PROPIETARIO" | "INQUILINO" | "OCUPANTE" | "FAMILIA";

export type LotePlanilla = {
    etapa: string; sigla: string;
    /** El código como figura en el plano: «A 2», «B**3a», «B 6Cd». */
    codigo: string;
    /** Como se lo nombra en el sistema, sin ambigüedad: «A 2 (4-5)». */
    nombre: string;
    manzana: string | null; solar: string | null; subunidad: string | null; edificio: string | null;
    areaM2: number | null;
    titular: string | null;
    situacion: Situacion;
    /** El estado como lo escribió la administración, tal cual. */
    estado: string | null;
    observaciones: string | null;
};
export type VinculoPlanilla = { sigla: string; codigo: string; vinculo: Vinculo };
export type PersonaPlanilla = { nombre: string; email: string; vinculos: VinculoPlanilla[]; observaciones: string | null };
export type AdministracionPlanilla = { nombre: string; sigla: string; orden: number };
export type Padron = { administraciones: AdministracionPlanilla[]; lotes: LotePlanilla[]; personas: PersonaPlanilla[]; avisos: string[] };

const texto = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * La forma corta de una etapa, que es la que la administración pone entre paréntesis:
 * «Etapas 1, 2 y 3» → «1-3», «Etapas 4 y 5» → «4-5», «6ª Etapa» → «6ª», «7ª Etapa (V11)» → «7ª».
 * También lee la propia forma corta («4-5», «6ª», «7»), que es como viene en la hoja de envíos.
 * Lo que va entre paréntesis en el nombre de la etapa (la versión del plano) no cuenta.
 */
export function siglaDeEtapa(nombre: string): string {
    const limpio = texto(nombre).replace(/\(.*?\)/g, " ");
    const n = (limpio.match(/\d+/g) || []).map(Number);
    if (!n.length) return limpio.slice(0, 12) || "?";
    return n.length === 1 ? `${n[0]}ª` : `${Math.min(...n)}-${Math.max(...n)}`;
}

/** El código de un lote, parejo: un solo espacio, sin espacios al borde. Las mayúsculas NO se tocan: «B 6Cb» y «B 6CB» no son lo mismo. */
export const codigoDeLote = (v: unknown): string => texto(v);
export const nombreDeLote = (codigo: string, sigla: string): string => `${codigo} (${sigla})`;

function situacionDe(estado: string, titular: string | null): Situacion {
    const e = sinTildes(estado);
    if (e.includes("terreno")) return "TERRENO";
    if (e.includes("desarrollador")) return "DESARROLLADOR";
    if (e.includes("sin titular") || !titular) return "SIN_TITULAR";
    return null;
}

function vinculoDe(v: string): Vinculo {
    const e = sinTildes(v);
    if (e.includes("familia")) return "FAMILIA";
    if (e.includes("ocupante")) return "OCUPANTE";
    if (e.includes("inquilin")) return "INQUILINO";
    return "PROPIETARIO";
}

const correoSirve = (v: string) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]{2,}$/.test(v);

/** Dónde está cada columna, buscándola por lo que dice su cabecera (las hojas cambian de orden entre versiones). */
function columnas(cab: unknown[], busca: Record<string, RegExp>): Record<string, number> {
    const out: Record<string, number> = {};
    cab.forEach((c, i) => { const t = sinTildes(texto(c)); for (const [k, re] of Object.entries(busca)) if (out[k] === undefined && re.test(t)) out[k] = i; });
    return out;
}

/**
 * Lee las dos hojas. Nunca tira: lo que no se entiende va a `avisos`, con el renglón, y el resto
 * se lee igual — una planilla de 400 lotes no se puede quedar afuera por un renglón raro.
 */
export function leerPadron(hojas: { lotes: unknown[][]; envios: unknown[][] }): Padron {
    const avisos: string[] = [];
    const lotes: LotePlanilla[] = [];
    const administraciones: AdministracionPlanilla[] = [];
    const porClave = new Map<string, LotePlanilla>();

    const fl = (hojas.lotes || []).filter((f) => Array.isArray(f) && f.some((c) => texto(c)));
    if (fl.length < 2) avisos.push("La hoja de lotes («Buscar lote») está vacía o no se encontró.");
    else {
        const c = columnas(fl[0], {
            etapa: /^etapa/, manzana: /^manzana/, solar: /^solar/, unidad: /^unidad/, lote: /^lote/, proa: /^(proa|edificio)/,
            area: /^area/, titular: /^titular/, estado: /^estado/, obs: /^observ/,
        });
        if (c.etapa === undefined || c.lote === undefined) avisos.push("La hoja de lotes no tiene las columnas «Etapa» y «Lote / unidad».");
        else for (let i = 1; i < fl.length; i++) {
            const f = fl[i];
            const etapa = texto(f[c.etapa]), codigo = codigoDeLote(f[c.lote]);
            if (!etapa || !codigo) { avisos.push(`Lotes, renglón ${i + 1}: falta la etapa o el lote.`); continue; }
            const sigla = siglaDeEtapa(etapa);
            /* «7ª Etapa (V11)»: lo del paréntesis es la versión del plano, no el nombre de la comisión. */
            if (!administraciones.some((a) => a.sigla === sigla)) administraciones.push({ nombre: etapa.replace(/\s*\(.*?\)\s*/g, " ").trim() || etapa, sigla, orden: 0 });
            const clave = `${sigla}|${codigo}`;
            if (porClave.has(clave)) { avisos.push(`Lotes, renglón ${i + 1}: ${nombreDeLote(codigo, sigla)} está dos veces; vale el primero.`); continue; }
            const area = Number(String(f[c.area] ?? "").replace(",", "."));
            const titular = texto(f[c.titular]) || null;
            const estado = texto(f[c.estado]) || null;
            const lote: LotePlanilla = {
                etapa, sigla, codigo, nombre: nombreDeLote(codigo, sigla),
                manzana: texto(f[c.manzana]) || null, solar: texto(f[c.solar]) || null, subunidad: texto(f[c.unidad]) || null, edificio: texto(f[c.proa]) || null,
                areaM2: Number.isFinite(area) && area > 0 ? area : null,
                titular, situacion: situacionDe(estado || "", titular), estado, observaciones: texto(f[c.obs]) || null,
            };
            lotes.push(lote); porClave.set(clave, lote);
        }
    }
    /* El orden de las administraciones es el de sus etapas: 1-3, 4-5, 6ª, 7ª. */
    administraciones.sort((a, b) => parseInt(a.sigla) - parseInt(b.sigla) || a.sigla.localeCompare(b.sigla)).forEach((a, i) => { a.orden = i + 1; });

    const personas: PersonaPlanilla[] = [];
    const porCorreo = new Map<string, PersonaPlanilla>();
    const fe = (hojas.envios || []).filter((f) => Array.isArray(f) && f.some((c) => texto(c)));
    if (fe.length < 2) avisos.push("La hoja de envíos («Envío de códigos») está vacía o no se encontró.");
    else {
        const c = columnas(fe[0], { nombre: /^nombre/, mail: /^(mail|e-?mail|correo)/, lotes: /^lotes/, obs: /^observ/ });
        if (c.mail === undefined || c.lotes === undefined) avisos.push("La hoja de envíos no tiene las columnas «Mail» y «Lotes y vínculo».");
        else for (let i = 1; i < fe.length; i++) {
            const f = fe[i];
            const email = texto(f[c.mail]).toLowerCase();
            if (!email) { avisos.push(`Envíos, renglón ${i + 1}: sin correo.`); continue; }
            if (!correoSirve(email)) { avisos.push(`Envíos, renglón ${i + 1}: el correo no tiene forma de correo.`); continue; }
            /* «(sin nombre; dominio …)» es una nota de quien armó la planilla, no un nombre. */
            const crudo = texto(f[c.nombre]);
            const nombre = /^\(.*\)$/.test(crudo) ? "" : crudo;
            const vinculos: VinculoPlanilla[] = [];
            for (const parte of texto(f[c.lotes]).split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
                // «B 7B (4-5) propietario»: el código, la etapa entre paréntesis y qué es de ese lote.
                const m = parte.match(/^(.+?)\s*\(([^)]*)\)\s*(.*)$/);
                if (!m) { avisos.push(`Envíos, renglón ${i + 1}: no se entiende «${parte}».`); continue; }
                const codigo = codigoDeLote(m[1]), sigla = siglaDeEtapa(m[2]);
                if (!porClave.has(`${sigla}|${codigo}`)) { avisos.push(`Envíos, renglón ${i + 1}: el lote ${nombreDeLote(codigo, sigla)} no figura en la hoja de lotes.`); continue; }
                if (vinculos.some((v) => v.sigla === sigla && v.codigo === codigo)) continue;
                vinculos.push({ sigla, codigo, vinculo: vinculoDe(m[3]) });
            }
            if (!vinculos.length) { avisos.push(`Envíos, renglón ${i + 1}: quedó sin ningún lote reconocible, no recibe código.`); continue; }
            const ya = porCorreo.get(email);
            if (ya) {
                /* El mismo correo en dos renglones: es la misma persona, se le suman los lotes. */
                for (const v of vinculos) if (!ya.vinculos.some((x) => x.sigla === v.sigla && x.codigo === v.codigo)) ya.vinculos.push(v);
                avisos.push(`Envíos, renglón ${i + 1}: ese correo ya estaba más arriba; se juntaron sus lotes.`);
                continue;
            }
            const p: PersonaPlanilla = { nombre, email, vinculos, observaciones: texto(f[c.obs]) || null };
            personas.push(p); porCorreo.set(email, p);
        }
    }
    return { administraciones, lotes, personas, avisos };
}

/** Un nombre llevado a palabras comparables: sin tildes, sin signos, en minúsculas. */
export const palabrasDe = (nombre: string | null | undefined): string[] =>
    sinTildes(String(nombre ?? "")).replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter((p) => p.length >= 4);

/** ¿Dos textos con nombres comparten al menos un apellido (una palabra de cuatro letras o más)? */
export function compartenNombre(a: string | null | undefined, b: string | null | undefined): boolean {
    const pa = new Set(palabrasDe(a));
    return palabrasDe(b).some((p) => pa.has(p));
}

/** El mismo nombre, escrito igual salvo tildes, mayúsculas y espacios. */
export const mismoNombre = (a: string | null | undefined, b: string | null | undefined): boolean => {
    const na = sinTildes(texto(a)).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
    return !!na && na === sinTildes(texto(b)).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
};

/**
 * Un lote cargado antes de las administraciones («L1», «J11», «G9») llevado al código del plano
 * («L 1», «J 11», «G 9»): la manzana son las letras del principio y el solar es el resto.
 * `null` si el nombre no tiene esa forma (y entonces no se lo intenta emparejar con nada).
 */
export function codigoDeNombreViejo(nombre: string): string | null {
    const m = texto(nombre).replace(/^lote\s+/i, "").match(/^([A-Za-z]{1,2})\s*(\d\S*)$/);
    return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}
