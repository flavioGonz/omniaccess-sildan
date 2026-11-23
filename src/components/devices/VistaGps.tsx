"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, DoorClosed, DoorOpen, FileSpreadsheet, History, Loader2, MapPin, Pencil, Plus, Radio, Satellite, TriangleAlert } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { atarVehiculoGps, cambiarPuertaGps, comandoGps, darDeAltaGps, descartarGps, diagnosticoGps, guardarServicioDireccionesGps, puertaGps, renombrarGps, servicioDireccionesGps, type DiagnosticoGps, type Rastreador } from "@/app/actions/gps";
import { ReportesGps, type InicioDeReportes } from "@/components/mapa/ReportesGps";
import { DeleteButton } from "@/components/ui/delete-button";
import { Pista } from "@/components/ui/pista";
import { Switch } from "@/components/ui/switch";
import { arrastrarEquipos } from "@/components/devices/ArbolAreas";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Los rastreadores GPS, en Dispositivos: una tabla, como el resto de los equipos.
 *
 * La primera versión fueron tarjetas, y Nico la devolvió el mismo día: «no debe ser una card,
 * sino una tabla como el resto de dispositivos». Tenía razón por una razón práctica: con veinte
 * camionetas una grilla de tarjetas no se puede barrer con la vista ni comparar — cuál tiene la
 * batería baja, cuál no reporta — y una tabla sí. Lo que cambia respecto de la tabla general son
 * las columnas: «Grabación» y «Hora del equipo» no le dicen nada a un rastreador; motor, batería
 * del vehículo, señal y posición sí.
 *
 * Dos cosas que la tabla dice con cuidado:
 *  · **La posición puede ser vieja.** Bajo techo el equipo sigue en línea pero sin satélites. Por
 *    eso «Reportó» y «Posición de» son columnas distintas: juntarlas haría creer que está ahí.
 *  · **El que se presenta solo no entra solo.** Su fila ofrece «Dar de alta» y nada más, hasta
 *    que alguien lo acepta (ver actions/gps).
 */

const SENAL = ["Sin señal", "Muy baja", "Baja", "Buena", "Fuerte"];
/** Debajo de esto, la batería de un vehículo de 12 V está descargándose. */
const VOLTAJE_BAJO = 11.8;
const TH = "text-muted-foreground font-semibold tracking-wide uppercase text-[10px]";

