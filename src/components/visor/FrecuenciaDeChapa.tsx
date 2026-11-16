"use client";

import { useEffect, useMemo, useState } from "react";
import { GitHubActivity, type Contribution, type ContributionLevel } from "@/components/ui/github-activity";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { CalendarDays } from "lucide-react";
import { ContenidoComportamiento, type ComportamientoVisor } from "./PanelComportamiento";

/**
 * La frecuencia de una matrícula: qué días se la vio (el calendario, a la manera de la actividad
 * de git) y, debajo, el módulo de comportamiento de siempre (la franja día × hora, las cifras y el
 * grafo de entradas y salidas).
 *
 * Por qué (16/11, Nico, con el menú de un vehículo del vivo abierto: «agregale Frecuencia: llamar
 * al módulo de comportamiento, similar a la gráfica de actividad de git, en un modal sobre el
 * video»). El comportamiento ya existía en la ficha de un evento y en Gestión de alarmas; desde el
 * vivo, con la chapa recién leída sobre el auto, no había cómo preguntar «¿este viene seguido?».
 *
 * Los datos son los mismos (/api/history/ficha): los pasos de esa chapa por los accesos. Un
 * vehículo que nunca pasó por una cámara de acceso no tiene nada, y se dice.
 */
/** Los días que se piden: los que el servidor devuelve en `comportamiento.dias`. El calendario muestra esos. */
const DIA_MS = 86_400_000;
const diaLocal = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Montevideo" });

export function calendarioDePasos(pasos: { momento: string }[], dias: number, ahora = Date.now()): Contribution[] {
    const cuenta = new Map<string, number>();
    for (const p of pasos) { const k = diaLocal(new Date(p.momento)); cuenta.set(k, (cuenta.get(k) || 0) + 1); }
    const max = Math.max(1, ...cuenta.values());
    const out: Contribution[] = [];
    for (let i = Math.max(1, dias) - 1; i >= 0; i--) {
        const date = diaLocal(new Date(ahora - i * DIA_MS)), count = cuenta.get(date) || 0, rel = count / max;
        const level: ContributionLevel = count === 0 ? 0 : rel > 0.75 ? 4 : rel > 0.5 ? 3 : rel > 0.25 ? 2 : 1;
        out.push({ date, count, level });
    }
    return out;
}

export function FrecuenciaDeChapa({ plate }: { plate: string }) {
    // `clave`: la chapa y el número de reintento. El estado se descarta cuando no es de esta clave (en vez de limpiarlo en el efecto, que encadena dibujos).
    const [vuelta, setVuelta] = useState(0);
    const clave = `${plate}|${vuelta}`;
    const [crudo, setCrudo] = useState<{ clave: string; datos: ComportamientoVisor | null; error: string | null } | null>(null);
    const estado = crudo?.clave === clave ? { cargando: false, datos: crudo.datos, error: crudo.error } : { cargando: true, datos: null, error: null };
    useEffect(() => {
        let vivo = true;
        fetch(`/api/history/ficha?${new URLSearchParams({ plate, momento: new Date().toISOString() })}`, { cache: "no-store" })
            .then(async (r) => { if (!r.ok) throw new Error(`El servidor respondió ${r.status}`); return r.json(); })
            .then((j) => { if (vivo) setCrudo({ clave, datos: j?.comportamiento || null, error: null }); })
            .catch((e) => { if (vivo) setCrudo({ clave, datos: null, error: e?.message || "No se pudo traer" }); });
        return () => { vivo = false; };
    }, [plate, clave]);
    const datos = estado.datos;
    const calendario = useMemo(() => (datos ? calendarioDePasos(datos.pasos, datos.dias) : []), [datos]);
    if (estado.cargando) return <Cargando texto={`Buscando cuándo se vio a ${plate}…`} />;
    if (estado.error) return <ErrorEstado mensaje={estado.error} alReintentar={() => setVuelta((n) => n + 1)} />;
    if (!datos || !datos.pasos.length) {
        return <Vacio icono={CalendarDays} titulo={`${plate} no pasó por ningún acceso`} ayuda={`En los últimos ${datos?.dias || 30} días no hay entradas ni salidas con esa matrícula. Lo que se ve en esta cámara es una lectura del video, no un paso por un acceso.`} />;
    }
    const diasConPasos = calendario.filter((c) => c.count > 0).length;
    return (
        <div className="space-y-4">
            <GitHubActivity contributions={calendario} months={Math.max(1, Math.round(datos.dias / 30))} label="pasos" accent={["#0ea5e9", "#38bdf8"]} cellSize={13} showMonths
                heading={`Se la vio ${diasConPasos} de los últimos ${datos.dias} días · ${datos.pasos.length} ${datos.pasos.length === 1 ? "paso" : "pasos"} por los accesos`} />
            <ContenidoComportamiento datos={datos} compacto />
        </div>
    );
}
