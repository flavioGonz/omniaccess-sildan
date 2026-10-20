/**
 * Qué dice una matrícula uruguaya de su vehículo, sin el padrón.
 *
 * Por qué (18/10, Nico: «un análisis de la nomenclatura de matrículas de Uruguay para diferenciar
 * taxis, policía, bomberos, ambulancias, etc., y dar una mejor descripción a desconocidos»). Una
 * chapa que no está en el padrón se mostraba como «no figura» y nada más; pero la chapa misma dice
 * mucho: STX 1234 es un taxi de Montevideo, SOF un vehículo oficial, SAM una ambulancia, SCD un
 * diplomático. Eso cambia lo que hace el guardia con un desconocido.
 *
 * La nomenclatura (SUCIVE / reglamentación de la chapa Mercosur, 2015; Wikipedia «Matrículas
 * automovilísticas de Uruguay»; matriculasdelmundo.com):
 *   1.ª letra       el departamento (S Montevideo, A Canelones, B Maldonado…; la Ñ no se usa).
 *   2.ª y 3.ª       en las chapas ESPECIALES, la categoría: TX taxi, OF oficial, AM ambulancia…
 *                   En las particulares del interior, la 2.ª (a veces 2.ª y 3.ª) es la localidad
 *                   (Maldonado: BA Maldonado … BE Punta del Este).
 *   Color de letra  negro particular · azul oficial · rojo comercial · verde taxi/ambulancia/
 *                   transporte · dorado diplomático, según la norma. NO se usa: medido el 18/10
 *                   en 176 recortes de las LPR del lab, las letras de un taxi salen tan oscuras
 *                   como las de un particular, y de noche el recorte es infrarrojo. La segunda
 *                   prueba es el aspecto del vehículo (vision-analisis.js, atributo `servicio`).
 *
 * Medido en el lab, 60 días de accesos: STX 44 chapas distintas, SDI 7, SCC 6, SCD 6, SAT 5,
 * SRE 3, SAM 3, SES 2, SAL 2, SIM 2, STU 2, SMI 1, SOF 1, STP 1. Las de Montevideo cuadran.
 *
 * CONFIANZA. En Montevideo (S…) la categoría es segura: las particulares de Montevideo no usan
 * esas letras. En el interior es «probable»: la 2.ª letra también es la localidad y la serie
 * particular avanza (Canelones AAA, AAB… ya pasó por AAM, AAT, AAU, AAL: son particulares). Por
 * eso en el interior NO se toman los códigos que empiezan con A–H (AM, AL, AT, AU, CC, CD, DI, ES,
 * EX…), que chocan con localidades y series particulares; sí los que no (TX, OF, MI, RE, TC, TP…).
 *
 * POLICÍA Y BOMBEROS. Los dos dependen del Ministerio del Interior y usan la misma serie MI (SMI en
 * Montevideo; motos de la Jefatura SJP/SMP). La chapa no los distingue: se dice «Ministerio del
 * Interior (Policía o Bomberos)». Lo distingue la foto (OmniVision: color, balizas, rotulado).
 */
import { normalizarChapa } from "@/lib/formato-chapa";

export const DEPARTAMENTO: Record<string, string> = {
    A: "Canelones", B: "Maldonado", C: "Rocha", D: "Treinta y Tres", E: "Cerro Largo", F: "Rivera", G: "Artigas",
    H: "Salto", I: "Paysandú", J: "Río Negro", K: "Soriano", L: "Colonia", M: "San José", N: "Flores", O: "Florida",
    P: "Lavalleja", Q: "Durazno", R: "Tacuarembó", S: "Montevideo",
};

export type TonoCategoria = "mal" | "aviso" | "info" | "bien" | "quieto";
export type GrupoCategoria = "emergencia" | "oficial" | "diplomatico" | "publico" | "comercial" | "especial" | "militar" | "temporal";
export type CategoriaChapa = {
    codigo: string;
    nombre: string;
    /** Para la frase: «Taxi de Montevideo». */
    corto: string;
    grupo: GrupoCategoria;
    tono: TonoCategoria;
    /** El color de las letras en la chapa, según la reglamentación (para explicar y, a futuro, contrastar con la foto). */
    letras: "negro" | "azul" | "rojo" | "verde" | "dorado";
    explica: string;
};

