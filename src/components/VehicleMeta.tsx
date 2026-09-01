"use client";

import { Car, Truck, Bus, Bike, Palette, Tag } from "lucide-react";
import { parseVehicleMeta, type VehicleMeta } from "@/lib/vehicle-details";

function TypeIcon({ type, size = 12 }: { type: string; size?: number }) {
    const t = (type || "").toLowerCase();
    if (/cami|truck|pickup/.test(t)) return <Truck size={size} />;
    if (/bus/.test(t)) return <Bus size={size} />;
    if (/moto|bike|bici/.test(t)) return <Bike size={size} />;
    return <Car size={size} />;
}

/**
 * Chips de metadatos del vehículo detectado por ANPR (color, tipo, marca, modelo).
 * Acepta `details` (string crudo del evento) o un `meta` ya parseado.
 */
export function VehicleMetaChips({
    details, meta: metaProp, size = "md", className = "",
}: { details?: string | null; meta?: VehicleMeta; size?: "sm" | "md"; className?: string }) {
    const meta = metaProp || parseVehicleMeta(details);
    if (!meta.hasAny) return null;
    const sm = size === "sm";
    const pad = sm ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[11px]";
    const ico = sm ? 10 : 12;

    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
            {meta.color && (
                <span className={`inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 font-medium text-foreground ${pad}`}>
                    <span className="rounded-full border border-black/20 shadow-sm" style={{ background: meta.colorHex || "#9ca3af", width: ico, height: ico }} />
                    {meta.color}
                </span>
            )}
            {meta.typeLabel && (
                <span className={`inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 font-medium text-muted-foreground ${pad}`}>
                    <TypeIcon type={meta.type || ""} size={ico} /> {meta.typeLabel}
                </span>
            )}
            {(meta.brand || meta.model) && (
                <span className={`inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 font-medium text-muted-foreground ${pad}`}>
                    <Tag size={ico} /> {[meta.brand, meta.model].filter(Boolean).join(" ")}
                </span>
            )}
        </div>
    );
}

export default VehicleMetaChips;
