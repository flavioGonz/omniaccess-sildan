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
 * SERIES PARTICULARES (28/11, Nico: «reconocer todos los prefijos… tenerlos bien mapeados»). La regla
 * de arriba —«en Montevideo la categoría es segura, en el interior valen los códigos que no empiezan
 * con A–H»— resultó falsa en los dos lados. Medido en el lab, 90 días, 3.240 chapas leídas tres veces
 * o más:
 *
 *   · Montevideo. La serie particular de autos va de SA a SD (hoy por SDO) y SE SALTEA los códigos
 *     acordados por las intendencias: SCC y SCD tienen 3 y 4 chapas donde sus vecinas tienen 12; SDI
 *     tiene 11 entre SDH 58 y SDJ 67; SDP no tiene ninguna (es «deportivo»). Pero NO saltea los que
 *     no son del acuerdo: SCM tiene 31, igual que SCL 33 y SCN 22, y se marcaba «Concejal municipal»
 *     a treinta y un autos particulares. Las motos tienen sus series (SM, SN, SO, SP), y ahí pasaba
 *     lo mismo con SMZ y SMT. Entonces: dentro de una serie particular sólo valen los ACORDADOS.
 *
 *   · Interior. La segunda letra es la localidad, y no siempre empieza en la A: Melo es EM, Mercedes
 *     KM, Young JY, Rivera FR. Ahí la serie particular NO saltea ni los acordados (BED es Punta del
 *     Este, no un edil; EMD es Melo, no Defensa). Entonces: si la segunda letra es una serie
 *     particular de ese departamento (`SERIE_PARTICULAR`), no se afirma ninguna categoría.
 *
 * Las series del interior salen de nuestras lecturas (5 chapas firmes o más), porque la única tabla
 * publicada es la de Maldonado. Cuando una fuente oficial las dé, se reemplazan.
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

    /* ── Sumadas el 18/11 (Nico: «nomenclaturas de matrículas de Uruguay entero, cargarlas y
       reconocer el tipo de chapa para dar más info del vehículo al guardia»). Salen del listado
       de tipos acordados del SUCIVE y del relevamiento de Wikipedia y Academia del Molino. ── */
    TI: { nombre: "Transporte interurbano", corto: "Interurbano", grupo: "publico", tono: "info", letras: "verde", explica: "Ómnibus de línea interdepartamental o interurbana." },
    TD: { nombre: "Transporte de escolares con discapacidad", corto: "Escolar adaptado", grupo: "publico", tono: "info", letras: "verde", explica: "Transporte escolar adaptado." },
    ID: { nombre: "Intendencia Departamental", corto: "Intendencia", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de la intendencia departamental." },
    ED: { nombre: "Edil", corto: "Edil", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de un edil departamental." },
    CM: { nombre: "Concejal municipal", corto: "Concejal", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de un concejal municipal." },
    RN: { nombre: "Representante nacional", corto: "Representante", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de un representante nacional." },
    MP: { nombre: "Ministerio Público", corto: "Fiscalía", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo del Ministerio Público y Fiscal." },
    NG: { nombre: "ONG internacional", corto: "ONG internacional", grupo: "diplomatico", tono: "aviso", letras: "dorado", explica: "Vehículo de una organización no gubernamental internacional acreditada." },
    LQ: { nombre: "Alquiler (rent a car)", corto: "Alquiler", grupo: "comercial", tono: "quieto", letras: "rojo", explica: "Auto de alquiler sin chofer: quien maneja no es el dueño." },
    TM: { nombre: "Transporte mediano", corto: "Transporte", grupo: "comercial", tono: "quieto", letras: "rojo", explica: "Utilitario de transporte mediano." },
    TA: { nombre: "Transporte con acoplado", corto: "Con acoplado", grupo: "comercial", tono: "quieto", letras: "rojo", explica: "Camión con acoplado." },
    TZ: { nombre: "Transporte con remolque", corto: "Remolque", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Transporte con remolque." },
    MZ: { nombre: "Transporte con remolque", corto: "Remolque", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Transporte con remolque." },
    ZZ: { nombre: "Vehículo con tráiler", corto: "Tráiler", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Vehículo con tráiler." },
    MA: { nombre: "Maquinaria", corto: "Maquinaria", grupo: "especial", tono: "quieto", letras: "negro", explica: "Maquinaria (no se usa en Cerro Largo, Soriano, Colonia ni Lavalleja)." },
    MV: { nombre: "Maquinaria vial", corto: "Maquinaria vial", grupo: "especial", tono: "quieto", letras: "negro", explica: "Maquinaria vial." },
    DP: { nombre: "Deportivo", corto: "Deportivo", grupo: "especial", tono: "quieto", letras: "verde", explica: "Vehículo deportivo o de competición." },
    VC: { nombre: "Vehículo clásico", corto: "Clásico", grupo: "especial", tono: "quieto", letras: "verde", explica: "Vehículo clásico o de colección." },
    DU: { nombre: "Demostración de usado", corto: "Demostración", grupo: "temporal", tono: "aviso", letras: "rojo", explica: "Chapa de demostración de vehículo usado (concesionaria)." },

    /* ── Sumados el 28/11, del repaso de fuentes (Wikipedia es/en, matriculasdelmundo.com). «DA»
       (alquiler, serie vieja) queda afuera a propósito: SDA es serie particular de Montevideo. ── */
    HA: { nombre: "Alquiler (serie anterior)", corto: "Alquiler", grupo: "comercial", tono: "quieto", letras: "rojo", explica: "Auto de alquiler sin chofer, con chapa de la serie anterior al Mercosur." },
    RA: { nombre: "Remise", corto: "Remise", grupo: "publico", tono: "info", letras: "rojo", explica: "Auto con chofer contratado (remise)." },
    MT: { nombre: "Turismo (camioneta)", corto: "Turismo", grupo: "publico", tono: "info", letras: "verde", explica: "Camioneta de transporte turístico." },
};

/**
 * Los tipos de chapa ACORDADOS por las intendencias (SUCIVE, «Tipos chapas acordados»; los mismos
 * 26 que lista Academia del Molino). Son los únicos que la serie particular de Montevideo se saltea:
 * por eso son los únicos que se afirman cuando el código cae adentro de una serie particular.
 */
export const ACORDADOS = new Set([
    "DI", "ME", "CC", "CD", "OI", "OF", "ED", "ID", "JD", "PL", "PE", "PJ", "MD", "MI",
    "AL", "TP", "RE", "ES", "TX", "AM", "TU", "TC", "TI", "AT", "PR", "DP",
]);

/**
 * Las series particulares de cada departamento: qué segundas letras son «un auto de alguien» y no
 * una categoría. `motos`, cuando el departamento usa letras aparte para las motos (Montevideo).
 * `localidad`, sólo donde está publicada (Maldonado, matriculasdelmundo.com y Wikipedia en inglés).
 *
 * Medido en el lab el 28/11 (90 días, chapas con 3 lecturas o más; entre paréntesis cuántas):
 * AB 405, AA 183, AV 18, AP 9 · BE 132, BF 17, BA 15, BL 13, BH 11, BG 6, BC 6 · CB 6 · DA 6 ·
 * EM 11, EE 5 · FR 6 · GA 7 · HA 14 · IA 14, IC 5 · JY 14, JF 5 · KM 8 · LA 17 · MA 91, MI 5 ·
 * NC 18, NA 9 · OA 26 · PA 5, PC 5 · QA 12 · RA 13. Con menos de 5 no se anota: puede ser una mala
 * lectura repetida. BL no figura en la tabla publicada de Maldonado, pero tiene 13 chapas.
 */
export const SERIE_PARTICULAR: Record<string, { autos: string; motos?: string; localidad?: Record<string, string> }> = {
    S: { autos: "ABCD", motos: "MNOP" },
    A: { autos: "ABPV" },
    B: { autos: "ABCDEFGHL", localidad: { A: "Maldonado", B: "San Carlos", C: "Pan de Azúcar", D: "Aiguá", E: "Punta del Este", F: "Garzón", G: "Piriápolis", H: "Solís" } },
    C: { autos: "B" }, D: { autos: "A" }, E: { autos: "EM" }, F: { autos: "R" }, G: { autos: "A" }, H: { autos: "A" },
    I: { autos: "AC" }, J: { autos: "FY" }, K: { autos: "M" }, L: { autos: "A" }, M: { autos: "AI" }, N: { autos: "AC" },
    O: { autos: "A" }, P: { autos: "AC" }, Q: { autos: "A" }, R: { autos: "A" },
};

/** ¿La segunda letra es una serie particular de ese departamento, para ese tipo de vehículo? */
function enSerieParticular(dep: string, l2: string, moto: boolean): boolean {
    const s = SERIE_PARTICULAR[dep];
    if (!s) return false;
    // Sin letras propias de moto, las motos comparten la serie de los autos (así es en el interior).
    return (moto && s.motos ? s.motos : s.autos).includes(l2);
}

/**
 * ¿Se puede afirmar la categoría `cod` en una chapa de ese departamento? Es la regla del
 * encabezado, en un solo lugar: la usan `leerChapa` y los prefijos del filtro.
 *   Montevideo: sí, salvo que el código caiga en una serie particular y no sea de los acordados.
 *   Interior:   sólo los códigos que no chocan con localidades (EN_INTERIOR) y cuya primera letra
 *               no sea una serie particular de ese departamento.
 */
export function categoriaVale(dep: string, cod: string, moto: boolean): boolean {
    if (dep === "S") return !enSerieParticular("S", cod[0], moto) || ACORDADOS.has(cod);
    return EN_INTERIOR.has(cod) && !enSerieParticular(dep, cod[0], moto);
}

/** Series fijas de tres letras (las fuerzas armadas, las motos policiales de Montevideo). */
const SERIES: Record<string, Omit<CategoriaChapa, "codigo">> = {
    ENA: { nombre: "Ejército Nacional", corto: "Ejército", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo del Ejército." },
    ENT: { nombre: "Ejército Nacional", corto: "Ejército", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo del Ejército." },
    FAU: { nombre: "Fuerza Aérea", corto: "Fuerza Aérea", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo de la Fuerza Aérea Uruguaya." },
    ARN: { nombre: "Armada Nacional", corto: "Armada", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo de la Armada." },
    ANA: { nombre: "Aviación Naval", corto: "Aviación Naval", grupo: "militar", tono: "info", letras: "negro", explica: "Vehículo de la Aviación Naval." },
    SJP: { nombre: "Policía (moto de Jefatura)", corto: "Policía", grupo: "emergencia", tono: "mal", letras: "azul", explica: "Moto de la Jefatura de Policía de Montevideo." },
    SMP: { nombre: "Ministerio del Interior (moto)", corto: "Policía", grupo: "emergencia", tono: "mal", letras: "azul", explica: "Moto del Ministerio del Interior." },

    /* Series propias de un departamento (18/11). Son de tres letras y fijas, así que no chocan
       con la serie particular del interior: se reconocen igual que las de Montevideo. */
    AIC: { nombre: "Intendencia de Canelones", corto: "Intendencia", grupo: "oficial", tono: "info", letras: "rojo", explica: "Vehículo de la Intendencia de Canelones." },
    CCM: { nombre: "Camión de mercaderías (Rocha)", corto: "Camión", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Camión de mercaderías empadronado en Rocha." },
    CCZ: { nombre: "Transporte con remolque (Rocha)", corto: "Remolque", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Transporte con remolque empadronado en Rocha." },
    GAT: { nombre: "Taxi de Artigas", corto: "Taxi", grupo: "publico", tono: "info", letras: "negro", explica: "Taxi empadronado en Artigas (chapa negra sobre amarillo)." },
    GBT: { nombre: "Taxi de Artigas", corto: "Taxi", grupo: "publico", tono: "info", letras: "negro", explica: "Taxi empadronado en Artigas (chapa negra sobre amarillo)." },
    GAR: { nombre: "Remise de Artigas", corto: "Remise", grupo: "publico", tono: "info", letras: "negro", explica: "Remise empadronado en Artigas." },
    GBR: { nombre: "Remise de Artigas", corto: "Remise", grupo: "publico", tono: "info", letras: "negro", explica: "Remise empadronado en Artigas." },
    GAO: { nombre: "Ómnibus interdepartamental (Artigas)", corto: "Ómnibus", grupo: "publico", tono: "info", letras: "negro", explica: "Ómnibus interdepartamental de Artigas." },
    GBO: { nombre: "Ómnibus interdepartamental (Artigas)", corto: "Ómnibus", grupo: "publico", tono: "info", letras: "negro", explica: "Ómnibus interdepartamental de Artigas." },
    GAE: { nombre: "Escolar de Artigas", corto: "Escolar", grupo: "publico", tono: "info", letras: "negro", explica: "Transporte escolar de Artigas." },
    GAM: { nombre: "Médico de Artigas", corto: "Médico", grupo: "especial", tono: "bien", letras: "verde", explica: "Vehículo de un médico, empadronado en Artigas." },
    GBM: { nombre: "Médico de Artigas", corto: "Médico", grupo: "especial", tono: "bien", letras: "verde", explica: "Vehículo de un médico, empadronado en Artigas." },
    GTC: { nombre: "Transporte de carga (Artigas)", corto: "Carga", grupo: "comercial", tono: "quieto", letras: "negro", explica: "Transporte de carga empadronado en Artigas." },
    HOM: { nombre: "Ómnibus interdepartamental (Salto)", corto: "Ómnibus", grupo: "publico", tono: "info", letras: "rojo", explica: "Ómnibus interdepartamental de Salto." },
    // Sumadas el 28/11.
    SPE: { nombre: "Presidencia de la República", corto: "Presidencia", grupo: "oficial", tono: "info", letras: "azul", explica: "Vehículo de la Presidencia de la República." },
    // «BCC» (consular de Maldonado, según Wikipedia en inglés) queda afuera: BC es la serie particular
    // de Pan de Azúcar, y afirmar «consular» sobre BCC sería repetir el error de SCM.
};

/**
 * En el interior la 2.ª letra también es localidad o serie particular: sólo se aceptan códigos que
 * empiezan con una letra que no se usa para eso (ver arriba). Medido: Canelones ya tiene AAM, AAT,
 * AAU, AAL particulares.
 */
const EN_INTERIOR = new Set([
    "TX", "RE", "TC", "TU", "TP", "TR", "OF", "MI", "MD", "IM", "JD", "PL", "PJ", "ME", "OI", "PR", "RO",
    // Sumados el 18/11, con la misma regla: ninguno empieza con A–H.
    "TI", "TD", "TM", "TA", "TZ", "MZ", "ZZ", "MA", "MV", "ID", "RN", "MP", "NG", "LQ", "VC",
    // Sumados el 28/11 (HA no: en Salto es la serie particular, y empieza con H).
    "RA", "MT",
]);

export type LecturaChapa = {
    departamento: string | null;
    /** La categoría, si la chapa es especial. Sin esto es particular (o no se sabe). */
    categoria: CategoriaChapa | null;
    confianza: "alta" | "probable" | null;
    /** De otro país del Mercosur, por el formato. */
    extranjera: "Brasil" | "Argentina" | "Paraguay" | null;
    /** La frase para un desconocido: «Taxi de Montevideo», «Particular de Canelones», «Matrícula argentina». */
    frase: string;
    /** La localidad, donde la segunda letra la dice y está publicada (hoy sólo Maldonado). */
    localidad?: string | null;
    /**
     * Tiene forma de chapa uruguaya pero empieza con una letra que no es de ningún departamento
     * (T–Z): es extranjera con el formato viejo, o está mal leída. Es la primera señal para corregir
     * por prefijo.
     */
    sinDepartamento?: boolean;
};

/** Maldonado, chapa anterior a 2019 (B 512·345): el primer número dice la localidad. Sólo los cinco que muestran las fuentes. */
const MALDONADO_VIEJA: Record<string, string> = { "1": "Maldonado", "2": "San Carlos", "5": "Punta del Este", "7": "Piriápolis", "8": "Solís" };

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
    if (n.formato === "UY_VIEJA") {
        const loc = p[0] === "B" ? MALDONADO_VIEJA[p[1]] || null : null;
        return { departamento: dep, categoria: null, confianza: null, extranjera: null, localidad: loc, frase: dep ? `Chapa vieja de ${dep}${loc ? ` (${loc})` : ""}` : "Chapa uruguaya vieja" };
    }
    const serie = SERIES[p.slice(0, 3)];
    if (serie) return { departamento: dep, categoria: { codigo: p.slice(0, 3), ...serie }, confianza: "alta", extranjera: null, frase: serie.nombre };
    const cod = p.slice(1, 3);
    const cat = CATEGORIAS[cod];
    const moto = n.formato === "UY_MOTO";
    if (cat && dep) {
        const montevideo = p[0] === "S";
        if (categoriaVale(p[0], cod, moto)) {
            return {
                departamento: dep, categoria: { codigo: cod, ...cat }, confianza: montevideo ? "alta" : "probable", extranjera: null,
                // Sin «(moto)»: las series especiales también usan tres números (SCD 150) sin ser motos.
                frase: `${cat.corto} de ${dep}`,
            };
        }
    }
    // Con forma uruguaya y una primera letra que no es de ningún departamento: no es «Particular».
    if (!dep) return { departamento: null, categoria: null, confianza: null, extranjera: null, sinDepartamento: true, frase: "Sin departamento: extranjera o mal leída" };
    const loc = SERIE_PARTICULAR[p[0]]?.localidad?.[p[1]] || null;
    return { departamento: dep, categoria: null, confianza: null, extranjera: null, localidad: loc, frase: `${moto ? "Moto particular" : "Particular"} de ${dep}${loc ? ` (${loc})` : ""}` };
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
    { id: "taxi", rotulo: "Taxi", codigos: ["TX"], series: ["GAT", "GBT"], aspecto: true },
    { id: "remise", rotulo: "Remise", codigos: ["RE", "RA"], series: ["GAR", "GBR"] },
    { id: "transporte", rotulo: "Ómnibus, turismo y escolar", codigos: ["TC", "TU", "TI", "ES", "TD", "MT"], series: ["GAO", "GBO", "GAE", "HOM"] },
    { id: "policia", rotulo: "Policía / Bomberos", codigos: ["MI"], series: ["SJP", "SMP"] },
    { id: "ambulancia", rotulo: "Ambulancia", codigos: ["AM"] },
    { id: "oficial", rotulo: "Oficial e intendencia", codigos: ["OF", "IM", "ID", "JD", "PL", "PE", "PJ", "ED", "CM", "RN", "MP"], series: ["AIC", "SPE"] },
    { id: "militar", rotulo: "Fuerzas armadas", codigos: ["MD"], series: ["ENA", "ENT", "FAU", "ARN", "ANA"] },
    { id: "diplomatico", rotulo: "Diplomático y consular", codigos: ["CD", "CC", "OI", "NG"] },
    { id: "alquiler", rotulo: "Alquiler (rent a car)", codigos: ["AL", "LQ", "HA"] },
    { id: "carga", rotulo: "Carga y remolque", codigos: ["TP", "TR", "TM", "TA", "TZ", "MZ", "ZZ"], series: ["CCM", "CCZ", "GTC"] },
    { id: "medico", rotulo: "Médico", codigos: ["ME"], series: ["GAM", "GBM"] },
    { id: "maquinaria", rotulo: "Maquinaria", codigos: ["MA", "MV"] },
    { id: "discapacidad", rotulo: "Discapacidad", codigos: ["DI"] },
    { id: "temporal", rotulo: "Temporaria, prueba o demostración", codigos: ["AT", "PR", "DU"] },
];

/**
 * Los comienzos de chapa de un tipo, con la misma regla que `leerChapa` (`categoriaVale`): no entra
 * un código que en ese departamento cae adentro de una serie particular (SCM no es «oficial»).
 * Sirven para filtrar con `startsWith` / `LIKE 'STX%'` sin expresiones regulares en la base.
 */
export function prefijosDeTipo(id: string): string[] {
    const t = TIPOS_CHAPA.find((x) => x.id === id);
    if (!t) return [];
    const out = new Set<string>(t.series || []);
    /* Un prefijo no dice si la chapa es de auto o de moto: se toma la regla de los autos, que son
       casi todo lo que se filtra. (Las motos SMZ/SMT de la serie SM quedan adentro de «carga» y
       «transporte»; `leerChapa`, que sí ve el largo, las dice «Moto particular».) */
    for (const c of t.codigos) for (const d of Object.keys(DEPARTAMENTO)) if (categoriaVale(d, c, false)) out.add(`${d}${c}`);
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
