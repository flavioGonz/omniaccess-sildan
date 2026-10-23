"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RegistroMatricula } from "@/lib/matricula-en-base";

/**
 * «Esta matrícula ya está en la base»: mientras se escribe una chapa en cualquier alta (padrón de
 * residentes y proveedores, vehículos, lista negra, invitados), qué hay ya cargado con ella (21/10,
 * Nico: «debe cotejar si ya no existe en la base»). Ver lib/matricula-en-base para qué mira.
 *
 * Avisa, no bloquea: quien carga decide (un residente puede ir a lista negra a propósito). La
 * pantalla que quiera frenar algo —la misma chapa otra vez en la misma lista— usa el hook.
 */
const normal = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");
const cache = new Map<string, { t: number; r: Record<string, RegistroMatricula[]> }>();
const VIGENCIA_MS = 15_000;

export function useMatriculasEnBase(plates: string[], opts: { excluirUserId?: string | null; activo?: boolean } = {}) {
    const lista = useMemo(() => [...new Set(plates.map(normal).filter((p) => p.length >= 4))].sort(), [plates.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
    const clave = `${lista.join(",")}|${opts.excluirUserId || ""}`;
    const [datos, setDatos] = useState<Record<string, RegistroMatricula[]>>({});
    const [cargando, setCargando] = useState(false);
    const [version, setVersion] = useState(0);
    useEffect(() => {
        if (opts.activo === false || !lista.length) { setDatos({}); setCargando(false); return; }
        const c = cache.get(clave);
        if (c && Date.now() - c.t < VIGENCIA_MS) { setDatos(c.r); return; }
        let vivo = true;
        setCargando(true);
        // Un respiro: no se pregunta por cada letra que se escribe.
        const t = setTimeout(() => {
            fetch("/api/matriculas/en-base", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plates: lista, excluirUserId: opts.excluirUserId || null }) })
                .then((r) => (r.ok ? r.json() : {}))
                .then((r) => { cache.set(clave, { t: Date.now(), r }); if (vivo) setDatos(r); })
                .catch(() => { if (vivo) setDatos({}); })
                .finally(() => { if (vivo) setCargando(false); });
        }, 350);
        return () => { vivo = false; clearTimeout(t); };
    }, [clave, opts.activo, version]); // eslint-disable-line react-hooks/exhaustive-deps
    /** Después de guardar: lo de recién cargado tiene que aparecer. */
    const refrescar = () => { cache.delete(clave); setVersion((v) => v + 1); };
    return { datos, cargando, refrescar };
}

const PUNTO: Record<RegistroMatricula["tono"], string> = { mal: "bg-[var(--mal)]", aviso: "bg-[var(--aviso)]", info: "bg-[var(--accion)]", quieto: "bg-muted-foreground/50" };

export function MatriculaEnBase({ plates, excluirUserId, ignorar, variante = "claro", className, titulo }: {
    plates: string[];
    /** La persona que se está editando: sus propias matrículas no son un aviso. */
    excluirUserId?: string | null;
    /** Lo que no hace falta decir en esta pantalla. */
    ignorar?: (r: RegistroMatricula) => boolean;
    /** «rojo»: sobre el cajón de la lista negra (texto blanco sobre un velo oscuro). */
    variante?: "claro" | "rojo";
    className?: string;
    titulo?: (plate: string) => string;
}) {
    const { datos, cargando } = useMatriculasEnBase(plates, { excluirUserId });
    const conAlgo = Object.entries(datos).map(([p, rs]) => [p, ignorar ? rs.filter((r) => !ignorar(r)) : rs] as const).filter(([, rs]) => rs.length);
    const rojo = variante === "rojo";
    if (!conAlgo.length) {
        return cargando && plates.some((p) => normal(p).length >= 4)
            ? <div className={cn("flex items-center gap-1.5 text-[11.5px]", rojo ? "text-white/70" : "text-muted-foreground", className)}><Loader2 size={12} className="animate-spin" /> Buscando la matrícula en la base…</div>
            : null;
    }
    return (
        <div role="status" className={cn("rounded-[10px] px-3 py-2.5 space-y-2", rojo ? "bg-black/25 text-white" : "border border-[color-mix(in_oklab,var(--aviso)_45%,transparent)] bg-[color-mix(in_oklab,var(--aviso)_8%,transparent)]", className)}>
            {conAlgo.map(([p, rs]) => (
                <div key={p}>
                    <div className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold", rojo ? "" : "tono-aviso")}>
                        <AlertTriangle size={13} className="shrink-0" />
                        <span>{titulo ? titulo(p) : <><span className="tabular-nums tracking-[0.06em]">{p}</span> ya está en la base</>}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5 pl-5">
                        {rs.map((r, i) => (
                            <li key={i} className={cn("flex items-baseline gap-2 text-[12px] leading-snug", rojo ? "text-white/90" : "text-foreground")}>
                                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-1px]", rojo ? "bg-white" : PUNTO[r.tono])} />
                                <span className="min-w-0">
                                    {r.href ? <a href={r.href} className="font-semibold underline-offset-2 hover:underline">{r.titulo}</a> : <span className="font-semibold">{r.titulo}</span>}
                                    {r.detalle && <span className={rojo ? "text-white/70" : "text-muted-foreground"}> · {r.detalle}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
