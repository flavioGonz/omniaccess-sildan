/**
 * Las reglas de analítica de una cámara Hikvision (cruce de línea y zona de intrusión), leídas y
 * escritas sobre el XML de ISAPI. Archivo puro: sin red ni base, lo prueban tests/analitica-xml.
 *
 * ## Por qué existe (23/10, Nico: «no puedo eliminar analíticas creadas… los dispositivos siempre
 * tienen varias»)
 *
 * El código anterior trataba `/ISAPI/Smart/LineDetection/1` como si fuera UNA línea. No lo es: es
 * una lista de hasta 4 (`LineItemList > LineItem`), y la zona igual (`FieldDetectionRegionList >
 * FieldDetectionRegion`, hasta 4). De ahí salían tres errores, medidos en las cámaras del lab:
 *
 *  1. Sólo se veía y se editaba el primer elemento: las otras tres líneas y zonas no existían para
 *     OmniAccess.
 *  2. No había cómo borrar: «Limpiar» + «Guardar» chocaba con «la línea necesita 2 puntos».
 *
 * ## Qué prende una regla
 *
 * Cada elemento trae su propio `<enabled>`, pero estas cámaras lo IGNORAN: probado el 23/10 en
 * «DEPO EXTERIOR», se escribe `true`, la cámara contesta OK y al releer vuelve a decir `false` (y
 * en «Ext. -> Cairoli» y «06 - CERCO» la línea dibujada dice `false` y la cámara la usa). Lo que
 * manda es el `<enabled>` de la RAÍZ: prende o apaga todas las líneas (o todas las zonas) juntas.
 * Por eso acá una regla está activa si está dibujada y su raíz está prendida, y no se ofrece
 * apagar una sola: eso sería un botón que la cámara no obedece.
 *
 * ## Cómo luce un elemento vacío en la cámara
 *
 * Una línea vacía conserva dos puntos iguales —(0,1000)(0,1000) en unas, (0,0)(0,0) en otras—; una
 * zona vacía no trae `RegionCoordinatesList`. Borrar es dejarlo exactamente así y apagado: el mismo
 * estado en que la cámara los trae de fábrica.
 *
 * Coordenadas: 0–1000, origen ABAJO-izquierda, tal cual las usa la cámara (la pantalla invierte Y).
 */

export type Pt = { x: number; y: number };
export type Dir = "both" | "ab" | "ba";
export type TipoRegla = "linea" | "zona";

export type ReglaCam = {
    /** El id del elemento en la cámara (1..4). */
    id: number;
    tipo: TipoRegla;
    /** Activa: dibujada y con la raíz prendida (el `<enabled>` propio lo ignoran las cámaras). */
    enabled: boolean;
    /** Sin geometría: el lugar está libre. */
    vacia: boolean;
    points: Pt[];
    direction?: Dir;
    sensibilidad: number | null;
    /** human | vehicle | human,vehicle (null si la cámara no filtra por objetivo). */
    objetivo: string | null;
    /** Zona: segundos que tiene que permanecer adentro (timeThreshold). */
    tiempo?: number | null;
};

export type LecturaReglas = {
    /** El `<enabled>` de la raíz: la analítica entera. */
    raiz: boolean;
    reglas: ReglaCam[];
    /** Cuántos lugares tiene la cámara (el `size` de la lista). */
    max: number;
};

export type CambioRegla = {
    id: number;
    /** Deja el lugar vacío y apagado, como viene de fábrica. */
    borrar?: boolean;
    points?: Pt[];
    direction?: Dir;
    sensibilidad?: number;
    objetivo?: string;
    tiempo?: number;
};

/** Límites de geometría que aceptan las cámaras Hikvision (capabilities: min 3, max 10 vértices). */
export const ZONA_MIN = 3;
export const ZONA_MAX = 10;

const ETIQUETA = { linea: { lista: "LineItemList", item: "LineItem", coords: "CoordinatesList", punto: "Coordinates" }, zona: { lista: "FieldDetectionRegionList", item: "FieldDetectionRegion", coords: "RegionCoordinatesList", punto: "RegionCoordinates" } } as const;

