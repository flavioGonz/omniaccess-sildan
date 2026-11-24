"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleDashed, MapPin, Plus } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { borrarGeocercaGps, geocercasGps, guardarGeocercaGps, type Geocerca, type Rastreador } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { ErrorEstado, Vacio } from "@/components/ui/estados";
import { Switch } from "@/components/ui/switch";
import { dentroDe, rotuloDeHorario } from "@/lib/gps-geocerca";
import { cn } from "@/lib/utils";
import { nombreDe, Panel } from "@/components/gps/piezas";

/**
 * Las zonas: las geocercas, en una lista.
 *
 * Hasta acá sólo se veían en un panel flotante del mapa, que es donde se DIBUJAN y donde tienen que
 * seguir dibujándose (una zona es un trazo sobre calles). Lo que faltaba es el otro uso: verlas
 * todas juntas, saber quién está adentro de cuál, pausar una sin borrarla. Eso es una lista, y en
 * el celular más: en el mapa hay que encontrarlas con dos dedos.
 *
 * Dibujar y corregir la forma llevan al mapa, con la zona ya abierta.
 */
const valePara = (c: Geocerca, imei: string) => !c.imeis.length || c.imeis.includes(imei);
const tamanio = (c: Geocerca) => (c.puntos ? `Forma libre, ${c.puntos.length} puntos` : c.radio >= 1000 ? `Círculo de ${(c.radio / 1000).toFixed(1).replace(".", ",")} km de radio` : `Círculo de ${c.radio} m de radio`);

export function ZonasGps({ lista, puedeConfig }: { lista: Rastreador[]; puedeConfig: boolean }) {
    const [zonas, setZonas] = useState<Geocerca[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const traer = useCallback(() => {
        setError(null);
        geocercasGps().then(setZonas).catch((e) => setError(e instanceof Error ? e.message : "No se pudieron traer las zonas."));
    }, []);
    useEffect(() => { traer(); }, [traer]);

    const [tocando, setTocando] = useState<string | null>(null);
    const alternar = async (c: Geocerca, activa: boolean) => {
        setTocando(c.id);
        try {
            /* Se manda la zona entera con el interruptor cambiado: guardar es reemplazar, y mandar sólo
               «activa» le borraría el horario y los rastreadores. */
            const x = await guardarGeocercaGps({ id: c.id, nombre: c.nombre, lat: c.lat, lon: c.lon, radio: c.radio, imeis: c.imeis, puntos: c.puntos, horario: c.horario, avisa: c.avisa, activa });
            if (!x.ok) toast.error({ title: "No se pudo cambiar", description: x.error });
            else { setZonas((z) => (z || []).map((y) => (y.id === c.id ? { ...y, activa } : y))); toast.success({ title: activa ? "Zona activa" : "Zona en pausa", description: "El receptor lo toma en menos de un minuto." }); }
        } catch (e) { toast.error({ title: "No se pudo cambiar", description: e instanceof Error ? e.message : undefined }); }
        finally { setTocando(null); }
    };
    const borrar = async (c: Geocerca) => {
        try { const x = await borrarGeocercaGps(c.id); if (!x.ok) toast.error({ title: "No se pudo borrar" }); traer(); }
        catch (e) { toast.error({ title: "No se pudo borrar", description: e instanceof Error ? e.message : undefined }); }
    };

    const conPosicion = lista.filter((r) => r.deviceId && r.lat !== null && r.lon !== null);
    return (
        <div className="mx-auto max-w-3xl space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="flex-1 text-[12.5px] leading-snug text-muted-foreground">Una zona avisa cuando un vehículo entra o sale. Se dibujan sobre el mapa; acá se ven todas juntas y se pausan.</p>
                {puedeConfig && (
                    <Button asChild className="h-11 text-[14px] sm:h-9 sm:text-[13px]">
                        <Link href="/admin/mapa?zona=nueva"><Plus size={16} /> Nueva zona</Link>
                    </Button>
                )}
            </div>

            {error ? <Panel><ErrorEstado mensaje={error} alReintentar={traer} /></Panel>
                : zonas === null ? <Panel><p className="flex items-center justify-center gap-2 py-12 text-[12.5px] text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Trayendo las zonas…</p></Panel>
                : !zonas.length ? <Panel><Vacio icono={CircleDashed} titulo="Todavía no hay ninguna zona" ayuda="La base, un cliente, un barrio que no se debería cruzar: se dibuja en el mapa y avisa sola." /></Panel>
                : (
                    <ul className="space-y-2">
                        {zonas.map((c) => {
                            const adentro = c.activa ? conPosicion.filter((r) => valePara(c, r.imei) && dentroDe(c, r.lat!, r.lon!)) : [];
                            const reglas = [`vigila ${rotuloDeHorario(c.horario)}`, c.avisa === "entra" ? "avisa sólo al entrar" : c.avisa === "sale" ? "avisa sólo al salir" : "avisa al entrar y al salir",
                                c.imeis.length ? `${c.imeis.length} ${c.imeis.length === 1 ? "vehículo" : "vehículos"}` : "todos los vehículos"];
                            return (
                                <li key={c.id}>
                                    <Panel className="p-3.5">
                                        <div className="flex items-start gap-3">
                                            <span className={cn("mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border", !c.activa ? "chip-neutro" : adentro.length ? "chip-bien" : "chip-info")}><CircleDashed size={18} /></span>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-[15px] font-bold leading-tight sm:text-[14px]">{c.nombre}</p>
                                                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{tamanio(c)}</p>
                                                <p className="mt-1 text-[12.5px] leading-snug first-letter:uppercase">{reglas.join(" · ")}.</p>
                                                {!c.activa ? <p className="mt-1 text-[12.5px] font-semibold text-muted-foreground">En pausa: no avisa.</p>
                                                    : adentro.length > 0 ? <p className="tono-bien mt-1 text-[12.5px] font-semibold">Adentro ahora: {adentro.map(nombreDe).join(", ")}.</p>
                                                    : <p className="mt-1 text-[12.5px] text-muted-foreground">Nadie adentro ahora.</p>}
                                            </div>
                                            {puedeConfig && (
                                                /* El interruptor mide 18 px: la etiqueta que lo envuelve le da los 44 que necesita un pulgar. */
                                                <label className="-mr-1.5 -mt-1.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2">
                                                    {tocando === c.id && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
                                                    <Switch checked={c.activa} disabled={tocando === c.id} onCheckedChange={(v) => alternar(c, v)} aria-label={`${c.nombre}: activa`} />
                                                </label>
                                            )}
                                        </div>
                                        <div className="mt-3 flex items-center gap-2">
                                            <Button asChild variant="outline" className="h-11 flex-1 text-[13.5px] sm:h-9 sm:flex-none sm:text-[13px]">
                                                <Link href={`/admin/mapa?zona=${c.id}`}><MapPin size={15} /> {puedeConfig ? "Verla y corregirla en el mapa" : "Verla en el mapa"}</Link>
                                            </Button>
                                            {puedeConfig && <span className="ml-auto"><DeleteButton onConfirm={() => borrar(c)} /></span>}
                                        </div>
                                    </Panel>
                                </li>
                            );
                        })}
                    </ul>
                )}
        </div>
    );
}
