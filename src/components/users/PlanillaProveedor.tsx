"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Car, ExternalLink, Loader2, Plus, UserMinus, Users } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { agregarEmpleado, getPlanilla, ponerAutorizado, quitarDeLaPlanilla, type RangoPlanilla } from "@/app/actions/proveedores";
import { duracion } from "@/lib/visitas/calculos";

/**
 * La planilla de un proveedor: quiénes trabajan para la empresa, si la empresa los autoriza, y
 * cuánto se quedó cada uno.
 *
 * Cada empleado es una persona con su credencial propia (tarjeta, PIN, rostro, su matrícula):
 * la permanencia sale de SUS pasadas por los equipos de entrada y salida (lib/planilla). Sin
 * credencial no hay cómo medirlo, y la fila lo dice en vez de mostrar un cero.
 *
 * Los campos de acá no tienen `name`: viven dentro del formulario de la ficha del proveedor y
 * no tienen que viajar con él. Cada acción se guarda sola, en el momento.
 */

type Datos = Awaited<ReturnType<typeof getPlanilla>>;
const RANGOS: { v: RangoPlanilla; rotulo: string }[] = [{ v: 1, rotulo: "Hoy" }, { v: 7, rotulo: "7 días" }, { v: 30, rotulo: "30 días" }];
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });

