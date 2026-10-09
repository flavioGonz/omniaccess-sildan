"use client";

import { cn } from "@/lib/utils";

/**
 * El logo de una empresa (delivery, taxi) incrustado en una captura.
 *
 * Con fondo transparente va suelto, con una sombra para que se lea sobre cualquier foto,
 * clara u oscura. Si el PNG tiene fondo, va en una placa blanca: suelto parecería un
 * pedazo de la captura. La altura la decide quien lo pone, según el tamaño de la foto.
 */
export function LogoSobreFoto({ empresa, className }: { empresa: { nombre: string; logo: string; transparente: boolean } | null | undefined; className?: string }) {
    if (!empresa) return null;
    return (
        <span title={empresa.nombre} className={cn("inline-flex items-center", !empresa.transparente && "rounded-md bg-white/90 px-1.5 py-1")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={empresa.logo} alt={empresa.nombre} draggable={false}
                className={cn("w-auto object-contain [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.85))]", className)} />
        </span>
    );
}
