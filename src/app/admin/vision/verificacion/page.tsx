"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";

/**
 * OmniVision › Verificación: si la doble verificación de intrusión sirve, cámara por cámara.
 *
 * La matriz cruza lo que dijo omni-vision con lo que decidió el guardia. Los dos números que
 * deciden si conviene que una regla de aviso espere a omni-vision («sólo si ve a alguien»):
 *  · Falsas sin nadie: de las que el guardia marcó falsas, cuántas omni-vision no vio a nadie.
 *    Es lo que la verificación ahorra.
 *  · Reales vistas: de las reales, cuántas omni-vision sí vio. Si se le escapa una real, en esa
 *    cámara no conviene retener avisos.
 */
type Matriz = Record<string, Record<"real" | "falsa" | "pendiente", number>>;
type Camara = { id: string; nombre: string; total: number; matriz: Matriz; retenidos: number; enviados: number; sinVeredicto: number; conLinea: boolean };
type Respuesta = { h: number; activa: boolean; camaras: Camara[] };

const RANGOS = [{ v: "24", r: "24 h" }, { v: "168", r: "7 días" }, { v: "720", r: "30 días" }];
const FILAS: { k: string; r: string; tono: "mal" | "aviso" | "quieto" }[] = [
    { k: "CONFIRMADA", r: "Confirmada", tono: "mal" }, { k: "PRESENTE", r: "Hay alguien", tono: "aviso" },
    { k: "ANIMAL", r: "Animal", tono: "quieto" }, { k: "NADA", r: "No se ve a nadie", tono: "quieto" }, { k: "SIN", r: "Sin verificar", tono: "quieto" },
];
const COLUMNAS = [{ k: "real", r: "Real" }, { k: "falsa", r: "Falsa" }, { k: "pendiente", r: "Sin decidir" }] as const;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");

function Tarjeta({ c }: { c: Camara }) {
    const m = c.matriz;
    const suma = (fs: string[], col: "real" | "falsa" | "pendiente") => fs.reduce((s, f) => s + (m[f]?.[col] || 0), 0);
    const falsas = suma(["CONFIRMADA", "PRESENTE", "ANIMAL", "NADA"], "falsa"), falsasSinNadie = suma(["ANIMAL", "NADA"], "falsa");
    const reales = suma(["CONFIRMADA", "PRESENTE", "ANIMAL", "NADA"], "real"), realesVistas = suma(["CONFIRMADA", "PRESENTE"], "real");
    return (
        <section className="rounded-[10px] border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[14px] font-bold">{c.nombre}</h2>
                <span className="text-[12px] text-muted-foreground tabular-nums">{c.total} detecciones</span>
                {!c.conLinea && <Pista titulo="Sin geometría" texto="La cámara no informa su línea o su zona (o no se pudo leer): omni-vision puede decir si hay alguien, pero no si toca la línea. Nunca sale «confirmada»."><span><Chip tono="quieto">sin línea leída</Chip></span></Pista>}
                {c.retenidos + c.enviados + c.sinVeredicto > 0 && <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">avisos: {c.enviados} enviados · <b className="text-foreground">{c.retenidos} retenidos</b>{c.sinVeredicto ? ` · ${c.sinVeredicto} sin veredicto a tiempo` : ""}</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-muted px-3 py-2">
                    <div className="text-[18px] font-bold tabular-nums">{pct(falsasSinNadie, falsas)}</div>
                    <div className="text-[11.5px] text-muted-foreground">de las falsas, omni-vision no vio a nadie ({falsasSinNadie} de {falsas})</div>
                </div>
                <div className={cn("rounded-md px-3 py-2", reales && realesVistas < reales ? "bg-[var(--mal-suave)]" : "bg-muted")}>
                    <div className="text-[18px] font-bold tabular-nums">{pct(realesVistas, reales)}</div>
                    <div className="text-[11.5px] text-muted-foreground">de las reales, omni-vision vio a alguien ({realesVistas} de {reales})</div>
                </div>
            </div>
            <table className="w-full text-[12.5px] tabular-nums">
                <thead><tr className="text-[11px] text-muted-foreground text-right"><th className="text-left font-semibold py-1">omni-vision \ guardia</th>{COLUMNAS.map((x) => <th key={x.k} className="font-semibold">{x.r}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                    {FILAS.map((f) => (
                        <tr key={f.k}>
                            <td className="py-1.5"><Chip tono={f.tono}>{f.r}</Chip></td>
                            {COLUMNAS.map((x) => <td key={x.k} className={cn("text-right", !(m[f.k]?.[x.k]) && "text-muted-foreground/50")}>{m[f.k]?.[x.k] || 0}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}

export default function VerificacionVision() {
    const [h, setH] = useState("168");
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cargar = useCallback(async () => {
        try {
            const r = await fetch(`/api/vision/verificacion?h=${h}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [h]);
    useEffect(() => { setDatos(null); cargar(); }, [cargar]);

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><ShieldCheck size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Doble verificación de intrusión</h1>
                        {datos && (datos.activa ? <Chip tono="bien">Prendida</Chip> : <Chip tono="quieto">Apagada en Analíticas</Chip>)}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        La cámara dice «alguien cruzó» y omni-vision mira la captura y un cuadro propio del canal. Acá se ve, por cámara, lo que dijo omni-vision contra lo que decidió el guardia: es lo que dice si conviene que los avisos esperen a omni-vision (Ajustes → Notificaciones → la regla → Doble verificación).
                    </p>
                </div>
            </div>
            <Filtros grupos={[{ clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) }]} />
            {error && !datos ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                : !datos ? <Cargando texto="Cruzando lo que vio omni-vision con lo que decidió la guardia…" />
                    : datos.camaras.length === 0 ? <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">No hubo cruces ni intrusiones de cámara en este rango.</div>
                        : <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{datos.camaras.map((c) => <Tarjeta key={c.id} c={c} />)}</div>}
        </div>
    );
}
