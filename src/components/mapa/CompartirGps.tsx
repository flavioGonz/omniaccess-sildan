"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Eye, Loader2, Share2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/ui/delete-button";
import { compartidosGps, compartirGps, cortarCompartidoGps, type Compartido } from "@/app/actions/gps";
import { DURACIONES, quedaLegible } from "@/lib/gps-compartir";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Compartir por dónde va un rastreador con alguien que no tiene usuario: se arma un enlace que
 * vence solo (lib/gps-compartir tiene las reglas).
 *
 * El diálogo dice, antes de armar nada, qué va a ver el otro: sólo ese vehículo y sólo desde ahora.
 * Y abajo lista los enlaces que siguen vivos, con cuántas veces se miraron: un enlace compartido
 * del que uno se olvidó es justamente lo que hay que poder ver y cortar.
 */
export function CompartirGps({ imei, nombre, alCerrar }: { imei: string; nombre: string; alCerrar: () => void }) {
    const [horas, setHoras] = useState(4);
    const [rotulo, setRotulo] = useState(nombre);
    const [conRecorrido, setConRecorrido] = useState(true);
    const [armando, setArmando] = useState(false);
    const [vivos, setVivos] = useState<Compartido[] | null>(null);
    const [copiado, setCopiado] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => {
        let vivo = true;
        compartidosGps(imei).then((l) => { if (vivo) setVivos(l); }).catch(() => { if (vivo) setVivos([]); });
        return () => { vivo = false; };
    }, [imei, vuelta]);

    const direccion = (c: Compartido) => `${window.location.origin}${c.ruta}`;
    async function copiar(c: Compartido) {
        try { await navigator.clipboard.writeText(direccion(c)); setCopiado(c.id); setTimeout(() => setCopiado((x) => (x === c.id ? null : x)), 2500); }
        catch { toast.error({ title: "No se pudo copiar", description: "Seleccioná la dirección y copiala a mano." }); }
    }
    async function armar() {
        setArmando(true);
        try {
            const r = await compartirGps(imei, { horas, nombre: rotulo, conRecorrido });
            if (!r.ok || !r.compartido) { toast.error({ title: "No se pudo compartir", description: r.error }); return; }
            setVivos((l) => [r.compartido!, ...(l || [])]);
            await copiar(r.compartido);
            toast.success({ title: "Enlace armado y copiado", description: `Pegalo en un mensaje. Vence en ${quedaLegible(r.compartido.venceAt)}.` });
        } catch (e) { toast.error({ title: "No se pudo compartir", description: e instanceof Error ? e.message : undefined }); }
        finally { setArmando(false); }
    }

    return (
        <Dialog open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Compartir la posición de {nombre}</DialogTitle>
                    <DialogDescription>Quien abra el enlace ve sólo este vehículo, desde ahora y hasta que venza. No ve el historial de antes, ni otros vehículos, ni necesita usuario.</DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div>
                        <span className="mb-1 block text-[12px] font-semibold">Por cuánto tiempo</span>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Duración">
                            {DURACIONES.map((d) => (
                                <button key={d.horas} type="button" aria-pressed={horas === d.horas} onClick={() => setHoras(d.horas)}
                                    className={cn("h-8 rounded-full border px-3 text-[12px] font-semibold", horas === d.horas ? "border-foreground bg-foreground text-background" : "border-border hover:bg-accent")}>{d.rotulo}</button>
                            ))}
                        </div>
                    </div>
                    <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold">Cómo se lo presenta</span>
                        <input value={rotulo} onChange={(e) => setRotulo(e.target.value)} maxLength={60} className="h-9 w-full rounded-[6px] border border-border bg-background px-3 text-[13px]" />
                        <span className="mt-1 block text-[11px] text-muted-foreground">Es el único dato del vehículo que ve el otro. Si no querés que vea la matrícula, no la pongas acá.</span>
                    </label>
                    <label className="flex items-center gap-2 text-[12.5px]">
                        <input type="checkbox" checked={conRecorrido} onChange={(e) => setConRecorrido(e.target.checked)} /> Mostrar también el camino que haga desde ahora
                    </label>
                    <Button className="w-full" onClick={armar} disabled={armando}>{armando ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Armar el enlace y copiarlo</Button>
                </div>

                <div className="mt-1 border-t border-border pt-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Enlaces que siguen funcionando</p>
                    {!vivos ? <p className="mt-2 text-[12px] text-muted-foreground">Trayendo…</p>
                        : vivos.length === 0 ? <p className="mt-2 text-[12px] text-muted-foreground">Ninguno: nadie de afuera está viendo este vehículo.</p>
                            : (
                                <ul className="mt-1.5 divide-y divide-border rounded-[10px] border border-border">
                                    {vivos.map((c) => (
                                        <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-[12.5px] font-semibold">{c.nombre} <span className="font-normal text-muted-foreground">· vence en {quedaLegible(c.venceAt)}</span></p>
                                                <p className="flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
                                                    <Eye size={11} /> {c.vistas ? `visto ${hace(c.ultimaVista)}` : "todavía nadie lo abrió"} · lo armó {c.creadoPor}
                                                </p>
                                            </div>
                                            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => copiar(c)}>{copiado === c.id ? <Check size={12} /> : <Copy size={12} />} {copiado === c.id ? "Copiado" : "Copiar"}</Button>
                                            <DeleteButton onConfirm={async () => { await cortarCompartidoGps(c.id); setVuelta((n) => n + 1); }} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
