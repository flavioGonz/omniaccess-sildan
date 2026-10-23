"use client";

import { ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { compararLectura, type Comparacion } from "@/lib/verificacion-lpr";
export { compararLectura, type Comparacion };

/**
 * La chapa de una NO_LEIDA, contada por OmniVision.
 *
 * Cuando la lectora de la barrera no lee la chapa, OmniVision hace la doble verificación: recorta
 * el vehículo de la foto del evento y la vuelve a leer (vision-relectura.js, en TODAS las
 * NO_LEIDA). Antes cada pantalla lo decía a su manera — un cartel amarillo «SIN LECTURA» y, abajo,
 * «omni-vision leyó ¿ABC1234?» en otro renglón —, y en el historial la matrícula ni aparecía:
 * la fila decía «Sin lectura» y la chapa sugerida quedaba escondida en la columna OmniVision.
 *
 * Ahora, en todas las pantallas, la chapa va donde va la chapa, y una marca chica — el destello
 * de OmniVision, en el azul de acción — dice de dónde salió. Sutil a propósito: el dato es la
 * chapa; la marca es su procedencia. Una lectura dudosa lleva signos de pregunta: OmniVision
 * misma avisó que no está segura, y el guardia la confirma mirando la foto.
 *
 * Archivo sin base ni red: lo usan el panel, la pared y el historial.
 */

/** Lo que las lectoras escriben cuando no leyeron (el mismo conjunto que lib/relectura, que no entra en el navegador). */
const NO_LEIDAS = new Set(["", "NO_LEIDA", "UNKNOWN", "S/P", "NOLEIDA", "SP"]);
export const esSinLectura = (p?: string | null) => NO_LEIDAS.has(String(p || "").trim().toUpperCase());
/**
 * Un disparo sin vehículo: la cámara no leyó chapa y OmniVision no vio ningún vehículo en la foto.
 * No es un acceso denegado: no había nadie (23/10, la cámara de salida de noche).
 */
export const esSinVehiculo = (plate: string | null | undefined, r: ReleidaMin) => esSinLectura(plate) && r?.estado === "SIN_VEHICULO";

/** Lo mínimo de una relectura para decir la chapa (RelecturaEvento y VisionFila.releida lo cumplen). */
export type ReleidaMin = { plate: string | null; estado: string; confianza?: number | null } | null | undefined;

/**
 * La chapa a mostrar: la de la cámara si la leyó; si no, la de OmniVision. `omni` dice que la leyó
 * OmniVision; `intento` que OmniVision la miró y tampoco pudo (la NO_LEIDA sigue sin chapa).
 */
export function chapaDe(plate: string | null | undefined, r: ReleidaMin) {
    if (!esSinLectura(plate)) return { plate: plate as string, omni: false, dudosa: false, intento: false };
    if (r?.plate && (r.estado === "LEIDA" || r.estado === "DUDOSA")) return { plate: r.plate, omni: true, dudosa: r.estado === "DUDOSA", intento: true };
    return { plate: null, omni: false, dudosa: false, intento: !!r };
}

/** El texto de la chapa: con signos de pregunta si OmniVision dijo que es dudosa. */
export const textoChapa = (c: ReturnType<typeof chapaDe>, sinLectura = "Sin lectura") =>
    c.plate ? (c.dudosa ? `¿${c.plate}?` : c.plate) : sinLectura;

const POR_QUE: Record<string, string> = {
    SIN_CHAPA: "vio el vehículo pero la chapa no se lee",
    SIN_VEHICULO: "no encontró un vehículo en la foto",
    SIN_FOTO: "el evento llegó sin foto",
    ERROR: "no pudo releerla",
};

/** La explicación de la marca, para el `title`: quién leyó, con cuánta confianza, y que es una sugerencia. */
export function explicacion(r: ReleidaMin): string {
    if (!r) return "";
    if (r.plate && (r.estado === "LEIDA" || r.estado === "DUDOSA")) {
        return `La cámara no leyó la chapa. OmniVision la verificó recortando el vehículo y leyó ${r.plate}`
            + `${r.confianza != null ? ` (${Math.round(r.confianza * 100)} %)` : ""}${r.estado === "DUDOSA" ? ", dudosa" : ""}.`
            + " Es una sugerencia: no cambia el evento ni la barrera; se confirma mirando la foto.";
    }
    return `La cámara no leyó la chapa y OmniVision tampoco: ${POR_QUE[r.estado] || "sin resultado"}.`;
}

/**
 * La marca: el destello de OmniVision, y su nombre si hay lugar. Va pegada a la chapa.
 *
 * `oscuro`: sobre foto o video (el azul normal desaparece sobre una escena de noche).
 * `tamano`: xs en listas densas, sm en tarjetas, md en el visor, lg en la pared.
 */
export function MarcaOmniVision({ r, oscuro, tamano = "sm", soloIcono, className }: {
    r: ReleidaMin;
    oscuro?: boolean;
    tamano?: "xs" | "sm" | "md" | "lg";
    soloIcono?: boolean;
    className?: string;
}) {
    if (!r) return null;
    const leyo = !!(r.plate && (r.estado === "LEIDA" || r.estado === "DUDOSA"));
    const ico = { xs: 10, sm: 11, md: 13, lg: 18 }[tamano];
    const texto = { xs: "text-[10px]", sm: "text-[10.5px]", md: "text-[11.5px]", lg: "text-[15px]" }[tamano];
    return (
        <span title={explicacion(r)}
            className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap align-middle", texto,
                leyo ? (oscuro ? "text-[var(--accion-en-oscuro)]" : "text-[var(--accion)]") : (oscuro ? "text-white/45" : "text-muted-foreground"),
                className)}>
            <Sparkles size={ico} className="shrink-0" />
            {!soloIcono && (leyo ? `OmniVision${r.estado === "DUDOSA" ? " · dudosa" : ""}` : r.estado === "SIN_VEHICULO" ? "OmniVision: sin vehículo" : "OmniVision no la leyó")}
        </span>
    );
}


