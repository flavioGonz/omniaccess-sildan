"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
    Plus, Trash2, Save, Clock, Bell, Zap, Tag, Send, Timer, Video, CalendarDays, PanelRightOpen,
    MessageCircle, Mail, Smartphone, Loader2, HelpCircle,
    ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Momento, Nada } from "@/components/ui/celdas";
import { Filtros } from "@/components/ui/filtros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import {
    getNotificationRules, createNotificationRule, updateNotificationRule, deleteNotificationRule,
    getDispositivosParaReglas,
} from "@/app/actions/queue";
import { getEnabledModules } from "@/app/actions/modules";

/**
 * Las reglas de notificación: qué evento, de qué cámara, en qué horario, sale por qué canal.
 *
 * Antes era una lista de renglones con un formulario que se desplegaba arriba de todo, con
 * selects nativos y siete violetas propios. Ahora es la tabla del sistema y cada regla se
 * abre en un cajón, como la ficha de una persona: la lista queda a la vista y cada campo
 * dice qué hace, con un ejemplo, detrás de su signo de pregunta.
 *
 * Las explicaciones dicen lo que hace el motor de verdad (lib/reglas-notificacion.ts para
 * LPR/Face/Intrusión, lib/onvif-polling.ts para Filas). Si el motor cambia, cambia el texto.
 */

type Rule = {
    id: string; name: string; enabled: boolean; deviceId: string | null; channelName: string | null;
    metric: string; operator: string; threshold: number; daysOfWeek: string; startTime: string;
    endTime: string; channels: string; minSeverity: string | null; cooldownSec: number; dedupe: boolean;
    modulo?: string; eventos?: string | null; lastFiredAt?: string | Date | null;
    verificacion?: string;
};
type Dev = { id: string; name: string; deviceType?: string };

/** El módulo de cada regla, y qué ajuste lo prende. Intrusión no tiene interruptor propio. */
const MODULOS = [
    { v: "LPR", l: "Matrículas", modulo: "MODULE_LPR" },
    { v: "INTRUSION", l: "Intrusión", modulo: null },
    { v: "FACE", l: "Rostros", modulo: "MODULE_FACE" },
    { v: "QUEUE", l: "Filas", modulo: "MODULE_QUEUE" },
] as const;
const nombreModulo = (v?: string | null) => MODULOS.find((m) => m.v === (v || "QUEUE"))?.l || v || "Filas";

// Qué cámaras puede elegir una regla, según el módulo.
const TIPOS_POR_MODULO: Record<string, string[]> = {
    QUEUE: ["QUEUE_COUNTER"],
    LPR: ["LPR_CAMERA", "LPR_INTERIOR"],
    FACE: ["FACE_TERMINAL", "FACE_CAMERA", "DOOR_INTERCOM"],
    INTRUSION: ["CAMERA", "LPR_INTERIOR"],
};
const EVENTOS: Record<string, { v: string; l: string; ayuda: string }[]> = {
    LPR: [
        { v: "ALLOW", l: "Acceso permitido", ayuda: "La barrera dejó pasar la matrícula." },
        { v: "DENY", l: "Acceso denegado", ayuda: "La barrera no la dejó pasar (sin credencial, fuera de horario, lista negra)." },
        { v: "UNKNOWN", l: "No reconocida", ayuda: "La matrícula no está en el padrón." },
        { v: "WATCHLIST", l: "En lista de vigilancia", ayuda: "Se leyó una matrícula de la lista de vigilancia (lista negra, VIP o en búsqueda)." },
        { v: "PARKED", l: "Estacionó", ayuda: "Una cámara de calle la vio quieta más de un minuto." },
        { v: "LEFT", l: "Se retiró", ayuda: "Se dejó de ver una que estaba estacionada." },
    ],
    FACE: [
        { v: "ALLOW", l: "Acceso permitido", ayuda: "El rostro tenía permiso y la puerta abrió." },
        { v: "DENY", l: "Acceso denegado", ayuda: "Rostro conocido sin permiso para esa puerta u horario." },
        { v: "UNKNOWN", l: "No reconocido", ayuda: "Rostro que no está en el padrón." },
    ],
    INTRUSION: [
        { v: "LINECROSS", l: "Cruce de línea", ayuda: "Algo cruzó una línea virtual de la cámara." },
        { v: "INTRUSION", l: "Intrusión en zona", ayuda: "Algo entró y se quedó en una zona vigilada." },
        { v: "REGION_ENTER", l: "Entrada a zona", ayuda: "Algo entró a la zona." },
        { v: "REGION_EXIT", l: "Salida de zona", ayuda: "Algo salió de la zona." },
    ],
};
const METRICAS = [{ v: "aforo", l: "Aforo" }, { v: "entrada", l: "Entradas" }, { v: "salida", l: "Salidas" }];
const OPERADORES = [{ v: ">=", l: "≥ igual o más" }, { v: ">", l: "> más de" }, { v: "==", l: "= exactamente" }, { v: "<=", l: "≤ igual o menos" }];
const ZONAS = ["Aforo", "Entrada", "Salida"];
const CANALES = [
    { v: "whatsapp", l: "WhatsApp", icono: MessageCircle },
    { v: "telegram", l: "Telegram", icono: Send },
    { v: "email", l: "Correo", icono: Mail },
    { v: "webpush", l: "Push (PWA)", icono: Smartphone },
];
const DIAS = [{ v: "1", l: "L" }, { v: "2", l: "M" }, { v: "3", l: "X" }, { v: "4", l: "J" }, { v: "5", l: "V" }, { v: "6", l: "S" }, { v: "7", l: "D" }];
const TODOS_LOS_DIAS = "1,2,3,4,5,6,7";
/** Una regla nueva nace en el primer módulo prendido; si no se sabe cuál, en Matrículas. */
const MODULO_POR_DEFECTO = "LPR";

