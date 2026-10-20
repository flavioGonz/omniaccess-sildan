"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import {
    ShieldAlert, Footprints, Ban, ScanLine, UserCheck, Siren, Server, Bell, Camera, Clock, Send,
    Save, RotateCcw, RefreshCw, HelpCircle, Image as ImageIcon, Filter, CheckCircle2, XCircle, MinusCircle,
    Search, Loader2, Layers, ShieldCheck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import { getReglasTelegram, guardarReglasTelegram, getEnviosTelegram, probarCategoriaTelegram } from "@/app/actions/telegram-reglas";

/**
 * Qué se envía al grupo de Telegram. Cada aviso que produce OmniAccess pasa por la pasarela del
 * bot, que lo clasifica en una de estas categorías y lo envía o lo filtra según estas reglas.
 * Todas las decisiones quedan en el historial de abajo, con el motivo.
 */
const TT = "tt-telegram-reglas";

type Cat = {
    k: string; nombre: string; icon: any; color: string; grupo: "LPR" | "Intrusión" | "Sistema";
    desc: string; ejemplo: string; camaras?: "LPR_CAMERA" | "CAMERA"; horario?: boolean; foto?: boolean;
};
const CATS: Cat[] = [
    { k: "vigilancia", nombre: "Lista de vigilancia", icon: ShieldAlert, color: "#ef4444", grupo: "LPR", camaras: "LPR_CAMERA", horario: true, foto: true,
        desc: "Matrículas en lista negra, en búsqueda o VIP marcadas para avisar.",
        ejemplo: "LISTA NEGRA · ABC1234\nENTRADA · Portería 1\nTitular: Juan Pérez\n[foto] [Clip grabado] [En vivo] [Historial]" },
    { k: "merodeo", nombre: "Merodeo", icon: Footprints, color: "#f59e0b", grupo: "LPR", camaras: "LPR_CAMERA", horario: true, foto: true,
        desc: "Un mismo vehículo que pasa varias veces en pocos minutos.",
        ejemplo: "MERODEO · ABC1234 · 4 pasadas en 15 min\nSALIDA · Portería 2\n[foto] [Clip grabado] [En vivo]" },
    { k: "denegado", nombre: "Accesos denegados", icon: Ban, color: "#f97316", grupo: "LPR", camaras: "LPR_CAMERA", horario: true, foto: true,
        desc: "Matrícula leída que no está habilitada (visitas no registradas, vencidas, etc.). Suele ser mucho volumen.",
        ejemplo: "ACCESO DENEGADO\nENTRADA · Portería 1\nMatrícula: SBC4521\nResultado: denegado" },
    { k: "no_leida", nombre: "Matrícula no leída", icon: ScanLine, color: "#a855f7", grupo: "LPR", camaras: "LPR_CAMERA", horario: true, foto: true,
        desc: "La cámara detectó un vehículo pero no pudo leer la matrícula.",
        ejemplo: "MATRÍCULA NO LEÍDA\nENTRADA · Portería 1\nMatrícula: no leída\n[foto] [Clip grabado]" },
    { k: "invitados", nombre: "Invitados", icon: UserCheck, color: "#22c55e", grupo: "LPR", camaras: "LPR_CAMERA", horario: true, foto: true,
        desc: "Ingreso o salida de un invitado con matrícula registrada por un residente.",
        ejemplo: "INVITADO · María Gómez · Lote 52\nENTRADA · Portería 1\nMatrícula: AAB1020" },
    { k: "intrusion", nombre: "Intrusión", icon: Siren, color: "#e11d48", grupo: "Intrusión", camaras: "CAMERA", horario: true, foto: true,
        desc: "Cruce de línea, intrusión o entrada a zona de las cámaras perimetrales. Se puede filtrar por tipo, objetivo, cámara, armado y ráfagas.",
        ejemplo: "INTRUSIÓN · Cruce de línea\nCámara: Perímetro Norte 3\nObjetivo: Persona\n+6 detecciones más en esta cámara\n[foto] [Clip grabado] [En vivo] [Confirmar] [Falsa alarma]" },
    { k: "equipos", nombre: "Estado de equipos", icon: Server, color: "#64748b", grupo: "Sistema",
        desc: "Cámaras o NVR que dejan de responder, memoria alta, hora desfasada y su normalización.",
        ejemplo: "ALERTA · Cámara Portería 2\nNo responde hace 3 min\n\nNORMALIZADO · Cámara Portería 2\nVolvió a responder" },
    { k: "reglas", nombre: "Reglas de alerta", icon: Bell, color: "#0ea5e9", grupo: "Sistema",
        desc: "Avisos de las reglas configuradas en la pestaña Reglas (despachos).",
        ejemplo: "Alerta de aforo\nFila · Aforo\nValor 12 (umbral 10)" },
];
const TIPOS = [
    { v: "LINECROSS", l: "Cruce de línea", tip: "Alguien o algo cruzó una línea virtual dibujada en la cámara." },
    { v: "INTRUSION", l: "Intrusión en zona", tip: "Permaneció dentro de una zona el tiempo configurado en la cámara." },
    { v: "REGION_ENTER", l: "Entrada a zona", tip: "Entró a una zona (sin esperar permanencia)." },
    { v: "REGION_EXIT", l: "Salida de zona", tip: "Salió de una zona. Normalmente no hace falta avisarlo." },
];
const OBJETIVOS = [
    { v: "human", l: "Persona", tip: "La cámara (AcuSense) clasificó el objetivo como persona." },
    { v: "vehicle", l: "Vehículo", tip: "Clasificado como vehículo." },
    { v: "otro", l: "Sin clasificar", tip: "La cámara no informó la clase (cámaras sin AcuSense, NVR Dahua). Ejemplo: animales, sombras, ramas." },
];
const DEC: Record<string, { l: string; c: string; Ic: any }> = {
    ENVIADO: { l: "Enviado", c: "chip-bien", Ic: CheckCircle2 },
    FILTRADO: { l: "Filtrado", c: "chip-neutro", Ic: MinusCircle },
    ERROR: { l: "Error", c: "chip-mal", Ic: XCircle },
};
const nombreCat = (k: string) => CATS.find((c) => c.k === k)?.nombre || k;
const hora = (s: string) => new Date(s).toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Ayuda({ texto }: { texto: string }) {
    return <span data-tooltip-id={TT} data-tooltip-content={texto} className="inline-flex text-muted-foreground hover:text-foreground cursor-help"><HelpCircle size={14} /></span>;
}
function Chip({ activo, onClick, children, tip }: { activo: boolean; onClick: () => void; children: React.ReactNode; tip?: string }) {
    return (
        <button type="button" onClick={onClick} data-tooltip-id={tip ? TT : undefined} data-tooltip-content={tip}
            className={cn("px-2.5 py-1 rounded-lg border text-[12px] font-semibold transition", activo ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60")}>
            {children}
        </button>
    );
}

export default function TelegramReglas() {
    const [datos, setDatos] = useState<any>(null);
    const [reglas, setReglas] = useState<any>(null);
    const [original, setOriginal] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [probando, setProbando] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<string | null>("intrusion");
    const [envios, setEnvios] = useState<any[]>([]);
    const [cargandoEnvios, setCargandoEnvios] = useState(false);
    const [fCat, setFCat] = useState(""); const [fDec, setFDec] = useState("");
    const [buscarCam, setBuscarCam] = useState("");

    const cargar = useCallback(async () => {
        try {
            const d = await getReglasTelegram();
            setDatos(d); setReglas(d.reglas); setOriginal(JSON.stringify(d.reglas));
        } catch (e: any) { toast.error(e?.message || "No se pudieron leer las reglas"); }
    }, []);
    const cargarEnvios = useCallback(async () => {
        setCargandoEnvios(true);
        try { setEnvios(await getEnviosTelegram({ categoria: fCat || undefined, decision: fDec || undefined, limite: 200 })); }
        catch (e: any) { toast.error(e?.message || "No se pudo leer el historial"); }
        finally { setCargandoEnvios(false); }
    }, [fCat, fDec]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { cargarEnvios(); }, [cargarEnvios]);

    const sucio = reglas && JSON.stringify(reglas) !== original;
    const cat = (k: string) => (reglas?.categorias?.[k]) || { activo: false };
    const set = (k: string, cambio: any) => setReglas((r: any) => ({ ...r, categorias: { ...r.categorias, [k]: { ...(r.categorias[k] || {}), ...cambio } } }));
    const alternar = (k: string, campo: string, v: string) => {
        const lista: string[] = Array.isArray(cat(k)[campo]) ? cat(k)[campo] : [];
        set(k, { [campo]: lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v] });
    };

    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarReglasTelegram(reglas);
            setOriginal(JSON.stringify(reglas));
            if (r.botAvisado) toast.success("Reglas guardadas. El bot ya las está aplicando.");
            else toast.warning("Reglas guardadas. El bot no respondió: las tomará en menos de 30 s cuando vuelva.");
            cargarEnvios();
        } catch (e: any) { toast.error(e?.message || "No se pudo guardar"); }
        finally { setGuardando(false); }
    };
    const probar = async (k: string) => {
        setProbando(k);
        try {
            const r = await probarCategoriaTelegram(k);
            if (r.ok) toast.success(`Prueba de "${nombreCat(k)}" enviada al grupo`); else toast.error(r.motivo || "No se pudo enviar la prueba");
            setTimeout(cargarEnvios, 2500);
        } catch (e: any) { toast.error(e?.message || "No se pudo enviar la prueba"); }
        finally { setProbando(null); }
    };

    const resumenTotal = useMemo(() => {
        const t = { ENVIADO: 0, FILTRADO: 0, ERROR: 0 };
        for (const v of Object.values<any>(datos?.resumen || {})) { t.ENVIADO += v.ENVIADO; t.FILTRADO += v.FILTRADO; t.ERROR += v.ERROR; }
        return t;
    }, [datos]);

    if (!reglas) return (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-muted/50 animate-pulse" />)}</div>
    );

    const activas = CATS.filter((c) => cat(c.k).activo).length;

    return (
        <div className="space-y-5 max-w-5xl">
            <Tooltip id={TT} place="top" className="!max-w-[320px] !text-[12px] !rounded-lg !z-[9999] !whitespace-pre-line" />

            {/* Cabecera */}
            <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3 min-w-[240px] flex-1">
                    <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-sky-500/10 text-sky-500"><Send size={18} /></div>
                    <div>
                        <div className="font-bold flex items-center gap-2">Qué se envía a Telegram
                            <Ayuda texto={"Todo aviso pasa por el bot, que lo clasifica en una categoría y decide según estas reglas.\nLo filtrado no se pierde: queda en el historial con el motivo."} />
                        </div>
                        <div className="text-[12px] text-muted-foreground">{activas} de {CATS.length} categorías encendidas{!datos?.configurado && " · el bot no tiene token o grupo configurado (pestaña Canales)"}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                    <span className="text-muted-foreground">Últimas 24 h</span>
                    <span className="px-2 py-1 rounded-md border chip-bien font-semibold tabular-nums" data-tooltip-id={TT} data-tooltip-content="Avisos que llegaron al grupo">{resumenTotal.ENVIADO} enviados</span>
                    <span className="px-2 py-1 rounded-md border chip-neutro font-semibold tabular-nums" data-tooltip-id={TT} data-tooltip-content="Avisos que las reglas no dejaron pasar">{resumenTotal.FILTRADO} filtrados</span>
                    {resumenTotal.ERROR > 0 && <span className="px-2 py-1 rounded-md border chip-mal font-semibold tabular-nums">{resumenTotal.ERROR} con error</span>}
                </div>
            </div>

            {/* Categorías */}
            {(["LPR", "Intrusión", "Sistema"] as const).map((g) => (
                <div key={g} className="space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Layers size={12} /> {g}</div>
                    {CATS.filter((c) => c.grupo === g).map((c) => {
                        const r = cat(c.k); const Icon = c.icon; const abierto = abierta === c.k;
                        const res = datos?.resumen?.[c.k] || { ENVIADO: 0, FILTRADO: 0, ERROR: 0 };
                        const listaCams = (datos?.camaras || []).filter((d: any) => !c.camaras || d.deviceType === c.camaras);
                        const camsSel: string[] = Array.isArray(r.camaras) ? r.camaras : [];
                        const tieneFiltros = !!(c.camaras || c.horario);
                        return (
                            <div key={c.k} className={cn("rounded-xl border bg-card transition-colors", r.activo ? "border-border" : "border-border/60")} style={{ boxShadow: r.activo ? `inset 3px 0 0 ${c.color}` : undefined }}>
                                <div className="p-3.5 flex items-center gap-3">
                                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition", !r.activo && "grayscale opacity-50")} style={{ background: `${c.color}1a`, color: c.color }}><Icon size={17} /></div>
                                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => tieneFiltros && setAbierta(abierto ? null : c.k)}>
                                        <div className="font-semibold text-[14px] flex items-center gap-2">{c.nombre}
                                            <span data-tooltip-id={TT} data-tooltip-content={`Ejemplo del mensaje:\n\n${c.ejemplo}`} onClick={(e) => e.stopPropagation()} className="inline-flex text-muted-foreground hover:text-foreground cursor-help"><HelpCircle size={14} /></span>
                                            {camsSel.length > 0 && <span className="px-1.5 py-0.5 rounded border chip-info text-[10px] font-bold">{camsSel.length} cámaras</span>}
                                            {r.horario?.activo && <span className="px-1.5 py-0.5 rounded border chip-aviso text-[10px] font-bold">{r.horario.desde}–{r.horario.hasta}</span>}
                                        </div>
                                        <div className="text-[12px] text-muted-foreground truncate">{c.desc}</div>
                                    </button>
                                    <div className="hidden md:flex items-center gap-1.5 text-[11px] tabular-nums" data-tooltip-id={TT} data-tooltip-content="Enviados / filtrados en las últimas 24 h">
                                        <span className="tono-bien font-bold">{res.ENVIADO}</span><span className="text-muted-foreground">/</span><span className="text-muted-foreground">{res.FILTRADO}</span>
                                        {res.ERROR > 0 && <span className="tono-mal font-bold ml-1">{res.ERROR} err</span>}
                                    </div>
                                    {c.foto && (
                                        <button type="button" onClick={() => set(c.k, { foto: r.foto === false })} disabled={!r.activo}
                                            data-tooltip-id={TT} data-tooltip-content={r.foto === false ? "Solo texto. Clic para enviar con la foto del evento." : "Sale con la foto del evento (con la marca de agua). Clic para mandar solo texto."}
                                            className={cn("h-8 w-8 rounded-lg border flex items-center justify-center transition disabled:opacity-40", r.foto === false ? "border-border text-muted-foreground" : "border-primary/40 bg-primary/10 text-foreground")}>
                                            <ImageIcon size={14} />
                                        </button>
                                    )}
                                    <button type="button" onClick={() => probar(c.k)} disabled={probando === c.k}
                                        data-tooltip-id={TT} data-tooltip-content="Manda al grupo un aviso de prueba con el último caso real de esta categoría, sin aplicar filtros."
                                        className="h-8 px-2.5 rounded-lg border border-border text-[12px] font-semibold flex items-center gap-1.5 hover:bg-muted/60 disabled:opacity-50">
                                        {probando === c.k ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Probar
                                    </button>
                                    {tieneFiltros && (
                                        <button type="button" onClick={() => setAbierta(abierto ? null : c.k)} data-tooltip-id={TT} data-tooltip-content="Filtros de esta categoría"
                                            className={cn("h-8 w-8 rounded-lg border flex items-center justify-center transition", abierto ? "bg-muted border-border" : "border-border text-muted-foreground hover:text-foreground")}>
                                            <Filter size={14} />
                                        </button>
                                    )}
                                    <Switch checked={!!r.activo} onCheckedChange={(v) => set(c.k, { activo: v })} />
                                </div>

                                {abierto && tieneFiltros && (
                                    <div className={cn("border-t border-border p-4 grid gap-4 md:grid-cols-2 animate-in fade-in slide-in-from-top-1 duration-200", !r.activo && "opacity-60")}>
                                        {c.k === "intrusion" && (<>
                                            <div className="space-y-2">
                                                <div className="text-[12px] font-semibold flex items-center gap-1.5">Tipos de evento <Ayuda texto="Solo se avisan los tipos marcados. Ejemplo: dejar Cruce de línea e Intrusión y sacar Entrada a zona si duplica avisos." /></div>
                                                <div className="flex flex-wrap gap-1.5">{TIPOS.map((t) => <Chip key={t.v} tip={t.tip} activo={(r.tipos || []).includes(t.v)} onClick={() => alternar("intrusion", "tipos", t.v)}>{t.l}</Chip>)}</div>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="text-[12px] font-semibold flex items-center gap-1.5">Objetivo <Ayuda texto="Clase que informó la cámara. Ejemplo: solo Persona para no recibir avisos por autos que pasan por la calle." /></div>
                                                <div className="flex flex-wrap gap-1.5">{OBJETIVOS.map((o) => <Chip key={o.v} tip={o.tip} activo={(r.objetivos || []).includes(o.v)} onClick={() => alternar("intrusion", "objetivos", o.v)}>{o.l}</Chip>)}</div>
                                            </div>
                                            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                                                <div>
                                                    <div className="text-[12px] font-semibold flex items-center gap-1.5"><ShieldCheck size={13} /> Solo cámaras armadas <Ayuda texto={"Respeta el horario de armado de cada regla en la cámara.\nEjemplo: si la línea del perímetro se arma de 20:00 a 07:00, los cruces de las 15:00 no se avisan.\nSi no se pudo leer el horario de la cámara, se avisa igual."} /></div>
                                                    <div className="text-[11px] text-muted-foreground">Usa el horario de armado leído de la cámara</div>
                                                </div>
                                                <Switch checked={!!r.soloArmadas} onCheckedChange={(v) => set("intrusion", { soloArmadas: v })} />
                                            </div>
                                            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                                                <div>
                                                    <div className="text-[12px] font-semibold flex items-center gap-1.5"><Clock size={13} /> Antirráfaga <Ayuda texto={"Después de avisar de una cámara, las detecciones siguientes de esa misma cámara durante estos minutos no se mandan: se cuentan y se informan en el próximo aviso (+N detecciones).\nEjemplo: 5 min. 0 = avisar todas."} /></div>
                                                    <div className="text-[11px] text-muted-foreground">Minutos de silencio por cámara</div>
                                                </div>
                                                <input type="number" min={0} max={120} value={r.antirrafagaMin ?? 0} onChange={(e) => set("intrusion", { antirrafagaMin: Number(e.target.value) })}
                                                    className="w-20 h-8 rounded-lg border border-border bg-background px-2 text-[13px] tabular-nums text-right" />
                                            </div>
                                        </>)}

                                        {c.horario && (
                                            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                                                <div>
                                                    <div className="text-[12px] font-semibold flex items-center gap-1.5"><Clock size={13} /> Solo en este horario <Ayuda texto={"Hora de Montevideo. Puede cruzar la medianoche.\nEjemplo: 22:00 a 06:00 avisa solo de noche."} /></div>
                                                    <div className="flex items-center gap-1.5 mt-1.5">
                                                        <input type="time" value={r.horario?.desde || "22:00"} disabled={!r.horario?.activo} onChange={(e) => set(c.k, { horario: { ...(r.horario || {}), desde: e.target.value } })} className="h-8 rounded-lg border border-border bg-background px-2 text-[13px] disabled:opacity-50" />
                                                        <span className="text-muted-foreground text-[12px]">a</span>
                                                        <input type="time" value={r.horario?.hasta || "06:00"} disabled={!r.horario?.activo} onChange={(e) => set(c.k, { horario: { ...(r.horario || {}), hasta: e.target.value } })} className="h-8 rounded-lg border border-border bg-background px-2 text-[13px] disabled:opacity-50" />
                                                    </div>
                                                </div>
                                                <Switch checked={!!r.horario?.activo} onCheckedChange={(v) => set(c.k, { horario: { desde: "22:00", hasta: "06:00", ...(r.horario || {}), activo: v } })} />
                                            </div>
                                        )}

                                        {c.camaras && (
                                            <div className="md:col-span-2 space-y-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <div className="text-[12px] font-semibold flex items-center gap-1.5"><Camera size={13} /> Cámaras <Ayuda texto={"Sin ninguna marcada se avisa de todas.\nEjemplo: marcar solo las del perímetro para no recibir avisos de las cámaras interiores."} /></div>
                                                    <span className="text-[11px] text-muted-foreground">{camsSel.length ? `${camsSel.length} de ${listaCams.length} seleccionadas` : `Todas (${listaCams.length})`}</span>
                                                    <div className="ml-auto flex items-center gap-1.5">
                                                        <div className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                            <input value={buscarCam} onChange={(e) => setBuscarCam(e.target.value)} placeholder="Buscar cámara" className="h-7 w-44 rounded-lg border border-border bg-background pl-6 pr-2 text-[12px]" /></div>
                                                        {camsSel.length > 0 && <button type="button" onClick={() => set(c.k, { camaras: [] })} className="h-7 px-2 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/60">Todas</button>}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto pr-1">
                                                    {listaCams.filter((d: any) => !buscarCam || d.name.toLowerCase().includes(buscarCam.toLowerCase())).map((d: any) => (
                                                        <Chip key={d.id} activo={camsSel.includes(d.id)} onClick={() => alternar(c.k, "camaras", d.id)}>{d.name}</Chip>
                                                    ))}
                                                    {listaCams.length === 0 && <span className="text-[12px] text-muted-foreground">No hay cámaras de este tipo.</span>}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {/* Barra de guardado */}
            <div className={cn("sticky bottom-3 z-10 flex items-center gap-2 rounded-xl border p-3 bg-card/95 backdrop-blur transition", sucio ? "border-primary/40 shadow-lg" : "border-border")}>
                <span className="text-[12px] text-muted-foreground flex-1">{sucio ? "Hay cambios sin guardar." : "Las reglas se aplican apenas se guardan, sin reiniciar nada."}</span>
                <button type="button" onClick={() => setReglas(JSON.parse(JSON.stringify(datos.defecto)))}
                    data-tooltip-id={TT} data-tooltip-content="Vuelve a los valores de fábrica: vigilancia, merodeo y reglas encendidas; el resto apagado. Hay que guardar para aplicarlo."
                    className="h-9 px-3 rounded-lg border border-border text-[13px] font-semibold flex items-center gap-1.5 hover:bg-muted/60"><RotateCcw size={14} /> Valores por defecto</button>
                <button type="button" onClick={() => setReglas(JSON.parse(original))} disabled={!sucio} className="h-9 px-3 rounded-lg border border-border text-[13px] font-semibold hover:bg-muted/60 disabled:opacity-40">Descartar</button>
                <button type="button" onClick={guardar} disabled={!sucio || guardando} className="h-9 px-4 rounded-lg accion text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-40">
                    {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar cambios
                </button>
            </div>

            {/* Historial */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
                    <div className="font-semibold text-[14px] flex items-center gap-2">Historial de envíos <Ayuda texto={"Cada aviso que llegó a la pasarela: si salió, si se filtró y por qué, o si falló.\nSe guardan los últimos 15 días."} /></div>
                    <div className="ml-auto flex items-center gap-1.5">
                        <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]">
                            <option value="">Todas las categorías</option>
                            {CATS.map((c) => <option key={c.k} value={c.k}>{c.nombre}</option>)}
                        </select>
                        <select value={fDec} onChange={(e) => setFDec(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]">
                            <option value="">Todas las decisiones</option>
                            <option value="ENVIADO">Enviados</option><option value="FILTRADO">Filtrados</option><option value="ERROR">Con error</option>
                        </select>
                        <button type="button" onClick={cargarEnvios} className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted/60" data-tooltip-id={TT} data-tooltip-content="Actualizar">
                            <RefreshCw size={13} className={cn(cargandoEnvios && "animate-spin")} />
                        </button>
                    </div>
                </div>
                <div className="max-h-[480px] overflow-auto">
                    <table className="w-full text-[12px]">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur text-muted-foreground">
                            <tr className="text-left">
                                <th className="px-3 py-2 font-semibold">Hora</th><th className="px-3 py-2 font-semibold">Categoría</th>
                                <th className="px-3 py-2 font-semibold">Aviso</th><th className="px-3 py-2 font-semibold">Decisión</th><th className="px-3 py-2 font-semibold">Motivo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {envios.map((f) => {
                                const d = DEC[f.decision] || DEC.FILTRADO; const C = CATS.find((c) => c.k === f.categoria);
                                return (
                                    <tr key={f.id} className="border-t border-border/60 hover:bg-muted/30">
                                        <td className="px-3 py-2 tabular-nums whitespace-nowrap text-muted-foreground">{hora(f.createdAt)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C?.color || "#94a3b8" }} />{nombreCat(f.categoria)}</span></td>
                                        <td className="px-3 py-2 max-w-[280px] truncate" title={f.titulo || ""}>{f.titulo || f.deviceName || "—"}</td>
                                        <td className="px-3 py-2"><span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] font-semibold", d.c)}><d.Ic size={11} /> {d.l}</span></td>
                                        <td className="px-3 py-2 text-muted-foreground max-w-[320px] truncate" title={f.motivo || ""}>{f.motivo || ""}</td>
                                    </tr>
                                );
                            })}
                            {!envios.length && (
                                <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">{cargandoEnvios ? "Cargando…" : "Todavía no hay envíos registrados con estos filtros."}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