/* ── Doble verificación (14/10) ────────────────────────────────────────────────────────────
 * En las cámaras con modo «Doble verificación» (lib/modo-camara.ts) OmniVision relee también
 * las chapas que la cámara SÍ leyó. Lo que importa al guardia no es la chapa de OmniVision sino
 * si coincide: la marca dice eso, y sólo muestra la otra chapa cuando difiere.
 *
 * Una letra de diferencia se distingue de «otra chapa»: el OCR confunde 0/O, 8/B, 1/I, y eso no
 * es lo mismo que haber leído otro auto. */

const TEXTO_COMP: Record<Comparacion["estado"], (c: Comparacion) => string> = {
    coincide: () => "Verificada",
    casi: (c) => `OmniVision: ${c.omni}`,
    difiere: (c) => `OmniVision leyó ${c.omni}`,
    sin: () => "Sin verificar",
};

/** La marca de la doble verificación, pegada a la chapa que leyó la cámara. */
export function MarcaVerificacion({ plate, r, oscuro, tamano = "sm", soloIcono, className }: {
    plate: string | null | undefined; r: ReleidaMin; oscuro?: boolean; tamano?: "xs" | "sm" | "md" | "lg"; soloIcono?: boolean; className?: string;
}) {
    const c = compararLectura(plate, r);
    if (!c) return null;
    const ico = { xs: 10, sm: 11, md: 13, lg: 18 }[tamano];
    const texto = { xs: "text-[10px]", sm: "text-[10.5px]", md: "text-[11.5px]", lg: "text-[15px]" }[tamano];
    const I = c.estado === "coincide" ? ShieldCheck : c.estado === "sin" ? ShieldQuestion : ShieldAlert;
    const tono = c.estado === "coincide" ? "tono-bien" : c.estado === "casi" ? "tono-aviso" : c.estado === "difiere" ? "tono-mal" : oscuro ? "text-white/45" : "tono-quieto";
    const titulo = c.estado === "coincide" ? `Doble verificación: OmniVision releyó la foto y leyó la misma chapa${r?.confianza != null ? ` (${Math.round(r.confianza * 100)} %)` : ""}.`
        : c.estado === "sin" ? "Doble verificación: OmniVision releyó la foto y no pudo leer la chapa. Vale la lectura de la cámara."
        : `Doble verificación: la cámara leyó ${plate} y OmniVision ${c.omni}${c.estado === "casi" ? " (un carácter de diferencia)" : ""}. La barrera decidió con la de la cámara: mirá la foto.`;
    return (
        <span title={titulo} className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap align-middle", texto, tono, className)}>
            <I size={ico} className="shrink-0" />
            {!soloIcono && TEXTO_COMP[c.estado](c)}
        </span>
    );
}
