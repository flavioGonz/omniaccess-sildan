"use client";
/**
 * Panel «Cuentas de los equipos» de Dispositivos (openspec usuarios-de-equipos, «Controles en el área»):
 * arriba de la lista de un área (sus equipos y sub-áreas) o, en «Todas», para todo el sitio. En esta
 * fase sólo lee: el estado, las cuentas, quién está conectado y la auditoría de esos equipos.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Globe, Loader2, ScanSearch, ScrollText, ShieldCheck, ShieldQuestion, Users, UserX, Wifi, AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Momento } from "@/components/ui/celdas";
import { Chip } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Pestanias } from "@/components/ui/pestanias";
import { Seek } from "@/components/ui/search";
import { cn } from "@/lib/utils";
import { hace } from "@/lib/fechas";
import type { EstadoAreas } from "@/app/actions/areas";
import { gestoraDeArea } from "@/lib/usuarios-equipo/areas";
import { CLASES, PROCEDENCIAS, type Clase, type Procedencia } from "@/lib/usuarios-equipo/inventario";
import { useSessionRole } from "@/hooks/useSessionRole";
import { sileo as toast } from "sileo";
import { useDatos, type TodasUsuarios, type CuentaVista, type SesionVista } from "@/components/devices/usuarios/datos";
import { MarcarConocida, type QueMarcar } from "@/components/devices/usuarios/MarcarConocida";

type Vista = "cuentas" | "conectados" | "auditoria";
type FiltroClase = "todas" | Clase;
const CLAVE_PLEGADO = "omni.panelCuentas.plegado";

export function PanelCuentas({ estado, areaId, deviceIds, onAbrirEquipo }: {
    estado: EstadoAreas;
    /** null: todo el sitio («Todas»). */
    areaId: string | null;
    /** Los equipos del área y sus sub-áreas; null para todo el sitio. */
    deviceIds: string[] | null;
    onAbrirEquipo?: (deviceId: string) => void;
}) {
    const { datos, error, cargando, traer } = useDatos<TodasUsuarios>("/api/devices/usuarios");
    const { tiene } = useSessionRole();
    const puedeMarcar = tiene("dispositivos.usuarios");
    const [vista, setVista] = useState<Vista>("cuentas");
    const [clase, setClase] = useState<FiltroClase>("todas");
    const [q, setQ] = useState("");
    const [marcar, setMarcar] = useState<QueMarcar | null>(null);
    const [plegado, setPlegado] = useState(false);
    useEffect(() => { try { setPlegado(localStorage.getItem(CLAVE_PLEGADO) === "1"); } catch { } }, []);
    const [revisando, setRevisando] = useState(false);
    const plegar = () => { const v = !plegado; setPlegado(v); try { localStorage.setItem(CLAVE_PLEGADO, v ? "1" : "0"); } catch { } };

    const ids = useMemo(() => (deviceIds ? new Set(deviceIds) : null), [deviceIds]);
    const equipos = useMemo(() => (datos?.equipos || []).filter((e) => e.soporte && (!ids || ids.has(e.id))), [datos, ids]);
    const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
    const nombreArea = (deviceId: string) => estado.areas.find((a) => a.id === estado.equipos[deviceId])?.nombre || "Sin área";
    const cuentas = useMemo(() => (datos?.cuentas || []).filter((c) => porId.has(c.deviceId) && !c.desaparecida), [datos, porId]);

    const n = {
        leidos: equipos.filter((e) => e.lectura?.cuentasOk).length,
        error: equipos.filter((e) => e.lectura && (e.lectura.cuentasError || e.lectura.sesionesError)).length,
        ajenas: cuentas.filter((c) => c.clase === "no-gestionada" && !c.conocida).length,
        conocidas: cuentas.filter((c) => c.clase === "no-gestionada" && c.conocida).length,
        accesos: equipos.reduce((a, e) => a + (e.sesiones.desconocida || 0), 0),
    };
    // «Revisar»: lee ya las cuentas y sesiones de los equipos de este panel (sólo GET a los equipos).
    const revisar = async () => {
        setRevisando(true);
        try {
            const r = await fetch("/api/devices/usuarios/revisar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceIds: equipos.map((e) => e.id) }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.ok) throw new Error(j.error || `Error ${r.status}`);
            toast.success({ title: `Revisados ${j.equipos} ${j.equipos === 1 ? "equipo" : "equipos"}`, description: j.errores ? `${j.errores} no contestaron: se muestra lo último leído.` : undefined });
            await traer();
        } catch (e: any) {
            toast.error({ title: "No se pudo revisar", description: e?.message });
        } finally { setRevisando(false); }
    };
    const gestora = areaId ? gestoraDeArea(estado, areaId) : null;
    const decideArea = areaId ? estado.areas.find((a) => a.id === areaId) : null;

    const filas = cuentas.filter((c) => (clase === "todas" || c.clase === clase) && (!q || `${c.nombre} ${porId.get(c.deviceId)?.name} ${porId.get(c.deviceId)?.ip}`.toLowerCase().includes(q.toLowerCase())));
    const columnas = useMemo<ColumnaTabla<CuentaVista>[]>(() => [
        { clave: "equipo", titulo: "Equipo", valor: (c) => porId.get(c.deviceId)?.name, celda: (c) => {
            const e = porId.get(c.deviceId);
            return <span className="min-w-0"><span className="font-semibold block truncate">{e?.name}</span><span className="text-[11px] text-muted-foreground tabular-nums">{e?.ip}{areaId ? "" : ` · ${nombreArea(c.deviceId)}`}</span></span>;
        } },
        { clave: "cuenta", titulo: "Cuenta", valor: (c) => c.nombre, celda: (c) => <span className="font-semibold">{c.nombre}</span> },
        { clave: "nivel", titulo: "Nivel", valor: (c) => c.nivel || "—" },
        { clave: "clase", titulo: "Clase", valor: (c) => CLASES[c.clase].rotulo, celda: (c) => (
            <span className="inline-flex items-center gap-1.5">
                <Pista texto={CLASES[c.clase].ayuda}><Chip tono={CLASES[c.clase].tono}>{CLASES[c.clase].rotulo}</Chip></Pista>
                {c.conocida && <Pista titulo="Conocida" texto={`${c.conocidaMotivo || ""}${c.conocidaPor ? ` · marcó ${c.conocidaPor}` : ""}`}><ShieldCheck size={13} className="tono-bien" /></Pista>}
            </span>
        ) },
        { clave: "vista", titulo: "Vista", valor: (c) => c.ultimaVez, celda: (c) => <Momento t={c.ultimaVez} /> },
        { clave: "accion", titulo: "", auxiliar: true, alinear: "der", celda: (c) => c.clase === "no-gestionada" && !c.conocida && puedeMarcar
            ? <Button variant="outline" size="sm" onClick={(ev) => { ev.stopPropagation(); setMarcar({ tipo: "cuenta", cuentaId: c.id, nombre: c.nombre, equipo: porId.get(c.deviceId)?.name || "el equipo" }); }}><ShieldCheck />Es conocida</Button>
            : null },
    ], [porId, puedeMarcar, areaId]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <section className="rounded-[10px] border border-border bg-card">
            <header className="flex flex-wrap items-center gap-2 px-4 py-3">
                <button type="button" onClick={plegar} className="flex items-center gap-2 text-left" aria-expanded={!plegado}>
                    <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-muted"><Users size={15} className="text-muted-foreground" /></span>
                    <span>
                        <span className="block text-[13px] font-bold">Cuentas de los equipos{decideArea ? ` · ${decideArea.nombre}` : ""}</span>
                        <span className="block text-[11.5px] text-muted-foreground">{equipos.length} {equipos.length === 1 ? "equipo compatible" : "equipos compatibles"} · {n.leidos} con cuentas leídas</span>
                    </span>
                    <ChevronDown size={15} className={cn("text-muted-foreground transition-transform", plegado && "-rotate-90")} />
                </button>
                <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                    {areaId && (gestora?.gestionada
                        ? <Pista texto={gestora.heredada ? `Hereda la gestión de «${gestora.decide?.nombre}».` : "Esta área gestiona las cuentas de sus equipos."}><Chip tono="bien" icono={ShieldCheck}>Gestionadas{gestora.heredada ? " · heredado" : ""}</Chip></Pista>
                        : <Pista texto="Las cuentas de esta área sólo se leen. Activar la gestión por área llega con las altas y bajas."><Chip tono="quieto" icono={Lock}>Sólo lectura</Chip></Pista>)}
                    {n.ajenas > 0 && <Chip tono="aviso" icono={UserX}>{n.ajenas} {n.ajenas === 1 ? "no gestionada" : "no gestionadas"}</Chip>}
                    {n.conocidas > 0 && <Chip tono="bien" icono={ShieldCheck}>{n.conocidas} {n.conocidas === 1 ? "conocida" : "conocidas"}</Chip>}
                    {n.accesos > 0 && <Chip tono="mal" icono={Globe}>{n.accesos} {n.accesos === 1 ? "acceso desconocido" : "accesos desconocidos"}</Chip>}
                    {n.error > 0 && <Pista texto="La última lectura de esos equipos falló. Se muestra lo último leído; el motivo está en la ficha de cada uno."><Chip tono="aviso" icono={AlertTriangle}>{n.error} sin leer</Chip></Pista>}
                    {!n.ajenas && !n.accesos && !n.error && n.leidos > 0 && <Chip tono="bien" icono={ShieldCheck}>Todo en orden</Chip>}
                    {puedeMarcar && equipos.length > 0 && (
                        <Button size="sm" onClick={revisar} disabled={revisando} className="ml-1">
                            {revisando ? <Loader2 className="animate-spin" /> : <ScanSearch />}Revisar
                        </Button>
                    )}
                </div>
            </header>
            <AnimatePresence initial={false}>
                {!plegado && (
                    <motion.div key="cuerpo" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <Pestanias<Vista> valor={vista} alElegir={setVista} opciones={[
                                    { valor: "cuentas", rotulo: "Cuentas", icono: Users, cuenta: cuentas.length },
                                    { valor: "conectados", rotulo: "Conectados", icono: Wifi, ...(n.accesos ? { cuenta: n.accesos, tono: "mal" as const } : {}) },
                                    { valor: "auditoria", rotulo: "Auditoría", icono: ScrollText },
                                ]} />
                                {vista === "cuentas" && (
                                    <>
                                        <div className="flex flex-wrap gap-1">
                                            {(["todas", "no-gestionada", "servicio", "fabrica", "gestionada"] as FiltroClase[]).map((k) => (
                                                <button key={k} type="button" onClick={() => setClase(k)}
                                                    className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold transition-colors", clase === k ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-muted")}>
                                                    {k === "todas" ? "Todas" : CLASES[k].rotulo}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="ml-auto"><Seek value={q} onChange={setQ} placeholder="Cuenta, equipo o IP" startOpen width={220} alto={34} /></div>
                                    </>
                                )}
                            </div>
                            {vista === "cuentas" && (
                                <Tabla filas={filas} clave={(c) => c.id} columnas={columnas} cargando={cargando && !datos} error={error} alReintentar={() => traer()}
                                    alClickFila={onAbrirEquipo ? (c) => onAbrirEquipo(c.deviceId) : undefined} alto="420px" id="cuentas-equipos" nombreArchivo="cuentas-de-equipos"
                                    vacio={{ icono: ShieldQuestion, titulo: cuentas.length ? "Ninguna cuenta con ese filtro" : "Todavía no hay cuentas leídas", ayuda: cuentas.length ? undefined : "La lectura automática corre cada 5 minutos; las cuentas se leen una vez por hora." }} />
                            )}
                            {vista === "conectados" && <Conectados deviceIds={equipos.map((e) => e.id)} nombreDe={(id) => porId.get(id)?.name || "Equipo dado de baja"} puedeMarcar={puedeMarcar} alMarcar={setMarcar} />}
                            {vista === "auditoria" && <Auditoria deviceIds={deviceIds ? equipos.map((e) => e.id) : null} />}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            <MarcarConocida que={marcar} onCerrar={() => setMarcar(null)} onHecho={() => traer()} />
        </section>
    );
}

function Conectados({ deviceIds, nombreDe, puedeMarcar, alMarcar }: { deviceIds: string[]; nombreDe: (id: string) => string; puedeMarcar: boolean; alMarcar: (q: QueMarcar) => void }) {
    const url = deviceIds.length ? `/api/devices/usuarios/sesiones?abiertas=1&deviceId=${deviceIds.join(",")}` : null;
    const { datos, error, cargando, traer } = useDatos<{ sesiones: SesionVista[] }>(url);
    const columnas: ColumnaTabla<SesionVista>[] = [
        { clave: "equipo", titulo: "Equipo", valor: (s) => nombreDe(s.deviceId), celda: (s) => <span className="font-semibold">{nombreDe(s.deviceId)}</span> },
        { clave: "cuenta", titulo: "Cuenta", valor: (s) => s.nombre },
        { clave: "ip", titulo: "Desde", valor: (s) => s.ip, celda: (s) => <span className="tabular-nums">{s.ip}</span> },
        { clave: "proc", titulo: "Procedencia", valor: (s) => s.procedencia, celda: (s) => {
            const p = PROCEDENCIAS[s.procedencia as Procedencia] || PROCEDENCIAS.desconocida;
            return <Chip tono={p.tono}>{s.origenNombre && s.procedencia !== "servidor" ? s.origenNombre : p.rotulo}</Chip>;
        } },
        { clave: "desde", titulo: "Vista desde", valor: (s) => s.vistaPrimera, celda: (s) => <span className="text-[12px] text-muted-foreground">{hace(s.vistaPrimera)}</span> },
        { clave: "accion", titulo: "", auxiliar: true, alinear: "der", celda: (s) => s.procedencia === "desconocida" && puedeMarcar
            ? <Button variant="outline" size="sm" onClick={() => alMarcar({ tipo: "ip", ip: s.ip, cuenta: s.nombre, equipo: nombreDe(s.deviceId) })}><ShieldCheck />Es conocida</Button> : null },
    ];
    const filas = [...(datos?.sesiones || [])].sort((a, b) => Number(b.procedencia === "desconocida") - Number(a.procedencia === "desconocida"));
    return (
        <div className="space-y-1.5">
            <Tabla filas={filas} clave={(s) => s.id} columnas={columnas} cargando={cargando && !datos} error={error} alReintentar={() => traer()} alto="380px" controles={false}
                vacio={{ icono: Wifi, titulo: "Nadie conectado en la última lectura" }} />
            <p className="text-[11px] text-muted-foreground">Se mira cada 5 minutos: una entrada más corta puede no verse.</p>
        </div>
    );
}

type FilaAuditoria = { id: string; cuando: string; quien: string; accion: string; objetivo: string; detalle: string | null };
function Auditoria({ deviceIds }: { deviceIds: string[] | null }) {
    const url = deviceIds && !deviceIds.length ? null : `/api/devices/usuarios/auditoria?dias=30${deviceIds ? `&deviceId=${deviceIds.join(",")}` : ""}`;
    const { datos, error, cargando, traer } = useDatos<{ filas: FilaAuditoria[] }>(url);
    const columnas: ColumnaTabla<FilaAuditoria>[] = [
        { clave: "cuando", titulo: "Cuándo", valor: (f) => f.cuando, celda: (f) => <Momento t={f.cuando} /> },
        { clave: "accion", titulo: "Qué", valor: (f) => f.accion, celda: (f) => <span className="font-semibold">{f.accion}</span> },
        { clave: "objetivo", titulo: "Dónde", valor: (f) => f.objetivo },
        { clave: "detalle", titulo: "Detalle", valor: (f) => f.detalle || "" },
        { clave: "quien", titulo: "Quién", valor: (f) => f.quien },
    ];
    return <Tabla filas={datos?.filas || []} clave={(f) => f.id} columnas={columnas} cargando={cargando && !datos} error={error} alReintentar={() => traer()} alto="380px" id="auditoria-cuentas" nombreArchivo="auditoria-cuentas-equipos"
        vacio={{ icono: ScrollText, titulo: "Nada en los últimos 30 días", ayuda: "Acá quedan las cuentas nuevas o que se fueron, los accesos desde IP desconocidas y quién marcó qué como conocido." }} />;
}
