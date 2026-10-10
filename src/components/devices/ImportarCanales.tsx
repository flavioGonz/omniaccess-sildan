"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, BadgeCheck, Camera, Eye, Loader2, Route, ScanEye, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip } from "@/components/ui/estados";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { importarCanalesNvr } from "@/app/actions/nvr";
import { ROLES, sugerirRol, type RolCamara } from "@/lib/rol-camara";

/**
 * Importar canales del grabador, preguntando QUÉ ES cada cámara.
 *
 * Antes «Crear la cámara» la creaba siempre como cámara común. Ahora cada canal pide su rol:
 * LPR de acceso, seguimiento, intrusión o sólo video para OmniVision. Se sugiere cuando el
 * modelo o el nombre lo dicen (una iDS-…/P es ANPR); si no, no se puede importar hasta elegir:
 * adivinar es lo que mandaba la cámara al circuito equivocado.
 *
 * Después de crear, se hace lo que el rol pide y se muestra cómo salió cada cosa: que la
 * cámara nos avise (servidor HTTP en la cámara) y que el video vaya o no a OmniVision.
 */
export type CanalImportable = { channel: number; ip: string | null; name: string | null; model: string | null; online: boolean | null };
type Fila = { rol: RolCamara | null; sugerido: string | null; direction: "ENTRY" | "EXIT" | null; groupId: string; vision: boolean };
type Resultado = { channel: number; name: string; accion: string; motivo?: string; pasos: { que: string; ok: boolean | null; detalle?: string }[] };

const ICONO: Record<RolCamara, typeof Camera> = { acceso: Camera, seguimiento: Route, intrusion: ShieldAlert, video: ScanEye };
const ROTULO_TIPO: Record<string, string> = { LPR_CAMERA: "LPR de acceso", LPR_INTERIOR: "seguimiento interior", CAMERA: "cámara (intrusión o video)", NVR: "grabador" };