/** Las categorías de las chapas especiales (2.ª y 3.ª letra). */
const CATEGORIAS: Record<string, Omit<CategoriaChapa, "codigo">> = {
    TX: { nombre: "Taxi", corto: "Taxi", grupo: "publico", tono: "info", letras: "verde", explica: "Servicio de taxi habilitado por la intendencia." },
    RE: { nombre: "Remise", corto: "Remise", grupo: "publico", tono: "info", letras: "rojo", explica: "Auto con chofer contratado (remise)." },
    TC: { nombre: "Transporte colectivo", corto: "Ómnibus", grupo: "publico", tono: "info", letras: "verde", explica: "Ómnibus de línea o transporte colectivo." },
    TU: { nombre: "Transporte turístico", corto: "Turismo", grupo: "publico", tono: "info", letras: "verde", explica: "Ómnibus o camioneta de turismo." },
    ES: { nombre: "Transporte escolar", corto: "Escolar", grupo: "publico", tono: "info", letras: "verde", explica: "Transporte de escolares." },
    TP: { nombre: "Carga profesional", corto: "Carga", grupo: "comercial", tono: "quieto", letras: "rojo", explica: "Camión o utilitario de transporte profesional de carga." },
    TR: { nombre: "Remolque", corto: "Remolque", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Remolque o semirremolque." },
    AL: { nombre: "Alquiler (rent a car)", corto: "Alquiler", grupo: "comercial", tono: "quieto", letras: "rojo", explica: "Auto de alquiler sin chofer: quien maneja no es el dueño." },
    OF: { nombre: "Vehículo oficial", corto: "Oficial", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de un organismo del Estado." },
    MI: { nombre: "Ministerio del Interior (Policía o Bomberos)", corto: "Policía / Bomberos", grupo: "emergencia", tono: "mal", letras: "azul", explica: "Ministerio del Interior: patrulleros de la Policía y unidades de Bomberos usan esta serie; la chapa no los distingue." },
    MD: { nombre: "Ministerio de Defensa", corto: "Defensa", grupo: "militar", tono: "info", letras: "azul", explica: "Vehículo del Ministerio de Defensa Nacional." },
    IM: { nombre: "Intendencia", corto: "Intendencia", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de la intendencia departamental." },
    JD: { nombre: "Junta Departamental", corto: "Junta Dptal.", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de la Junta Departamental." },
    PL: { nombre: "Poder Legislativo", corto: "Legislativo", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo del Poder Legislativo." },
    PE: { nombre: "Poder Ejecutivo", corto: "Ejecutivo", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo del Poder Ejecutivo." },
    PJ: { nombre: "Poder Judicial", corto: "Judicial", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo del Poder Judicial." },
    AM: { nombre: "Ambulancia", corto: "Ambulancia", grupo: "emergencia", tono: "mal", letras: "verde", explica: "Ambulancia o unidad de emergencia médica." },
    ME: { nombre: "Médico", corto: "Médico", grupo: "especial", tono: "bien", letras: "verde", explica: "Vehículo de un médico (cruz verde en la chapa)." },
    DI: { nombre: "Persona con discapacidad", corto: "Discapacidad", grupo: "especial", tono: "quieto", letras: "negro", explica: "Vehículo de una persona con discapacidad (símbolo de silla de ruedas)." },
    CD: { nombre: "Cuerpo diplomático", corto: "Diplomático", grupo: "diplomatico", tono: "aviso", letras: "dorado", explica: "Embajada: vehículo diplomático." },
    CC: { nombre: "Cuerpo consular", corto: "Consular", grupo: "diplomatico", tono: "aviso", letras: "dorado", explica: "Consulado: vehículo consular." },
    OI: { nombre: "Organismo internacional", corto: "Org. internacional", grupo: "diplomatico", tono: "aviso", letras: "dorado", explica: "Vehículo de un organismo internacional." },
    AT: { nombre: "Admisión temporaria", corto: "Temporaria", grupo: "temporal", tono: "aviso", letras: "verde", explica: "Vehículo extranjero o de residente temporal con admisión temporaria." },
    EX: { nombre: "Exonerado", corto: "Exonerado", grupo: "especial", tono: "quieto", letras: "negro", explica: "Vehículo exonerado de tributos." },
    PR: { nombre: "Prueba / provisoria", corto: "Provisoria", grupo: "temporal", tono: "aviso", letras: "rojo", explica: "Chapa de prueba o provisoria (concesionaria, traslado)." },
    RO: { nombre: "Casa rodante", corto: "Casa rodante", grupo: "especial", tono: "quieto", letras: "negro", explica: "Motorhome / casa rodante." },
};

/** Series fijas de tres letras (las fuerzas armadas, las motos policiales de Montevideo). */
const SERIES: Record<string, Omit<CategoriaChapa, "codigo">> = {
    ENA: { nombre: "Ejército Nacional", corto: "Ejército", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo del Ejército." },
    ENT: { nombre: "Ejército Nacional", corto: "Ejército", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo del Ejército." },
    FAU: { nombre: "Fuerza Aérea", corto: "Fuerza Aérea", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo de la Fuerza Aérea Uruguaya." },
    ARN: { nombre: "Armada Nacional", corto: "Armada", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo de la Armada." },
    ANA: { nombre: "Aviación Naval", corto: "Aviación Naval", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo de la Aviación Naval." },
    SJP: { nombre: "Policía (moto de Jefatura)", corto: "Policía", grupo: "emergencia", tono: "mal", letras: "azul", explica: "Moto de la Jefatura de Policía de Montevideo." },
    SMP: { nombre: "Ministerio del Interior (moto)", corto: "Policía", grupo: "emergencia", tono: "mal", letras: "azul", explica: "Moto del Ministerio del Interior." },
};

/**
 * En el interior la 2.ª letra también es localidad o serie particular: sólo se aceptan códigos que
 * empiezan con una letra que no se usa para eso (ver arriba). Medido: Canelones ya tiene AAM, AAT,
 * AAU, AAL particulares.
 */
const EN_INTERIOR = new Set(["TX", "RE", "TC", "TU", "TP", "TR", "OF", "MI", "MD", "IM", "JD", "PL", "PJ", "ME", "OI", "PR", "RO"]);

export type LecturaChapa = {
    departamento: string | null;
    /** La categoría, si la chapa es especial. Sin esto es particular (o no se sabe). */
    categoria: CategoriaChapa | null;
    confianza: "alta" | "probable" | null;
    /** De otro país del Mercosur, por el formato. */
    extranjera: "Brasil" | "Argentina" | "Paraguay" | null;
    /** La frase para un desconocido: «Taxi de Montevideo», «Particular de Canelones», «Matrícula argentina». */
    frase: string;
};

const PAIS: Record<string, LecturaChapa["extranjera"]> = { BR: "Brasil", AR: "Argentina", PY: "Paraguay" };

/** Lo que dice la chapa sola. null si no tiene forma de chapa. */
export function leerChapa(texto: string | null | undefined): LecturaChapa | null {
    const n = normalizarChapa(texto);
    if (!n) return null;
    const p = n.plate;
    if (PAIS[n.formato]) {
        const pais = PAIS[n.formato]!;
        return { departamento: null, categoria: null, confianza: null, extranjera: pais, frase: `Matrícula de ${pais}` };
    }
    // AAA1234 puede ser también brasileña vieja; acá se la toma como uruguaya, que es lo que se ve en el barrio.
    const dep = DEPARTAMENTO[p[0]] || null;
    if (n.formato === "UY_VIEJA") return { departamento: dep, categoria: null, confianza: null, extranjera: null, frase: dep ? `Chapa vieja de ${dep}` : "Chapa uruguaya vieja" };
    const serie = SERIES[p.slice(0, 3)];
    if (serie) return { departamento: dep, categoria: { codigo: p.slice(0, 3), ...serie }, confianza: "alta", extranjera: null, frase: serie.nombre };
    const cod = p.slice(1, 3);
    const cat = CATEGORIAS[cod];
    const moto = n.formato === "UY_MOTO";
    if (cat && dep) {
        const montevideo = p[0] === "S";
        if (montevideo || EN_INTERIOR.has(cod)) {
            return {
                departamento: dep, categoria: { codigo: cod, ...cat }, confianza: montevideo ? "alta" : "probable", extranjera: null,
                // Sin «(moto)»: las series especiales también usan tres números (SCD 150) sin ser motos.
                frase: `${cat.corto} de ${dep}`,
            };
        }
    }
    return { departamento: dep, categoria: null, confianza: null, extranjera: null, frase: dep ? `${moto ? "Moto particular" : "Particular"} de ${dep}` : "Particular" };
}

/**
 * Los tipos por los que se filtra el historial (18/10, Nico: «que el motor catalogue las chapas de
 * Uruguay y sus tipos, no sólo en la búsqueda de parecidos»). Agrupan códigos de la tabla de arriba
 * en lo que un guardia pregunta: «¿qué taxis entraron?», «¿pasó la policía?». `aspecto`: también
 * cuenta lo que OmniVision ve en el vehículo (ver SERVICIO_TAXI en vision-analisis.js) — sólo para
 * taxi, que es lo único que se midió que distingue (14 STX: 11 «taxi»; 284 particulares: 0).
 */
export type TipoChapa = { id: string; rotulo: string; codigos: string[]; series?: string[]; aspecto?: boolean };
export const TIPOS_CHAPA: TipoChapa[] = [
    { id: "taxi", rotulo: "Taxi", codigos: ["TX"], aspecto: true },
    { id: "remise", rotulo: "Remise", codigos: ["RE"] },
    { id: "transporte", rotulo: "Ómnibus, turismo y escolar", codigos: ["TC", "TU", "ES"] },
    { id: "policia", rotulo: "Policía / Bomberos", codigos: ["MI"], series: ["SJP", "SMP"] },
    { id: "ambulancia", rotulo: "Ambulancia", codigos: ["AM"] },
    { id: "oficial", rotulo: "Oficial e intendencia", codigos: ["OF", "IM", "JD", "PL", "PE", "PJ"] },
    { id: "militar", rotulo: "Fuerzas armadas", codigos: ["MD"], series: ["ENA", "ENT", "FAU", "ARN", "ANA"] },
    { id: "diplomatico", rotulo: "Diplomático y consular", codigos: ["CD", "CC", "OI"] },
    { id: "alquiler", rotulo: "Alquiler (rent a car)", codigos: ["AL"] },
    { id: "carga", rotulo: "Carga y remolque", codigos: ["TP", "TR"] },
    { id: "discapacidad", rotulo: "Discapacidad", codigos: ["DI"] },
    { id: "temporal", rotulo: "Temporaria o de prueba", codigos: ["AT", "PR"] },
];

/**
 * Los comienzos de chapa de un tipo, con la misma regla de confianza que `leerChapa`: en
 * Montevideo (S…) todos los códigos; en el interior sólo los que no chocan con localidades.
 * Sirven para filtrar con `startsWith` / `LIKE 'STX%'` sin expresiones regulares en la base.
 */
export function prefijosDeTipo(id: string): string[] {
    const t = TIPOS_CHAPA.find((x) => x.id === id);
    if (!t) return [];
    const out = new Set<string>(t.series || []);
    for (const c of t.codigos) {
        out.add(`S${c}`);
        if (EN_INTERIOR.has(c)) for (const d of Object.keys(DEPARTAMENTO)) if (d !== "S") out.add(`${d}${c}`);
    }
    return [...out];
}

/**
 * El tipo (id de TIPOS_CHAPA) de una chapa leída, con la misma regla de confianza que
 * `leerChapa`; null si es particular, extranjera o no tiene forma de chapa. Lo usan las reglas
 * de aviso (lib/reglas-notificacion): «avisame cuando entre una ambulancia».
 */
export function tipoDeChapa(texto: string | null | undefined): string | null {
    const c = leerChapa(texto)?.categoria;
    if (!c) return null;
    return TIPOS_CHAPA.find((t) => t.codigos.includes(c.codigo) || t.series?.includes(c.codigo))?.id ?? null;
}
