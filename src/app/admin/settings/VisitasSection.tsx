"use client";

import { useEffect, useState } from "react";
import { DoorOpen, DoorClosed, Plus, Trash2, Save, Loader2, Clock, BellRing, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Pista } from "@/components/ui/pista";
import { getAjustesVisitas, guardarAjustesVisitas } from "@/app/actions/visitas";
import type { Ajustes, ClaveAviso } from "@/lib/visitas/ajustes-base";
import { ETIQUETA_AVISO } from "@/lib/visitas/presentacion";

/**
 * Ajustes → Visitas y patrones: el modo de acceso del barrio, los tipos de visita con su
 * tiempo, y cada aviso a la guardia con su umbral. Lo que se guarda pasa por la misma
 * validación que usa el motor (lib/visitas/ajustes-base), así que lo que se ve acá es lo que
 * el motor va a usar; el motor lo toma en 30 s, sin reiniciar nada.
 */

const EXPLICACION: Record<ClaveAviso, string> = {
    VISITA_EXCEDIDA: "Una visita registrada pasó su tiempo sin que la cámara de Salida la lea ni el guardia la cierre.",
    FUERA_DE_RUTINA: "Una matrícula con rutina aparece un día que no es de su rutina, o lejos de su hora.",
    PERMANENCIA_INUSUAL: "Una visita con matrícula lleva más de lo que se queda 9 de cada 10 veces. Sólo con salidas reales leídas: nunca con tiempos estimados.",
    PRIMERA_VEZ_NOCHE: "Una matrícula que nunca se vio entra dentro de la franja nocturna.",
    DA_VUELTAS: "Una matrícula sin registro ni rutina pasa muchas veces en poco tiempo (lecturas a menos de 2 min de la anterior cuentan como una sola pasada). No cuenta a residentes, visitas, rutinas ni frecuentes (como un ómnibus que cruza el barrio).",
    SIN_REGISTRAR: "Sólo en barrio abierto: entra una matrícula que no está en el padrón, ni en una visita, ni en una invitación. En un barrio abierto entra mucha gente así: apagado por defecto.",
};

