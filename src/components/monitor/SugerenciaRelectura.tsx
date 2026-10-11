"use client";

import { Ban, ScanLine, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";
import type { RelecturaEvento } from "@/lib/relectura";

/**
 * La relectura de una NO_LEIDA, en el monitor LPR.
 *
 * vision-worker recortó el vehículo de la foto del evento y omni-lpr leyó el recorte. Es una
 * SUGERENCIA: la lectora no leyó, y nadie confirmó todavía. Por eso se muestra con signo de
 * pregunta, con su confianza, con la foto de la chapa al pasar el mouse, y el evento sigue
 * diciendo SIN LECTURA. Quien la da por buena es el guardia, con «Cargar matrícula» (que la
 * trae escrita) — y recién ahí el sistema reevalúa el acceso, como siempre.
 *
 * Si la chapa sugerida está en la lista negra o es de alguien del padrón, se dice: es lo que
 * cambia lo que el guardia hace con ese auto.
 */

const ROL: Record<string, string> = { RESIDENT: "Residente", STAFF: "Personal", PROVIDER: "Proveedor", VISITOR: "Visita", TEMPORARY_VISITOR: "Visita", ADMIN: "Administración", SECURITY: "Seguridad", OPERATOR: "Operador", WHITELISTED: "Residente", BLACKLISTED: "Lista negra" };
const SIN_LECTURA: Record<string, string> = {
    SIN_CHAPA: "Se vio el vehículo, pero la chapa no se lee",
    SIN_VEHICULO: "No se ve ningún vehículo en la foto",
    SIN_FOTO: "El evento llegó sin foto",
    ERROR: "No se pudo releer",
};

function Explicacion({ r }: { r: RelecturaEvento }) {
    return (
        <span className="block space-y-2">
            {r.chapa && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${r.chapa}?w=320`} alt={`Chapa ${r.plate}`} className="w-full rounded-md border border-border bg-black" />
            )}
            <span className="block">La lectora no leyó la chapa. omni-vision recortó {r.vehiculo ? "el vehículo" : "la foto"} y la volvió a leer: <b>{r.plate}</b>{r.confianza != null ? ` con ${Math.round(r.confianza * 100)} %` : ""}{r.estado === "DUDOSA" ? ", dudosa" : ""}.</span>
            {r.otras.length > 0 && <span className="block text-muted-foreground">También se leyó: {r.otras.map((o) => o.plate).join(", ")}.</span>}
            <span className="block text-muted-foreground">Es una sugerencia: mirá la foto y, si coincide, cargala con «Cargar matrícula».</span>
        </span>
    );
}

export function SugerenciaRelectura({ r, sobreFoto, className }: { r?: RelecturaEvento | null; sobreFoto?: boolean; className?: string }) {
    if (!r) return null;
    if (!r.plate) {
        // Sobre la foto grande no se dice nada: «no se pudo» no le cambia nada al guardia ahí.
        if (sobreFoto) return null;
        return <span className={cn("inline-flex items-center gap-1 text-[10px] text-muted-foreground", className)}><ScanLine size={10} /> omni-vision: {(SIN_LECTURA[r.estado] || "relectura sin resultado").toLowerCase()}</span>;
    }
    const negra = r.vigilancia && String(r.vigilancia.category).toUpperCase() === "BLACKLISTED";
    const busqueda = r.vigilancia && String(r.vigilancia.category).toUpperCase() === "SEARCH";
    const dudosa = r.estado === "DUDOSA";
    return (
        <Pista titulo="Leída por omni-vision" texto={<Explicacion r={r} />} ancho={300}>
            <span className={cn("inline-flex items-center gap-1.5 flex-wrap", sobreFoto ? "text-[12px]" : "text-[10.5px]", className)}>
                {/* Quién leyó: la lectora no; omni-vision sí. Es lo que distingue esta chapa de una lectura de la cámara. */}
                <span className={cn("uppercase font-black tracking-wider", sobreFoto ? "text-[10px] text-[var(--accion-en-oscuro)]" : "text-[9px] text-[var(--accion)]")}>omni-vision leyó</span>
                <span className={cn("inline-flex items-center gap-1 rounded font-bold tabular-nums tracking-[0.12em]",
                    sobreFoto ? "px-2 py-0.5 bg-black/60 text-white border border-white/30" : "px-1.5 py-0.5 bg-muted text-foreground border border-border",
                    dudosa && "opacity-80")}>
                    <ScanLine size={sobreFoto ? 12 : 10} className="text-[var(--accion-en-oscuro)]" /> ¿{r.plate}?
                </span>
                <span className={cn("tabular-nums", sobreFoto ? "text-white/80" : "text-muted-foreground")}>{r.confianza != null ? `${Math.round(r.confianza * 100)} %` : ""}{dudosa ? " · dudosa" : ""}</span>
                {negra && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-red-500/20 text-red-300 border border-red-500/50"><Ban size={9} /> Lista negra</span>}
                {busqueda && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-200 border border-amber-500/50"><Search size={9} /> En búsqueda</span>}
                {!r.vigilancia && r.quien && <span className={sobreFoto ? "text-white/90" : "text-foreground/80"}>{r.quien.name} · {ROL[r.quien.role] || r.quien.role}{r.quien.unidad ? ` · ${r.quien.unidad}` : ""}</span>}
            </span>
        </Pista>
    );
}
