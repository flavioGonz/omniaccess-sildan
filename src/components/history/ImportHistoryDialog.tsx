"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileJson, Loader2, CheckCircle2, AlertTriangle, Database } from "lucide-react";
import { sileo as toast } from "sileo";

interface Props {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onDone?: () => void;
}

export function ImportHistoryDialog({ open, onOpenChange, onDone }: Props) {
    const [file, setFile] = useState<File | null>(null);
    const [parsed, setParsed] = useState<any[] | null>(null);
    const [parseErr, setParseErr] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

    const reset = () => { setFile(null); setParsed(null); setParseErr(null); setResult(null); };

    const onFile = async (f: File | null) => {
        reset();
        if (!f) return;
        setFile(f);
        try {
            const txt = await f.text();
            const json = JSON.parse(txt);
            const arr: any[] = Array.isArray(json) ? json : (json?.events || []);
            if (!Array.isArray(arr) || arr.length === 0) { setParseErr("El archivo no contiene un arreglo de eventos."); return; }
            setParsed(arr);
        } catch (e: any) {
            setParseErr("JSON inválido: " + (e?.message || "no se pudo leer"));
        }
    };

    const doImport = async () => {
        if (!parsed) return;
        setImporting(true);
        try {
            const r = await fetch("/api/history/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: parsed }) });
            const d = await r.json();
            if (!r.ok) { toast.error({ title: "Error al importar", description: d?.error || "" }); }
            else { setResult({ inserted: d.inserted || 0, skipped: d.skipped || 0 }); toast.success({ title: `Importados ${d.inserted}`, description: `${d.skipped} duplicados omitidos` }); onDone?.(); }
        } catch (e: any) {
            toast.error({ title: "Error de red", description: e?.message || "" });
        } finally { setImporting(false); }
    };

    const preview = (parsed || []).slice(0, 5);

    return (
        <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Database size={18} className="text-blue-400" /> Importar registros</DialogTitle>
                    <DialogDescription>Importá un JSON exportado desde otra instancia. Los eventos se insertan con deduplicación por ID; las terminales/usuarios de origen no se vinculan (se conserva el nombre de la terminal).</DialogDescription>
                </DialogHeader>

                {!result ? (
                    <div className="space-y-4">
                        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl p-6 cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors">
                            <FileJson size={28} className="text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">{file ? file.name : "Elegí un archivo .json"}</span>
                            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
                        </label>

                        {parseErr && <div className="flex items-center gap-2 text-red-400 text-xs"><AlertTriangle size={14} /> {parseErr}</div>}

                        {parsed && (
                            <div className="rounded-lg border border-border overflow-hidden">
                                <div className="px-3 py-2 bg-muted/40 text-xs font-semibold flex items-center justify-between">
                                    <span>{parsed.length.toLocaleString()} eventos detectados</span>
                                    <span className="text-muted-foreground">Vista previa</span>
                                </div>
                                <div className="max-h-40 overflow-y-auto divide-y divide-border/50 text-[11px]">
                                    {preview.map((e, i) => (
                                        <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                                            <span className="font-mono text-muted-foreground">{e.timestamp ? new Date(e.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?"}</span>
                                            <span className="font-mono font-bold">{e.plateDetected || e.plateNumber || "s/l"}</span>
                                            <span className={e.decision === "GRANT" ? "text-emerald-400" : "text-red-400"}>{e.decision === "GRANT" ? "OK" : "DENY"}</span>
                                            <span className="ml-auto text-muted-foreground truncate max-w-[140px]">{e.deviceName || e.location || ""}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3 py-6">
                        <CheckCircle2 size={40} className="text-emerald-400" />
                        <p className="text-sm font-bold">{result.inserted.toLocaleString()} registros importados</p>
                        <p className="text-xs text-muted-foreground">{result.skipped.toLocaleString()} duplicados omitidos</p>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>{result ? "Cerrar" : "Cancelar"}</Button>
                    {!result && (
                        <Button onClick={doImport} disabled={!parsed || importing} className="bg-blue-600 hover:bg-blue-500 min-w-[130px]">
                            {importing ? <Loader2 size={16} className="animate-spin" /> : <><Upload size={15} className="mr-1.5" /> Importar</>}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
