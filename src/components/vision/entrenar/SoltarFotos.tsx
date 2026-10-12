"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Check, ImagePlus, Link2, Loader2, Upload, Video, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CURVA_SUAVE } from "@/components/ui/entrada";

/**
 * Agregar fotos al conjunto: soltarlas, elegirlas, o sacarle una foto a una cámara.
 *
 * Antes era un botón «Subir fotos» que mostraba «3/40» y nada más: con fotos de 4 MB por una VPN
 * no se sabía si estaba subiendo o colgado. Ahora cada foto tiene su miniatura y su porcentaje de
 * subida REAL — XMLHttpRequest, porque fetch no informa el avance de lo que se manda — y arriba el
 * total en bytes.
 *
 * Van de a una a propósito: el servidor las recomprime, y en paralelo se pisan con el resto de la
 * app (lo mismo que antes; ver subir() en la página).
 *
 * También por LINK: pegar uno o varios en el campo, Ctrl+V en la página, o arrastrar una imagen
 * desde otra pestaña del navegador (eso llega como link, no como archivo: antes no hacía nada).
 * La imagen la trae el servidor (lib/ingesta-link.ts), sin bajarla y volver a subirla.
 */
type Subida = { id: string; nombre: string; url: string; bytes: number; enviados: number; estado: "espera" | "subiendo" | "lista" | "mal"; error?: string; link?: boolean };

