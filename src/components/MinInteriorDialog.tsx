"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCw, ShieldAlert, ShieldCheck, ShieldQuestion, Search, ExternalLink, X } from "lucide-react";
import { MI_LOGO } from "@/components/min-interior-logo";

const normPlate = (p?: string | null) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MIN_INTERIOR_URL = "https://matriculas-requeridas.minterior.gub.uy/index.php";

type Result = { status: "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN"; matricula: string; excerpt: string };

export function MinInteriorDialog({
    plate,
    open,
    onOpenChange,
}: {
    plate?: string | null;
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const [sid, setSid] = useState("");
    const [image, setImage] = useState("");
    const [mat, setMat] = useState(normPlate(plate));
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<Result | null>(null);

    const startCaptcha = useCallback(async () => {
        setLoading(true); setError(""); setResult(null); setCode(""); setImage("");
        try {
            const r = await fetch("/api/min-interior?action=start", { cache: "no-store" });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error || "No se pudo iniciar la consulta.");
            setSid(d.sid); setImage(d.image);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) { setMat(normPlate(plate)); startCaptcha(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, plate]);

    const reload = async () => {
        if (!sid) return startCaptcha();
        setLoading(true); setError(""); setCode("");
        try {
            const r = await fetch("/api/min-interior?action=reload&sid=" + encodeURIComponent(sid), { cache: "no-store" });
            const d = await r.json();
            if (!d.ok) { if (r.status === 410) return startCaptcha(); throw new Error(d.error); }
            setImage(d.image);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const consultar = async () => {
        if (!mat || !code) { setError("Completá la matrícula y el código del captcha."); return; }
        setSubmitting(true); setError(""); setResult(null);
        try {
            const r = await fetch("/api/min-interior", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sid, matricula: mat, captcha_code: code }),
            });
            const d = await r.json();
            if (!d.ok) {
                if (r.status === 410) { setError("La sesión venció. Se recargó el captcha, probá de nuevo."); startCaptcha(); return; }
                throw new Error(d.error);
            }
            setResult({ status: d.status, matricula: d.matricula, excerpt: d.excerpt });
            if (d.status === "CAPTCHA") { setError("El código no coincide. Se recargó una nueva imagen."); startCaptcha(); }
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setSubmitting(false);
        }
    };

    const badge = () => {
        if (!result) return null;
        if (result.status === "REQUERIDA")
            return (
                <div className="rounded-xl border-2 border-red-500 bg-red-500/10 p-4 flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-500/15">
                        <ShieldAlert className="text-red-500" size={26} />
                    </div>
                    <div>
                        <div className="text-lg font-extrabold tracking-tight text-red-500">MATRÍCULA REQUERIDA</div>
                        <div className="text-sm text-muted-foreground">{result.matricula} figura con requerimiento en el Ministerio del Interior. Actuá según protocolo.</div>
                    </div>
                </div>
            );
        if (result.status === "NO")
            return (
                <div className="rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-4 flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500/15">
                        <ShieldCheck className="text-emerald-500" size={26} />
                    </div>
                    <div>
                        <div className="text-lg font-extrabold tracking-tight text-emerald-600">Sin requisitoria</div>
                        <div className="text-sm text-muted-foreground">{result.matricula} no figura como requerida.</div>
                    </div>
                </div>
            );
        return (
            <div className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3">
                    <ShieldQuestion className="text-amber-500 shrink-0" size={26} />
                    <div className="text-sm font-semibold text-amber-600">Respuesta recibida — verificá el texto:</div>
                </div>
                {result.excerpt && <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{result.excerpt}</p>}
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-md gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-2xl [&>button]:hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header institucional */}
                <div className="relative bg-gradient-to-b from-[#0b3d91] to-[#0a337c] px-6 pb-5 pt-6 text-white">
                    <button
                        onClick={() => onOpenChange(false)}
                        className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                        aria-label="Cerrar"
                    >
                        <X size={18} />
                    </button>
                    <div className="mx-auto flex w-fit items-center justify-center rounded-xl bg-white px-4 py-2.5 shadow-md">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={MI_LOGO} alt="Ministerio del Interior" className="h-11 w-auto" />
                    </div>
                    <h2 className="mt-3 text-center text-lg font-bold tracking-tight">Matrículas requeridas</h2>
                    <p className="mt-0.5 text-center text-xs text-white/70">
                        Consulta oficial · el operador ingresa el verificador
                    </p>
                </div>

                {/* Cuerpo */}
                <div className="space-y-4 bg-background px-6 py-5">
                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Matrícula</label>
                        <Input
                            value={mat}
                            onChange={(e) => setMat(normPlate(e.target.value))}
                            className="mt-1 h-11 text-center text-xl font-bold uppercase tracking-[0.25em]"
                            placeholder="ABC1234"
                        />
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Verificador (Captcha)</label>
                        <div className="mt-1 flex items-center gap-2">
                            <Input
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
                                maxLength={6}
                                inputMode="numeric"
                                className="h-12 w-24 text-center text-xl font-mono tracking-[0.3em]"
                                placeholder="----"
                                autoFocus
                            />
                            <div className="flex h-12 flex-1 items-center justify-center rounded-lg border bg-[#f3efe0]">
                                {loading ? (
                                    <Loader2 className="animate-spin text-muted-foreground" size={22} />
                                ) : image ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={image} alt="captcha" className="h-10" />
                                ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                )}
                            </div>
                            <Button type="button" variant="outline" size="icon" className="h-12 w-11 shrink-0" onClick={reload} title="Recargar imagen" disabled={loading}>
                                <RotateCw size={16} className={loading ? "animate-spin" : ""} />
                            </Button>
                        </div>
                    </div>

                    {error && (
                        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>
                    )}

                    {badge()}

                    <div className="flex items-center justify-between pt-1">
                        <a
                            href={MIN_INTERIOR_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-[#0b3d91]"
                        >
                            <ExternalLink size={12} /> Sitio oficial
                        </a>
                        <div className="flex items-center gap-2">
                            {result && (
                                <Button type="button" variant="outline" onClick={startCaptcha}>Nueva consulta</Button>
                            )}
                            <Button
                                type="button"
                                onClick={consultar}
                                disabled={submitting || loading || !!result}
                                className="bg-[#0b3d91] hover:bg-[#0a337c]"
                            >
                                {submitting ? <Loader2 className="mr-1 animate-spin" size={16} /> : <Search className="mr-1" size={16} />}
                                Consultar
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
