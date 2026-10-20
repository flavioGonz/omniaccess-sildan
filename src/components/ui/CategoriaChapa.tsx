"use client";

import { Ambulance, Building2, Bus, Car, CarTaxiFront, Check, Flag, Globe2, Landmark, ShieldAlert, Shield, Truck, Accessibility, Stethoscope, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";
import { leerChapa, type CategoriaChapa as Cat } from "@/lib/categoria-chapa";

/** El ícono de cada categoría: se reconoce de un vistazo en una tabla de cien filas. */
function iconoDe(c: Cat) {
    switch (c.codigo) {
        case "TX": return CarTaxiFront;
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
 *
 * `aspecto`: lo que OmniVision ve en el vehículo (atributo `servicio`, ver vision-analisis.js).
 * Hoy sólo «taxi», que es lo único que se midió que distingue. Una chapa de taxi que además se ve
 * como taxi queda CONFIRMADA (aunque sea del interior, donde la chapa sola es «probable»); un
 * vehículo sin chapa especial que se ve como taxi se marca «taxi por aspecto», punteado.
 *
 * El color de las letras NO se usa: se midió (18/10, 176 recortes de las LPR del lab) y en las
 * fotos de las cámaras las letras de un taxi salen tan oscuras como las de un particular, y de
 * noche el recorte es infrarrojo y no tiene color.
 */
export function CategoriaChapa({ plate, extranjera = false, aspecto = null, className }: { plate?: string | null; extranjera?: boolean; aspecto?: "taxi" | null; className?: string }) {
    const l = leerChapa(plate);
    if (l?.categoria) {
        const c = l.categoria;
        const I = iconoDe(c);
        const confirmada = aspecto === "taxi" && c.codigo === "TX";
        const probable = l.confianza === "probable" && !confirmada;
        return (
            <Pista titulo={confirmada ? `${l.frase} · confirmado` : l.frase} texto={<>{c.explica}{c.codigo.length === 2 ? <> Lo dice la chapa: «{c.codigo}» después de la letra del departamento{l.departamento ? ` (${l.departamento})` : ""}.</> : null}
                {confirmada ? <> Y OmniVision lo ve como taxi por su aspecto: las dos pruebas coinciden.</> : probable ? <> En el interior es probable, no seguro: esas letras también pueden ser de una localidad.</> : null}
                {aspecto === "taxi" && c.codigo !== "TX" ? <> OmniVision lo ve como taxi.</> : null}</>}>
                <span className={cn("inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[10.5px] font-bold whitespace-nowrap", `chip-${c.tono}`, probable && "border-dashed", className)}>
                    <I size={11} /> {c.corto}{probable ? "?" : ""}{confirmada && <Check size={10} strokeWidth={3} />}
                </span>
            </Pista>
        );
    }
    if (aspecto === "taxi") {
        return (
            <Pista titulo="Taxi, por su aspecto" texto="La chapa no es de taxi (o no se leyó), pero OmniVision lo ve como taxi: cartel en el techo, pintura. Es una pista para mirar, no una prueba.">
                <span className={cn("inline-flex items-center gap-1 h-5 px-1.5 rounded-full border border-dashed text-[10.5px] font-bold whitespace-nowrap chip-info", className)}>
                    <CarTaxiFront size={11} /> Taxi?
                </span>
            </Pista>
        );
    }
    if (!l) return null;
    if (extranjera && l.extranjera) {
        return (
            <Pista titulo={l.frase} texto="Por el formato de la chapa (Mercosur de otro país).">
                <span className={cn("inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[10.5px] font-bold chip-quieto", className)}><Globe2 size={11} /> {l.extranjera}</span>
            </Pista>
        );
    }
    return null;
}