const vacia = (modulo: string) => ({
    name: "", enabled: true, modulo, eventos: "", deviceId: "", channelName: "", metric: "aforo", operator: ">=",
    threshold: 5, daysOfWeek: TODOS_LOS_DIAS, startTime: "00:00", endTime: "23:59",
    channels: "whatsapp", minSeverity: "", cooldownSec: 60, dedupe: true, verificacion: "avisar",
});

function listaCsv(csv: string | null | undefined) { return String(csv || "").split(",").map((x) => x.trim()).filter(Boolean); }
function diasLegibles(csv: string) {
    const d = listaCsv(csv);
    if (d.length === 7) return "todos los días";
    if (d.join(",") === "1,2,3,4,5") return "lunes a viernes";
    if (d.join(",") === "6,7") return "fines de semana";
    return d.map((x) => DIAS.find((y) => y.v === x)?.l).join(" ");
}
function queDispara(r: Rule) {
    if ((r.modulo || "QUEUE") === "QUEUE") return `${METRICAS.find((m) => m.v === r.metric)?.l || r.metric} ${r.operator} ${r.threshold}`;
    const ev = listaCsv(r.eventos);
    if (!ev.length) return "Todos los eventos";
    return ev.map((e) => EVENTOS[r.modulo || ""]?.find((x) => x.v === e)?.l || e).join(" · ");
}

/** Rótulo de un grupo de botones: como el de CajonCampo, pero sin <label> (un label con
 *  varios botones adentro "aprieta" el primero cuando se toca el texto). */
function Rotulo({ texto, pista, children }: { texto: string; pista?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
                {texto}
                {pista && (
                    <Pista titulo={texto} texto={pista} lado="arriba" ancho={290}>
                        <HelpCircle size={12.5} className="text-muted-foreground/50 hover:text-[var(--accion)] transition-colors cursor-help" />
                    </Pista>
                )}
            </div>
            {children}
        </div>
    );
}

/** Una explicación con su ejemplo, para el signo de pregunta de cada campo. */
const Ayuda = ({ que, ejemplo }: { que: React.ReactNode; ejemplo: React.ReactNode }) => (
    <div className="space-y-1.5 text-[11.5px] leading-snug">
        <p>{que}</p>
        <p className="text-muted-foreground"><b className="text-foreground/80">Ejemplo:</b> {ejemplo}</p>
    </div>
);

