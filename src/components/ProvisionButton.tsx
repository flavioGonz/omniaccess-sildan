"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Zap, Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { provisionLprDevice } from "@/app/actions/provision";
import { sileo as toast } from "sileo";

// Botón "Poner a punto" de una cámara LPR: corre el provisioning completo (hora, envío
// de eventos al server, modo ANPR, códec H.264, stream de video y matrículas) y muestra
// el resultado de cada paso.
export function ProvisionButton({ deviceId, deviceName, onDone }: { deviceId: string; deviceName?: string; onDone?: () => void }) {
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<any>(null);

    const run = async () => {
        setRunning(true); setResult(null);
        try {
            const r: any = await provisionLprDevice(deviceId, true);
            setResult(r);
            if (r?.ok) toast.success({ title: `Puesta a punto OK (${r.okCount}/${r.total})` });
            else toast.error({ title: r?.error || `Puesta a punto con avisos (${r?.okCount ?? 0}/${r?.total ?? 0})` });
            onDone?.();
        } catch { toast.error({ title: "Error al poner a punto" }); }
        finally { setRunning(false); }
    };

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={run} disabled={running}
                            className="h-8 w-8 rounded-md bg-card/50 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 border border-border/50 hover:border-emerald-500/30 transition-all">
                            {running ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Poner a punto (hora · envío · códec · matrículas)</p></TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {result && (
                <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-5" onClick={() => setResult(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                            <div className="flex items-center gap-2"><Zap size={16} className="text-emerald-400" /><span className="text-sm font-bold text-foreground">Puesta a punto — {deviceName || "cámara"}</span></div>
                            <button onClick={() => setResult(null)} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X size={16} /></button>
                        </div>
                        <div className="p-4 space-y-2.5">
                            {(result.steps || []).map((s: any, i: number) => (
                                <div key={i} className="flex items-start gap-2.5 text-xs">
                                    {s.ok ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" /> : <XCircle size={15} className="text-red-400 shrink-0 mt-0.5" />}
                                    <div className="min-w-0">
                                        <p className="font-bold text-foreground">{s.name}</p>
                                        <p className={cn("truncate", s.ok ? "text-muted-foreground" : "text-red-400")}>{s.detail}</p>
                                    </div>
                                </div>
                            ))}
                            {result.error && (!result.steps || !result.steps.length) && <p className="text-xs text-red-400">{result.error}</p>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function cn(...a: (string | boolean | undefined)[]) { return a.filter(Boolean).join(" "); }
