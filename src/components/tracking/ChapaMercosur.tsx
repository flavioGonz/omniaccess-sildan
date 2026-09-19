"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La matrícula, dibujada como la chapa que es.
 *
 * Antes era un rectángulo blanco con la patente en negro, centrado, que funcionaba pero
 * no se parecía a nada. El operador que mira el visor está comparando lo que dice el
 * sistema contra lo que ve en la foto — y en la foto hay una chapa. Dibujar la chapa
 * hace esa comparación directa: mismo formato, misma separación, mismo relieve.
 *
 * Es CSS, no una imagen: sirve para cualquier matrícula, escala sin pixelarse y no suma
 * un archivo por patente.
 *
 * El país sale de `NEXT_PUBLIC_PAIS` y no está escrito acá. OmniAccess corre en más de un
 * barrio y no todos están del mismo lado del río; la banda Mercosur es común a la región,
 * el nombre del país no.
 *
 * El agrupado también se deduce, no se asume. Una chapa Mercosur uruguaya es tres letras y
 * cuatro dígitos, y se lee mejor separada — pero si la matrícula no tiene esa forma (una
 * chapa vieja, una de otro país, una lectura cortada) se muestra tal cual vino. Partir a
 * ciegas en la posición tres convertiría "AB123" en "AB1 23", que no es ninguna chapa.
 */

const PAIS = process.env.NEXT_PUBLIC_PAIS || "URUGUAY";

/** Tres letras y cuatro dígitos: el formato Mercosur para autos particulares. */
const MERCOSUR = /^([A-Z]{3})(\d{4})$/;

export function agruparChapa(plate: string) {
    const m = MERCOSUR.exec((plate || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
    return m ? `${m[1]} ${m[2]}` : plate;
}

export function ChapaMercosur({ plate, conocida, onCopiar, tamano = "normal", className }: {
    plate: string;
    /** Si la chapa está en el padrón. Decide el tilde o la cruz, nada más. */
    conocida?: boolean;
    onCopiar?: () => void;
    tamano?: "chico" | "normal";
    className?: string;
}) {
    const grande = tamano === "normal";
    const Marca = conocida ? Check : X;

    const cuerpo = (
        <div className={cn("chapa-mercosur relative rounded-lg overflow-hidden flex flex-col", className)}>
            {/* El reflejo especular que barre el metal. */}
            <span className="chapa-brillo absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none z-20" />

            <div className={cn("chapa-banda flex items-center justify-between gap-3 text-white",
                grande ? "px-3 py-1" : "px-2 py-0.5")}>
                <div className="flex items-center gap-1.5">
                    {/* La estrella del emblema Mercosur. */}
                    <svg className={grande ? "w-3.5 h-3.5" : "w-2.5 h-2.5"} viewBox="0 0 24 24" fill="#fde047">
                        <path d="M12 2l2.4 7.2h7.6l-6.1 4.5 2.3 7.3-6.2-4.6-6.2 4.6 2.3-7.3-6.1-4.5h7.6z" />
                    </svg>
                    <span className={cn("font-extrabold uppercase text-white/90",
                        grande ? "text-[9px] tracking-[0.24em]" : "text-[7px] tracking-[0.18em]")}>
                        Mercosur
                    </span>
                </div>
                <span className={cn("font-bold uppercase text-white",
                    grande ? "text-[9px] tracking-[0.18em]" : "text-[7px] tracking-[0.12em]")}>
                    {PAIS}
                </span>
            </div>

            <div className={cn("chapa-cuerpo flex items-center justify-between gap-3",
                grande ? "px-4 py-2.5" : "px-2.5 py-1")}>
                <span className={cn("chapa-texto font-extrabold leading-none tabular-nums select-all",
                    grande ? "text-[38px]" : "text-[17px]")}>
                    {agruparChapa(plate)}
                </span>
                {conocida != null && (
                    <span
                        title={conocida ? "La matrícula figura en el padrón" : "La matrícula no figura en el padrón"}
                        className={cn("rounded-full flex items-center justify-center shrink-0 border",
                            grande ? "w-5 h-5" : "w-3.5 h-3.5")}
                        style={{
                            background: "color-mix(in oklab, var(--visor-tono) 25%, transparent)",
                            borderColor: "color-mix(in oklab, var(--visor-tono) 60%, transparent)",
                            color: "color-mix(in oklab, var(--visor-tono) 70%, #000)",
                        }}>
                        <Marca size={grande ? 12 : 9} strokeWidth={3.5} />
                    </span>
                )}
            </div>
        </div>
    );

    if (!onCopiar) return cuerpo;
    return (
        <button type="button" onClick={onCopiar} title="Copiar la matrícula"
            className="block w-fit transition-transform duration-300 hover:scale-[1.02] active:scale-[0.99]">
            {cuerpo}
        </button>
    );
}