export function ImportarCanales({ abierto, alCerrar, nvrId, canales, existentes, grupos, alTerminar }: {
    abierto: boolean; alCerrar: () => void; nvrId: string;
    canales: CanalImportable[];
    /** Los equipos que ya hay, para decir «ya existe» por IP en vez de crear otro. */
    existentes: { id: string; ip: string; name: string; deviceType: string }[];
    grupos: { id: string; name: string }[];
    alTerminar: () => void;
}) {
    const [filas, setFilas] = useState<Record<number, Fila>>({});
    const [importando, setImportando] = useState(false);
    const [resultado, setResultado] = useState<Resultado[] | null>(null);

    useEffect(() => {
        if (!abierto) return;
        setResultado(null);
        const f: Record<number, Fila> = {};
        for (const c of canales) {
            const s = sugerirRol(c);
            f[c.channel] = { rol: s?.rol ?? null, sugerido: s?.por ?? null, direction: null, groupId: "none", vision: s ? ROLES[s.rol].vision : true };
        }
        setFilas(f);
    }, [abierto, canales]);

    const existe = (c: CanalImportable) => (c.ip ? existentes.find((d) => d.ip === c.ip) : undefined);
    const cambiar = (ch: number, p: Partial<Fila>) => setFilas((x) => ({ ...x, [ch]: { ...x[ch], ...p } }));
    const nuevas = canales.filter((c) => c.ip && !existe(c));
    const faltan = useMemo(() => nuevas.filter((c) => {
        const f = filas[c.channel];
        return !f?.rol || (f.rol === "acceso" && !f.direction);
    }), [nuevas, filas]);

    async function importar() {
        setImportando(true);
        try {
            const r = await importarCanalesNvr(nvrId, canales.map((c) => {
                const f = filas[c.channel];
                return { channel: c.channel, rol: (f?.rol || "video") as RolCamara, direction: f?.direction || undefined, groupId: f?.groupId };
            }));
            if (!r.ok) { setResultado([{ channel: 0, name: "Importación", accion: "omitida", motivo: r.error, pasos: [] }]); return; }
            const res: Resultado[] = [];
            for (const d of r.detalle) {
                const pasos: Resultado["pasos"] = [];
                const f = filas[d.channel];
                if (d.accion === "creada" && d.id && d.rol) {
                    // La hora primero: una cámara nueva suele venir en otro huso (CST-8 de fábrica) y
                    // sus eventos quedarían corridos horas. «MATRICULA SALIDA» llegó 11 h atrasada.
                    try {
                        const h = await fetch("/api/devices/sync-time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: d.id }) });
                        const jh = await h.json().catch(() => ({}));
                        pasos.push({ que: "Hora puesta", ok: h.ok && jh?.ok !== false, detalle: h.ok ? undefined : jh?.error });
                    } catch (e: any) { pasos.push({ que: "Hora puesta", ok: false, detalle: e?.message }); }
                    // Que la cámara nos avise: el mismo «servidor de alarma» del monitor de intrusión.
                    if (ROLES[d.rol].avisos) {
                        try {
                            const a = await fetch(`/api/devices/alarm-host?deviceId=${d.id}`, { method: "POST" }).then((x) => x.json());
                            pasos.push({ que: "La cámara nos avisa", ok: !!(a?.ok ?? a?.hasOmni), detalle: a?.error });
                        } catch (e: any) { pasos.push({ que: "La cámara nos avisa", ok: false, detalle: e?.message }); }
                    }
                    try {
                        const v = await fetch(`/api/vision/camaras/${d.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ analiza: !!f?.vision }) });
                        pasos.push({ que: f?.vision ? "OmniVision la analiza" : "OmniVision no la analiza", ok: v.ok, detalle: v.ok ? undefined : (await v.json().catch(() => ({})))?.error });
                    } catch (e: any) { pasos.push({ que: "OmniVision", ok: false, detalle: e?.message }); }
                }
                res.push({ channel: d.channel, name: d.name, accion: d.accion, motivo: d.motivo, pasos });
            }
            setResultado(res);
            alTerminar();
        } finally { setImportando(false); }
    }

    return (
        <Dialog open={abierto} onOpenChange={(o) => { if (!o && !importando) alCerrar(); }}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogTitle className="text-[16px] font-bold">{resultado ? "Cómo salió" : `Importar ${canales.length === 1 ? "la cámara" : `${canales.length} cámaras`} del grabador`}</DialogTitle>
                <DialogDescription className="text-[12.5px] text-muted-foreground -mt-2">
                    {resultado ? "Cada cámara, con lo que se hizo." : "Decí qué es cada una: decide a qué pantalla va, si la cámara nos avisa y si OmniVision mira su video. Se puede cambiar después desde su ficha."}
                </DialogDescription>

                {!resultado ? (
                    <div className="space-y-3">
                        {canales.map((c, i) => {
                            const ya = existe(c), f = filas[c.channel];
                            return (
                                <motion.div key={c.channel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                                    className="rounded-[10px] border border-border overflow-hidden grid grid-cols-1 md:grid-cols-[200px_1fr]">
                                    <div className="relative aspect-video md:aspect-auto bg-black min-h-[112px]">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={`/api/nvr/snapshot?ch=${c.channel}`} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }} />
                                        <span className="absolute top-1.5 left-1.5 min-w-6 h-6 px-1.5 rounded-md bg-black/75 text-white text-[12px] font-bold grid place-items-center tabular-nums">{c.channel}</span>
                                    </div>
                                    <div className="p-3 space-y-2.5 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[13.5px] font-bold truncate">{c.name || `Canal ${c.channel}`}</span>
                                            <span className="text-[11.5px] text-muted-foreground tabular-nums">{c.ip || "sin IP"}{c.model ? ` · ${c.model}` : ""}</span>
                                            {c.online === false && <Chip tono="mal">Sin señal</Chip>}
                                        </div>
                                        {!c.ip ? <p className="text-[12px] tono-mal">El canal no tiene IP: no se puede importar.</p>
                                            : ya ? (
                                                <p className="text-[12px] text-muted-foreground"><Chip tono="info" icono={BadgeCheck}>Ya existe</Chip> como <b className="text-foreground">{ya.name}</b> ({ROTULO_TIPO[ya.deviceType] || ya.deviceType}). Sólo se mapea el canal; el tipo se cambia desde su ficha.</p>
                                            ) : (
                                                <>
                                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
                                                        {(Object.keys(ROLES) as RolCamara[]).map((r) => {
                                                            const I = ICONO[r], sel = f?.rol === r;
                                                            return (
                                                                <button key={r} type="button" onClick={() => cambiar(c.channel, { rol: r, vision: ROLES[r].vision })} aria-pressed={sel} title={ROLES[r].que}
                                                                    className={cn("rounded-md border px-2 py-2 text-left transition-colors", sel ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_12%,transparent)]" : "border-border hover:bg-accent")}>
                                                                    <span className="flex items-center gap-1.5 text-[12px] font-bold"><I size={13} /> {ROLES[r].rotulo}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {f?.rol ? <p className="text-[11.5px] text-muted-foreground">{ROLES[f.rol].que}</p> : <p className="text-[11.5px] tono-aviso inline-flex items-center gap-1"><AlertTriangle size={12} /> Elegí qué es esta cámara.</p>}
                                                    {f?.sugerido && f.rol && <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Sparkles size={11} /> Sugerido porque {f.sugerido}.</p>}
                                                    {f?.rol === "acceso" && (
                                                        <div className="flex items-center gap-3 flex-wrap">
                                                            <div className="inline-flex rounded-md bg-muted p-0.5">
                                                                {([["ENTRY", "Entrada"], ["EXIT", "Salida"]] as const).map(([v, r]) => (
                                                                    <button key={v} type="button" onClick={() => cambiar(c.channel, { direction: v })}
                                                                        className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold", f.direction === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>{r}</button>
                                                                ))}
                                                            </div>
                                                            <select value={f.groupId} onChange={(e) => cambiar(c.channel, { groupId: e.target.value })}
                                                                className="h-9 bg-background border border-border rounded-md px-2 text-[12.5px]">
                                                                <option value="none">Sin grupo (no abre para nadie)</option>
                                                                {grupos.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                                            </select>
                                                            {!f.direction && <span className="text-[11.5px] tono-aviso">¿Entra o sale?</span>}
                                                        </div>
                                                    )}
                                                    {f?.rol && (
                                                        <label className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
                                                            <span className="text-[12px]"><span className="font-semibold inline-flex items-center gap-1"><Eye size={12} /> Que OmniVision mire su video</span><span className="block text-muted-foreground text-[11px]">Siluetas, búsqueda, reglas propias. Suma un poco de GPU.</span></span>
                                                            <Switch checked={f.vision} onCheckedChange={(v) => cambiar(c.channel, { vision: v })} />
                                                        </label>
                                                    )}
                                                </>
                                            )}
                                    </div>
                                </motion.div>
                            );
                        })}
                        <div className="flex items-center justify-end gap-3 pt-1">
                            {faltan.length > 0 && <span className="text-[12px] tono-aviso">Falta completar {faltan.length === 1 ? "1 cámara" : `${faltan.length} cámaras`}.</span>}
                            <Button variant="ghost" onClick={alCerrar} disabled={importando}>Cancelar</Button>
                            <Button onClick={importar} disabled={importando || faltan.length > 0 || !canales.some((c) => c.ip)}>
                                {importando ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} Importar
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {resultado.map((r) => (
                            <div key={r.channel + r.name} className="rounded-[10px] border border-border px-3 py-2.5 space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-bold">{r.name}</span>
                                    {r.accion === "creada" ? <Chip tono="bien">Creada</Chip> : r.accion === "mapeada" ? <Chip tono="info">Mapeada</Chip> : <Chip tono="mal">No se importó</Chip>}
                                </div>
                                {r.motivo && <p className="text-[12px] text-muted-foreground">{r.motivo}</p>}
                                {r.pasos.map((p) => (
                                    <p key={p.que} className={cn("text-[12px]", p.ok ? "tono-bien" : "tono-mal")}>{p.ok ? "✓" : "✗"} {p.que}{p.detalle ? ` — ${p.detalle}` : ""}</p>
                                ))}
                            </div>
                        ))}
                        <div className="flex justify-end pt-1"><Button onClick={alCerrar}>Listo</Button></div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
