"use client";

import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatoDe } from "@/lib/formato-chapa";

/** Lo que no es una chapa: sin lectura o el texto de reemplazo del servidor. */
const SIN_CHAPA = new Set(["NO_LEIDA", "UNKNOWN", "S/P", "S/L", ""]);

/**
 * Una lectura de la CÁMARA que no tiene forma de chapa del Mercosur (lib/formato-chapa).
 *
 * Las nuestras (OmniVision, seguimiento) ya no dejan pasar un texto así; las de la cámara sí
 * entran —decide la barrera con ellas y no se tocan—, pero se marcan, porque `94C044` dibujada
 * igual que `SBO1234` se lee como un dato cierto (Nico, 15/10).
 */
export function MarcaFormatoChapa({ plate, className }: { plate?: string | null; className?: string }) {
    const p = String(plate || "").toUpperCase();
    if (SIN_CHAPA.has(p) || formatoDe(p)) return null;
    return (
        <span title="No tiene forma de matrícula del Mercosur: puede ser una lectura equivocada de la cámara." className={cn("inline-flex tono-aviso", className)}>
            <CircleHelp size={13} aria-label="Formato de matrícula dudoso" />
        </span>
    );
}
