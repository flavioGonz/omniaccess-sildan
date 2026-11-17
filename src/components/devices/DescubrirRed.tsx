"use client";

import { useCallback, useEffect, useState } from "react";
import { Radar, Loader2, Plus, Check, Globe } from "lucide-react";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { ErrorEstado } from "@/components/ui/estados";
import { IconoTipo } from "@/components/devices/ArbolAreas";
import { cn } from "@/lib/utils";

/**
 * «Descubrir equipos en la red»: el barrido de ping de los mapas de KumaMap, acá adentro
 * (pedido 17/11 de Nico).
 *
 * Lo que cambia respecto de aquel, y es el motivo de traerlo: ESTE sabe qué equipos ya están
 * dados de alta. Un barrido que devuelve veinte direcciones no dice nada; la pregunta de verdad
 * es cuál de esas veinte es una cámara que todavía no está cargada, y esa queda arriba, marcada,
 * con el botón para darla de alta con la IP ya puesta.
 *
 * Tarda: son 254 pings y después los puertos de las que contestaron. Por eso el rango se puede
 * achicar y la pantalla dice lo que está haciendo.
 */

type Hallazgo = {
    ip: string; rtt: number | null; nombre: string | null; puertos: number[];
    servidor: string | null; reino: string | null;
    parece: { que: string; tipo: string | null; marca: string | null };
    equipo: { id: string; nombre: string; tipo: string } | null;
};

const PUERTO_ROTULO: Record<number, string> = { 80: "web", 443: "web segura", 554: "RTSP", 8000: "Hikvision", 37777: "Dahua", 22: "SSH" };

export function DescubrirRed({ abierto, alCerrar, alDarDeAlta, alAbrirEquipo }: {
    abierto: boolean;
    alCerrar: () => void;
    /** Dar de alta esa IP: la pantalla de Dispositivos abre su alta con lo que se sepa. */
    alDarDeAlta: (datos: { ip: string; marca: string | null; tipo: string | null; nombre: string | null }) => void;
    alAbrirEquipo?: (id: string) => void;
}) {
    const [subredes, setSubredes] = useState<string[]>([]);
    const [subred, setSubred] = useState("");
    const [desde, setDesde] = useState(1);
    const [hasta, setHasta] = useState(254);
    const [barriendo, setBarriendo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resultado, setResultado] = useState<{ total: number; hallazgos: Hallazgo[]; ms: number } | null>(null);

    useEffect(() => {
        if (!abierto) return;
        fetch("/api/devices/descubrir", { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => { setSubredes(j.subredes || []); setSubred((s) => s || j.subredes?.[0] || "192.168.1"); })
            .catch(() => setSubred((s) => s || "192.168.1"));
    }, [abierto]);

    const barrer = useCallback(async () => {
        setBarriendo(true); setError(null); setResultado(null);
        try {
            const r = await fetch("/api/devices/descubrir", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ subred, desde, hasta }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setResultado(j);
            const nuevos = (j.hallazgos as Hallazgo[]).filter((h) => !h.equipo).length;
            toast.success({
                title: `${j.hallazgos.length} contestaron de ${j.total}`,
                description: nuevos ? `${nuevos} sin dar de alta` : "Todas ya están dadas de alta.",
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo barrer la red");
        } finally { setBarriendo(false); }
    }, [subred, desde, hasta]);

    const nuevos = resultado?.hallazgos.filter((h) => !h.equipo) || [];
    const conocidos = resultado?.hallazgos.filter((h) => h.equipo) || [];

    return (
        <Cajon open={abierto} onOpenChange={(v) => !v && alCerrar()}>
            <CajonContenido ancho="ancho" titulo="Descubrir equipos en la red"
                descripcion="Le manda un ping a cada dirección del rango y prueba sus puertos. Sólo redes privadas."
                encabezado={
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="flex-1 min-w-[180px]">
                            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">Subred</span>
                            <input value={subred} onChange={(e) => setSubred(e.target.value)} placeholder="192.168.1" list="oa-subredes"
                                className="w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-[var(--accion)]/30" />
                            <datalist id="oa-subredes">{subredes.map((s) => <option key={s} value={s} />)}</datalist>
                        </label>
                        {[["Desde", desde, setDesde], ["Hasta", hasta, setHasta]].map(([r, v, set]) => (
                            <label key={r as string} className="w-20">
                                <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">{r as string}</span>
                                <input type="number" min={1} max={254} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value) || 1)}
                                    className="w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-[var(--accion)]/30" />
                            </label>
                        ))}
                        <Button onClick={barrer} disabled={barriendo || !subred}>
                            {barriendo ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />} Buscar
                        </Button>
                    </div>
                }>
                <div className="space-y-4">
                    {subredes.length > 1 && !resultado && !barriendo && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                            <span className="text-muted-foreground">Redes con equipos:</span>
                            {subredes.map((s) => (
                                <button key={s} type="button" onClick={() => setSubred(s)}
                                    className={cn("h-7 px-2.5 rounded-full border text-[12px] font-semibold tabular-nums",
                                        s === subred ? "border-[var(--accion)] text-[var(--accion)]" : "border-border hover:bg-accent")}>{s}.x</button>
                            ))}
                        </div>
                    )}

                    {barriendo && (
                        <div className="rounded-[10px] border border-dashed border-border p-8 text-center">
                            <Loader2 size={20} className="animate-spin mx-auto mb-2 text-muted-foreground" />
                            <p className="text-[13px] font-semibold">Barriendo {subred}.{desde} – {subred}.{hasta}</p>
                            <p className="text-[12px] text-muted-foreground">Son {hasta - desde + 1} direcciones: puede tardar medio minuto.</p>
                        </div>
                    )}

                    {error && !barriendo && <ErrorEstado mensaje={error} alReintentar={barrer} />}

                    {resultado && !barriendo && (
                        <>
                            <p className="text-[12px] text-muted-foreground tabular-nums">
                                {resultado.hallazgos.length} de {resultado.total} contestaron · {(resultado.ms / 1000).toFixed(1)} s
                            </p>

                            {nuevos.length > 0 && (
                                <section className="space-y-2">
                                    <h3 className="text-[13px] font-bold">Sin dar de alta · {nuevos.length}</h3>
                                    <div className="rounded-[10px] border border-border divide-y divide-border">
                                        {nuevos.map((h) => <Fila key={h.ip} h={h} alDarDeAlta={alDarDeAlta} />)}
                                    </div>
                                </section>
                            )}

                            {conocidos.length > 0 && (
                                <section className="space-y-2">
                                    <h3 className="text-[13px] font-bold text-muted-foreground">Ya están en OmniAccess · {conocidos.length}</h3>
                                    <div className="rounded-[10px] border border-border divide-y divide-border">
                                        {conocidos.map((h) => <Fila key={h.ip} h={h} alAbrirEquipo={alAbrirEquipo} />)}
                                    </div>
                                </section>
                            )}

                            {resultado.hallazgos.length === 0 && (
                                <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                                    No contestó nadie en ese rango. Puede ser la subred equivocada, o equipos que no responden al ping.
                                </div>
                            )}
                        </>
                    )}

                    {!resultado && !barriendo && !error && (
                        <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                            <Globe size={18} className="mx-auto mb-2 opacity-40" />
                            Elegí la red y tocá Buscar. Se le manda un ping a cada dirección y, a las que contestan, se les prueban los puertos para saber qué son.
                        </div>
                    )}
                </div>
            </CajonContenido>
        </Cajon>
    );
}

