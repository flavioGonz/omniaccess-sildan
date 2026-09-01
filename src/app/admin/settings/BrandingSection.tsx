"use client";

import { useEffect, useState, useRef } from "react";
import { Palette, Upload, Save, Image as ImageIcon, Loader2, Eye, Smartphone, X, MessageSquareQuote, Copy, ExternalLink, FileText } from "lucide-react";
import { getAppBranding, saveAppBranding, uploadBrandingFile, savePwaIcon, getReportBranding } from "@/app/actions/settings";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import SplashDesigner from "./SplashDesigner";

const PWA_MODES = [
    { k: "filas", l: "Filas / Aforo", c: "#7c3aed", path: "/pwa/filas" },
    { k: "lpr", l: "LPR / Matrículas", c: "#3b82f6", path: "/pwa/lpr" },
    { k: "face", l: "Facial", c: "#22c55e", path: "/pwa/face" },
];

const TABS = [
    { k: "identidad", l: "Identidad", icon: Palette },
    { k: "testimonios", l: "Testimonios", icon: MessageSquareQuote },
    { k: "reportes", l: "Reportes", icon: FileText },
    { k: "pwa", l: "PWA e Iconos", icon: Smartphone },
    { k: "splash", l: "PWA SplashScreen", icon: Smartphone },
];

