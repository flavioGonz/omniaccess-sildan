/**
 * Identidad por rostro, del lado del panel: los tipos y lo poco que hace falta en el navegador.
 * Las reglas (umbrales, qué es una visita) viven en lib-rostros.js, que es lo que usa el proceso
 * de visión; acá no se repiten.
 */

import type { Frecuencia } from "@/lib/rostros-frecuencia";

/** «R-0042». Igual que `codigo` de lib-rostros.js (tests/rostros.test.ts comprueba que coincidan). */
export const codigoRostro = (numero: number) => "R-" + String(Math.max(0, Math.trunc(Number(numero) || 0))).padStart(4, "0");

export const FILTROS_ROSTRO = ["todos", "sin-registrar", "registrados", "frecuentes", "sugerencias", "para-registrar"] as const;
export type FiltroRostro = (typeof FILTROS_ROSTRO)[number];
export const ORDENES_ROSTRO = ["recientes", "veces", "nuevos"] as const;
export type OrdenRostro = (typeof ORDENES_ROSTRO)[number];

/** De cuántas visitas para arriba una cara cuenta como «frecuente» en el filtro. */
export const FRECUENTE_DESDE = 3;
/** Cuántas caras trae cada página de la grilla. */
export const ROSTROS_POR_PAGINA = 60;
/** Cuántas pasadas se muestran en la ficha. */
export const PASADAS_EN_FICHA = 80;

export type FilaRostro = {
    id: string; numero: number; codigo: string;
    /** El nombre de la persona del padrón, o el apodo. Null si nadie la registró. */
    nombre: string | null;
    registro: "persona" | "apodo" | null;
    userId: string | null; rol: string | null;
    /** La URL de su mejor cara. Null si se perdió la foto. */
    foto: string | null;
    calidad: number;
    veces: number; primeraVez: string; ultimaVez: string; ultimaCamara: string | null;
    /** Con qué frecuencia pasa, y si conviene registrarla (lib/rostros-frecuencia). */
    frecuencia: Frecuencia;
    /** A quién se parece sin llegar al umbral: la propuesta de unirlas. */
    sugerencia: { id: string; codigo: string; nombre: string | null; foto: string | null; parecido: number } | null;
};

export type PasadaRostro = { id: string; cuando: string; camara: string | null; similitud: number | null; px: number | null; cara: string | null; cuadro: string | null };

export type FichaRostro = FilaRostro & {
    ejemplos: number;
    pasadas: PasadaRostro[];
    /** Cuántas pasadas tiene en total (la ficha muestra las últimas). */
    totalPasadas: number;
    camaras: { camara: string; veces: number }[];
};

