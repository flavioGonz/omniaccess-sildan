"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ArrowRight, UserCheck, UserX, ShieldAlert, CheckCircle2 } from "lucide-react";
import { setEventPlate } from "@/app/actions/history";

/**
 * Corregir el registro con lo que leyó OmniVision.
 *
 * Nace de la doble verificación: la cámara leyó una chapa y OmniVision, al releer la foto, leyó
 * OTRA. Hasta ahora la leyenda «OmniVision leyó X» sólo avisaba de la diferencia; el guardia tenía
 * que abrir «Cargar matrícula» y teclear la chapa a mano. Ahora la leyenda es un botón: toca, y
 * este diálogo confirma el cambio de la cámara → OmniVision en un paso. Al guardar, `setEventPlate`
 * re-evalúa el acceso (residente, decisión, watchlist), igual que la carga manual.
 *
 * Es confirmar, no teclear: OmniVision ya leyó la chapa, el guardia sólo decide si vale. Por eso
 * muestra las dos lecturas enfrentadas y la confianza, para decidir mirando la foto.
 */

type SaveResult = {
    ok: boolean;
    plate?: string;
    decision?: "GRANT" | "DENY";
    user?: { name: string; unit: string } | null;
    watch?: { label: string; category: string } | null;
    error?: string;
};

export function CorregirOmniDialog({ abierto, onCerrar, eventId, plateCamara, plateOmni, confianza, onSaved }: {
    abierto: boolean;
    onCerrar: () => void;
    eventId: string;
    plateCamara?: string | null;
    plateOmni: string;
    confianza?: number | null;
    onSaved?: (plate: string, r: SaveResult) => void;
}) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<SaveResult | null>(null);

    // Cada apertura arranca limpia: sin error ni resultado de una corrección anterior.
    useEffect(() => { if (abierto) { setSaving(false); setError(""); setResult(null); } }, [abierto]);

    const corregir = async () => {
        setSaving(true); setError("");
        try {
            const r = (await setEventPlate(eventId, plateOmni)) as SaveResult;
            if (!r.ok) { setError(r.error || "No se pudo corregir."); return; }
            setResult(r);
            onSaved?.(r.plate || plateOmni, r);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
            <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles size={18} className="text-[var(--accion)]" /> Corregir con OmniVision
                    </DialogTitle>
                    <DialogDescription>
                        La cámara y OmniVision leyeron distinto. Confirmá la chapa que corresponde a la foto; al
                        guardar, el sistema re-evalúa el acceso.
                    </DialogDescription>
                </DialogHeader>

                {!result ? (
                    <div className="space-y-4">
                        {/* Las dos lecturas enfrentadas: de la cámara a la de OmniVision. */}
                        <div className="flex items-center justify-center gap-3">
                            <div className="text-center">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Cámara</div>
                                <div className="px-3 py-1.5 rounded-lg border border-border bg-muted font-mono text-lg font-bold tracking-[0.18em] line-through decoration-2 decoration-[var(--mal-texto)] text-muted-foreground">{plateCamara || "—"}</div>
                            </div>
                            <ArrowRight size={18} className="text-muted-foreground shrink-0 mt-4" />
                            <div className="text-center">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accion)] mb-1">OmniVision</div>
                                <div className="px-3 py-1.5 rounded-lg border-2 border-[var(--accion)] bg-[var(--accion)]/10 font-mono text-lg font-bold tracking-[0.18em] text-foreground">{plateOmni}</div>
                                {confianza != null && <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">{Math.round(confianza * 100)} % de confianza</div>}
                            </div>
                        </div>
                        {error && <p className="text-sm text-[var(--mal-texto)]">{error}</p>}
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
                            <Button onClick={corregir} disabled={saving}>
                                {saving ? <Loader2 className="mr-1 animate-spin" size={16} /> : <CheckCircle2 className="mr-1" size={16} />}
                                Corregir a {plateOmni}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="text-center text-2xl font-bold uppercase tracking-[0.25em]">{result.plate}</div>
                        {result.user ? (
                            <div className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-3">
                                <UserCheck className="text-emerald-500 shrink-0" size={26} />
                                <div>
                                    <div className="font-bold text-emerald-600">Residente · {result.decision === "GRANT" ? "Acceso permitido" : "Acceso denegado"}</div>
                                    <div className="text-sm text-muted-foreground">{result.user.name}{result.user.unit ? ` · ${result.user.unit}` : ""}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 rounded-xl border-2 border-slate-400 bg-slate-400/10 p-3">
                                <UserX className="text-slate-400 shrink-0" size={26} />
                                <div>
                                    <div className="font-bold text-slate-500">No es residente</div>
                                    <div className="text-sm text-muted-foreground">La matrícula no figura registrada en el barrio.</div>
                                </div>
                            </div>
                        )}
                        {result.watch && (
                            <div className="flex items-center gap-3 rounded-xl border-2 border-red-500 bg-red-500/10 p-3">
                                <ShieldAlert className="text-red-500 shrink-0" size={26} />
                                <div>
                                    <div className="font-bold text-red-500">En watchlist · {result.watch.category}</div>
                                    {result.watch.label && <div className="text-sm text-muted-foreground">{result.watch.label}</div>}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end">
                            <Button onClick={onCerrar}>Listo</Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