export default function BrandingSection({ activeTab }: { activeTab?: string } = {}) {
    const [form, setForm] = useState<any>({ name: "", subtitle: "", logoUrl: "", loginBgUrl: "", primary: "", testimonials: [] });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState<"logo" | "bg" | null>(null);
    const [tab, setTab] = useState("identidad");
    useEffect(() => { if (activeTab) setTab(activeTab); }, [activeTab]);
    const logoRef = useRef<HTMLInputElement>(null);
    const bgRef = useRef<HTMLInputElement>(null);
    const pwaRef = useRef<HTMLInputElement>(null);
    const [uploadingPwa, setUploadingPwa] = useState<string | null>(null);
    const [pwaTs, setPwaTs] = useState<Record<string, number>>({ filas: Date.now(), lpr: Date.now(), face: Date.now() });
    const pwaModeRef = useRef<string>("filas");
    const [origin, setOrigin] = useState("");
    const [report, setReport] = useState<any>({ company: "OmniAccess", tagline: "Reporte de aforo \u00b7 Control de Filas", footer: "OmniAccess", contact: "", primary: "#7c3aed", accent: "#7c3aed", tableHeader: "#7c3aed", tableStripe: "#f7f4ff", logoUrl: "", preparedBy: "", authorizedBy: "", coverUrl: "" });
    const [uploadingRep, setUploadingRep] = useState(false);
    const [savingRep, setSavingRep] = useState(false);
    const repLogoRef = useRef<HTMLInputElement>(null);
    const repCoverRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setOrigin(window.location.origin); (async () => { try { setForm(await getAppBranding() as any); } catch (e) { console.error(e); } try { setReport(await getReportBranding() as any); } catch (e) { console.error(e); } finally { setLoading(false); } })(); }, []);

    const upload = async (file: File, which: "logo" | "bg") => {
        setUploading(which);
        try {
            const fd = new FormData(); fd.append("file", file);
            const res = await uploadBrandingFile(fd);
            if (res.success && res.url) { setForm((f: any) => ({ ...f, [which === "logo" ? "logoUrl" : "loginBgUrl"]: res.url })); toast.success("Imagen subida"); }
            else toast.error(res.message || "Error al subir");
        } catch { toast.error("Error al subir"); } finally { setUploading(null); }
    };

    const uploadPwa = async (file: File, mode: string) => {
        setUploadingPwa(mode);
        try {
            const fd = new FormData(); fd.append("file", file);
            const res = await savePwaIcon(fd, mode);
            if (res.success) { setPwaTs(t => ({ ...t, [mode]: Date.now() })); toast.success("Icono PWA actualizado"); }
            else toast.error(res.message || "Error");
        } catch { toast.error("Error al subir"); } finally { setUploadingPwa(null); }
    };

    const save = async () => {
        setSaving(true);
        try {
            const res = await saveAppBranding({
                APP_BRAND_NAME: form.name, APP_BRAND_SUBTITLE: form.subtitle,
                APP_BRAND_LOGO_URL: form.logoUrl, APP_BRAND_LOGIN_BG_URL: form.loginBgUrl,
                APP_BRAND_PRIMARY: form.primary,
                APP_BRAND_TESTIMONIALS: JSON.stringify(form.testimonials || []),
            });
            if (res.success) toast.success("Branding guardado · refrescá el login para verlo");
            else toast.error(res.message || "Error al guardar");
        } catch { toast.error("Error al guardar"); } finally { setSaving(false); }
    };

    const uploadReportLogo = async (file: File) => {
        setUploadingRep(true);
        try {
            const fd = new FormData(); fd.append("file", file);
            const res = await uploadBrandingFile(fd);
            if (res.success && res.url) { setReport((r: any) => ({ ...r, logoUrl: res.url })); toast.success("Logo del reporte subido"); }
            else toast.error(res.message || "Error al subir");
        } catch { toast.error("Error al subir"); } finally { setUploadingRep(false); }
    };

    const uploadReportCover = async (file: File) => {
        setUploadingRep(true);
        try {
            const fd = new FormData(); fd.append("file", file);
            const res = await uploadBrandingFile(fd);
            if (res.success && res.url) { setReport((r: any) => ({ ...r, coverUrl: res.url })); toast.success("Portada subida"); }
            else toast.error(res.message || "Error al subir");
        } catch { toast.error("Error al subir"); } finally { setUploadingRep(false); }
    };

    const saveReport = async () => {
        setSavingRep(true);
        try {
            const res = await saveAppBranding({
                REPORT_COMPANY: report.company || "", REPORT_TAGLINE: report.tagline || "",
                REPORT_FOOTER: report.footer || "", REPORT_CONTACT: report.contact || "",
                REPORT_PRIMARY: report.primary || "", REPORT_ACCENT: report.accent || "",
                REPORT_TABLE_HEADER: report.tableHeader || "", REPORT_TABLE_STRIPE: report.tableStripe || "",
                REPORT_LOGO_URL: report.logoUrl || "",
                REPORT_PREPARED_BY: report.preparedBy || "", REPORT_AUTHORIZED_BY: report.authorizedBy || "",
                REPORT_COVER_URL: report.coverUrl || "",
            });
            if (res.success) toast.success("Branding de reportes guardado \u00b7 se aplica al pr\u00f3ximo PDF");
            else toast.error(res.message || "Error al guardar");
        } catch { toast.error("Error al guardar"); } finally { setSavingRep(false); }
    };

    const copyUrl = (url: string) => { navigator.clipboard?.writeText(url).then(() => toast.success("URL copiada")).catch(() => {}); };

    const SaveBtn = () => (
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-bold transition">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar branding
        </button>
    );

    if (loading) return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Cargando…</div>;

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-900/30"><Palette size={20} className="text-white" /></div>
                <div>
                    <h2 className="text-lg font-bold text-foreground">Branding</h2>
                    <p className="text-xs text-muted-foreground">Identidad visual del login y de las PWA</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-muted/60 border border-border">
                {TABS.map(t => {
                    const Icon = t.icon; const active = tab === t.k;
                    return (
                        <button key={t.k} onClick={() => setTab(t.k)} className={cn("inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition", active ? "bg-violet-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            <Icon size={14} /> {t.l}
                        </button>
                    );
                })}
            </div>

            <div key={tab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
                {tab === "identidad" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div className="space-y-4">
                            <label className="block text-sm font-medium text-foreground/80">Nombre de la app
                                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="OmniAccess" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                            <label className="block text-sm font-medium text-foreground/80">Subtítulo / eslogan
                                <input value={form.subtitle} onChange={e => setForm({ ...form, subtitle: e.target.value })} placeholder="Plataforma unificada de control de acceso" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                            <label className="block text-sm font-medium text-foreground/80">Color principal (opcional, hex)
                                <div className="mt-1.5 flex items-center gap-2">
                                    <input value={form.primary} onChange={e => setForm({ ...form, primary: e.target.value })} placeholder="#7c3aed" className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500 font-mono" />
                                    {form.primary && <span className="w-9 h-9 rounded-lg border border-border shrink-0" style={{ background: form.primary }} />}
                                </div>
                            </label>
                            <div>
                                <span className="block text-sm font-medium text-foreground/80 mb-1.5">Logo</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-16 h-16 rounded-xl border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">{form.logoUrl ? <img src={form.logoUrl} alt="logo" className="w-full h-full object-contain" /> : <ImageIcon size={20} className="text-muted-foreground" />}</div>
                                    <input ref={logoRef} type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, "logo"); }} />
                                    <button onClick={() => logoRef.current?.click()} disabled={uploading === "logo"} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-sm font-semibold text-foreground transition">{uploading === "logo" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Subir logo</button>
                                </div>
                            </div>
                            <div>
                                <span className="block text-sm font-medium text-foreground/80 mb-1.5">Foto de fondo del login</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-24 h-16 rounded-xl border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">{form.loginBgUrl ? <img src={form.loginBgUrl} alt="bg" className="w-full h-full object-cover" /> : <ImageIcon size={20} className="text-muted-foreground" />}</div>
                                    <input ref={bgRef} type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, "bg"); }} />
                                    <button onClick={() => bgRef.current?.click()} disabled={uploading === "bg"} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-sm font-semibold text-foreground transition">{uploading === "bg" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Subir fondo</button>
                                </div>
                            </div>
                            <SaveBtn />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5"><Eye size={13} /> Vista previa del login</div>
                            <div className="relative rounded-xl border border-border overflow-hidden aspect-[4/3] bg-zinc-900">
                                {form.loginBgUrl && <img src={form.loginBgUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                                <div className="relative h-full flex flex-col items-center justify-center text-center p-6 gap-3">
                                    {form.logoUrl ? <img src={form.logoUrl} alt="logo" className="h-14 object-contain drop-shadow-lg" /> : <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg" style={{ background: form.primary || "#7c3aed" }}>{(form.name || "O").charAt(0)}</div>}
                                    <div className="text-white font-bold text-2xl drop-shadow">{form.name || "OmniAccess"}</div>
                                    <div className="text-white/80 text-sm max-w-[80%]">{form.subtitle}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {tab === "testimonios" && (
                    <div className="max-w-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground/80"><MessageSquareQuote size={15} className="text-violet-400" /> Testimonios del login (panel derecho)</span>
                            <button type="button" onClick={() => setForm((f: any) => ({ ...f, testimonials: [...(f.testimonials || []), { quote: "", name: "", role: "" }] }))} className="text-xs font-semibold text-violet-400 hover:text-violet-300">+ Agregar</button>
                        </div>
                        <div className="space-y-3">
                            {((form.testimonials || []).length === 0) && <p className="text-xs text-muted-foreground">Sin testimonios. El login mostrará el predeterminado.</p>}
                            {(form.testimonials || []).map((t: any, i: number) => (
                                <div key={i} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 relative">
                                    <button type="button" onClick={() => setForm((f: any) => ({ ...f, testimonials: f.testimonials.filter((_: any, j: number) => j !== i) }))} className="absolute top-2 right-2 text-muted-foreground hover:text-red-400"><X size={14} /></button>
                                    <textarea value={t.quote} onChange={(e) => setForm((f: any) => ({ ...f, testimonials: f.testimonials.map((x: any, j: number) => j === i ? { ...x, quote: e.target.value } : x) }))} placeholder="Frase del testimonio…" rows={2} className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500 resize-none" />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input value={t.name} onChange={(e) => setForm((f: any) => ({ ...f, testimonials: f.testimonials.map((x: any, j: number) => j === i ? { ...x, name: e.target.value } : x) }))} placeholder="Nombre" className="bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                                        <input value={t.role} onChange={(e) => setForm((f: any) => ({ ...f, testimonials: f.testimonials.map((x: any, j: number) => j === i ? { ...x, role: e.target.value } : x) }))} placeholder="Cargo" className="bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <SaveBtn />
                    </div>
                )}

                {tab === "splash" && <SplashDesigner />}
                {tab === "pwa" && (
                    <div className="space-y-3">
                        <input ref={pwaRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPwa(f, pwaModeRef.current); (e.currentTarget as HTMLInputElement).value = ""; }} />
                        <p className="text-xs text-muted-foreground">Cada modo de OmniAccess tiene su propia PWA instalable, con su icono y URL. Abrí la URL en el celular y "Agregar a pantalla de inicio".</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {PWA_MODES.map(m => {
                                const url = (origin || "") + m.path;
                                return (
                                    <div key={m.k} className="rounded-xl border border-border bg-card p-4 flex flex-col items-center gap-3">
                                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: m.c }}>{m.l}</span>
                                        <div className="w-16 h-16 rounded-2xl border overflow-hidden flex items-center justify-center bg-muted/40" style={{ borderColor: `${m.c}55` }}>
                                            <img src={`/iconos/${m.k}-512.png?t=${pwaTs[m.k]}`} alt="" className="w-full h-full object-cover" />
                                        </div>
                                        <button onClick={() => { pwaModeRef.current = m.k; pwaRef.current?.click(); }} disabled={uploadingPwa === m.k} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-accent border border-border text-foreground text-[11px] font-semibold transition disabled:opacity-60">
                                            {uploadingPwa === m.k ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Cambiar icono
                                        </button>
                                        <div className="w-full flex items-center gap-1 rounded-lg bg-muted/50 border border-border px-2 py-1.5">
                                            <span className="flex-1 text-[10px] font-mono text-muted-foreground truncate" title={url}>{url}</span>
                                            <button onClick={() => copyUrl(url)} title="Copiar URL" className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition"><Copy size={12} /></button>
                                            <a href={m.path} target="_blank" rel="noreferrer" title="Abrir" className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition"><ExternalLink size={12} /></a>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-[10px] text-muted-foreground">Los iconos se generan en 192/512 px (incl. maskable). Las notificaciones push usan el icono del modo activo. Reinstalá la PWA para ver el icono de inicio nuevo.</p>
                    </div>
                )}
                {tab === "reportes" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div className="space-y-4">
                            <p className="text-xs text-muted-foreground">Diseñá el PDF de reportes (Filas / Aforo): logo, colores, textos de encabezado y pie, y estilo de tabla. Se aplica al próximo reporte exportado o enviado.</p>
                            <label className="block text-sm font-medium text-foreground/80">Empresa / encabezado
                                <input value={report.company} onChange={e => setReport({ ...report, company: e.target.value })} placeholder="OmniAccess" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                            <label className="block text-sm font-medium text-foreground/80">Bajada del encabezado
                                <input value={report.tagline} onChange={e => setReport({ ...report, tagline: e.target.value })} placeholder="Reporte de aforo · Control de Filas" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block text-sm font-medium text-foreground/80">Pie de página
                                    <input value={report.footer} onChange={e => setReport({ ...report, footer: e.target.value })} placeholder="OmniAccess" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                                </label>
                                <label className="block text-sm font-medium text-foreground/80">Contacto (opcional)
                                    <input value={report.contact} onChange={e => setReport({ ...report, contact: e.target.value })} placeholder="tel · email · web" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                                </label>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="block text-sm font-medium text-foreground/80">Realizado por (portada)
                                    <input value={report.preparedBy} onChange={e => setReport({ ...report, preparedBy: e.target.value })} placeholder="Nombre, cargo" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                                </label>
                                <label className="block text-sm font-medium text-foreground/80">Autorizado por (portada)
                                    <input value={report.authorizedBy} onChange={e => setReport({ ...report, authorizedBy: e.target.value })} placeholder="Nombre, cargo" className="mt-1.5 w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:border-violet-500" />
                                </label>
                            </div>
                            <div>
                                <span className="block text-sm font-medium text-foreground/80 mb-1.5">Logo del reporte</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-16 h-16 rounded-xl border border-border bg-white flex items-center justify-center overflow-hidden shrink-0">{report.logoUrl ? <img src={report.logoUrl} alt="logo" className="w-full h-full object-contain p-1" /> : <ImageIcon size={20} className="text-muted-foreground" />}</div>
                                    <input ref={repLogoRef} type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" className="hidden" onChange={e => { const fl = e.target.files?.[0]; if (fl) uploadReportLogo(fl); (e.currentTarget as HTMLInputElement).value = ""; }} />
                                    <button onClick={() => repLogoRef.current?.click()} disabled={uploadingRep} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-sm font-semibold text-foreground transition">{uploadingRep ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Subir logo</button>
                                    {report.logoUrl && <button onClick={() => setReport({ ...report, logoUrl: "" })} className="text-xs text-muted-foreground hover:text-red-400">Quitar</button>}
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1">Si lo dejás vacío, usa el logo del branding general.</p>
                            </div>
                            <div>
                                <span className="block text-sm font-medium text-foreground/80 mb-1.5">Portada (imagen de fondo, opcional)</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-16 h-20 rounded-lg border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">{report.coverUrl ? <img src={report.coverUrl} alt="portada" className="w-full h-full object-cover" /> : <ImageIcon size={18} className="text-muted-foreground" />}</div>
                                    <input ref={repCoverRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={e => { const fl = e.target.files?.[0]; if (fl) uploadReportCover(fl); (e.currentTarget as HTMLInputElement).value = ""; }} />
                                    <div className="flex flex-col gap-1">
                                        <button onClick={() => repCoverRef.current?.click()} disabled={uploadingRep} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-sm font-semibold text-foreground transition w-fit">{uploadingRep ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Subir portada A4</button>
                                        {report.coverUrl && <button onClick={() => setReport({ ...report, coverUrl: "" })} className="text-xs text-muted-foreground hover:text-red-400 w-fit">Quitar (usar diseño por defecto)</button>}
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1">Si subís una hoja A4 (vertical), se usa como fondo de la portada y el texto se escribe encima.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {([
                                    { k: "primary", l: "Encabezado" },
                                    { k: "accent", l: "Acento / gráficas" },
                                    { k: "tableHeader", l: "Cabecera de tabla" },
                                    { k: "tableStripe", l: "Filas alternas" },
                                ] as const).map(c => (
                                    <label key={c.k} className="block text-xs font-medium text-foreground/80">{c.l}
                                        <div className="mt-1.5 flex items-center gap-2">
                                            <input value={report[c.k]} onChange={e => setReport({ ...report, [c.k]: e.target.value })} placeholder="#7c3aed" className="flex-1 min-w-0 bg-muted/50 border border-border rounded-lg px-2 py-2 text-xs text-foreground outline-none focus:border-violet-500 font-mono" />
                                            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(report[c.k] || "") ? report[c.k] : "#7c3aed"} onChange={e => setReport({ ...report, [c.k]: e.target.value })} className="w-8 h-8 rounded-md border border-border shrink-0 bg-transparent cursor-pointer p-0" />
                                        </div>
                                    </label>
                                ))}
                            </div>
                            <button onClick={saveReport} disabled={savingRep} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-bold transition">
                                {savingRep ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar branding de reportes
                            </button>
                        </div>

                        {/* Live preview */}
                        <div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5"><Eye size={13} /> Vista previa del reporte (PDF A4)</div>
                            <div className="rounded-xl border border-border overflow-hidden bg-white shadow-sm text-[#1c1c1e]" style={{ aspectRatio: "210/297" }}>
                                <div className="h-full flex flex-col">
                                    {/* header band */}
                                    <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: report.primary || "#7c3aed" }}>
                                        <div className="w-9 h-9 rounded-md bg-white flex items-center justify-center overflow-hidden shrink-0">{report.logoUrl ? <img src={report.logoUrl} alt="" className="w-full h-full object-contain p-0.5" /> : <span className="text-base font-bold" style={{ color: report.primary || "#7c3aed" }}>{(report.company || "O").charAt(0)}</span>}</div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-white font-bold text-sm leading-tight truncate">{report.company || "OmniAccess"}</div>
                                            <div className="text-white/80 text-[9px] truncate">{report.tagline || "Reporte de aforo · Control de Filas"}</div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-white/90 text-[8px]">31/05/2026 16:00</div>
                                            {report.contact && <div className="text-white/70 text-[7px] truncate max-w-[90px]">{report.contact}</div>}
                                        </div>
                                    </div>
                                    {/* body */}
                                    <div className="flex-1 px-3 py-2.5 overflow-hidden">
                                        <div className="font-bold text-[11px]">Reporte diario · Aforo</div>
                                        <div className="text-[8px] text-gray-500 mb-2">Resumen por hora — 31 may 2026</div>
                                        <div className="grid grid-cols-4 gap-1 mb-2.5">
                                            {[{ l: "REGISTROS", v: "24", c: "#6366f1" }, { l: "MÁXIMO", v: "57", c: "#ef4444" }, { l: "PROMEDIO", v: "31", c: "#10b981" }, { l: "TOTAL", v: "742", c: report.accent || "#7c3aed" }].map((k, i) => (
                                                <div key={i} className="rounded-md bg-gray-50 border-l-2 px-1.5 py-1" style={{ borderColor: k.c }}>
                                                    <div className="font-bold text-[11px]" style={{ color: k.c }}>{k.v}</div>
                                                    <div className="text-[6px] text-gray-400 font-semibold">{k.l}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-[6px] font-bold text-gray-500 mb-1">AFORO POR HORA</div>
                                        <div className="flex items-end gap-[2px] h-10 mb-2.5">
                                            {[30, 45, 60, 80, 55, 70, 90, 65, 50, 75, 40, 85, 58, 72].map((h, i) => (
                                                <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: report.accent || "#7c3aed" }} />
                                            ))}
                                        </div>
                                        <div className="rounded-md overflow-hidden border border-gray-200">
                                            <div className="grid grid-cols-3 text-white text-[7px] font-bold text-center" style={{ background: report.tableHeader || "#7c3aed" }}>
                                                <div className="py-1">HORA</div><div className="py-1">AFORO</div><div className="py-1">PICO</div>
                                            </div>
                                            {[["08:00", "12", "18"], ["09:00", "24", "31"], ["10:00", "40", "57"], ["11:00", "33", "44"], ["12:00", "51", "57"]].map((row, i) => (
                                                <div key={i} className="grid grid-cols-3 text-[7px] text-center text-gray-700" style={{ background: i % 2 === 1 ? (report.tableStripe || "#f7f4ff") : "#ffffff" }}>
                                                    {row.map((cell, j) => <div key={j} className="py-[3px]">{cell}</div>)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {/* footer */}
                                    <div className="px-3 py-1.5 border-t border-gray-200 flex items-center justify-between text-[7px] text-gray-400">
                                        <span className="truncate">{report.footer || report.company || "OmniAccess"}</span>
                                        <span>Página 1 de 1</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