export function PlanillaProveedor({ proveedorId, alAbrirFicha, alCambiar }: {
    proveedorId: string;
    /** Abre la ficha de un empleado (para cargarle credenciales). */
    alAbrirFicha: (id: string) => void;
    /** Para el resumen de la sección plegada. */
    alCambiar?: (r: { empleados: number; adentro: number }) => void;
}) {
    const [rango, setRango] = useState<RangoPlanilla>(7);
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nuevo, setNuevo] = useState({ nombre: "", dni: "", autorizado: true });
    const [agregando, setAgregando] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const d = await getPlanilla(proveedorId, rango);
            setDatos(d); setError(null);
            alCambiar?.({ empleados: d.empleados.length, adentro: d.empleados.filter((e) => e.adentroDesde).length });
        } catch (e: any) { setError(e?.message || "No se pudo leer la planilla"); }
    }, [proveedorId, rango]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { cargar(); }, [cargar]);

    async function agregar() {
        if (!nuevo.nombre.trim()) return;
        setAgregando(true);
        try {
            await agregarEmpleado(proveedorId, nuevo);
            setNuevo({ nombre: "", dni: "", autorizado: true });
            toast.success({ title: "Agregado a la planilla", description: "Abrí su ficha para cargarle la tarjeta, el PIN o el rostro: sin credencial no se mide su permanencia." });
            await cargar();
        } catch (e: any) { toast.error({ title: "No se agregó", description: e?.message }); }
        finally { setAgregando(false); }
    }
    async function autorizar(id: string, v: boolean) {
        setDatos((d) => d && { ...d, empleados: d.empleados.map((e) => (e.id === id ? { ...e, autorizado: v } : e)) });
        try { await ponerAutorizado(id, v); await cargar(); }
        catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); await cargar(); }
    }
    async function quitar(id: string, nombre: string) {
        try { await quitarDeLaPlanilla(id); toast.success({ title: `${nombre} salió de la planilla`, description: "La persona y su historial siguen en Usuarios." }); await cargar(); }
        catch (e: any) { toast.error({ title: "No se pudo", description: e?.message }); }
    }

    if (error && !datos) return <ErrorEstado mensaje={error} alReintentar={cargar} />;
    if (!datos) return <div className="text-[12px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Trayendo la planilla…</div>;

    const enRango = rango === 1 ? "hoy" : `en ${rango} días`;
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                {RANGOS.map((r) => (
                    <button key={r.v} type="button" onClick={() => setRango(r.v)}
                        className={cn("px-2.5 py-1 rounded-full border text-[12px] font-semibold", rango === r.v ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                        {r.rotulo}
                    </button>
                ))}
                <span className="ml-auto text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5 tabular-nums">
                    <Car size={12} />
                    {datos.sinVehiculos ? "La empresa no tiene matrículas" : `Vehículos de la empresa: ${datos.vehiculos.entradas} ${datos.vehiculos.entradas === 1 ? "entrada" : "entradas"} ${enRango}${datos.vehiculos.totalMin ? ` · ${duracion(datos.vehiculos.totalMin)}` : ""}${datos.vehiculos.adentro ? ` · ${datos.vehiculos.adentro} adentro` : ""}`}
                </span>
            </div>

            {datos.empleados.length === 0 ? (
                <p className="text-[12px] text-muted-foreground rounded-[10px] border border-dashed border-border px-3 py-3">Sin empleados cargados. Es opcional: sirve para saber quién de la empresa entró, si la empresa lo autoriza y cuánto se quedó cada uno.</p>
            ) : (
                <div className="rounded-[10px] border border-border divide-y divide-border">
                    {datos.empleados.map((e) => {
                        const sinCredencial = e.credenciales.length === 0;
                        return (
                            <div key={e.id} className={cn("flex items-center gap-3 px-3 py-2.5", !e.autorizado && "bg-[var(--mal-suave)]")}>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button type="button" onClick={() => alAbrirFicha(e.id)} className="text-[13px] font-semibold hover:underline text-left">{e.nombre}</button>
                                        {e.dni && <span className="text-[11px] text-muted-foreground tabular-nums">CI {e.dni}</span>}
                                        {e.adentroDesde && <Chip tono="bien">adentro desde {hora(e.adentroDesde)}</Chip>}
                                        {!e.autorizado && <Chip tono="mal">no autorizado</Chip>}
                                        {e.pasoSinAutorizacion > 0 && (
                                            <Pista titulo="Entró sin autorización" texto="Su credencial abrió después de que la empresa lo marcó no autorizado: sigue cargada en algún equipo. Sacala desde Dispositivos o desde su ficha.">
                                                <span className="inline-flex"><Chip tono="mal" icono={AlertTriangle}>entró {e.pasoSinAutorizacion} {e.pasoSinAutorizacion === 1 ? "vez" : "veces"} sin autorización</Chip></span>
                                            </Pista>
                                        )}
                                    </div>
                                    <div className="text-[11.5px] text-muted-foreground tabular-nums mt-0.5">
                                        {sinCredencial
                                            ? <>Sin credencial: no se puede medir. <button type="button" onClick={() => alAbrirFicha(e.id)} className="tono-accion font-semibold hover:underline">Cargarle una</button></>
                                            : <>{e.credenciales.join(" · ")} · {e.totalMin || e.adentroDesde ? `${duracion(e.totalMin)} ${enRango}` : `sin pasadas ${enRango}`}{rango !== 1 && e.dias ? ` en ${e.dias} ${e.dias === 1 ? "día" : "días"}` : ""}{rango !== 1 && e.hoyMin ? ` · hoy ${duracion(e.hoyMin)}` : ""}</>}
                                        {(e.sinSalida > 0 || e.salidasSinEntrada > 0) && (
                                            <Pista titulo="El total puede quedar corto" texto="Una entrada sin salida leída no tiene hora de fin y no se suma (sería inventar horas). Una salida sin entrada leída quiere decir que entró por donde no hay equipo.">
                                                <span className="ml-1 tono-aviso cursor-help">· {[e.sinSalida ? `${e.sinSalida} sin salida` : "", e.salidasSinEntrada ? `${e.salidasSinEntrada} sin entrada` : ""].filter(Boolean).join(", ")}</span>
                                            </Pista>
                                        )}
                                    </div>
                                </div>
                                <Pista titulo={e.autorizado ? "Autorizado por la empresa" : "No autorizado"} texto="No autorizado: no se le mandan credenciales a los equipos desde su ficha, y si su credencial igual abre, la planilla lo marca.">
                                    <span className="inline-flex"><Switch checked={e.autorizado} onCheckedChange={(v) => autorizar(e.id, v)} aria-label={`${e.nombre}: autorizado`} /></span>
                                </Pista>
                                <button type="button" onClick={() => alAbrirFicha(e.id)} className="text-muted-foreground hover:text-foreground" aria-label={`Ficha de ${e.nombre}`}><ExternalLink size={14} /></button>
                                <button type="button" onClick={() => quitar(e.id, e.nombre)} className="text-muted-foreground hover:text-[var(--mal-texto)]" aria-label={`Sacar a ${e.nombre} de la planilla`}><UserMinus size={14} /></button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Agregar: sin `name` (no viaja con la ficha del proveedor) y Enter agrega, no guarda la ficha. */}
            <div className="flex items-end gap-2 flex-wrap">
                <label className="flex-1 min-w-[160px]">
                    <span className="block text-[11.5px] font-medium text-foreground/85 mb-1">Nombre</span>
                    <Input value={nuevo.nombre} onChange={(ev) => setNuevo((n) => ({ ...n, nombre: ev.target.value }))} placeholder="Empleado de la empresa"
                        onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); agregar(); } }} />
                </label>
                <label className="w-[140px]">
                    <span className="block text-[11.5px] font-medium text-foreground/85 mb-1">Documento</span>
                    <Input value={nuevo.dni} onChange={(ev) => setNuevo((n) => ({ ...n, dni: ev.target.value }))} placeholder="Sin puntos" className="tabular-nums"
                        onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); agregar(); } }} />
                </label>
                <label className="flex items-center gap-2 h-9 text-[12px]">
                    <Switch checked={nuevo.autorizado} onCheckedChange={(v) => setNuevo((n) => ({ ...n, autorizado: v }))} /> Autorizado
                </label>
                <Button type="button" variant="outline" onClick={agregar} disabled={!nuevo.nombre.trim() || agregando}>
                    {agregando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar
                </Button>
            </div>
            <p className="text-[11.5px] text-muted-foreground flex items-start gap-1.5"><Users size={12} className="mt-0.5 shrink-0" /> Cada empleado entra con su credencial propia. Su permanencia sale de sus pasadas por los equipos de entrada y de salida.</p>
        </div>
    );
}
