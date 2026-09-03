"use client";

/** Constructor de manuales — /admin/manuales
 *  Editor de Markdown con vista previa, pegado de capturas con Ctrl+V, panel de imágenes
 *  faltantes, capturador automático y compilación a HTML/PDF.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    BookOpen, Save, Hammer, Camera, Download, FileText, Image as ImageIcon, Loader2, Check,
    AlertTriangle, Eye, Code2, Columns2, Trash2, RefreshCw, Clipboard, Plus, ExternalLink, X, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

interface Manual {
    id: string; titulo: string; subtitulo: string; para: string; color: string; prefijo: string; orden: number;
    grupo?: string; modo?: string;
    existe: boolean; bytes: number; capitulos: number;
    capturas: { total: number; listas: number };
    pdf: { url: string; kb: number; fecha: string } | null; html: string | null;
}
interface Img { alt: string; file: string; existe: boolean }

/* ── vista previa: el mismo dialecto que entiende el compilador ── */
function preview(md: string): string {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (t: string) => esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    const L = md.split("\n"); const out: string[] = []; let i = 0;
    while (i < L.length) {
        const l = L[i];
        let m = l.match(/^(#{1,4})\s+(.*)$/);
        if (m) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
        if (l.startsWith("» ")) { out.push(`<div class="ruta"><b>Cómo llegar</b> ${inline(l.slice(2))}</div>`); i++; continue; }
        m = l.match(/^!\[([^\]]*)\]\(img\/([^)]+)\)\s*$/);
        if (m) {
            i++; const marcas: any[] = [];
            while (i < L.length && /^\s*@\s*\d+\s*,\s*\d+\s+/.test(L[i])) {
                const k = L[i].match(/^\s*@\s*(\d+)\s*,\s*(\d+)\s+(.*)$/)!; marcas.push({ x: +k[1], y: +k[2], t: k[3] }); i++;
            }
            const pts = marcas.map((k, n) => `<span class="mk" style="left:${k.x}%;top:${k.y}%">${n + 1}</span>`).join("");
            const leg = marcas.length ? `<ol class="leg">${marcas.map((k) => `<li>${inline(k.t)}</li>`).join("")}</ol>` : "";
            out.push(`<figure><div class="lz"><img src="/manuales/img/${m[2]}" alt="">${pts}</div><figcaption>${inline(m[1])}</figcaption>${leg}</figure>`);
            continue;
        }
        if (l.startsWith("> ")) {
            const b: string[] = []; while (i < L.length && L[i].startsWith(">")) { b.push(L[i].replace(/^>\s?/, "")); i++; }
            const t = b.join(" "); const cls = /^⏱/.test(t) ? "tiempo" : /^⚠/.test(t) ? "alerta" : "nota";
            out.push(`<blockquote class="${cls}">${inline(t.replace(/^[⏱⚠]\s*/, ""))}</blockquote>`); continue;
        }
        if (l.includes("|") && (L[i + 1] || "").match(/^\s*\|?[\s:|-]+\|/)) {
            const h = l.split("|").filter((x) => x.trim()); i += 2; const rows: string[][] = [];
            while (i < L.length && L[i].includes("|")) { rows.push(L[i].split("|").filter((x, k, a) => !(k === 0 && !x.trim()) && !(k === a.length - 1 && !x.trim()))); i++; }
            out.push(`<table><thead><tr>${h.map((x) => `<th>${inline(x.trim())}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c.trim())}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
            continue;
        }
        if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
            const ord = /^\s*\d+\./.test(l); const it: string[] = [];
            while (i < L.length) {
                if (/^\s*[-*]\s+/.test(L[i]) || /^\s*\d+\.\s+/.test(L[i])) { it.push(L[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "")); i++; }
                else if (it.length && /^\s{2,}\S/.test(L[i])) { it[it.length - 1] += " " + L[i].trim(); i++; }
                else break;
            }
            out.push(`<${ord ? "ol" : "ul"}>${it.map((x) => `<li>${inline(x)}</li>`).join("")}</${ord ? "ol" : "ul"}>`); continue;
        }
        if (l.trim() === "---") { out.push("<hr>"); i++; continue; }
        if (!l.trim()) { i++; continue; }
        const b: string[] = [];
        while (i < L.length && L[i].trim() && !/^(#{1,4}\s|»\s|>\s|\s*[-*]\s|\s*\d+\.\s)/.test(L[i]) && !L[i].includes("|")) { b.push(L[i]); i++; }
        if (b.length) out.push(`<p>${inline(b.join(" "))}</p>`); else i++;
    }
    return out.join("\n");
}