const hikDirAUi = (v?: string | null): Dir => (v === "left-right" ? "ab" : v === "right-left" ? "ba" : "both");
const uiDirAHik = (v?: Dir): string => (v === "ab" ? "left-right" : v === "ba" ? "right-left" : "any");
const fija = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
const tag = (bloque: string, nombre: string) => bloque.match(new RegExp(`<${nombre}\\b[^>]*>\\s*([^<]*?)\\s*</${nombre}>`, "i"))?.[1] ?? null;
const conTag = (bloque: string, nombre: string, valor: string) => bloque.replace(new RegExp(`(<${nombre}\\b[^>]*>)\\s*[^<]*?\\s*(</${nombre}>)`, "i"), `$1${valor}$2`);

function puntos(bloque: string): Pt[] {
    const out: Pt[] = [];
    const re = /<positionX>\s*(-?\d+)\s*<\/positionX>\s*<positionY>\s*(-?\d+)\s*<\/positionY>/gi;
    let m; while ((m = re.exec(bloque))) out.push({ x: parseInt(m[1], 10), y: parseInt(m[2], 10) });
    return out;
}

/** Vacía: una línea con sus dos puntos iguales, una zona con menos de tres. */
export function esVacia(tipo: TipoRegla, p: Pt[]): boolean {
    if (tipo === "linea") return p.length < 2 || (p[0].x === p[1].x && p[0].y === p[1].y);
    return p.length < ZONA_MIN;
}