export function VistaGps({ lista, busqueda, alCambiar }: {
    lista: Rastreador[];
    busqueda?: string;
    alCambiar: () => void;
}) {
    const q = (busqueda || "").trim().toLowerCase();
    const filas = q ? lista.filter((r) => [r.nombre, r.imei, r.matricula].some((x) => (x || "").toLowerCase().includes(q))) : lista;

    /* El diagnóstico de instalación recorre un día de posiciones: se pide al entrar y cada cinco
       minutos, no con cada refresco de la tabla. */
    const [diag, setDiag] = useState<Record<string, DiagnosticoGps>>({});
    useEffect(() => {
        let vivo = true;
        const traer = () => diagnosticoGps().then((d) => { if (vivo) setDiag(Object.fromEntries(d.map((x) => [x.imei, x]))); }).catch(() => { /* sin diagnóstico la tabla sigue andando */ });
        traer(); const iv = setInterval(traer, 5 * 60_000);
        return () => { vivo = false; clearInterval(iv); };
    }, []);

    /* La puerta del receptor: si un equipo desconocido que se presenta se anota o no. */
    const [puerta, setPuerta] = useState<{ cerrada: boolean; pendientes: number } | null>(null);
    const [cambiandoPuerta, setCambiandoPuerta] = useState(false);
    useEffect(() => { puertaGps().then(setPuerta).catch(() => { }); }, [lista.length]);
    const cambiarPuerta = async (cerrada: boolean) => {
        setCambiandoPuerta(true);
        try {
            await cambiarPuertaGps(cerrada);
            setPuerta((p) => (p ? { ...p, cerrada } : p));
            toast.success({ title: cerrada ? "Puerta cerrada" : "Puerta abierta", description: cerrada ? "El receptor sólo atiende a los rastreadores dados de alta. Vale en menos de un minuto." : "Un rastreador nuevo que se conecte va a aparecer acá para darlo de alta. Vale en menos de un minuto." });
        } catch (e) { toast.error({ title: "No se pudo cambiar", description: e instanceof Error ? e.message : undefined }); }
        finally { setCambiandoPuerta(false); }
    };

    /* Los reportes: de un vehículo (el ícono de su fila) o de todos (el botón de arriba). */
    const [reportes, setReportes] = useState<InicioDeReportes | null>(null);
    const hayDeAlta = lista.some((r) => r.deviceId);

    return (
        <>
        <ReportesGps abierto={!!reportes} alCerrar={() => setReportes(null)} rastreadores={lista} inicio={reportes || undefined} />
        {puerta && (
            <div className="mb-3 flex items-center gap-3 rounded-[10px] border border-border bg-card/40 px-4 py-2.5">
                <span className={cn("h-8 w-8 shrink-0 grid place-items-center rounded-full border", puerta.cerrada ? "chip-bien" : "chip-aviso")}>{puerta.cerrada ? <DoorClosed size={15} /> : <DoorOpen size={15} />}</span>
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{puerta.cerrada ? "El receptor sólo atiende a los rastreadores dados de alta" : "El receptor anota a los rastreadores nuevos que se conectan"}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                        {puerta.cerrada
                            ? "Para instalar uno nuevo, abrí la puerta, esperá a que aparezca en la tabla, dalo de alta y volvé a cerrarla."
                            : "Así se instala uno nuevo. El puerto está en internet: cuando no estés instalando, conviene cerrarla."}
                        {puerta.pendientes > 0 && ` Hay ${puerta.pendientes} sin dar de alta.`}
                    </p>
                </div>
                <label className="flex items-center gap-2 text-[12px] font-semibold shrink-0">
                    {cambiandoPuerta && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
                    Puerta cerrada <Switch checked={puerta.cerrada} disabled={cambiandoPuerta} onCheckedChange={cambiarPuerta} aria-label="Cerrar la puerta del receptor a rastreadores nuevos" />
                </label>
            </div>
        )}
        <ServicioDeDirecciones />
        {hayDeAlta && (
            <div className="mb-2 flex justify-end">
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => setReportes({})}><FileSpreadsheet size={14} /> Reportes de rastreo</Button>
            </div>
        )}
        <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
            <Table>
                <TableHeader className="bg-card/60">
                    <TableRow className="border-border/60 hover:bg-transparent">
                        <TableHead className={cn(TH, "py-2.5 pl-4")}>Equipo</TableHead>
                        <TableHead className={TH}>Vehículo</TableHead>
                        <TableHead className={TH}>Estado</TableHead>
                        <TableHead className={TH}>Motor</TableHead>
                        <TableHead className={TH}>Batería</TableHead>
                        <TableHead className={TH}>Señal</TableHead>
                        <TableHead className={TH}>Posición</TableHead>
                        <TableHead className={TH}>Relé</TableHead>
                        <TableHead className={cn(TH, "text-right pr-4")}>Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filas.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={9} className="text-center py-16">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="p-5 bg-card/50 rounded-lg border border-dashed border-border"><Satellite size={36} className="text-muted-foreground" /></div>
                                    <p className="text-sm font-semibold text-muted-foreground">{lista.length ? "Ninguno coincide con la búsqueda" : "Todavía no se presentó ningún rastreador"}</p>
                                    {!lista.length && <p className="text-xs text-muted-foreground max-w-md">Un rastreador aparece acá solo cuando se conecta al receptor (puerto 1341 de este servidor).</p>}
                                </div>
                            </TableCell>
                        </TableRow>
                    )}
                    {filas.map((r) => <Fila key={r.imei} r={r} d={diag[r.imei]} alCambiar={alCambiar} alReportes={() => setReportes({ imeis: [r.imei] })} />)}
                </TableBody>
            </Table>
        </div>
        </>
    );
}

