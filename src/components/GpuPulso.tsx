"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El consumo de la GPU, de reojo, en el sidebar.
 *
 * **Vatios y no porcentaje**, y no es un detalle de gusto. `utilization.gpu` no dice
 * cuanto calcula la placa: dice que fraccion del tiempo hubo algun nucleo ocupado. El
 * lector, entre pedido y pedido, deja un hilo de CUDA girando en vacio y el driver cuenta
 * esa vuelta como trabajo. Medido en esta instalacion con el lector TRABADO --sin devolver
 * una sola matricula-- el porcentaje marcaba 100% y la placa estaba a 37,5 de 70 W, tibia.
 * Ese numero mando a alguien a buscar un incendio que no existia.
 *
 * La potencia sale del sensor de la placa y no sube si no hay calculo. Es el unico de los
 * dos que no miente, asi que es el que se muestra.
 *
 * El dato viene de la muestra que la pasarela guarda por minuto, no de un comando por
 * visita: este indicador esta en todas las paginas y en todas las sesiones abiertas a la
 * vez. Por eso tambien se apaga solo cuando la muestra envejece: un numero viejo mostrado
 * como si fuera de ahora es peor que ninguno.
 */

type Pulso = {
    hay: boolean; watts?: number | null; limite?: number | null;
    uso?: number | null; temp?: number | null; enGpu?: boolean | null;
    lecturas?: number | null; edadSeg?: number;
};

/** Cuando la muestra deja de valer como "ahora". La pasarela guarda una por minuto. */
const VIEJA_SEG = 180;

export function GpuPulso({ collapsed }: { collapsed?: boolean }) {
    const [p, setP] = useState<Pulso | null>(null);

    useEffect(() => {
        let vivo = true;
        const leer = async () => {
            try {
                const r = await fetch("/api/tracking/pulso", { cache: "no-store" });
                if (!r.ok) return;
                const d = await r.json();
                if (vivo) setP(d);
            } catch { }
        };
        leer();
        const iv = setInterval(leer, 20000);
        return () => { vivo = false; clearInterval(iv); };
    }, []);

    if (!p?.hay || p.watts == null) return null;

    const vieja = (p.edadSeg ?? 0) > VIEJA_SEG;
    const frac = p.limite ? p.watts / p.limite : null;

    /* Tres tramos sobre la potencia, que es trabajo de verdad. Apagado cuando el dato
       envejecio: ahi el color hablaria de un momento que ya paso. */
    const tono = vieja ? "bg-muted-foreground/40"
        : frac == null ? "bg-sky-500"
            : frac >= 0.85 ? "bg-[var(--mal)]"
                : frac >= 0.6 ? "bg-[var(--aviso)]"
                    : "bg-emerald-500";

    const detalle = [
        p.limite ? `${p.watts} de ${Math.round(p.limite)} W` : `${p.watts} W`,
        p.temp != null ? `${p.temp} °C` : null,
        /* El porcentaje va al final y con su advertencia: sirve para entender el numero
           grande cuando alguien lo ve en otro lado, no para decidir nada por si solo. */
        p.uso != null ? `uso ${p.uso}% (incluye la espera del lector)` : null,
        p.enGpu === false ? "el lector NO esta usando la placa" : null,
        vieja ? `sin datos nuevos hace ${Math.round((p.edadSeg ?? 0) / 60)} min` : null,
    ].filter(Boolean).join(" · ");

    return (
        <Link
            href="/admin/settings"
            title={`GPU · ${detalle}`}
            className={cn(
                "flex items-center gap-1.5 rounded-lg border border-border bg-card/60 hover:bg-accent transition-colors px-2 py-1.5 shrink-0",
                collapsed && "px-1.5",
            )}
        >
            <span className={cn("h-2 w-2 rounded-full shrink-0", tono)} />
            {!collapsed && (
                <span className={cn("text-xs font-semibold tabular-nums", vieja ? "text-muted-foreground" : "text-foreground/90")}>
                    {p.watts}<span className="text-[10px] text-muted-foreground ml-0.5">W</span>
                </span>
            )}
            {collapsed && <Zap size={13} className="text-muted-foreground" />}
        </Link>
    );
}
