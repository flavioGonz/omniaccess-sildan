import { normalizarChapa } from "@/lib/formato-chapa";

/**
 * El censo del barrio: lo que carga un residente desde el QR, y qué se acepta.
 *
 * Pedido del 18/11 (Nico): un formulario con el diseño de OmniAccess para que, en una asamblea
 * de más de 300 personas, cada lote cargue sus vehículos y sus servicios. Tiene que vivir en una
 * URL nuestra, no en una herramienta de afuera.
 *
 * Dos decisiones de forma que son casi todo el diseño:
 *
 *  · **Una lista de vehículos, no doce campos.** El pedido traía «Vehículo residente 1 a 4»,
 *    «Vehículo familia autorizado 1 a 4» y «Vehículos de proveedores», que son lo mismo con otra
 *    etiqueta. Es UNA lista con un tipo por fila y un botón «agregar». Nadie completa doce
 *    campos parado en una asamblea con el celular; con una lista, el que tiene un auto termina
 *    en cuarenta segundos y el que tiene seis también puede.
 *  · **Una lista de servicios**, por lo mismo: jardinero, piscinero y «otro» son el mismo hecho
 *    —alguien que entra tal día a tal hora— con distinto nombre.
 *
 * Y una regla que no se negocia: **nada de esto entra al padrón solo.** Cae en una bandeja y
 * alguien lo aprueba. El formulario es un QR abierto: cualquiera puede escribir que es del lote
 * 42, y lo que se carga son matrículas que abren un portón.
 */

export type Tenencia = "PROPIETARIO" | "INQUILINO";
export type TipoVehiculo = "PROPIO" | "FAMILIAR" | "PROVEEDOR";
export type TipoServicio = "JARDINERO" | "PISCINERO" | "LIMPIEZA" | "OTRO";

export const TENENCIAS: { id: Tenencia; rotulo: string }[] = [
    { id: "PROPIETARIO", rotulo: "Propietario" },
    { id: "INQUILINO", rotulo: "Inquilino" },
];

export const TIPOS_VEHICULO: { id: TipoVehiculo; rotulo: string; ayuda: string }[] = [
    { id: "PROPIO", rotulo: "De la casa", ayuda: "El de los que viven en el lote." },
    { id: "FAMILIAR", rotulo: "Familiar autorizado", ayuda: "Alguien de la familia que entra sin avisar." },
    { id: "PROVEEDOR", rotulo: "Proveedor", ayuda: "El que viene a trabajar a la casa." },
];

export const TIPOS_SERVICIO: { id: TipoServicio; rotulo: string }[] = [
    { id: "JARDINERO", rotulo: "Jardinero" },
    { id: "PISCINERO", rotulo: "Piscinero" },
    { id: "LIMPIEZA", rotulo: "Limpieza" },
    { id: "OTRO", rotulo: "Otro" },
];

/** Lunes a domingo, en el orden en que los piensa cualquiera. */
export const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
export type Dia = (typeof DIAS)[number];

/** Topes. No son límites del barrio: son el tamaño a partir del cual esto es otra cosa (una flota). */
export const VEHICULOS_MAX = 10;
export const SERVICIOS_MAX = 8;
export const TEXTO_MAX = 80;
export const COMENTARIO_MAX = 500;

export type VehiculoCargado = { chapa: string; tipo: TipoVehiculo; marca?: string; color?: string; quien?: string };
export type ServicioCargado = { tipo: TipoServicio; nombre?: string; dias: Dia[]; desde?: string; hasta?: string; chapa?: string };

export type Solicitud = {
    lote: string;
    apellido: string;
    nombre: string;
    tenencia: Tenencia;
    telefono: string;
    email: string;
    vehiculos: VehiculoCargado[];
    servicios: ServicioCargado[];
    comentario: string;
};

const texto = (v: unknown, max = TEXTO_MAX) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * El lote, como lo escribe la gente: «12», «B4», «b 4», «Lote 7». Se guarda en mayúsculas y sin
 * la palabra «lote», que la mitad escribe y la otra mitad no — y si no, el mismo lote entra dos
 * veces escrito distinto y la bandeja no los junta.
 */
export function normalizarLote(v: unknown): string {
    return String(v ?? "").toUpperCase().replace(/\bLOTES?\b/g, " ").replace(/[^A-Z0-9/-]+/g, " ").trim().replace(/\s+/g, "").slice(0, 12);
}