/**
 * El servicio de direcciones: dónde está y si contesta (23/11).
 *
 * Es un Nominatim propio de IES —no un servicio de afuera: por dónde anda cada vehículo no se le
 * manda a un tercero—, y OmniAccess sólo necesita saber en qué dirección de la red está. Va acá,
 * al lado de la puerta del receptor, porque es la otra pieza de afuera de la que dependen los
 * rastreadores. Sin él todo anda igual, pero los lugares se dicen con coordenadas: por eso se ve
 * siempre cómo está, y no sólo cuando alguien lo va a buscar.
 */
function ServicioDeDirecciones() {
    const [e, setE] = useState<Awaited<ReturnType<typeof servicioDireccionesGps>> | null>(null);
    const [borrador, setBorrador] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => { servicioDireccionesGps().then(setE).catch(() => { /* sin saber cómo está, no se muestra nada: no es un error de esta pantalla */ }); }, [vuelta]);
    if (!e) return null;
    const guardar = async () => {
        setGuardando(true); setError(null);
        try {
            const r = await guardarServicioDireccionesGps(borrador || "");
            if (!r.ok) { setError(r.error || "No se pudo guardar."); return; }
            setBorrador(null); setVuelta((n) => n + 1);
            toast.success({ title: borrador ? "Servicio de direcciones guardado" : "Sin servicio de direcciones", description: r.ejemplo ? `Contesta. Por ejemplo: «${r.ejemplo}».` : undefined });
        } catch (x) { setError(x instanceof Error ? x.message : "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    const bien = !!e.url && e.ok;
    return (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-card/40 px-4 py-2.5">
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border", bien ? "chip-bien" : e.url ? "chip-mal" : "chip-quieto")}><MapPin size={15} /></span>
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{bien ? "Los lugares se dicen con su dirección" : e.url ? "El servicio de direcciones no contesta" : "Sin servicio de direcciones"}</p>
                <p className="text-[11.5px] text-muted-foreground">
                    {bien ? <>Servicio propio en <span className="tabular-nums">{e.url}</span>{e.ejemplo ? ` · por ejemplo, «${e.ejemplo}»` : ""}{e.guardadas ? ` · ${e.guardadas.toLocaleString("es-UY")} direcciones ya averiguadas` : ""}.</>
                        : e.url ? <>Está cargado <span className="tabular-nums">{e.url}</span> y no responde. Mientras tanto los lugares se ven con coordenadas{e.guardadas ? "; los ya averiguados siguen saliendo con su dirección" : ""}.</>
                        : "Las paradas, los reportes y el mapa muestran coordenadas. Cargá la dirección del servicio propio de IES para que digan la calle."}
                </p>
                {borrador !== null && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <input value={borrador} onChange={(x) => setBorrador(x.target.value)} placeholder="http://172.26.20.186:8080" autoFocus aria-label="Dirección del servicio"
                            onKeyDown={(x) => { if (x.key === "Enter") guardar(); if (x.key === "Escape") setBorrador(null); }}
                            className="h-8 w-[260px] max-w-full rounded-[6px] border border-border bg-background px-2 text-[12.5px] tabular-nums outline-none focus:border-[var(--accion)]" />
                        <Button size="sm" className="h-8 px-2.5 text-[12px]" disabled={guardando} onClick={guardar}>{guardando && <Loader2 size={13} className="animate-spin" />} Probar y guardar</Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-[12px]" disabled={guardando} onClick={() => { setBorrador(null); setError(null); }}>Cancelar</Button>
                        {error && <p className="tono-mal w-full text-[11.5px] font-semibold" role="alert">{error}</p>}
                    </div>
                )}
            </div>
            {borrador === null && <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12px]" onClick={() => { setError(null); setBorrador(e.url || ""); }}>{e.url ? "Cambiar" : "Cargar"}</Button>}
        </div>
    );
}

function Fila({ r, d, alCambiar, alReportes }: { r: Rastreador; d?: DiagnosticoGps; alCambiar: () => void; alReportes: () => void }) {
    const [trabajando, setTrabajando] = useState(false);
    const [nombre, setNombre] = useState("");
    /** El nombre en edición, o `null` si no se está cambiando. */
    const [nuevo, setNuevo] = useState<string | null>(null);
    const renombrar = async () => {
        if (nuevo === null) return;
        setTrabajando(true);
        try {
            const x = await renombrarGps(r.imei, nuevo);
            if (!x.ok) toast.error({ title: "No se pudo cambiar el nombre", description: x.error });
            else { setNuevo(null); alCambiar(); }
        } finally { setTrabajando(false); }
    };
    const [chapa, setChapa] = useState(r.matricula || "");
    const conPosicion = r.lat !== null && r.lon !== null;
    const bajo = r.voltaje !== null && r.voltaje < VOLTAJE_BAJO;

    /* El relé se acciona en dos toques: el primero arma («¿Confirmar?») y el segundo dispara. Si
       no hay segundo toque en unos segundos se desarma solo. Un botón que corta un motor no puede
       dispararse con un clic que iba para la fila de al lado. */
    const [armado, setArmado] = useState(false);
    const [mandando, setMandando] = useState<string | null>(null);
    useEffect(() => { if (!armado) return; const t = setTimeout(() => setArmado(false), 5000); return () => clearTimeout(t); }, [armado]);
    const mandar = async (accion: "estado" | "rele.accionar" | "rele.soltar") => {
        setMandando(accion); setArmado(false);
        try {
            const x = await comandoGps(r.imei, accion);
            /* Se muestra lo que contestó EL EQUIPO, textual: es la única palabra que vale. */
            if (!x.ok) toast.error({ title: accion === "estado" ? "No contestó" : "No se accionó", description: x.error });
            else toast.success({ title: accion === "estado" ? "El equipo contestó" : accion === "rele.accionar" ? "Relé accionado" : "Relé en reposo", description: x.respuesta });
            alCambiar();
        } finally { setMandando(null); }
    };

    const alta = async () => {
        setTrabajando(true);
        try {
            const x = await darDeAltaGps(r.imei, nombre);
            if (!x.ok) toast.error({ title: "No se pudo dar de alta", description: x.error });
            else { toast.success({ title: "Rastreador dado de alta" }); alCambiar(); }
        } finally { setTrabajando(false); }
    };
    const atar = async () => {
        setTrabajando(true);
        try {
            const x = await atarVehiculoGps(r.imei, chapa);
            if (!x.ok) toast.error({ title: "No se pudo atar", description: x.error });
            else { toast.success({ title: chapa ? "Atado al vehículo" : "Desatado" }); alCambiar(); }
        } finally { setTrabajando(false); }
    };

    return (
        /* Arrastrable al árbol de áreas, como cualquier otro equipo — sólo si ya está dado de alta:
           lo que se arrastra es el equipo, y el que se presentó solo todavía no es uno. */
        <TableRow className="border-border/50" draggable={!!r.deviceId}
            onDragStart={(e) => { if (r.deviceId) arrastrarEquipos(e, [r.deviceId], r.nombre || r.imei); }}>
            <TableCell className="py-2 pl-4">
                <div className="flex items-center gap-3 min-w-0">
                    <span className={cn("w-9 h-9 rounded-md grid place-items-center shrink-0", r.enLinea ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}><Satellite size={17} /></span>
                    <div className="min-w-0">
                        {nuevo !== null ? (
                            <input autoFocus value={nuevo} onChange={(e) => setNuevo(e.target.value)} aria-label="Nombre del rastreador"
                                onKeyDown={(e) => { if (e.key === "Enter") renombrar(); if (e.key === "Escape") setNuevo(null); }}
                                className="h-7 w-[180px] px-2 rounded-[6px] border border-border bg-background text-[12.5px] font-semibold" />
                        ) : <p className="text-[13px] font-semibold truncate">{r.nombre || `Rastreador ${r.imei.slice(-6)}`}</p>}
                        <p className="text-[10.5px] text-muted-foreground tabular-nums truncate">IMEI {r.imei}{!r.deviceId && <span className="tono-aviso font-semibold"> · sin dar de alta</span>}</p>
                    </div>
                    {/* Lo que los datos dicen de cómo quedó instalado (actions/gps, diagnosticoGps). */}
                    {d && d.avisos.length > 0 && (
                        <Pista ancho={320} lado="derecha" titulo={d.avisos.length === 1 ? "Para revisar en la instalación" : `${d.avisos.length} cosas para revisar en la instalación`}
                            texto={<span className="block space-y-1.5">{d.avisos.map((a) => <span key={a} className="block">{a}</span>)}</span>}>
                            <span className="h-6 px-1.5 rounded-full border chip-aviso text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 cursor-help"><TriangleAlert size={12} />{d.avisos.length}</span>
                        </Pista>
                    )}
                </div>
            </TableCell>

            <TableCell>
                {r.deviceId ? (
                    <div className="flex items-center gap-1.5">
                        <input value={chapa} onChange={(e) => setChapa(e.target.value.toUpperCase())} placeholder="Matrícula" aria-label="Matrícula del vehículo"
                            className="h-7 w-[92px] px-2 rounded-[6px] border border-border bg-background text-[12px] font-semibold tabular-nums" />
                        {chapa !== (r.matricula || "") && (
                            <Button variant="outline" size="sm" className="h-7 px-2 text-[11.5px]" disabled={trabajando} onClick={atar}>
                                {trabajando ? <Loader2 size={12} className="animate-spin" /> : chapa ? "Atar" : "Desatar"}
                            </Button>
                        )}
                    </div>
                ) : <span className="text-[11.5px] text-muted-foreground">—</span>}
            </TableCell>

            <TableCell>
                {/* «Dejó de reportar» es un evento que se avisó (el receptor lo detecta), no sólo un equipo
                    que hace rato no habla: por eso va en rojo y no en gris. */}
                {r.sinReporteDesde ? (
                    <span className="h-6 px-2 rounded-md text-[9.5px] font-bold uppercase inline-flex items-center gap-1 border w-fit chip-mal">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--mal)]" />Dejó de reportar
                    </span>
                ) : (
                    <span className={cn("h-6 px-2 rounded-md text-[9.5px] font-bold uppercase inline-flex items-center gap-1 border w-fit",
                        r.enLinea ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25" : "text-muted-foreground border-border bg-muted/40")}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", r.enLinea ? "bg-emerald-500" : "bg-muted-foreground/40")} />{r.enLinea ? "En línea" : "Sin reportar"}
                    </span>
                )}
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">Reportó {hace(r.ultimoLatido, "nunca")}</p>
            </TableCell>

            <TableCell className="text-[12.5px]">
                {r.encendido === null ? <span className="text-muted-foreground">—</span>
                    : <span className={cn("font-semibold", r.encendido ? "tono-bien" : "text-muted-foreground")}>{r.encendido ? "Encendido" : "Apagado"}</span>}
                {(r.velocidad || 0) > 0 && <p className="text-[10.5px] text-muted-foreground tabular-nums">{r.velocidad} km/h</p>}
            </TableCell>

            <TableCell className="text-[12.5px] tabular-nums">
                {r.voltaje !== null
                    ? <span className={cn("font-semibold", bajo && "tono-aviso")} title={bajo ? "Batería del vehículo baja" : "Batería del vehículo"}>{r.voltaje.toFixed(1).replace(".", ",")} V</span>
                    : <span className="text-muted-foreground">—</span>}
            </TableCell>

            <TableCell className="text-[12.5px]">{r.senal !== null ? SENAL[Math.min(4, r.senal)] : <span className="text-muted-foreground">—</span>}</TableCell>

            <TableCell>
                {conPosicion ? (
                    <>
                        {/* La calle si se sabe; las coordenadas quedan al pasar el mouse, para quien las necesite copiar. */}
                        {r.direccion
                            ? <p className="max-w-[230px] truncate text-[12px] font-semibold" title={`${r.direccion} (${r.lat!.toFixed(5)}, ${r.lon!.toFixed(5)})`}>{r.direccion}</p>
                            : <p className="text-[12px] font-semibold tabular-nums">{r.lat!.toFixed(5)}, {r.lon!.toFixed(5)}</p>}
                        <p className="text-[10.5px] text-muted-foreground">de {hace(r.cuando)}{d ? ` · ${d.posiciones.toLocaleString("es-UY")} ${d.posiciones === 1 ? "punto" : "puntos"}` : ""}</p>
                    </>
                ) : <span className="text-[11.5px] text-muted-foreground">Sin satélites todavía</span>}
            </TableCell>

            <TableCell>
                {!r.deviceId ? <span className="text-[11.5px] text-muted-foreground">—</span> : (
                    <div className="flex items-center gap-1.5">
                        <span className={cn("h-6 px-2 rounded-md text-[9.5px] font-bold uppercase inline-flex items-center gap-1 border w-fit",
                            r.cortado ? "bg-red-500/10 text-red-500 border-red-500/25" : "text-muted-foreground border-border bg-muted/40")}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", r.cortado ? "bg-red-500" : "bg-muted-foreground/40")} />
                            {r.cortado === null ? "Sin dato" : r.cortado ? "Accionado" : "En reposo"}
                        </span>
                        {r.cortado ? (
                            <Button variant="outline" size="sm" className="h-7 px-2 text-[11.5px]" disabled={!!mandando || !r.enLinea} onClick={() => mandar("rele.soltar")}>
                                {mandando === "rele.soltar" ? <Loader2 size={12} className="animate-spin" /> : "Soltar"}
                            </Button>
                        ) : armado ? (
                            <Button size="sm" className="h-7 px-2 text-[11.5px] pleno-mal" disabled={!!mandando} onClick={() => mandar("rele.accionar")}>¿Confirmar?</Button>
                        ) : (
                            <Button variant="outline" size="sm" className="h-7 px-2 text-[11.5px]" disabled={!!mandando || !r.enLinea}
                                title={r.enLinea ? "Accionar el relé del rastreador" : "El rastreador no está en línea"} onClick={() => setArmado(true)}>
                                {mandando === "rele.accionar" ? <Loader2 size={12} className="animate-spin" /> : "Accionar"}
                            </Button>
                        )}
                    </div>
                )}
            </TableCell>

            <TableCell className="pr-4">
                <div className="flex items-center justify-end gap-1">
                    {r.deviceId ? (
                        <>
                            {conPosicion && (
                                <Link href={`/admin/mapa?gps=${r.imei}`} title="Ver en el mapa"
                                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><MapPin size={14} /></Link>
                            )}
                            <Link href={`/admin/mapa?gps=${r.imei}&eventos=1`} title="Ver sus eventos en el mapa"
                                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><History size={14} /></Link>
                            <button type="button" onClick={alReportes} title="Reportes de este vehículo: viajes, paradas, excesos, geocercas… en Excel o PDF"
                                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><FileSpreadsheet size={14} /></button>
                            <button type="button" onClick={() => mandar("estado")} disabled={!!mandando || !r.enLinea} title="Preguntarle al equipo cómo está"
                                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40">
                                {mandando === "estado" ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}</button>
                            {nuevo !== null ? (
                                <button type="button" onClick={renombrar} disabled={trabajando} title="Guardar el nombre"
                                    className="h-7 w-7 grid place-items-center rounded-md text-[var(--accion)] hover:bg-accent">{trabajando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}</button>
                            ) : (
                                <button type="button" onClick={() => setNuevo(r.nombre || "")} title="Cambiar el nombre"
                                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><Pencil size={14} /></button>
                            )}
                        </>
                    ) : (
                        <>
                            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Camioneta 1)" aria-label="Nombre del rastreador"
                                className="h-7 w-[168px] px-2 rounded-[6px] border border-border bg-background text-[12px]" />
                            <Button size="sm" className="h-7 px-2.5 text-[11.5px]" disabled={trabajando} onClick={alta}>
                                {trabajando ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Dar de alta
                            </Button>
                            {/* No es de nadie: se puede descartar. Si vuelve a conectarse con la puerta abierta, vuelve a aparecer. */}
                            <DeleteButton onConfirm={async () => { const x = await descartarGps(r.imei); if (!x.ok) toast.error({ title: "No se pudo descartar", description: x.error }); alCambiar(); }} />
                        </>
                    )}
                </div>
            </TableCell>
        </TableRow>
    );
}
