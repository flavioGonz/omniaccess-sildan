"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    Zap, Loader2, CheckCircle2, XCircle, X, Clock, Send, ScanLine, Film, Radio, Car, AlertTriangle,
} from "lucide-react";
import { provisionLprDevice } from "@/app/actions/provision";
import { sileo as toast } from "sileo";

function cn(...a: (string | boolean | undefined)[]) { return a.filter(Boolean).join(" "); }

// Lo que la puesta a punto va a tocar en la cámara. Se muestra ANTES de aplicar.
const PASOS = [
    { name: "Hora", Icon: Clock, detail: "Sincroniza la hora de la cámara con la del servidor." },
    { name: "Envío de eventos (HTTP host)", Icon: Send, detail: "Apunta las detecciones al servidor de OmniAccess." },
    { name: "Modo ANPR", Icon: ScanLine, detail: "Verifica que esté en modo lectura de matrículas (roadDetection)." },
    { name: "Códec H.264", Icon: Film, detail: "Fuerza H.264 en los canales 101/102 para el video en vivo." },
    { name: "Video en vivo (go2rtc)", Icon: Radio, detail: "Registra el stream de la cámara en el servidor de video." },
    { name: "Matrículas", Icon: Car, detail: "Sincroniza el padrón de matrículas (solo agrega/quita las que cambiaron)." },
];

export function ProvisionButton({ deviceId, deviceName, onDone }: { deviceId: string; deviceName?: string; onDone?: () => void }) {
    const [fase, setFase] = useState<null | "confirmar" | "corriendo" | "resultado">(null);
    const [result, setResult] = useState<any>(null);

    const run = async () => {
        setFase("corriendo"); setResult(null);
        try {
            const r: any = await provisionLprDevice(deviceId, true);
            setResult(r); setFase("resultado");
            if (r?.ok) toast.success({ title: `Puesta a punto OK (${r.okCount}/${r.total})` });
            else toast.error({ title: r?.error || `Puesta a punto con avisos (${r?.okCount ?? 0}/${r?.total ?? 0})` });
            onDone?.();
        } catch {
            toast.error({ title: "Error al poner a punto" });
            setFase("resultado"); setResult({ ok: false, error: "No se pudo contactar la cámara.", steps: [] });
        }
    };

    const cerrar = () => { setFase(null); setResult(null); };

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setFase("confirmar")}
                            className="h-8 w-8 rounded-md bg-card/50 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 border border-border/50 hover:border-emerald-500/30 transition-all">
                            <Zap size={15} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Poner a punto (hora · envío · códec · matrículas)</p></TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {fase && (
                <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-5" onClick={cerrar}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <div className="flex items-center gap-2.5">
                                <span className="h-9 w-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                                    <Zap size={17} className="text-emerald-500" />
                                </span>
                                <div>
                                    <p className="text-sm font-bold text-foreground leading-tight">Puesta a punto</p>
                                    <p className="text-[11px] text-muted-foreground leading-tight">{deviceName || "Cámara LPR"}</p>
                                </div>
                            </div>
                            <button onClick={cerrar} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X size={16} /></button>
                        </div>

                        {/* Confirmación: qué va a cambiar */}
                        {fase === "confirmar" && (
                            <>
                                <div className="px-5 pt-4 pb-2">
                                    <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 mb-3">
                                        <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[12px] text-foreground/90 leading-snug">
                                            Se va a <b>configurar la cámara por API</b>. Estos son los cambios que se aplicarán:
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        {PASOS.map((p) => (
                                            <div key={p.name} className="flex items-start gap-2.5">
                                                <span className="h-7 w-7 rounded-lg bg-accent flex items-center justify-center shrink-0 mt-0.5">
                                                    <p.Icon size={14} className="text-muted-foreground" />
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="text-[12px] font-semibold text-foreground leading-tight">{p.name}</p>
                                                    <p className="text-[11px] text-muted-foreground leading-snug">{p.detail}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
                                    <button onClick={cerrar} className="px-3.5 py-2 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent transition-colors">Cancelar</button>
                                    <button onClick={run} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1.5 transition-colors">
                                        <Zap size={14} /> Poner a punto
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Corriendo */}
                        {fase === "corriendo" && (
                            <div className="px-5 py-8 flex flex-col items-center gap-3">
                                <Loader2 size={26} className="animate-spin text-emerald-500" />
                                <p className="text-sm font-semibold text-foreground">Configurando la cámara…</p>
                                <p className="text-[11px] text-muted-foreground">Hora · envío · códec · video · matrículas</p>
                            </div>
                        )}

                        {/* Resultado */}
                        {fase === "resultado" && (
                            <>
                                <div className="p-4 space-y-2.5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                                    {(result?.steps || []).map((s: any, i: number) => (
                                        <div key={i} className="flex items-start gap-2.5 text-xs rounded-lg px-2 py-1.5 bg-accent/40">
                                            {s.ok ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" /> : <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />}
                                            <div className="min-w-0">
                                                <p className="font-bold text-foreground">{s.name}</p>
                                                <p className={cn("break-words", s.ok ? "text-muted-foreground" : "text-red-500")}>{s.detail}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {result?.error && (!result.steps || !result.steps.length) && (
                                        <p className="text-xs text-red-500 px-1">{result.error}</p>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
                                    <span className={cn("text-[11px] font-bold", result?.ok ? "text-emerald-500" : "text-amber-500")}>
                                        {result?.ok ? "Todo aplicado correctamente" : `Aplicado con avisos (${result?.okCount ?? 0}/${result?.total ?? 0})`}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {!result?.ok && <button onClick={run} className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-accent">Reintentar</button>}
                                        <button onClick={cerrar} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500">Listo</button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