/** Uruguay: 09x xxx xxx. Se guarda en dígitos, con el país, igual que lo manda WhatsApp. */
export function normalizarTelefono(v: unknown): string {
    const d = String(v ?? "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("598")) return d.slice(0, 12);
    if (d.startsWith("0")) return "598" + d.slice(1, 10);
    return d.length >= 8 && d.length <= 9 ? "598" + d : d.slice(0, 12);
}

/** Un teléfono uruguayo de celular: 598 9x xxx xxx. Es el único dato por el que se le puede volver a hablar. */
export const telefonoSirve = (t: string) => /^5989\d{7}$/.test(t) || /^598[2-4]\d{6,7}$/.test(t);

const horaSirve = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/**
 * Valida y normaliza lo que llega del formulario. Devuelve los datos listos para guardar y la
 * lista de lo que está mal, en el idioma del que lo va a leer — no «campo requerido».
 *
 * Las matrículas pasan por el mismo molde con el que leen las cámaras: lo que no entra ahí no va
 * a abrir nunca un portón, y vale más decirlo con la persona delante que descubrirlo tres semanas
 * después en la barrera.
 *
 * Con una diferencia importante: la cámara CORRIGE lo que confunde —un 0 por una O— porque está
 * adivinando desde píxeles. Una persona que escribe SU chapa no está adivinando: si lo que puso
 * no cae exacto en un molde, corregírselo en silencio es guardar la chapa de otro. Acá se acepta
 * sólo lo que entra sin cambios, y si hay una corrección posible se la propone para que la mire.
 */
export function validarSolicitud(x: any): { datos: Solicitud | null; errores: string[] } {
    const errores: string[] = [];
    const lote = normalizarLote(x?.lote);
    const apellido = texto(x?.apellido, 60);
    const nombre = texto(x?.nombre, 60);
    const telefono = normalizarTelefono(x?.telefono);
    const email = texto(x?.email, 120).toLowerCase();
    const tenencia: Tenencia = x?.tenencia === "INQUILINO" ? "INQUILINO" : "PROPIETARIO";

    if (!lote) errores.push("Falta el lote.");
    if (apellido.length < 2) errores.push("Falta el apellido.");
    if (!telefono) errores.push("Falta el teléfono.");
    else if (!telefonoSirve(telefono)) errores.push("Ese teléfono no parece uruguayo. Va con 09 adelante.");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) errores.push("Ese correo no se entiende.");

    const vistas = new Set<string>();
    const vehiculos: VehiculoCargado[] = [];
    for (const v of Array.isArray(x?.vehiculos) ? x.vehiculos.slice(0, VEHICULOS_MAX) : []) {
        const cruda = texto(v?.chapa, 12);
        if (!cruda) continue;
        const n = normalizarChapa(cruda);
        if (!n) { errores.push(`«${cruda}» no tiene forma de matrícula.`); continue; }
        if (n.cambios > 0) { errores.push(`¿«${cruda}» es ${n.plate}? Revisalo: hay letras y números que se parecen.`); continue; }
        if (vistas.has(n.plate)) { errores.push(`La matrícula ${n.plate} está dos veces.`); continue; }
        vistas.add(n.plate);
        const tipo: TipoVehiculo = v?.tipo === "FAMILIAR" || v?.tipo === "PROVEEDOR" ? v.tipo : "PROPIO";
        vehiculos.push({ chapa: n.plate, tipo, marca: texto(v?.marca, 30) || undefined, color: texto(v?.color, 20) || undefined, quien: texto(v?.quien, 60) || undefined });
    }

    const servicios: ServicioCargado[] = [];
    for (const s of Array.isArray(x?.servicios) ? x.servicios.slice(0, SERVICIOS_MAX) : []) {
        const tipo: TipoServicio = TIPOS_SERVICIO.some((t) => t.id === s?.tipo) ? s.tipo : "OTRO";
        const nombre = texto(s?.nombre, 60);
        const dias = (Array.isArray(s?.dias) ? s.dias : []).filter((d: unknown): d is Dia => (DIAS as readonly string[]).includes(String(d)));
        const desde = texto(s?.desde, 5), hasta = texto(s?.hasta, 5);
        const chapaCruda = texto(s?.chapa, 12);
        const leida = chapaCruda ? normalizarChapa(chapaCruda) : null;
        const chapa = leida && leida.cambios === 0 ? leida.plate : undefined;
        if (chapaCruda && !chapa) {
            errores.push(leida
                ? `¿La matrícula «${chapaCruda}» es ${leida.plate}? Revisala.`
                : `La matrícula «${chapaCruda}» de ${nombre || TIPOS_SERVICIO.find((t) => t.id === tipo)?.rotulo} no tiene forma de matrícula.`);
        }
        // Una fila de servicio sin nada escrito es una que abrieron y no usaron: se ignora.
        if (!nombre && !dias.length && !desde && !chapa && tipo === "OTRO") continue;
        if ((desde && !horaSirve(desde)) || (hasta && !horaSirve(hasta))) errores.push("Revisá el horario de los servicios.");
        servicios.push({ tipo, nombre: nombre || undefined, dias, desde: desde || undefined, hasta: hasta || undefined, chapa });
    }

    const comentario = texto(x?.comentario, COMENTARIO_MAX);
    if (errores.length) return { datos: null, errores };
    return { datos: { lote, apellido, nombre, tenencia, telefono, email, vehiculos, servicios, comentario }, errores: [] };
}

/** Una línea para la bandeja: «Lote B4 · Pérez · 3 vehículos · 2 servicios». */
export function resumenDeSolicitud(s: Pick<Solicitud, "lote" | "apellido" | "vehiculos" | "servicios">): string {
    const partes = [`Lote ${s.lote}`, s.apellido];
    if (s.vehiculos.length) partes.push(`${s.vehiculos.length} ${s.vehiculos.length === 1 ? "vehículo" : "vehículos"}`);
    if (s.servicios.length) partes.push(`${s.servicios.length} ${s.servicios.length === 1 ? "servicio" : "servicios"}`);
    return partes.join(" · ");
}
