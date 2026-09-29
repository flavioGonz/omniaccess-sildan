"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCw, ShieldAlert, ShieldCheck, ShieldQuestion, Search, ExternalLink } from "lucide-react";

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
                <div className="rounded-xl border-2 border-red-500 bg-red-500/10 p-4 flex items-center gap-3">
                    <ShieldAlert className="text-red-500 shrink-0" size={32} />
                    <div>
                        <div className="text-lg font-bold text-red-500">MATRÍCULA REQUERIDA</div>
                        <div className="text-sm text-muted-foreground">{result.matricula} figura con requerimiento en el Ministerio del Interior. Actuá según protocolo.</div>
                    </div>
                </div>
            );
        if (result.status === "NO")
            return (
                <div className="rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-4 flex items-center gap-3">
                    <ShieldCheck className="text-emerald-500 shrink-0" size={32} />
                    <div>
                        <div className="text-lg font-bold text-emerald-600">Sin requisitoria</div>
                        <div className="text-sm text-muted-foreground">{result.matricula} no figura como requerida.</div>
                    </div>
                </div>
            );
        return (
            <div className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4">
                <div className="flex items-center gap-3">
                    <ShieldQuestion className="text-amber-500 shrink-0" size={32} />
                    <div className="text-sm font-semibold text-amber-600">Respuesta recibida — verificá el texto:</div>
                </div>
                {result.excerpt && <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{result.excerpt}</p>}
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert size={18} className="text-indigo-500" /> Matrículas requeridas — Min. Interior
                    </DialogTitle>
                    <DialogDescription>
                        Consulta oficial. El guardia escribe el código del captcha; el sistema envía la consulta y muestra el resultado.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matrícula</label>
                        <Input
                            value={mat}
                            onChange={(e) => setMat(normPlate(e.target.value))}
                            className="mt-1 font-bold uppercase tracking-widest"
                            placeholder="ABC1234"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verificador (Captcha)</label>
                        <div className="mt-1 flex items-center gap-2">
                            <Input
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
                                maxLength={6}
                                className="w-28 text-center text-lg tracking-[0.3em] font-mono"
                                placeholder="----"
                                autoFocus
                            />
                            <div className="flex h-11 min-w-[120px] items-center justify-center rounded-md border bg-white px-2">
                                {loading ? (
                                    <Loader2 className="animate-spin text-muted-foreground" size={20} />
                                ) : image ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={image} alt="captcha" className="h-9" />
                                ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                )}
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={reload} title="Recargar imagen" disabled={loading}>
                                <RotateCw size={16} />
                            </Button>
                        </div>
                    </div>

                    {error && <p className="text-sm text-red-500">{error}</p>}

                    {badge()}

                    <div className="flex items-center justify-between pt-1">
                        <a
                            href={MIN_INTERIOR_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-indigo-500"
                        >
                            <ExternalLink size={12} /> Abrir sitio oficial
                        </a>
                        <div className="flex items-center gap-2">
                            {result && (
                                <Button type="button" variant="outline" onClick={startCaptcha}>Nueva consulta</Button>
                            )}
                            <Button type="button" onClick={consultar} disabled={submitting || loading || !!result}>
                                {submitting ? <Loader2 className="animate-spin mr-1" size={16} /> : <Search className="mr-1" size={16} />}
                                Consultar
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