export default function ManualesPage() {
    const [lista, setLista] = useState<Manual[]>([]);
    const [producto, setProducto] = useState<any>(null);
    const [sel, setSel] = useState<string | null>(null);
    const [md, setMd] = useState("");
    const [mdOrig, setMdOrig] = useState("");
    const [imgs, setImgs] = useState<Img[]>([]);
    const [vista, setVista] = useState<"split" | "code" | "preview">("split");
    const [cargando, setCargando] = useState(true);
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [consola, setConsola] = useState<string | null>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);

    const sucio = md !== mdOrig;
    const man = lista.find((m) => m.id === sel) || null;

    const cargarLista = useCallback(() => {
        setCargando(true);
        fetch("/api/manuals", { cache: "no-store" }).then((r) => r.json()).then((j) => {
            if (j.ok) { setLista(j.manuales); setProducto(j.producto); }
        }).finally(() => setCargando(false));
    }, []);
    useEffect(cargarLista, [cargarLista]);

    async function abrir(id: string) {
        if (sucio && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
        const j = await fetch(`/api/manuals?id=${id}`, { cache: "no-store" }).then((r) => r.json());
        if (!j.ok) { toast.error({ title: "No se pudo abrir" }); return; }
        setSel(id); setMd(j.md); setMdOrig(j.md); setImgs(j.imagenes || []);
    }

    async function guardar() {
        if (!sel) return;
        setOcupado("guardar");
        const j = await fetch("/api/manuals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sel, md }) }).then((r) => r.json());
        setOcupado(null);
        if (j.ok) { setMdOrig(md); toast.success({ title: "Guardado" }); cargarLista(); }
        else toast.error({ title: "No se pudo guardar", description: j.error });
    }

    async function compilar() {
        if (sucio) await guardar();
        setOcupado("build"); setConsola("Compilando…");
        const j = await fetch("/api/manuals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "build", id: sel }) }).then((r) => r.json());
        setOcupado(null); setConsola(j.salida || "");
        if (j.ok) { toast.success({ title: "Compilado", description: "PDF y HTML actualizados" }); cargarLista(); }
        else toast.error({ title: "Falló la compilación" });
    }

    async function capturar(all = false) {
        setOcupado("capture"); setConsola("Capturando pantallas… puede tardar varios minutos.");
        const j = await fetch("/api/manuals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "capture", only: man?.prefijo ? man.prefijo + "-" : undefined, all }) }).then((r) => r.json());
        setOcupado(null); setConsola(j.salida || "");
        if (j.ok) { toast.success({ title: "Capturas listas" }); if (sel) abrir(sel); cargarLista(); }
        else toast.error({ title: "Falló el capturador" });
    }

    /** Inserta texto en el cursor del editor */
    function insertar(txt: string) {
        const ta = taRef.current; if (!ta) { setMd(md + "\n" + txt); return; }
        const a = ta.selectionStart, b = ta.selectionEnd;
        const nuevo = md.slice(0, a) + txt + md.slice(b);
        setMd(nuevo);
        requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = a + txt.length; });
    }

    /** Ctrl+V con una imagen en el portapapeles → la sube y pega el marcador */
    const onPaste = useCallback(async (e: React.ClipboardEvent) => {
        const it = Array.from(e.clipboardData?.items || []).find((x) => x.type.startsWith("image/"));
        if (!it || !sel) return;
        e.preventDefault();
        const f = it.getAsFile(); if (!f) return;
        setOcupado("upload");
        const desc = window.prompt("¿Qué muestra esta captura? (será el epígrafe)", "") || "Captura";
        const fd = new FormData(); fd.append("id", sel); fd.append("file", f); fd.append("desc", desc);
        const j = await fetch("/api/manuals", { method: "POST", body: fd }).then((r) => r.json());
        setOcupado(null);
        if (j.ok) {
            insertar("\n" + j.markdown + "\n");
            setImgs((p) => [...p, { alt: desc, file: j.file, existe: true }]);
            toast.success({ title: `Imagen agregada (${j.kb} KB)`, description: j.file });
        } else toast.error({ title: "No se pudo subir", description: j.error });
    }, [sel, md]);

    const faltan = imgs.filter((x) => !x.existe);

    return (
        <div className="h-full flex flex-col bg-background text-foreground overflow-hidden">
            {/* ── Encabezado ── */}
            <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-sky-500/20 to-cyan-500/10 border border-sky-500/20"><BookOpen size={20} className="text-sky-400" /></div>
                    <div>
                        <h1 className="text-base font-bold">Manuales</h1>
                        <p className="text-[11px] text-muted-foreground">{producto ? `${producto.familia} · versión ${producto.version}` : "Constructor de documentación"}</p>
                    </div>
                </div>
                {sel && (
                    <div className="flex items-center gap-1.5">
                        <button onClick={() => capturar(false)} disabled={!!ocupado} className="h-9 px-3 rounded-lg border border-border text-[12px] font-bold flex items-center gap-1.5 hover:bg-accent disabled:opacity-50">
                            {ocupado === "capture" ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Capturar pantallas
                        </button>
                        <button onClick={compilar} disabled={!!ocupado} className="h-9 px-3 rounded-lg border border-border text-[12px] font-bold flex items-center gap-1.5 hover:bg-accent disabled:opacity-50">
                            {ocupado === "build" ? <Loader2 size={14} className="animate-spin" /> : <Hammer size={14} />} Compilar
                        </button>
                        <button onClick={guardar} disabled={!sucio || !!ocupado} className={cn("h-9 px-4 rounded-lg text-white text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-40", sucio ? "bg-emerald-600 hover:bg-emerald-500" : "bg-muted-foreground")}>
                            {ocupado === "guardar" ? <Loader2 size={14} className="animate-spin" /> : sucio ? <Save size={14} /> : <Check size={14} />} {sucio ? "Guardar" : "Guardado"}
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 flex">
                {/* ── Lista de manuales ── */}
                <aside className="w-[290px] shrink-0 border-r border-border overflow-y-auto custom-scrollbar p-3 space-y-2">
                    {cargando && <div className="flex items-center gap-2 text-xs text-muted-foreground p-3"><Loader2 size={14} className="animate-spin" /> Cargando…</div>}
                    {/* Un manual por rol dentro de cada modo del sistema: no se mezclan */}
                    {Object.entries([...lista].sort((a, b) => a.orden - b.orden)
                        .reduce<Record<string, Manual[]>>((acc, m) => {
                            const g = m.grupo || "Otros"; (acc[g] ||= []).push(m); return acc;
                        }, {})).map(([grupo, items]) => (
                            <div key={grupo} className="space-y-2 pb-1">
                                <div className="px-1 pt-2 text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{grupo}</div>
                                {items.map((m) => {
                                    const pct = m.capturas.total ? Math.round((m.capturas.listas / m.capturas.total) * 100) : 100;
                                    return (
                            <motion.button key={m.id} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={() => abrir(m.id)}
                                className={cn("w-full text-left rounded-xl border p-3 transition-colors", sel === m.id ? "border-sky-500/50 bg-sky-500/5" : "border-border hover:bg-accent")}>
                                <div className="flex items-start gap-2.5">
                                    <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: m.color }} />
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-[13px] leading-tight">{m.titulo}</div>
                                        <div className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">{m.subtitulo}</div>
                                        {m.existe ? (
                                            <>
                                                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                                                    <span>{m.capitulos} capítulos</span>
                                                    <span>·</span>
                                                    <span className={cn(pct < 100 && "text-amber-400 font-bold")}>{m.capturas.listas}/{m.capturas.total} capturas</span>
                                                </div>
                                                <div className="h-1 rounded-full bg-muted/50 mt-1.5 overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} />
                                                </div>
                                            </>
                                        ) : <div className="text-[10px] text-muted-foreground mt-2 italic">Sin escribir</div>}
                                    </div>
                                </div>
                                {m.pdf && (
                                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
                                        <a href={m.pdf.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                            className="text-[10.5px] font-bold text-sky-400 hover:underline flex items-center gap-1"><Download size={11} /> PDF · {m.pdf.kb} KB</a>
                                        {m.html && <a href={m.html} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                            className="text-[10.5px] text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto"><ExternalLink size={11} /> HTML</a>}
                                    </div>
                                )}
                                        </motion.button>
                                    );
                                })}
                            </div>
                        ))}
                    <button onClick={() => capturar(true)} disabled={!!ocupado}
                        className="w-full h-9 rounded-lg border border-dashed border-border text-[11.5px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center gap-1.5 disabled:opacity-50">
                        <RefreshCw size={13} /> Rehacer todas las capturas
                    </button>
                </aside>

                {/* ── Editor ── */}
                {!sel ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                        <BookOpen size={44} className="opacity-20" />
                        <p className="text-sm">Elegí un manual para editarlo.</p>
                        <p className="text-xs opacity-70">Podés pegar capturas con <b>Ctrl+V</b> directamente en el editor.</p>
                    </div>
                ) : (
                    <div className="flex-1 min-w-0 flex flex-col">
                        {/* barra del editor */}
                        <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0">
                            <span className="text-[12px] font-bold">{man?.titulo}</span>
                            <span className="text-[11px] text-muted-foreground">{(md.length / 1024).toFixed(1)} KB</span>
                            {sucio && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">sin guardar</span>}
                            <div className="ml-auto flex items-center gap-1 bg-background/60 p-0.5 rounded-lg border border-border/60">
                                {([["code", <Code2 size={14} key="c" />], ["split", <Columns2 size={14} key="s" />], ["preview", <Eye size={14} key="p" />]] as const).map(([k, ic]) => (
                                    <button key={k} onClick={() => setVista(k as any)} className={cn("h-7 w-8 rounded-md flex items-center justify-center", vista === k ? "bg-sky-500/20 text-sky-300" : "text-muted-foreground hover:text-foreground")}>{ic}</button>
                                ))}
                            </div>
                        </div>

                        {/* atajos de formato */}
                        <div className="px-4 py-1.5 border-b border-border/60 flex items-center gap-1.5 flex-wrap shrink-0 text-[11px]">
                            {[
                                { l: "Capítulo", t: "\n# Título del capítulo\n\n" },
                                { l: "Sección", t: "\n## Título de sección\n\n" },
                                { l: "Cómo llegar", t: "» Menú lateral → Pantalla\n\n" },
                                { l: "Aviso", t: "> Texto del aviso.\n\n" },
                                { l: "Cuidado", t: "> ⚠ Lo que hay que tener en cuenta.\n\n" },
                                { l: "Tiempo", t: "> ⏱ Esta acción demora entre X y Y segundos.\n\n" },
                                { l: "Tabla", t: "\n| Columna | Columna |\n|---|---|\n| dato | dato |\n\n" },
                                { l: "Marcador", t: "@ 50,50 Qué señala este número\n" },
                            ].map((b) => (
                                <button key={b.l} onClick={() => insertar(b.t)} className="px-2 h-6 rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent font-semibold">{b.l}</button>
                            ))}
                            <span className="ml-auto text-muted-foreground flex items-center gap-1"><Clipboard size={12} /> Ctrl+V pega una captura</span>
                        </div>

                        <div className="flex-1 min-h-0 flex">
                            {vista !== "preview" && (
                                <textarea ref={taRef} value={md} onChange={(e) => setMd(e.target.value)} onPaste={onPaste} spellCheck={false}
                                    className={cn("h-full p-4 bg-background font-mono text-[12.5px] leading-[1.65] resize-none focus:outline-none custom-scrollbar",
                                        vista === "split" ? "w-1/2 border-r border-border" : "w-full")}
                                    placeholder="# Primer capítulo&#10;&#10;» Menú lateral → Pantalla&#10;&#10;Escribí acá. Pegá capturas con Ctrl+V." />
                            )}
                            {vista !== "code" && (
                                <div className={cn("h-full overflow-y-auto custom-scrollbar p-6 manual-preview", vista === "split" ? "w-1/2" : "w-full")}
                                    dangerouslySetInnerHTML={{ __html: preview(md) }} />
                            )}
                        </div>

                        {/* pie: imágenes y consola */}
                        <div className="border-t border-border shrink-0 max-h-[190px] overflow-y-auto custom-scrollbar">
                            {faltan.length > 0 && (
                                <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20">
                                    <div className="flex items-center gap-2 text-[11.5px] font-bold text-amber-400 mb-1"><AlertTriangle size={13} /> Faltan {faltan.length} captura(s)</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {faltan.map((f) => <span key={f.file} className="text-[10.5px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono">{f.file}</span>)}
                                    </div>
                                    <p className="text-[10.5px] text-muted-foreground mt-1">Generalas con <b>Capturar pantallas</b>, o pegá la imagen con Ctrl+V sobre el marcador.</p>
                                </div>
                            )}
                            {imgs.filter((x) => x.existe).length > 0 && (
                                <div className="px-4 py-2">
                                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1"><ImageIcon size={12} /> Capturas del manual</div>
                                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                                        {imgs.filter((x) => x.existe).map((f) => (
                                            <button key={f.file} onClick={() => insertar(`\n![${f.alt}](img/${f.file})\n`)} title={`${f.file} — clic para insertar de nuevo`}
                                                className="shrink-0 w-24 rounded-md overflow-hidden border border-border hover:border-sky-500/60">
                                                <img src={`/manuales/img/${f.file}`} alt="" className="w-full aspect-video object-cover" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <AnimatePresence>
                                {consola && (
                                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-border">
                                        <div className="px-4 py-2 flex items-start gap-2">
                                            <pre className="flex-1 text-[10.5px] font-mono text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">{consola}</pre>
                                            <button onClick={() => setConsola(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>

            <style jsx global>{`
                .manual-preview h1{font-size:22px;font-weight:800;margin:18px 0 10px;padding-bottom:7px;border-bottom:2px solid var(--border)}
                .manual-preview h2{font-size:17px;font-weight:700;margin:18px 0 7px}
                .manual-preview h3{font-size:14.5px;font-weight:700;margin:14px 0 5px}
                .manual-preview p{margin:0 0 9px;font-size:13.5px;line-height:1.6}
                .manual-preview ul,.manual-preview ol{margin:0 0 10px;padding-left:20px;font-size:13.5px}
                .manual-preview li{margin:3px 0}
                .manual-preview table{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:12.5px}
                .manual-preview th{text-align:left;padding:6px 8px;border-bottom:2px solid var(--border);font-weight:700}
                .manual-preview td{padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:top}
                .manual-preview code{background:var(--muted);padding:1px 4px;border-radius:3px;font-size:12px}
                .manual-preview .ruta{background:var(--muted);border-left:3px solid var(--primary);padding:6px 10px;border-radius:0 6px 6px 0;font-size:12.5px;margin:0 0 12px}
                .manual-preview .ruta b{font-size:9px;text-transform:uppercase;letter-spacing:.1em;margin-right:6px;opacity:.7}
                .manual-preview blockquote{margin:0 0 12px;padding:9px 12px;border-radius:6px;font-size:12.5px;border-left:4px solid;background:var(--muted)}
                .manual-preview blockquote.tiempo{border-color:#10b981}
                .manual-preview blockquote.alerta{border-color:#f59e0b}
                .manual-preview blockquote.nota{border-color:#94a3b8}
                .manual-preview figure{margin:14px 0}
                .manual-preview .lz{position:relative;line-height:0}
                .manual-preview figure img{width:100%;border-radius:7px;border:1px solid var(--border)}
                .manual-preview figcaption{font-size:11px;opacity:.7;text-align:center;margin-top:5px}
                .manual-preview .mk{position:absolute;transform:translate(-50%,-50%);width:21px;height:21px;border-radius:50%;
                    background:#0ea5e9;color:#fff;font:800 11px/21px sans-serif;text-align:center;box-shadow:0 0 0 2px #fff}
                .manual-preview .leg{list-style:none;counter-reset:mk;padding:0;margin:7px 0 0;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:2px 14px}
                .manual-preview .leg li{counter-increment:mk;position:relative;padding-left:23px}
                .manual-preview .leg li::before{content:counter(mk);position:absolute;left:0;width:16px;height:16px;border-radius:50%;
                    background:#0ea5e9;color:#fff;font:800 9.5px/16px sans-serif;text-align:center}
                .manual-preview hr{border:0;border-top:1px solid var(--border);margin:16px 0}
            `}</style>
        </div>
    );
}