const pastilla = (on: boolean) => cn("h-8 px-3 rounded-full border text-[11px] font-semibold transition-colors inline-flex items-center gap-1.5",
    on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-foreground" : "bg-background text-muted-foreground border-border hover:text-foreground");

export default function RulesManager() {
    const [reglas, setReglas] = useState<Rule[]>([]);
    const [equipos, setEquipos] = useState<Dev[]>([]);
    const [modulos, setModulos] = useState<Record<string, boolean>>({});
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [filtroModulo, setFiltroModulo] = useState("todos");

    // el cajón: null cerrado, "nueva" o el id de la regla
    const [abierta, setAbierta] = useState<string | null>(null);
    const [form, setForm] = useState<any>(vacia(MODULO_POR_DEFECTO));
    const [guardando, setGuardando] = useState(false);
    const [borrar, setBorrar] = useState<Rule | null>(null);

    const cargar = useCallback(async () => {
        setError(null);
        try {
            const [r, d, m] = await Promise.all([getNotificationRules(), getDispositivosParaReglas(), getEnabledModules().catch(() => ({}))]);
            setReglas(r as any); setEquipos(d as any); setModulos(m as any);
        } catch (e: any) { setError(e?.message || "No se pudieron leer las reglas"); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    /* Sólo los módulos prendidos en este barrio, más el de la regla abierta: ofrecer "Filas"
       donde no hay contadores es ofrecer una regla que nunca va a disparar. */
    const modulosVisibles = useMemo(() => MODULOS.filter((m) => !m.modulo || modulos[m.modulo] || form.modulo === m.v || reglas.some((r) => (r.modulo || "QUEUE") === m.v)), [modulos, form.modulo, reglas]);
    const moduloInicial = modulosVisibles[0]?.v || MODULO_POR_DEFECTO;

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return reglas.filter((r) => (filtroModulo === "todos" || (r.modulo || "QUEUE") === filtroModulo) &&
            (!q || r.name.toLowerCase().includes(q) || queDispara(r).toLowerCase().includes(q) || r.channels.includes(q)));
    }, [reglas, busqueda, filtroModulo]);

    const nombreEquipo = (id: string | null) => id ? (equipos.find((d) => d.id === id)?.name || "Cámara borrada") : "Todas";

    const abrir = (r: Rule | null) => {
        if (r) setForm({ ...r, modulo: r.modulo || "QUEUE", eventos: r.eventos || "", deviceId: r.deviceId || "", channelName: r.channelName || "", minSeverity: r.minSeverity || "", verificacion: r.verificacion || "avisar" });
        else setForm(vacia(moduloInicial));
        setAbierta(r ? r.id : "nueva");
    };
    const alternar = (campo: "daysOfWeek" | "channels" | "eventos", v: string, orden: string[]) => {
        const set = new Set(listaCsv(form[campo]));
        set.has(v) ? set.delete(v) : set.add(v);
        setForm({ ...form, [campo]: orden.filter((x) => set.has(x)).join(",") });
    };

    const guardar = async () => {
        if (!form.name.trim()) { toast.error("Ponele un nombre a la regla"); return; }
        if (!form.channels) { toast.error("Elegí al menos un canal"); return; }
        if (!form.daysOfWeek) { toast.error("Elegí al menos un día"); return; }
        setGuardando(true);
        try {
            const datos = { ...form, name: form.name.trim(), threshold: Number(form.threshold), cooldownSec: Math.max(0, Number(form.cooldownSec) || 0) };
            delete datos.id; delete datos.lastFiredAt; delete datos.createdAt; delete datos.updatedAt;
            if (abierta && abierta !== "nueva") { await updateNotificationRule(abierta, datos); toast.success("Regla guardada"); }
            else { await createNotificationRule(datos); toast.success("Regla creada"); }
            setAbierta(null); cargar();
        } catch (e: any) { toast.error("No se pudo guardar", { description: e?.message }); }
        finally { setGuardando(false); }
    };
    const prenderApagar = async (r: Rule) => {
        setReglas((rs) => rs.map((x) => x.id === r.id ? { ...x, enabled: !r.enabled } : x));
        try { await updateNotificationRule(r.id, { enabled: !r.enabled }); }
        catch { toast.error("No se pudo cambiar"); cargar(); }
    };

    const columnas: ColumnaTabla<Rule>[] = [
        {
            clave: "enabled", titulo: "", ancho: 56, auxiliar: true,
            celda: (r) => <Pista titulo={r.enabled ? "Activa" : "Apagada"} texto={r.enabled ? "Evalúa cada evento y despacha cuando se cumple." : "No evalúa nada; queda guardada para prenderla después."}>
                <span onClick={(e) => e.stopPropagation()}><Switch checked={r.enabled} onCheckedChange={() => prenderApagar(r)} aria-label="Activa" /></span>
            </Pista>,
        },
        {
            clave: "name", titulo: "Regla", valor: (r) => r.name,
            celda: (r) => <div className={cn("min-w-0", !r.enabled && "opacity-55")}>
                <div className="text-[13px] font-semibold text-foreground truncate">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">{nombreModulo(r.modulo)}</div>
            </div>,
        },
        { clave: "dispara", titulo: "Qué la dispara", valor: (r) => queDispara(r), celda: (r) => <span className="text-[12px]">{queDispara(r)}</span> },
        { clave: "camara", titulo: "Cámara", ancho: 150, valor: (r) => nombreEquipo(r.deviceId), celda: (r) => <span className={cn("text-[12px]", !r.deviceId && "text-muted-foreground")}>{nombreEquipo(r.deviceId)}</span> },
        {
            clave: "cuando", titulo: "Cuándo", ancho: 150, valor: (r) => `${r.startTime}-${r.endTime}`,
            celda: (r) => <div className="text-[12px] leading-tight"><div className="tabular-nums">{r.startTime === "00:00" && r.endTime === "23:59" ? "Todo el día" : `${r.startTime} a ${r.endTime}`}</div><div className="text-[11px] text-muted-foreground">{diasLegibles(r.daysOfWeek)}</div></div>,
        },
        {
            clave: "canales", titulo: "Sale por", ancho: 120, valor: (r) => r.channels,
            celda: (r) => <div className="flex items-center gap-1.5">{listaCsv(r.channels).map((c) => { const C = CANALES.find((x) => x.v === c); const I = C?.icono || Bell; return <Pista key={c} titulo={C?.l || c} texto="A los destinatarios de ese canal (pestaña Destinatarios)."><span className="w-7 h-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground"><I size={13} /></span></Pista>; })}</div>,
        },
        { clave: "cooldown", titulo: "Pausa", ancho: 80, alinear: "der", valor: (r) => r.cooldownSec, celda: (r) => <span className="text-[12px] tabular-nums text-muted-foreground">{r.cooldownSec ? `${r.cooldownSec} s` : "—"}</span> },
        { clave: "ultima", titulo: "Última vez", ancho: 110, valor: (r) => r.lastFiredAt ? new Date(r.lastFiredAt).toISOString() : "", celda: (r) => r.lastFiredAt ? <Momento t={r.lastFiredAt} /> : <Nada /> },
        {
            clave: "acciones", titulo: "", ancho: 84, auxiliar: true,
            celda: (r) => <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                <Pista titulo="Abrir" texto="Todas las propiedades de la regla."><button onClick={() => abrir(r)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><PanelRightOpen size={14} /></button></Pista>
                <Pista titulo="Borrar" texto="Se borra la regla; los despachos que ya hizo quedan en Despachos." lado="izquierda"><button onClick={() => setBorrar(r)} className="p-1.5 rounded hover:bg-[var(--mal-suave)] text-[var(--mal)]"><Trash2 size={14} /></button></Pista>
            </div>,
        },
    ];

    const esFilas = form.modulo === "QUEUE";
    const equiposDelModulo = equipos.filter((d) => (TIPOS_POR_MODULO[form.modulo] || []).includes(d.deviceType || ""));
    const activas = reglas.filter((r) => r.enabled).length;

    return (
        <>
            <Tabla<Rule>
                id="reglas-notificacion"
                filas={visibles}
                clave={(r) => r.id}
                columnas={columnas}
                cargando={cargando}
                error={error}
                alReintentar={cargar}
                alClickFila={(r) => abrir(r)}
                alto="62vh"
                vacio={{ icono: Bell, titulo: busqueda || filtroModulo !== "todos" ? "Ninguna coincide" : "Sin reglas", ayuda: "Una regla dice qué evento, de qué cámara y en qué horario sale por WhatsApp, Telegram o correo." }}
                barra={
                    <Filtros
                        busqueda={busqueda} alBuscar={setBusqueda} placeholder="Nombre, evento o canal"
                        grupos={[{ clave: "modulo", titulo: "Módulo", valor: filtroModulo, alElegir: setFiltroModulo, opciones: [{ valor: "todos", rotulo: "Todos" }, ...modulosVisibles.map((m) => ({ valor: m.v, rotulo: m.l }))] }]}
                        acciones={<div className="flex items-center gap-3">
                            <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{activas} activa{activas === 1 ? "" : "s"} de {reglas.length}</span>
                            <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nueva regla</Button>
                        </div>}
                    />
                }
            />

            <Cajon open={!!abierta} onOpenChange={(o) => { if (!o) setAbierta(null); }}>
                {abierta && (
                    <CajonContenido
                        ancho="intermedio"
                        titulo={abierta === "nueva" ? "Nueva regla" : form.name || "Regla"}
                        descripcion="Qué evento, de qué cámara y en qué horario sale por qué canal."
                        pie={<>
                            {abierta !== "nueva" && (
                                <Button type="button" variant="outline" className="mr-auto text-[var(--mal)]" onClick={() => setBorrar(reglas.find((r) => r.id === abierta) || null)}>
                                    <Trash2 size={15} /> Borrar
                                </Button>
                            )}
                            <Button type="button" variant="ghost" onClick={() => setAbierta(null)}>Cancelar</Button>
                            <Button type="button" onClick={guardar} disabled={guardando}>
                                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {abierta === "nueva" ? "Crear regla" : "Guardar cambios"}
                            </Button>
                        </>}>

                        <CajonSeccion titulo="La regla" icono={Tag}>
                            <CajonCampo etiqueta="Nombre" pista={<Ayuda que="Cómo se la reconoce en esta tabla y en Despachos. Va en el aviso como título de la alerta." ejemplo="«Lista negra en la entrada», «Cruce perimetral de noche»." />}>
                                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Lista negra en la entrada" />
                            </CajonCampo>
                            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2.5">
                                <div className="text-[12px]">
                                    <div className="font-medium text-foreground/85">{form.enabled ? "Activa" : "Apagada"}</div>
                                    <div className="text-muted-foreground text-[11.5px]">{form.enabled ? "Evalúa cada evento desde que se guarda." : "Queda guardada sin evaluar nada."}</div>
                                </div>
                                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} aria-label="Activa" />
                            </div>
                        </CajonSeccion>

                        <CajonSeccion titulo="Qué la dispara" icono={Zap}>
                            <Rotulo texto="Módulo" pista={<Ayuda que="De qué parte del sistema salen los eventos que mira esta regla. Cambiarlo borra los eventos elegidos, porque cada módulo tiene los suyos." ejemplo="Matrículas para la barrera y las cámaras de calle; Intrusión para las perimetrales." />}>
                                <div className="flex flex-wrap gap-1.5">
                                    {modulosVisibles.map((m) => <button key={m.v} type="button" onClick={() => setForm({ ...form, modulo: m.v, eventos: "", deviceId: "" })} className={pastilla(form.modulo === m.v)}>{m.l}</button>)}
                                </div>
                            </Rotulo>

                            {!esFilas ? (
                                <Rotulo texto="Eventos" pista={<Ayuda que="Qué tiene que pasar para que salga el aviso. Sin ninguno marcado, sale con cualquier evento del módulo (puede ser mucho)." ejemplo="Sólo «En lista de vigilancia»: avisa cuando entra una matrícula vigilada y no con cada auto." />}>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(EVENTOS[form.modulo] || []).map((ev) => (
                                            <Pista key={ev.v} titulo={ev.l} texto={ev.ayuda} lado="abajo">
                                                <button type="button" onClick={() => alternar("eventos", ev.v, (EVENTOS[form.modulo] || []).map((x) => x.v))} className={pastilla(listaCsv(form.eventos).includes(ev.v))}>{ev.l}</button>
                                            </Pista>
                                        ))}
                                    </div>
                                    {!listaCsv(form.eventos).length && <p className="mt-1.5 text-[11.5px] tono-aviso">Sin eventos marcados: dispara con todos.</p>}
                                </Rotulo>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    <Rotulo texto="Qué se mide" pista={<Ayuda que="El número del contador de la fila que se compara contra el umbral." ejemplo="Aforo: cuántas personas hay ahora en la fila." />}>
                                        <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                            <SelectContent>{METRICAS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </Rotulo>
                                    <Rotulo texto="Zona" pista={<Ayuda que="La zona del contador. Vacío: cualquiera." ejemplo="Entrada: sólo la línea de entrada de la fila." />}>
                                        <Select value={form.channelName || "cualquiera"} onValueChange={(v) => setForm({ ...form, channelName: v === "cualquiera" ? "" : v })}>
                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                            <SelectContent><SelectItem value="cualquiera">Cualquiera</SelectItem>{ZONAS.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </Rotulo>
                                    <Rotulo texto="Condición" pista={<Ayuda que="Cómo se compara la medida con el umbral." ejemplo="«≥ igual o más» con umbral 8: avisa cuando hay 8 o más." />}>
                                        <Select value={form.operator} onValueChange={(v) => setForm({ ...form, operator: v })}>
                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                            <SelectContent>{OPERADORES.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </Rotulo>
                                    <CajonCampo etiqueta="Umbral" pista={<Ayuda que="El número contra el que se compara." ejemplo="8 personas." />}>
                                        <Input type="number" min={0} value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} className="tabular-nums" />
                                    </CajonCampo>
                                </div>
                            )}

                            <Rotulo texto="Cámara" pista={<Ayuda que="De qué equipo tienen que venir los eventos. «Todas» toma cualquier cámara del módulo." ejemplo="Sólo «LPR Entrada»: no avisa lo que lee la de Salida." />}>
                                <Select value={form.deviceId || "todas"} onValueChange={(v) => setForm({ ...form, deviceId: v === "todas" ? "" : v })}>
                                    <SelectTrigger className="h-9"><Video size={14} className="text-muted-foreground" /><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="todas">Todas las cámaras</SelectItem>
                                        {equiposDelModulo.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                        {form.deviceId && !equiposDelModulo.some((d) => d.id === form.deviceId) && <SelectItem value={form.deviceId}>{nombreEquipo(form.deviceId)}</SelectItem>}
                                    </SelectContent>
                                </Select>
                            </Rotulo>
                        </CajonSeccion>

                        <CajonSeccion titulo="Cuándo" icono={CalendarDays}>
                            <Rotulo texto="Días" pista={<Ayuda que="Los días en que la regla avisa. Fuera de ellos el evento pasa igual, pero no sale ningún aviso." ejemplo="Sólo S y D para avisar intrusiones el fin de semana." />}>
                                <div className="flex gap-1">
                                    {DIAS.map((d) => <button key={d.v} type="button" onClick={() => alternar("daysOfWeek", d.v, DIAS.map((x) => x.v))} className={cn("w-9 h-9 rounded-full border text-[12px] font-bold", listaCsv(form.daysOfWeek).includes(d.v) ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{d.l}</button>)}
                                </div>
                            </Rotulo>
                            <div className="grid grid-cols-2 gap-3">
                                <CajonCampo etiqueta="Desde" pista={<Ayuda que="Hora de inicio, en la hora del barrio. Si «Hasta» es menor, la ventana cruza la medianoche." ejemplo="22:00 a 06:00 = toda la noche." />}>
                                    <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="tabular-nums" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Hasta" pista={<Ayuda que="Hora de fin, incluida." ejemplo="23:59 para que llegue hasta el final del día." />}>
                                    <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="tabular-nums" />
                                </CajonCampo>
                            </div>
                        </CajonSeccion>

                        <CajonSeccion titulo="A dónde va" icono={Send}>
                            <Rotulo texto="Canales" pista={<Ayuda que="Por dónde sale el aviso. A cada canal le llega a sus destinatarios (pestaña Destinatarios); si un canal no tiene ninguno, va al destino por defecto del canal. El texto sale de Plantillas." ejemplo="WhatsApp: le llega a los números de guardia cargados en Destinatarios." />}>
                                <div className="flex flex-wrap gap-1.5">
                                    {CANALES.map((c) => { const I = c.icono; return <button key={c.v} type="button" onClick={() => alternar("channels", c.v, CANALES.map((x) => x.v))} className={pastilla(listaCsv(form.channels).includes(c.v))}><I size={13} /> {c.l}</button>; })}
                                </div>
                            </Rotulo>
                        </CajonSeccion>

                        {form.modulo === "INTRUSION" && (
                            /* La doble verificación: la cámara dice «alguien cruzó» y omni-vision mira la
                               captura. Esperar cuesta unos segundos; a cambio, una sombra o un perro no
                               despiertan a nadie. Si omni-vision no contesta a tiempo, avisa igual. */
                            <CajonSeccion titulo="Doble verificación" icono={ShieldCheck}>
                                <div className="grid gap-2">
                                    {([
                                        ["avisar", "Avisar siempre", "Al instante, como manda la cámara."],
                                        ["confirmada", "Sólo si omni-vision ve a alguien", "Espera hasta unos segundos a que omni-vision mire la captura. Si ve una persona o un vehículo, avisa; si sólo hay un animal o nada, no. Si no contesta a tiempo, avisa igual."],
                                    ] as const).map(([v, t, d]) => (
                                        <button key={v} type="button" onClick={() => setForm({ ...form, verificacion: v })} aria-pressed={(form.verificacion || "avisar") === v}
                                            className={cn("rounded-[10px] border px-3 py-2.5 text-left", (form.verificacion || "avisar") === v ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                            <span className="block text-[13px] font-semibold">{t}</span>
                                            <span className="block text-[11.5px] text-muted-foreground leading-snug">{d}</span>
                                        </button>
                                    ))}
                                </div>
                            </CajonSeccion>
                        )}

                        <CajonSeccion titulo="Para no repetir" icono={Timer}>
                            <CajonCampo etiqueta="Pausa entre avisos (segundos)"
                                ayuda={!esFilas ? "Después de avisar, la regla calla este tiempo aunque sigan llegando eventos." : undefined}
                                pista={<Ayuda que="Tiempo mínimo entre dos avisos de esta misma regla. Evita una ráfaga cuando un evento se repite. 0 = sin pausa." ejemplo="60: si la misma regla se cumple tres veces en un minuto, sale un solo aviso." />}>
                                <Input type="number" min={0} value={form.cooldownSec} onChange={(e) => setForm({ ...form, cooldownSec: e.target.value })} className="tabular-nums w-32" />
                            </CajonCampo>
                            {esFilas && (
                                <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2.5">
                                    <div className="text-[12px]">
                                        <div className="flex items-center gap-1.5 font-medium text-foreground/85">Respetar la pausa
                                            <Pista titulo="Respetar la pausa" texto={<Ayuda que="Sólo en Filas: apagado, avisa en cada lectura que cumpla la condición, ignorando la pausa." ejemplo="Prendido con 60 s: una fila que sigue llena avisa una vez por minuto, no cada segundo." />} ancho={290}><HelpCircle size={12.5} className="text-muted-foreground/50 hover:text-[var(--accion)] cursor-help" /></Pista>
                                        </div>
                                        <div className="text-muted-foreground text-[11.5px]">{form.dedupe ? "Un aviso por pausa." : "Avisa en cada lectura."}</div>
                                    </div>
                                    <Switch checked={form.dedupe} onCheckedChange={(v) => setForm({ ...form, dedupe: v })} aria-label="Respetar la pausa" />
                                </div>
                            )}
                            {abierta !== "nueva" && (
                                <p className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5"><Clock size={12} /> Último aviso: {reglas.find((r) => r.id === abierta)?.lastFiredAt ? <Momento t={reglas.find((r) => r.id === abierta)!.lastFiredAt!} /> : "nunca"}</p>
                            )}
                        </CajonSeccion>
                    </CajonContenido>
                )}
            </Cajon>

            <ConfirmarAccion
                id={borrar?.id || ""}
                open={!!borrar}
                onOpenChange={(o) => { if (!o) setBorrar(null); }}
                title={`Borrar «${borrar?.name || ""}»`}
                description="La regla deja de avisar y se borra. Los despachos que ya hizo quedan en Despachos."
                etiquetaAccion="Borrar regla"
                onDelete={async (id) => { await deleteNotificationRule(id); return { success: true } as any; }}
                onSuccess={() => { toast.success("Regla borrada"); setBorrar(null); setAbierta(null); cargar(); }}
            />
        </>
    );
}