/** Los links http(s) de un texto pegado o soltado (uno por renglón, o varios separados por espacios). */
export function linksDe(texto: string): string[] {
    return [...new Set((texto.match(/https?:\/\/[^\s"'<>]+/gi) || []).map((x) => x.replace(/[),.;]+$/, "")))];
}
/** El src de las <img> de un HTML soltado (al arrastrar una imagen de otra página llega así). */
function imagenesDeHtml(html: string): string[] {
    return [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]).filter((x) => /^https?:/i.test(x));
}
/** Cuántos links se aceptan por tanda: más es pegar una lista por error. */
const LINKS_MAX = 40;

function traerUno(link: string): Promise<void> {
    return fetch("/api/vision/objetos/fotos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: link }) })
        .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `El servidor respondió ${r.status}`); });
}

/** Cuánto queda a la vista la tanda terminada antes de plegarse: lo justo para ver que llegaron. */
const PLEGAR_MS = 3500;
/** Lo que acepta el servidor (cualquier image/*, que recomprime): lo demás se avisa en vez de mandarse para que falle. */
const esFoto = (f: File) => f.type.startsWith("image/");

function subirUna(f: File, alAvanzar: (enviados: number) => void): Promise<void> {
    return new Promise((ok, mal) => {
        const x = new XMLHttpRequest();
        x.open("POST", "/api/vision/objetos/fotos");
        x.setRequestHeader("content-type", f.type);
        x.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar(e.loaded); };
        x.onload = () => {
            if (x.status >= 200 && x.status < 300) return ok();
            let m = `El servidor respondió ${x.status}`;
            try { m = JSON.parse(x.responseText)?.error || m; } catch { /* la respuesta no era JSON: queda el código */ }
            mal(new Error(m));
        };
        x.onerror = () => mal(new Error("Se cortó la conexión"));
        x.send(f);
    });
}

export function SoltarFotos({ camaras, alAgregar }: { camaras: { id: string; name: string }[]; alAgregar: () => void }) {
    const [lista, setLista] = useState<Subida[]>([]);
    const [encima, setEncima] = useState(false);
    const [enPagina, setEnPagina] = useState(false);
    const [camara, setCamara] = useState("");
    const [sacando, setSacando] = useState(false);
    const archivos = useRef<HTMLInputElement>(null);
    const [texto, setTexto] = useState("");
    const ocupado = lista.some((s) => s.estado === "espera" || s.estado === "subiendo");

    async function subir(entrada: FileList | File[] | null) {
        const todas = [...(entrada || [])];
        const fs = todas.filter(esFoto);
        if (todas.length > fs.length) toast.error({ title: `${todas.length - fs.length} archivo${todas.length - fs.length === 1 ? "" : "s"} no son fotos`, description: "Se saltearon." });
        if (!fs.length) return;
        const nuevas: Subida[] = fs.map((f, i) => ({ id: `${Date.now()}-${i}`, nombre: f.name, url: URL.createObjectURL(f), bytes: f.size, enviados: 0, estado: "espera" }));
        setLista((l) => [...l.filter((s) => s.estado === "espera" || s.estado === "subiendo"), ...nuevas]);
        let mal = 0;
        for (const [k, f] of fs.entries()) {
            const id = nuevas[k].id;
            const poner = (c: Partial<Subida>) => setLista((l) => l.map((s) => (s.id === id ? { ...s, ...c } : s)));
            poner({ estado: "subiendo" });
            try { await subirUna(f, (enviados) => poner({ enviados })); poner({ estado: "lista", enviados: f.size }); }
            catch (e: any) { mal++; poner({ estado: "mal", error: e?.message }); }
        }
        if (mal) toast.error({ title: `${mal} de ${fs.length} no se pudieron subir`, description: "Quedan marcadas en rojo: pasá el mouse para ver por qué." });
        else toast.success({ title: `${fs.length} foto${fs.length === 1 ? "" : "s"} agregada${fs.length === 1 ? "" : "s"}`, description: "Están en «Sin dibujar»." });
        alAgregar();
        // Las que llegaron se pliegan; las que fallaron quedan para que se vea cuáles fueron.
        setTimeout(() => setLista((l) => { l.filter((s) => s.estado === "lista").forEach((s) => URL.revokeObjectURL(s.url)); return l.filter((s) => s.estado !== "lista"); }), PLEGAR_MS);
    }

    async function traer(links: string[]) {
        const ls = links.slice(0, LINKS_MAX);
        if (links.length > LINKS_MAX) toast.error({ title: `Se traen los primeros ${LINKS_MAX} links`, description: `Eran ${links.length}.` });
        if (!ls.length) { toast.error({ title: "No hay ningún link", description: "Tiene que empezar con http:// o https://." }); return; }
        const nuevas: Subida[] = ls.map((l, i) => {
            let nombre = l; try { nombre = new URL(l).hostname.replace(/^www\./, ""); } catch { /* queda el link */ }
            return { id: `${Date.now()}-l${i}`, nombre, url: l, bytes: 0, enviados: 0, estado: "espera", link: true };
        });
        setLista((l) => [...l.filter((s) => s.estado === "espera" || s.estado === "subiendo"), ...nuevas]);
        let mal = 0, ultimoError = "";
        for (const s of nuevas) {
            const poner = (c: Partial<Subida>) => setLista((l) => l.map((x) => (x.id === s.id ? { ...x, ...c } : x)));
            poner({ estado: "subiendo" });
            try { await traerUno(s.url); poner({ estado: "lista" }); }
            catch (e: any) { mal++; ultimoError = e?.message || ""; poner({ estado: "mal", error: e?.message }); }
        }
        if (mal) toast.error({ title: `${mal} de ${ls.length} no se pudieron traer`, description: mal === 1 ? ultimoError : "Quedan marcadas en rojo: pasá el mouse para ver por qué." });
        else toast.success({ title: `${ls.length} foto${ls.length === 1 ? "" : "s"} traída${ls.length === 1 ? "" : "s"}`, description: "Están en «Sin dibujar»." });
        alAgregar();
        setTimeout(() => setLista((l) => l.filter((x) => x.estado !== "lista")), PLEGAR_MS);
    }

    async function sacarFoto() {
        if (!camara) return;
        setSacando(true);
        try {
            const r = await fetch(`/api/vision/objetos/fotos?camara=${encodeURIComponent(camara)}`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: "Foto agregada", description: "Está en «Sin dibujar»." });
            alAgregar();
        } catch (e: any) { toast.error({ title: "No se sacó la foto", description: e?.message }); }
        finally { setSacando(false); }
    }

    // Los manejadores de la ventana se registran una vez; llaman a la versión de este render.
    const acciones = useRef({ subir, traer });
    acciones.current = { subir, traer };

    // Arrastrar fotos (o una imagen de otra pestaña) sobre CUALQUIER parte de la página muestra
    // dónde soltarlas. Y Ctrl+V fuera de un campo: una imagen copiada se sube, un link se trae.
    useEffect(() => {
        let n = 0;
        const sirve = (e: DragEvent) => { const t = e.dataTransfer?.types || []; return t.includes("Files") || t.includes("text/uri-list"); };
        const entra = (e: DragEvent) => { if (sirve(e)) { n++; setEnPagina(true); } };
        const sale = (e: DragEvent) => { if (sirve(e)) { n = Math.max(0, n - 1); if (!n) setEnPagina(false); } };
        const sobre = (e: DragEvent) => { if (sirve(e)) e.preventDefault(); };
        const suelta = (e: DragEvent) => {
            if (!sirve(e)) return;
            e.preventDefault(); n = 0; setEnPagina(false); setEncima(false);
            const dt = e.dataTransfer!;
            const fotos = [...dt.files].filter(esFoto);
            if (fotos.length) return void acciones.current.subir(fotos);
            // Una imagen arrastrada desde otra página: el <img> del HTML es la imagen; el uri-list
            // a veces es el link de la página que la contiene.
            const links = imagenesDeHtml(dt.getData("text/html"));
            acciones.current.traer(links.length ? links : linksDe(dt.getData("text/uri-list") || dt.getData("text/plain")));
        };
        const pega = (e: ClipboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            const fotos = [...(e.clipboardData?.files || [])].filter(esFoto);
            if (fotos.length) { e.preventDefault(); return void acciones.current.subir(fotos); }
            const links = linksDe(e.clipboardData?.getData("text/plain") || "");
            if (links.length) { e.preventDefault(); acciones.current.traer(links); }
        };
        window.addEventListener("dragenter", entra); window.addEventListener("dragleave", sale);
        window.addEventListener("dragover", sobre); window.addEventListener("drop", suelta);
        window.addEventListener("paste", pega);
        return () => {
            window.removeEventListener("dragenter", entra); window.removeEventListener("dragleave", sale);
            window.removeEventListener("dragover", sobre); window.removeEventListener("drop", suelta);
            window.removeEventListener("paste", pega);
        };
    }, []);

    const total = lista.reduce((n, s) => n + s.bytes, 0);
    const enviados = lista.reduce((n, s) => n + (s.estado === "mal" ? s.bytes : s.enviados), 0);
    // Con links no hay bytes que contar (los baja el servidor): el avance va por cantidad.
    const pct = lista.some((x) => x.link) ? Math.round((lista.filter((x) => x.estado === "lista" || x.estado === "mal").length / lista.length) * 100) : total ? Math.round((enviados / total) * 100) : 0;
    const hechas = lista.filter((s) => s.estado === "lista").length;

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-2">
                {/* La zona de soltar. Es un botón: con teclado también abre el selector. */}
                <motion.button type="button" onClick={() => archivos.current?.click()}
                    onDragEnter={() => setEncima(true)} onDragLeave={() => setEncima(false)}
                    animate={{ scale: encima ? 1.01 : 1 }} transition={{ duration: 0.2, ease: CURVA_SUAVE }}
                    className={cn("group relative overflow-hidden rounded-[14px] border-2 border-dashed px-6 py-7 text-left transition-colors",
                        encima ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border bg-card hover:border-[color-mix(in_oklab,var(--accion)_55%,var(--border))] hover:bg-accent/40")}>
                    <div className="flex items-center gap-4">
                        <motion.span animate={encima ? { y: -4, rotate: -6 } : { y: 0, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
                            className={cn("grid h-14 w-14 place-items-center rounded-[14px] shrink-0 transition-colors", encima ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground group-hover:text-foreground")}>
                            {encima ? <Upload size={24} /> : <ImagePlus size={24} />}
                        </motion.span>
                        <span className="min-w-0">
                            <span className="block text-[15px] font-bold">{encima ? "Soltalas para agregarlas" : "Soltá las fotos acá"}</span>
                            <span className="block text-[12.5px] text-muted-foreground leading-snug mt-0.5">
                                o <span className="text-[var(--accion-texto,var(--accion))] font-semibold">elegilas de la computadora</span>. Van de a una, cada una con su avance.
                            </span>
                        </span>
                    </div>
                </motion.button>
                <input ref={archivos} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />

                {/* Sacarle una foto a una cámara: lo mejor para entrenar (ver «Fotos de las cámaras o subidas»). */}
                <div className="rounded-[14px] border border-border bg-card p-3 flex flex-col gap-2">
                    <div className="text-[12.5px] font-bold inline-flex items-center gap-1.5"><Camera size={14} /> De una cámara, ahora</div>
                    <label className={cn("relative flex items-center h-9 rounded-lg pl-2.5 pr-2 gap-1.5 text-[12.5px] font-semibold", camara ? "bg-muted" : "bg-muted/60 text-muted-foreground")}>
                        <Video size={14} className="shrink-0" />
                        <select value={camara} onChange={(e) => setCamara(e.target.value)} aria-label="Cámara" className="appearance-none bg-transparent outline-none pr-4 w-full min-w-0 [&>option]:text-foreground [&>option]:bg-background">
                            <option value="">Elegí una cámara</option>
                            {camaras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <span className="pointer-events-none absolute right-2 text-[9px] opacity-70">▼</span>
                    </label>
                    <Button onClick={sacarFoto} disabled={!camara || sacando}>{sacando ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Sacar foto ahora</Button>
                    <p className="text-[11px] text-muted-foreground leading-snug">El cuadro de este momento en máxima resolución. Volvé a la mañana, a la tarde y de noche.</p>
                </div>
            </div>

            {/* Por link: lo pega la persona y lo trae el servidor. */}
            <form onSubmit={(e) => { e.preventDefault(); const ls = linksDe(texto); if (ls.length) { setTexto(""); traer(ls); } else toast.error({ title: "Eso no es un link", description: "Tiene que empezar con http:// o https://." }); }}
                className="flex items-center gap-2 rounded-[14px] border border-border bg-card pl-3 pr-1.5 py-1.5">
                <Link2 size={16} className="text-muted-foreground shrink-0" />
                <Input value={texto} onChange={(e) => setTexto(e.target.value)}
                    onPaste={(e) => { const ls = linksDe(e.clipboardData.getData("text/plain")); if (ls.length > 1) { e.preventDefault(); traer(ls); } }}
                    placeholder="Pegá el link de una imagen (o de la página que la tiene). Varios a la vez también."
                    className="h-9 flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1" />
                <Button type="submit" variant="outline" disabled={!texto.trim()}><ImagePlus size={14} /> Traer</Button>
            </form>
            <p className="text-[11px] text-muted-foreground -mt-1 px-1">También: arrastrá una imagen desde otra pestaña, o copiala y apretá <kbd className="px-1 rounded bg-muted">Ctrl</kbd>+<kbd className="px-1 rounded bg-muted">V</kbd> en esta página.</p>

            {/* La tanda que sube: total arriba, cada foto con su avance. */}
            <AnimatePresence initial={false}>
                {lista.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.26, ease: CURVA_SUAVE }}
                        className="overflow-hidden">
                        <div className="rounded-[14px] border border-border bg-card p-3 space-y-2.5">
                            <div className="flex items-center gap-3 text-[12.5px]">
                                <span className="font-bold tabular-nums">{ocupado ? `Subiendo ${hechas + 1} de ${lista.length}` : `${hechas} de ${lista.length} subidas`}</span>
                                <span className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <motion.span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accion)]" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.3, ease: CURVA_SUAVE }} />
                                </span>
                                <span className="tabular-nums text-muted-foreground w-[92px] text-right">{pct} %{total ? ` · ${(total / 1e6).toFixed(1)} MB` : ""}</span>
                            </div>
                            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-10 gap-2">
                                <AnimatePresence initial={false}>
                                    {lista.map((s) => <Miniatura key={s.id} s={s} />)}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Arrastrando sobre la página: dónde va a parar lo que se suelte. */}
            <AnimatePresence>
                {enPagina && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                        className="fixed inset-0 z-[60] grid place-items-center bg-background/70 backdrop-blur-[2px] pointer-events-none">
                        <motion.div initial={{ scale: 0.94, y: 8 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}
                            className="rounded-[14px] border-2 border-dashed border-[var(--accion)] bg-card px-10 py-8 text-center [box-shadow:var(--sombra-flotante)]">
                            <Upload size={30} className="mx-auto text-[var(--accion)]" />
                            <div className="mt-2 text-[16px] font-bold">Soltá para agregar al conjunto</div>
                            <div className="text-[12.5px] text-muted-foreground">Van a «Sin dibujar»</div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/** Una foto de la tanda: miniatura con un anillo que se completa con lo enviado. */
function Miniatura({ s }: { s: Subida }) {
    const frac = s.bytes ? s.enviados / s.bytes : 0;
    const R = 15, L = 2 * Math.PI * R;
    return (
        <motion.div layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.22, ease: CURVA_SUAVE }}
            title={s.estado === "mal" ? `${s.nombre}: ${s.error}` : s.nombre}
            className={cn("relative aspect-square rounded-[8px] overflow-hidden bg-black", s.estado === "mal" && "ring-2 ring-[var(--mal)]")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.url} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }}
                className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", s.estado === "lista" ? "opacity-100" : "opacity-55")} />
            {/* Un link a una página no se previsualiza: queda el sitio escrito. */}
            {s.link && <span className="absolute inset-x-1 bottom-1 truncate text-[9px] text-white/80 text-center">{s.nombre}</span>}
            <span className="absolute inset-0 grid place-items-center">
                {s.estado === "lista" ? (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 16 }} className="grid h-7 w-7 place-items-center rounded-full pleno-bien"><Check size={15} strokeWidth={3} /></motion.span>
                ) : s.estado === "mal" ? (
                    <span className="grid h-7 w-7 place-items-center rounded-full pleno-mal"><X size={15} strokeWidth={3} /></span>
                ) : s.link ? (
                    // Lo baja el servidor: no hay bytes que mostrar, sólo que está en eso.
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-black/45">{s.estado === "espera" ? <span className="text-[10px] font-bold text-white">…</span> : <Loader2 size={18} className="animate-spin text-white" />}</span>
                ) : (
                    <span className="relative grid place-items-center">
                        <svg width={38} height={38} viewBox="0 0 38 38" className="-rotate-90">
                            <circle cx={19} cy={19} r={R} fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.25)" strokeWidth={3} />
                            <motion.circle cx={19} cy={19} r={R} fill="none" stroke="var(--accion-en-oscuro)" strokeWidth={3} strokeLinecap="round"
                                strokeDasharray={L} initial={false} animate={{ strokeDashoffset: L * (1 - frac) }} transition={{ duration: 0.25 }} />
                        </svg>
                        <span className="absolute text-[10px] font-bold text-white tabular-nums">{s.estado === "espera" ? "…" : `${Math.round(frac * 100)}`}</span>
                    </span>
                )}
            </span>
        </motion.div>
    );
}