/** Los nombres de cámara vienen de la base con las entidades HTML escapadas («Ext. -&gt; Cairoli»). */
export const nombreCamara = (s: string | null | undefined) => (s ? s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&") : null);

/** «3 veces», «1 vez». Cero es una cara cargada a mano que ninguna cámara vio todavía. */
export const textoVeces = (n: number) => (n <= 0 ? "sin verla aún" : n === 1 ? "1 vez" : `${n.toLocaleString("es-UY")} veces`);

/* ── Los ajustes del motor (Ajustes › Motor de rostros) ─────────────────────────── */

/** Lo que se puede ajustar, con sus límites: los mismos rangos que acepta lib-rostros.js › umbrales. */
export const LIMITES_ROSTROS = {
    misma: { min: 0.5, max: 0.99 }, parecida: { min: 0.3, max: 0.99 }, padron: { min: 0.5, max: 0.99 },
    pxMin: { min: 30, max: 600 }, anonimosDias: { min: 1, max: 365 },
} as const;
export type AjustesRostros = { misma: number; parecida: number; padron: number; pxMin: number; anonimosDias: number };
export type EstadoAjustesRostros = AjustesRostros & { porDefecto: AjustesRostros };

/**
 * Lo que se guarda, dentro de sus límites y coherente: «se parece» nunca por encima de «misma
 * persona» (si no, no queda nada en el medio y nunca se sugiere unir). Devuelve también por qué
 * se corrigió algo, para decirlo en vez de cambiarlo callado.
 */
export function normalizarAjustesRostros(a: Partial<AjustesRostros>, base: AjustesRostros): { ajustes: AjustesRostros; avisos: string[] } {
    const avisos: string[] = [];
    const entre = (v: unknown, def: number, l: { min: number; max: number }, paso: number) => {
        const n = Number(v);
        if (v == null || !Number.isFinite(n)) return def;
        return Math.round(Math.min(l.max, Math.max(l.min, n)) / paso) * paso;
    };
    const dos = (n: number) => Math.round(n * 100) / 100;
    const misma = dos(entre(a.misma, base.misma, LIMITES_ROSTROS.misma, 0.01));
    let parecida = dos(entre(a.parecida, base.parecida, LIMITES_ROSTROS.parecida, 0.01));
    if (parecida > misma) { parecida = misma; avisos.push("«Se parece» no puede quedar por encima de «misma persona»: se igualaron, y así nunca se va a sugerir unir dos caras."); }
    return {
        ajustes: {
            misma, parecida, padron: dos(entre(a.padron, base.padron, LIMITES_ROSTROS.padron, 0.01)),
            pxMin: Math.round(entre(a.pxMin, base.pxMin, LIMITES_ROSTROS.pxMin, 1)), anonimosDias: Math.round(entre(a.anonimosDias, base.anonimosDias, LIMITES_ROSTROS.anonimosDias, 1)),
        },
        avisos,
    };
}

/* ── Agregar a mano una cara que no alcanzó ─────────────────────────────────────── */

/**
 * Hasta qué tamaño se deja agregar A MANO una cara que la compuerta dejó sin identidad: la mitad
 * del mínimo (40 px con el mínimo en 80). Por debajo no se guarda ni queriendo.
 *
 * Por qué hay un piso: medido el 13/11 con caras de 14 a 20 px, personas DISTINTAS se parecían
 * hasta 0,82 —por encima del 0,80 de «misma persona»—. Una identidad fundada con una cara así se
 * come las pasadas de cualquiera que se le parezca. Entre 20 y 80 px no hay medición todavía: la
 * mitad del mínimo es un criterio, no un número medido. Ese mismo día, de 17 pasadas sin
 * identidad, 7 tenían entre 53 y 77 px (se pueden agregar) y 10 entre 16 y 33 (no).
 */
export const PISO_MANUAL_PARTE = 0.5;
export const pisoManual = (pxMin: number) => Math.round(pxMin * PISO_MANUAL_PARTE);

/* ── Qué da cada cámara ─────────────────────────────────────────────────────────── */

/** Lo que dio una cámara al modo face en los últimos días: cuántas caras vio, de qué tamaño y cuántas alcanzaron. */
export type UsoCamaraRostros = { deviceId: string; pasadas: number; conIdentidad: number; pxMediana: number | null };
/** Cuántos días para atrás se mira lo que dio cada cámara. */
export const USO_CAMARAS_DIAS = 7;
/** De cuántas caras para arriba se opina de una cámara (con dos caras no hay nada que decir). */
export const USO_CAMARAS_MINIMO = 5;
/** Qué decir de una cámara: si sus caras alcanzan, si llegan chicas, o si todavía no hay datos. */
export function veredictoCamara(u: UsoCamaraRostros | undefined, pxMin: number): { tono: "bien" | "aviso" | "quieto"; texto: string } | null {
    if (!u || !u.pasadas) return null;
    const base = `${u.pasadas === 1 ? "1 cara" : `${u.pasadas} caras`}${u.pxMediana != null ? ` · mediana ${u.pxMediana} px` : ""}`;
    if (u.pasadas < USO_CAMARAS_MINIMO) return { tono: "quieto", texto: base };
    if (u.conIdentidad === 0) return { tono: "aviso", texto: `${base} · ninguna alcanzó los ${pxMin} px` };
    return { tono: u.conIdentidad * 2 >= u.pasadas ? "bien" : "quieto", texto: `${base} · ${u.conIdentidad} con identidad` };
}

/* ── Subir una foto ─────────────────────────────────────────────────────────────── */

/** A quién se parece la cara de una foto: una identidad, o alguien enrolado a mano en el padrón. */
export type ParecidoRostro = { similitud: number; rostro: { id: string; codigo: string; nombre: string | null; foto: string | null } | null; persona: string | null };
/** Lo que el motor vio en una foto subida, antes de guardar nada. */
export type AnalisisFoto = {
    /** Cuántas caras hay en la foto; se trabaja con la más grande. */
    caras: number;
    cara: { px: number; prob: number; recorte: string; caja: [number, number, number, number] } | null;
    /**
     * Qué pasaría al guardarla: «conocida» (ya es de alguien), «nueva» (nace una identidad),
     * «chica»/«dudosa» (no alcanza para comparar bien: se puede guardar igual, a sabiendas) o «sin-cara».
     */
    veredicto: "conocida" | "nueva" | "chica" | "dudosa" | "sin-cara";
    motivo: string | null;
    parecidos: ParecidoRostro[];
    /** Con cuántas identidades conocidas se comparó. */
    comparadas: number;
    umbrales: { misma: number; parecida: number; pxMin: number };
};
export type RostroGuardado = { id: string; codigo: string; nombre: string | null; nueva: boolean; ejemplos: number };

export const ROLES_PERSONA_DESDE_ROSTRO = [
    { valor: "RESIDENT", rotulo: "Residente" }, { valor: "STAFF", rotulo: "Personal" }, { valor: "PROVIDER", rotulo: "Proveedor" }, { valor: "VISITOR", rotulo: "Visitante" },
] as const;
export type RolPersonaDesdeRostro = (typeof ROLES_PERSONA_DESDE_ROSTRO)[number]["valor"];