export default function VisitasSection() {
    const [aj, setAj] = useState<Ajustes | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const cargar = () => { setError(null); getAjustesVisitas().then(setAj).catch((e) => setError(e?.message || "No se pudo leer")); };
    useEffect(cargar, []);

    if (error) return <div className="rounded-[10px] border border-border bg-card p-6 text-sm">No se pudieron leer los ajustes: {error} <button onClick={cargar} className="tono-accion font-semibold ml-1">Reintentar</button></div>;
    if (!aj) return <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>;

    const set = (p: Partial<Ajustes>) => setAj({ ...aj, ...p });
    const setAviso = <K extends ClaveAviso>(k: K, v: Partial<Ajustes["avisos"][K]>) => set({ avisos: { ...aj.avisos, [k]: { ...aj.avisos[k], ...v } } });

    async function guardar() {
        if (!aj) return;
        setGuardando(true);
        try {
            const r = await guardarAjustesVisitas(aj);
            if (!r.ok) { toast.error("No se pudo guardar", { description: r.error }); return; }
            setAj(r.ajustes);
            toast.success("Visitas y patrones guardado", { description: `Barrio ${r.ajustes.modo === "ABIERTO" ? "abierto" : "cerrado"}. El motor lo toma en menos de un minuto.` });
        } finally { setGuardando(false); }
    }

    return (
        <div className="max-w-5xl space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-[17px] font-bold">Visitas y patrones</h2>
                    <p className="text-[12.5px] text-muted-foreground max-w-2xl">Cómo funciona el barrio (con o sin barrera), cuánto tiempo tiene cada visita y qué avisos le llegan a la guardia. Los avisos van sólo a la consola del guardia y al monitor: nunca por WhatsApp.</p>
                </div>
                <Button onClick={guardar} disabled={guardando}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar</Button>
            </div>

            {/* Modo */}
            <section className="rounded-[10px] border border-border bg-card p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3">Modo de acceso</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {([["ABIERTO", DoorOpen, "Barrio abierto", "No hay barrera: nadie puede ser frenado. Las lecturas dicen Registrado / No registrado, los contadores cuentan todo lo que entra y sale, y los avisos se basan en visitas y patrones."],
                        ["CERRADO", DoorClosed, "Barrio cerrado", "Hay barrera: cada lectura es Permitido o Denegado con su motivo, como siempre. Las visitas y los patrones funcionan igual."]] as const).map(([v, Ic, t, d]) => (
                        <button key={v} type="button" onClick={() => set({ modo: v })}
                            className={cn("text-left rounded-[10px] border-2 p-4 transition-colors", aj.modo === v ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:border-foreground/20")}>
                            <div className="flex items-center gap-2 font-bold"><Ic size={18} /> {t}</div>
                            <p className="mt-1 text-[12.5px] text-muted-foreground">{d}</p>
                        </button>
                    ))}
                </div>
            </section>

            {/* Tipos */}
            <section className="rounded-[10px] border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1.5"><Clock size={12} /> Tipos de visita y su tiempo</h3>
                    <Button size="sm" variant="outline" onClick={() => set({ tipos: [...aj.tipos, { clave: `TIPO_${Date.now().toString(36).toUpperCase()}`, nombre: "Nuevo tipo", minutos: 30, activo: true }] })}><Plus size={14} /> Agregar</Button>
                </div>
                <div className="space-y-2">
                    {aj.tipos.map((t, i) => (
                        <div key={i} className="flex items-center gap-3 flex-wrap">
                            <Input value={t.nombre} onChange={(e) => { const tipos = [...aj.tipos]; tipos[i] = { ...t, nombre: e.target.value }; set({ tipos }); }} className="w-56" />
                            <div className="flex items-center gap-2"><Input type="number" min={1} max={1440} value={t.minutos} onChange={(e) => { const tipos = [...aj.tipos]; tipos[i] = { ...t, minutos: Number(e.target.value) }; set({ tipos }); }} className="w-24 tabular-nums" /><span className="text-[12px] text-muted-foreground">min</span></div>
                            <label className="flex items-center gap-2 text-[12px]"><Switch checked={t.activo} onCheckedChange={(v) => { const tipos = [...aj.tipos]; tipos[i] = { ...t, activo: v }; set({ tipos }); }} /> {t.activo ? "Activo" : "Desactivado"}</label>
                            <Pista titulo="Quitar" texto="Si tiene visitas en curso no se puede quitar: desactivalo."><button type="button" onClick={() => set({ tipos: aj.tipos.filter((_, j) => j !== i) })} disabled={aj.tipos.length <= 1} className="p-2 rounded hover:bg-[var(--mal-suave)] text-[var(--mal)] disabled:opacity-30"><Trash2 size={14} /></button></Pista>
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground">Una visita con matrícula se cierra sola cuando la cámara de Salida la lee. Las que siguen abiertas se cierran a las <Input type="time" value={aj.horaCorte} onChange={(e) => set({ horaCorte: e.target.value })} className="inline-flex w-28 h-7 tabular-nums mx-1" /> como «sin salida registrada», sin avisar.</p>
            </section>

            {/* Avisos */}
            <section className="rounded-[10px] border border-border bg-card p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3 inline-flex items-center gap-1.5"><BellRing size={12} /> Avisos a la guardia</h3>
                <div className="divide-y divide-border">
                    {(Object.keys(EXPLICACION) as ClaveAviso[]).map((k) => {
                        const a: any = aj.avisos[k];
                        const deshabilitado = k === "SIN_REGISTRAR" && aj.modo !== "ABIERTO";
                        return (
                            <div key={k} className={cn("py-3 flex items-start gap-4", deshabilitado && "opacity-50")}>
                                <Switch checked={a.activo} onCheckedChange={(v) => setAviso(k, { activo: v } as any)} disabled={deshabilitado} className="mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-[13px]">{ETIQUETA_AVISO[k].titulo}{deshabilitado && <span className="text-muted-foreground font-normal"> · sólo en barrio abierto</span>}</div>
                                    <p className="text-[12px] text-muted-foreground">{EXPLICACION[k]}</p>
                                    {k === "FUERA_DE_RUTINA" && <Campo etiqueta="a más de" sufijo="min de su hora"><Input type="number" value={a.margenMin} onChange={(e) => setAviso(k, { margenMin: Number(e.target.value) } as any)} className="w-20 h-8 tabular-nums" /></Campo>}
                                    {k === "PRIMERA_VEZ_NOCHE" && <Campo etiqueta="entre" sufijo=""><Input type="time" value={a.desde} onChange={(e) => setAviso(k, { desde: e.target.value } as any)} className="w-28 h-8" /><span className="text-[12px]">y</span><Input type="time" value={a.hasta} onChange={(e) => setAviso(k, { hasta: e.target.value } as any)} className="w-28 h-8" /></Campo>}
                                    {k === "DA_VUELTAS" && <Campo etiqueta="" sufijo="min"><Input type="number" value={a.lecturas} onChange={(e) => setAviso(k, { lecturas: Number(e.target.value) } as any)} className="w-16 h-8 tabular-nums" /><span className="text-[12px]">pasadas en</span><Input type="number" value={a.minutos} onChange={(e) => setAviso(k, { minutos: Number(e.target.value) } as any)} className="w-20 h-8 tabular-nums" /></Campo>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Parámetros */}
            <section className="rounded-[10px] border border-border bg-card p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3 inline-flex items-center gap-1.5"><Timer size={12} /> Patrones</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                    <Campo etiqueta="Rutina: al menos" sufijo="días distintos"><Input type="number" value={aj.rutinaDiasMin} onChange={(e) => set({ rutinaDiasMin: Number(e.target.value) })} className="w-16 h-8 tabular-nums" /></Campo>
                    <Campo etiqueta="con una variación menor a" sufijo="min"><Input type="number" value={aj.rutinaDesvioMaxMin} onChange={(e) => set({ rutinaDesvioMaxMin: Number(e.target.value) })} className="w-16 h-8 tabular-nums" /></Campo>
                    <Campo etiqueta="El perfil mira los últimos" sufijo="días"><Input type="number" value={aj.ventanaPerfilDias} onChange={(e) => set({ ventanaPerfilDias: Number(e.target.value) })} className="w-16 h-8 tabular-nums" /></Campo>
                    <Campo etiqueta="No repetir el mismo aviso por" sufijo="min"><Input type="number" value={aj.antirreboteMin} onChange={(e) => set({ antirreboteMin: Number(e.target.value) })} className="w-16 h-8 tabular-nums" /></Campo>
                </div>
            </section>
        </div>
    );
}

function Campo({ etiqueta, sufijo, children }: { etiqueta: string; sufijo: string; children: React.ReactNode }) {
    return <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px]">{etiqueta && <span className="text-muted-foreground">{etiqueta}</span>}{children}{sufijo && <span className="text-muted-foreground">{sufijo}</span>}</div>;
}
