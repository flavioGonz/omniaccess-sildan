"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Keyboard, Loader2, CheckCircle2, UserCheck, UserX, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { setEventPlate } from "@/app/actions/history";

const normPlate = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

type SaveResult = {
    ok: boolean;
    plate?: string;
    decision?: "GRANT" | "DENY";
    user?: { name: string; unit: string } | null;
    watch?: { label: string; category: string } | null;
    error?: string;
};

/** Botón para cargar/corregir a mano la matrícula de una detección NO_LEIDA.
 * Al guardar, re-evalúa el acceso (residente / decisión / watchlist) en el servidor. */
export function PlateManualButton({
    eventId,
    currentPlate,
    onSaved,
    label = false,
    className,
}: {
    eventId: string;
    currentPlate?: string | null;
    onSaved?: (plate: string, result: SaveResult) => void;
    label?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [plate, setPlate] = useState(normPlate(currentPlate));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<SaveResult | null>(null);

    const openDialog = (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        setPlate(""); setError(""); setResult(null); setOpen(true);
    };

    const save = async () => {
        const p = normPlate(plate);
        if (!p) { setError("Ingresá una matrícula."); return; }
        setSaving(true); setError("");
        try {
            const r = (await setEventPlate(eventId, p)) as SaveResult;
            if (!r.ok) { setError(r.error || "No se pudo guardar."); return; }
            setResult(r);
            onSaved?.(r.plate || p, r);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <button
                onClick={openDialog}
                title="Cargar matrícula a mano"
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors",
                    label
                        ? "px-2 py-1 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                        : "p-1 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10",
                    className
                )}
            >
                <Keyboard size={14} />
                {label && <span>Cargar matrícula</span>}
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Keyboard size={18} className="text-amber-500" /> Cargar matrícula
                        </DialogTitle>
                        <DialogDescription>
                            La cámara no pudo leerla. Ingresá la matrícula y el sistema re-evalúa el acceso.
                        </DialogDescription>
                    </DialogHeader>

                    {!result ? (
                        <div className="space-y-4">
                            <Input
                                value={plate}
                                onChange={(e) => setPlate(normPlate(e.target.value))}
                                onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                                className="h-12 text-center text-2xl font-bold uppercase tracking-[0.3em]"
                                placeholder="ABC1234"
                                autoFocus
                            />
                            {error && <p className="text-sm text-red-500">{error}</p>}
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                                <Button onClick={save} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
                                    {saving ? <Loader2 className="mr-1 animate-spin" size={16} /> : <CheckCircle2 className="mr-1" size={16} />}
                                    Guardar
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
                                <Button onClick={() => setOpen(false)}>Listo</Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
