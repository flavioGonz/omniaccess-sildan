"use client";

import { Ambulance, Building2, Bus, Car, Flag, Globe2, Landmark, ShieldAlert, Shield, Truck, Accessibility, Stethoscope, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";
import { leerChapa, type CategoriaChapa as Cat } from "@/lib/categoria-chapa";

/** El ícono de cada categoría: se reconoce de un vistazo en una tabla de cien filas. */
function iconoDe(c: Cat) {
    switch (c.codigo) {
        case "AM": return Ambulance;
        case "MI": case "SJP": case "SMP": return ShieldAlert;
        case "ME": return Stethoscope;
        case "DI": return Accessibility;
        case "TC": case "TU": case "ES": return Bus;
        case "TP": case "TR": return Truck;
        case "CD": case "CC": case "OI": return Flag;
        case "AT": case "PR": return Clock3;
        case "IM": case "JD": return Building2;
        case "OF": case "PL": case "PE": case "PJ": return Landmark;
    }
    return c.grupo === "militar" ? Shield : Car;
}

/**
 * Lo que dice la chapa sola (lib/categoria-chapa): «Taxi», «Policía / Bomberos», «Diplomático».
 * Sólo se dibuja si la chapa es ESPECIAL (o extranjera, con `extranjera`): una particular no dice
 * nada que no se sepa. Con la explicación al pasar el mouse, y «probable» en el interior.
 */
export function CategoriaChapa({ plate, extranjera = false, className }: { plate?: string | null; extranjera?: boolean; className?: string }) {
    const l = leerChapa(plate);
    if (!l) return null;
    if (l.categoria) {
        const c = l.categoria;
        const I = iconoDe(c);
        return (
            <Pista titulo={l.frase} texto={<>{c.explica}{c.codigo.length === 2 ? <> Lo dice la chapa: «{c.codigo}» después de la letra del departamento{l.departamento ? ` (${l.departamento})` : ""}; letras {c.letras}.</> : null}
                {l.confianza === "probable" ? <> En el interior es probable, no seguro: esas letras también pueden ser de una localidad.</> : null}</>}>
                <span className={cn("inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[10.5px] font-bold whitespace-nowrap", `chip-${c.tono}`, l.confianza === "probable" && "border-dashed", className)}>
                    <I size={11} /> {c.corto}{l.confianza === "probable" ? "?" : ""}
                </span>
            </Pista>
        );
    }
    if (extranjera && l.extranjera) {
        return (
            <Pista titulo={l.frase} texto="Por el formato de la chapa (Mercosur de otro país).">
                <span className={cn("inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[10.5px] font-bold chip-quieto", className)}><Globe2 size={11} /> {l.extranjera}</span>
            </Pista>
        );
    }
    return null;
}