/** Los bloques de elementos con su posición en el XML (el `\b` deja afuera a `…List`). */
function bloques(xml: string, tipo: TipoRegla): { inicio: number; fin: number; texto: string }[] {
    const t = ETIQUETA[tipo].item;
    const re = new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}>`, "gi");
    const out: { inicio: number; fin: number; texto: string }[] = [];
    let m; while ((m = re.exec(xml))) out.push({ inicio: m.index, fin: m.index + m[0].length, texto: m[0] });
    return out;
}

/** La parte del XML antes de la lista: ahí está el `<enabled>` de la raíz. */
function cabeza(xml: string, tipo: TipoRegla): { texto: string; fin: number } {
    const i = xml.search(new RegExp(`<${ETIQUETA[tipo].lista}\\b`, "i"));
    return i < 0 ? { texto: xml, fin: xml.length } : { texto: xml.slice(0, i), fin: i };
}

export function leerReglas(xml: string, tipo: TipoRegla): LecturaReglas {
    const raiz = /<enabled>\s*true\s*<\/enabled>/i.test(cabeza(xml, tipo).texto);
    const lista = xml.match(new RegExp(`<${ETIQUETA[tipo].lista}\\b[^>]*size="(\\d+)"`, "i"));
    const bs = bloques(xml, tipo);
    const reglas: ReglaCam[] = bs.map((b, i) => {
        const id = parseInt(tag(b.texto, "id") || String(i + 1), 10);
        const coords = b.texto.match(new RegExp(`<${ETIQUETA[tipo].coords}\\b[\\s\\S]*?</${ETIQUETA[tipo].coords}>`, "i"))?.[0] || "";
        const p = puntos(coords);
        const vacia = esVacia(tipo, p);
        const sens = tag(b.texto, "sensitivityLevel");
        const r: ReglaCam = {
            id, tipo, enabled: raiz && !vacia, vacia, points: vacia ? [] : p,
            sensibilidad: sens != null && sens !== "" ? Number(sens) : null,
            objetivo: tag(b.texto, "detectionTarget"),
        };
        if (tipo === "linea") r.direction = hikDirAUi(tag(b.texto, "directionSensitivity"));
        if (tipo === "zona") { const t = tag(b.texto, "timeThreshold"); r.tiempo = t != null && t !== "" ? Number(t) : null; }
        return r;
    });
    return { raiz, reglas, max: lista ? Number(lista[1]) : reglas.length };
}

/** Cómo luce una línea vacía EN ESTA cámara (unas usan (0,1000), otras (0,0)). */
function puntoVacio(xml: string, defecto: Pt = { x: 0, y: 1000 }): Pt {
    for (const r of leerReglasCrudas(xml)) if (r.length === 2 && r[0].x === r[1].x && r[0].y === r[1].y) return r[0];
    return defecto;
}
/** El punto con el que esta cámara marca una línea vacía (para borrar con el XML de un solo elemento). */
export const puntoVacioDe = (xmlCompleto: string): Pt => puntoVacio(xmlCompleto);
function leerReglasCrudas(xml: string): Pt[][] {
    return bloques(xml, "linea").map((b) => puntos(b.texto));
}

const coordsXml = (tipo: TipoRegla, p: Pt[]) => {
    const e = ETIQUETA[tipo];
    return `<${e.coords}>${p.map((q) => `<${e.punto}><positionX>${fija(q.x)}</positionX><positionY>${fija(q.y)}</positionY></${e.punto}>`).join("")}</${e.coords}>`;
};

/**
 * Aplica los cambios elemento por elemento sobre el XML que devolvió la cámara (lo demás queda
 * igual: horarios, confianza, campos que no conocemos). La raíz: `activa` si se pide; si no, queda
 * prendida mientras haya algo dibujado y se apaga cuando no queda nada.
 *
 * `conservarZona`: al borrar una zona deja sus coordenadas y sólo la apaga. Es el segundo intento
 * si una cámara rechaza la zona sin `RegionCoordinatesList`.
 */
export function aplicarCambios(xml: string, tipo: TipoRegla, cambios: CambioRegla[], opciones: { conservarZona?: boolean; activa?: boolean; soloElemento?: boolean; vacio?: Pt } = {}): string {
    const e = ETIQUETA[tipo];
    const vacio = tipo === "linea" ? puntoVacio(xml, opciones.vacio) : null;
    // De atrás para adelante: así los índices de los bloques que faltan no se corren.
    const bs = bloques(xml, tipo);
    const porId = new Map(cambios.map((c) => [c.id, c]));
    for (let i = bs.length - 1; i >= 0; i--) {
        const b = bs[i];
        const id = parseInt(tag(b.texto, "id") || String(i + 1), 10);
        const c = porId.get(id); if (!c) continue;
        let t = b.texto;
        const reCoords = new RegExp(`<${e.coords}\\b[\\s\\S]*?</${e.coords}>|<${e.coords}\\s*/>`, "i");
        const ponerCoords = (p: Pt[]) => {
            const nuevo = coordsXml(tipo, p);
            if (reCoords.test(t)) t = t.replace(reCoords, nuevo);
            else if (/<detectionTarget\b/i.test(t)) t = t.replace(/<detectionTarget\b/i, `${nuevo}<detectionTarget`);
            else t = t.replace(new RegExp(`</${e.item}>$`, "i"), `${nuevo}</${e.item}>`);
        };
        if (c.borrar) {
            if (tipo === "linea") ponerCoords([vacio!, vacio!]);
            else if (!opciones.conservarZona) t = t.replace(reCoords, "");
            if (/<enabled>/i.test(t)) t = conTag(t, "enabled", "false");
        } else {
            if (c.points) ponerCoords(c.points);
            // El `<enabled>` propio se pone en true al dibujar, por si algún firmware sí lo usa.
            if (c.points && /<enabled>/i.test(t)) t = conTag(t, "enabled", "true");
            if (c.direction && /<directionSensitivity>/i.test(t)) t = conTag(t, "directionSensitivity", uiDirAHik(c.direction));
            if (c.sensibilidad != null && /<sensitivityLevel>/i.test(t)) t = conTag(t, "sensitivityLevel", String(Math.max(1, Math.min(100, Math.round(c.sensibilidad)))));
            if (c.objetivo && /<detectionTarget>/i.test(t)) t = conTag(t, "detectionTarget", c.objetivo);
            if (c.tiempo != null && /<timeThreshold>/i.test(t)) t = conTag(t, "timeThreshold", String(Math.max(0, Math.min(10, Math.round(c.tiempo)))));
        }
        xml = xml.slice(0, b.inicio) + t + xml.slice(b.fin);
    }
    // El XML de un solo elemento (…/lineItem/<id>, …/regions/<id>) no tiene raíz que tocar.
    if (opciones.soloElemento) return xml;
    const dibujadas = leerReglasConRaiz(xml, tipo, true).some((r) => !r.vacia);
    const prendidas = dibujadas && (opciones.activa ?? (cabezaPrendida(xml, tipo) || cambios.some((c) => c.points)));
    const cab = cabeza(xml, tipo);
    const nuevaCab = cab.texto.replace(/<enabled>\s*(true|false)\s*<\/enabled>/i, `<enabled>${prendidas ? "true" : "false"}</enabled>`);
    return nuevaCab + xml.slice(cab.fin);
}

const cabezaPrendida = (xml: string, tipo: TipoRegla) => /<enabled>\s*true\s*<\/enabled>/i.test(cabeza(xml, tipo).texto);

/** Como leerReglas pero suponiendo la raíz prendida (para decidir cómo dejarla). */
function leerReglasConRaiz(xml: string, tipo: TipoRegla, raiz: boolean): ReglaCam[] {
    const cab = cabeza(xml, tipo);
    const forzada = cab.texto.replace(/<enabled>\s*(true|false)\s*<\/enabled>/i, `<enabled>${raiz ? "true" : "false"}</enabled>`);
    return leerReglas(forzada + xml.slice(cab.fin), tipo).reglas;
}

/**
 * Lo que la cámara guardó comparado con lo pedido. Vacío = quedó exactamente así. La cámara
 * redondea las coordenadas: se tolera una diferencia de 2 (0,2 % del cuadro).
 */
export function diferencias(pedido: CambioRegla[], leido: ReglaCam[]): string[] {
    const out: string[] = [];
    for (const c of pedido) {
        const r = leido.find((x) => x.id === c.id);
        const nombre = `${r?.tipo === "zona" ? "Zona" : "Línea"} ${c.id}`;
        if (!r) { out.push(`${nombre}: la cámara no la devolvió`); continue; }
        if (c.borrar) { if (!r.vacia) out.push(`${nombre}: sigue en la cámara`); continue; }
        if (c.points) {
            if (r.vacia) out.push(`${nombre}: la cámara no guardó la geometría`);
            else if (r.points.length !== c.points.length || r.points.some((p, i) => Math.abs(p.x - fija(c.points![i].x)) > 2 || Math.abs(p.y - fija(c.points![i].y)) > 2)) out.push(`${nombre}: la geometría quedó distinta`);
        }
        if (c.direction && r.direction && r.direction !== c.direction) out.push(`${nombre}: el sentido no cambió`);
        if (c.sensibilidad != null && r.sensibilidad != null && r.sensibilidad !== Math.round(c.sensibilidad)) out.push(`${nombre}: la sensibilidad quedó en ${r.sensibilidad}`);
        if (c.objetivo && r.objetivo && r.objetivo.split(",").sort().join(",") !== c.objetivo.split(",").sort().join(",")) out.push(`${nombre}: el objetivo quedó en ${r.objetivo}`);
        if (c.tiempo != null && r.tiempo != null && r.tiempo !== Math.round(c.tiempo)) out.push(`${nombre}: el tiempo quedó en ${r.tiempo} s`);
    }
    return out;
}

/** Validación antes de mandar: lo que la cámara rechazaría o guardaría mal. */
export function validarCambios(tipo: TipoRegla, cambios: CambioRegla[], max: number): string | null {
    for (const c of cambios) {
        if (!Number.isInteger(c.id) || c.id < 1 || c.id > max) return `${tipo === "linea" ? "Línea" : "Zona"} ${c.id}: la cámara tiene ${max} lugares`;
        if (c.borrar || !c.points) continue;
        if (tipo === "linea" && (c.points.length !== 2 || esVacia("linea", c.points))) return `Línea ${c.id}: necesita 2 puntos distintos`;
        if (tipo === "zona" && (c.points.length < ZONA_MIN || c.points.length > ZONA_MAX)) return `Zona ${c.id}: entre ${ZONA_MIN} y ${ZONA_MAX} vértices`;
    }
    return null;
}