function Fila({ h, alDarDeAlta, alAbrirEquipo }: {
    h: Hallazgo;
    alDarDeAlta?: (datos: { ip: string; marca: string | null; tipo: string | null; nombre: string | null }) => void;
    alAbrirEquipo?: (id: string) => void;
}) {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5">
            <IconoTipo tipo={h.equipo?.tipo || h.parece.tipo || "?"} size={15} className="shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold tabular-nums">{h.ip}</span>
                    {h.rtt != null && <span className="text-[11px] text-muted-foreground tabular-nums">{h.rtt} ms</span>}
                    {/* El nombre del equipo y lo que parece ser van en texto normal: un chip los pone en
                        mayúsculas, y un nombre propio en mayúsculas grita sin decir nada más. */}
                    {h.equipo
                        ? <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold tono-bien"><Check size={12} className="shrink-0" />{h.equipo.nombre}</span>
                        : <span className="text-[12.5px] font-semibold text-foreground/80">{h.parece.que}</span>}
                </div>
                <div className="text-[11.5px] text-muted-foreground truncate">
                    {[h.nombre, h.servidor, h.reino, h.puertos.map((p) => PUERTO_ROTULO[p] || p).join(" · ")].filter(Boolean).join(" · ") || "sin puertos conocidos abiertos"}
                </div>
            </div>
            {h.equipo
                ? alAbrirEquipo && <Button size="sm" variant="outline" onClick={() => alAbrirEquipo(h.equipo!.id)}>Abrir</Button>
                : alDarDeAlta && (
                    <Button size="sm" onClick={() => alDarDeAlta({ ip: h.ip, marca: h.parece.marca, tipo: h.parece.tipo, nombre: h.nombre })}>
                        <Plus size={14} /> Dar de alta
                    </Button>
                )}
        </div>
    );
}
