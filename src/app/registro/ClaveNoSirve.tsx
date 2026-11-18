"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { OmniLogo } from "@/components/brand/OmniLogo";
import { normalizarClave } from "@/lib/censo-invitaciones";

/**
 * «Esa clave no sirve», y qué hacer.
 *
 * Es la misma pantalla para una clave mal tipeada, una vieja y una inventada: decir cuál de los
 * tres casos es le sirve a quien prueba claves, y a la familia que se equivocó no le cambia nada.
 * Lo que sí le sirve es poder escribirla de nuevo sin volver al correo.
 */
export function ClaveNoSirve({ pidiendo }: {
    /** Se entró a /registro sin clave: no hay nada mal todavía, sólo falta la clave. */
    pidiendo?: boolean;
}) {
    const [clave, setClave] = useState("");
    const router = useRouter();
    const sirve = !!normalizarClave(clave);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="border-b border-border">
                <div className="mx-auto flex w-full max-w-[640px] items-center gap-2.5 px-4 py-3.5">
                    <OmniLogo size={26} className="shrink-0" />
                    <span className="text-[17px] font-bold tracking-[-0.02em] leading-none">Omni<span className="font-normal">Access</span></span>
                </div>
            </div>
            <main className="mx-auto w-full max-w-[460px] px-4 pt-16 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-border">
                    <KeyRound size={26} className="text-muted-foreground" />
                </div>
                <h1 className="mt-6 text-[26px] font-bold leading-tight tracking-[-0.02em]">{pidiendo ? "Entrá con la clave de tu lote" : "Esa clave no sirve"}</h1>
                <p className="mx-auto mt-3 text-[15px] leading-relaxed text-muted-foreground">
                    Cada lote tiene la suya y llega en el correo del censo. Entrá por el enlace de ese correo,
                    o escribila acá abajo.
                </p>
                <form className="mt-7 flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = normalizarClave(clave); if (c) router.push(`/registro/${c}`); }}>
                    <input value={clave} onChange={(e) => setClave(e.target.value)} placeholder="ABCD-3456"
                        autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                        className="h-12 flex-1 rounded-[10px] border border-border bg-card px-3.5 text-center text-[17px] font-bold uppercase tracking-[0.14em] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[var(--accion)]/30" />
                    <button type="submit" disabled={!sirve}
                        className="h-12 w-12 shrink-0 grid place-items-center rounded-[10px] bg-[var(--accion)] text-white disabled:opacity-40" aria-label="Entrar">
                        <ArrowRight size={18} />
                    </button>
                </form>
                <p className="mt-4 text-[12.5px] text-muted-foreground">
                    Si no te llegó el correo, pedíselo a la administración del barrio.
                </p>
            </main>
        </div>
    );
}
