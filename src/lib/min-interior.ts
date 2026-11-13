/**
 * Consulta asistida de "Matrículas Requeridas" (Ministerio del Interior, Uruguay).
 *
 * Lo que comparten el botón, el diálogo y la ruta: la URL oficial (para ofrecer abrirla
 * cuando la respuesta no se pudo clasificar) y la normalización de la matrícula. Vivían
 * repetidas en el botón y en el diálogo, y el diálogo no podía importarlas del botón sin
 * un ciclo (el botón importa al diálogo).
 */

/**
 * El formulario oficial. El 22/10 el sitio pasó a redirigir a la portada del Ministerio en gub.uy
 * y el enlace apuntó un tiempo a la ficha del servicio; el 2/11 Nico avisó que volvió a estar en
 * línea en su dirección de siempre, que es la que lleva la matrícula a consultar.
 */
export const MIN_INTERIOR_URL = "https://matriculas-requeridas.minterior.gub.uy/";

/** Cuánto vale una respuesta guardada para mostrarla junto al botón como «última consulta». */
export const ULTIMA_VIGENTE_MS = 24 * 60 * 60 * 1000;

/** Sólo letras y números en mayúscula: así la escribe el sitio y así la guarda OmniAccess. */
export const normalizarMatricula = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Largo máximo del código de la imagen: el formulario oficial no acepta más. */
export const LARGO_CODIGO = 6;

export type EstadoConsulta = "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN";

/** La última consulta guardada de una matrícula, como la devuelve `?action=ultima`. */
export type UltimaConsulta = { estado: Exclude<EstadoConsulta, "CAPTCHA">; creadoEn: string; quien: string | null; extracto: string | null };

/**
 * Una matrícula que el Ministerio confirmó como REQUERIDA (13/11, Nico: «una vez detectada una
 * matrícula requerida por el Ministerio, en todas las búsquedas, estados, fotos, debe indicar la
 * fecha de consulta y la confirmación de requerida: cartel visual claro … debe ingresarse
 * automáticamente a listas negras y avisar de ese proceso»).
 *
 * No se inventó otra lista: al confirmarse, la matrícula entra a la LISTA NEGRA con esta etiqueta
 * y un motivo que dice cuándo se consultó y quién. Así vale todo lo que la lista negra ya hace
 * —la barrera la deniega, salta el aviso crítico en toda la app y en la pared, avisa el bot— y lo
 * único que se agrega es reconocerla por la etiqueta para mostrarla como lo que es.
 */
export const ETIQUETA_REQUERIDA = "Requerida · Ministerio del Interior";
/** Cómo se la nombra donde no entra la etiqueta entera (el rótulo sobre la foto, una cápsula). */
export const REQUERIDA_CORTA = "Requerida · M. Interior";
/**
 * Lo que dice SOBRE EL VEHÍCULO (la silueta, el cuadro de la pared): «la policía», no el nombre del
 * organismo (13/11, Nico: «genera más impacto»). Es lo que se lee de lejos y en un segundo; quién
 * lo confirmó y cuándo lo dice el cartel (CartelRequerida), que sí nombra al Ministerio.
 */
export const REQUERIDA_POLICIA = "Requerida por la policía";
const INICIO_MOTIVO = "Requerida por el Ministerio del Interior";

/** ¿Esta entrada de la lista es una requerida confirmada? Por la etiqueta, o por cómo empieza el motivo. */
export const esRequerida = (etiqueta?: string | null, motivo?: string | null) =>
    String(etiqueta || "").trim() === ETIQUETA_REQUERIDA || String(motivo || "").startsWith(INICIO_MOTIVO);

/** El motivo que queda en la lista negra: qué, cuándo se consultó y quién. `antes`: lo que ya decía la lista de esa matrícula. */
export function motivoRequerida(cuando: Date, quien: string | null, antes?: string | null): string {
    const f = new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", year: "numeric" }).format(cuando);
    const h = new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", hour: "2-digit", minute: "2-digit", hour12: false }).format(cuando);
    // Los nombres de cámara están guardados con las entidades de HTML («Ext. -&gt; Cairoli») y el motivo
    // viejo las arrastra: acá se escriben como se leen, porque esto se muestra tal cual.
    const limpio = antes ? antes.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").trim().replace(/\.$/, "") : "";
    const previo = limpio && !limpio.startsWith(INICIO_MOTIVO) ? ` Antes en la lista: ${limpio}.` : "";
    return `${INICIO_MOTIVO}. Confirmada en el sitio oficial el ${f} a las ${h}${quien ? ` por ${quien}` : ""}.${previo}`;
}

/** Cuándo se confirmó, sacado del motivo («13/11/2026 17:16»), para el cartel. Null si el motivo no lo trae. */
export function confirmacionDe(motivo?: string | null): string | null {
    const m = /el (\d{2}\/\d{2}\/\d{4}) a las (\d{2}:\d{2})/.exec(String(motivo || ""));
    return m ? `${m[1]} ${m[2]}` : null;
}

/** Lo que la ruta cuenta de la entrada automática a la lista negra, para avisarlo en el momento. */
export type AltaRequerida = { ok: boolean; yaEstaba: boolean; antes: string | null; error?: string };

/**
 * La frase del aviso de «lista negra a la vista» (lib/lista-negra-vista): quién lo dice y dónde se
 * la vio. Sin la hora: el aviso ya tiene la suya.
 */
export function motivoALaVista(n: { requerida: boolean; etiqueta: string; motivo: string | null }, camara: string | null): string {
    const donde = camara ? ` A la vista en ${camara}.` : " A la vista en una cámara de seguimiento.";
    if (n.requerida) {
        const c = confirmacionDe(n.motivo);
        return `Requerida por el Ministerio del Interior${c ? ` (confirmada el ${c})` : ""}.${donde}`;
    }
    return `En la lista negra${n.etiqueta ? `: ${n.etiqueta}` : ""}.${donde}`;
}
