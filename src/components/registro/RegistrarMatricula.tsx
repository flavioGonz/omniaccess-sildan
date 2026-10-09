"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ExternalLink, Eye, Info, Loader2, ShieldAlert, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Estado, Matricula } from "@/components/ui/celdas";
import { CajonUsuario } from "@/components/users/CajonUsuario";
import { WatchlistDialog } from "@/components/WatchlistDialog";
import { queSeSabeDeMatricula } from "@/app/actions/registro";

/**
 * «Registrar» una matrícula leída: primero QUÉ es, después el cajón que corresponde.
 *
 * El botón abría directo el alta de una persona (y en el diálogo viejo, no en el cajón).
 * Pero una matrícula que el guardia quiere "registrar" es una de dos cosas muy distintas:
 *
 *   · alguien del barrio —residente, personal, proveedor habitual— que tiene que quedar en
 *     el padrón con su nombre y su lote; o
 *   · una matrícula a vigilar —lista negra, en búsqueda, VIP— que no es de nadie conocido y
 *     no tiene por qué ser una persona.
 *
 * Mezclarlas generaba personas inventadas para poder marcar un auto sospechoso, y autos de
 * vecinos cargados como "vigilancia" para que dejaran de salir en rojo. Por eso se pregunta
 * antes, se dice qué pasa con cada opción, y se avisa si la matrícula ya está en alguna de
 * las dos.
 */

type Paso = "elegir" | "persona" | "vigilancia";

function Opcion({ icono: Icono, titulo, para, pasa, alElegir, aviso, alerta }: {
    icono: React.ComponentType<{ size?: number; className?: string }>; titulo: string; para: string; pasa: string[]; alElegir: () => void; aviso?: React.ReactNode;
    /**
     * La opción que pone a alguien bajo vigilancia lleva el fondo de alerta: no es otra forma
     * de "registrar", es marcar un auto como sospechoso o buscado, y eso se tiene que notar
     * antes de tocar.
     */
    alerta?: boolean;
}) {
    return (
        <button type="button" onClick={alElegir}
            className={cn("group w-full text-left rounded-[10px] border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]",
                alerta ? "bg-[var(--mal-suave)] border-[color-mix(in_oklab,var(--mal)_34%,transparent)] hover:border-[var(--mal)]"
                    : "bg-card border-border hover:border-[var(--accion)] hover:bg-[color-mix(in_oklab,var(--accion)_5%,transparent)]")}>
            <div className="flex items-start gap-3">
                <span className={cn("w-10 h-10 rounded-[10px] border grid place-items-center shrink-0",
                    alerta ? "bg-background/60 border-[color-mix(in_oklab,var(--mal)_34%,transparent)] tono-mal" : "bg-muted border-border text-muted-foreground group-hover:text-[var(--accion)]")}>
                    <Icono size={19} />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-foreground flex items-center gap-2">{titulo}
                        <ArrowRight size={15} className="ml-auto text-muted-foreground group-hover:text-[var(--accion)] transition-transform group-hover:translate-x-0.5" />
                    </p>
                    <p className="text-[12.5px] text-muted-foreground mt-0.5">{para}</p>
                    <ul className="mt-3 space-y-1.5">
                        {pasa.map((t) => (
                            <li key={t} className="flex items-start gap-2 text-[12px] text-foreground/80 leading-snug">
                                <Check size={13} className="mt-0.5 shrink-0 text-muted-foreground" /> {t}
                            </li>
                        ))}
                    </ul>
                    {aviso && <div className="mt-3">{aviso}</div>}
                </div>
            </div>
        </button>
    );
}

export function RegistrarMatricula({ plate, alCerrar, alTerminar, units, groups, devices, parkingSlots }: {
    /** null = cerrado. */
    plate: string | null;
    alCerrar: () => void;
    /** Se registró algo: refrescar lo de atrás. */
    alTerminar: () => void;
    units: any[]; groups: any[]; devices: any[]; parkingSlots: any[];
}) {
    const [paso, setPaso] = useState<Paso>("elegir");
    const [sabido, setSabido] = useState<Awaited<ReturnType<typeof queSeSabeDeMatricula>> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!plate) return;
        setPaso("elegir"); setSabido(null); setError(null);
        queSeSabeDeMatricula(plate).then(setSabido).catch((e) => setError(e?.message || "No se pudo consultar"));
    }, [plate]);

    if (!plate) return null;

    return (
        <>
            <Cajon open={paso === "elegir"} onOpenChange={(o) => { if (!o && paso === "elegir") alCerrar(); }}>
                <CajonContenido ancho="angosto" titulo={`Registrar ${plate}`} descripcion="¿Qué es esta matrícula para el barrio?">
                    <CajonSeccion titulo="" className="pt-6 pb-6">
                        <div className="flex items-center gap-3 flex-wrap">
                            <Matricula p={plate} className="text-[18px] px-3 py-1" />
                            {!sabido && !error && <span className="text-[12px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Buscando si ya está cargada…</span>}
                            {error && <span className="text-[12px] tono-mal">{error}</span>}
                            {sabido && !sabido.duenio && !sabido.vigilancia && <Estado tono="neutro">No está cargada en ningún lado</Estado>}
                        </div>
                        {sabido?.duenio && (
                            <div className="rounded-[10px] border chip-info px-3 py-2.5 text-[12.5px] flex items-center gap-2">
                                <span className="flex-1 min-w-0">Ya es de <b>{sabido.duenio.nombre}</b>{sabido.duenio.unidad ? ` · ${sabido.duenio.unidad}` : ""}.</span>
                                <Link href={`/admin/users?search=${encodeURIComponent(sabido.duenio.nombre)}`} className="font-semibold tono-accion flex items-center gap-1 shrink-0">Ver ficha <ExternalLink size={12} /></Link>
                            </div>
                        )}
                        {sabido?.vigilancia && (
                            <div className="rounded-[10px] border chip-aviso px-3 py-2.5 text-[12.5px]">
                                Ya está en vigilancia como <b>{sabido.vigilancia.etiqueta}</b>{sabido.vigilancia.motivo ? ` (${sabido.vigilancia.motivo})` : ""}.
                            </div>
                        )}
                    </CajonSeccion>

                    <CajonSeccion titulo="Elegí una" icono={ShieldAlert}>
                        <Opcion icono={UserPlus} titulo="Una persona del barrio"
                            para="Residente, personal, proveedor habitual o visita frecuente: alguien con nombre y lote."
                            pasa={[
                                "Se crea la persona con esta matrícula ya cargada.",
                                "Queda en el padrón: deja de salir como «no registrada».",
                                "Desde su ficha se manda a las lectoras para que la barrera la deje pasar.",
                            ]}
                            aviso={sabido?.duenio ? <p className="text-[12px] font-semibold tono-aviso">Ya tiene dueño: esto crearía otra persona con la misma matrícula.</p> : undefined}
                            alElegir={() => setPaso("persona")} />
                        <Opcion icono={Eye} titulo="Una matrícula en seguimiento"
                            para="Un auto a vigilar que no es de nadie del barrio: lista negra, en búsqueda o VIP."
                            pasa={[
                                "Entra a la lista de vigilancia con su categoría y un motivo. No se crea ninguna persona.",
                                "El monitor la destaca cada vez que pasa y, si querés, avisa.",
                                "En lista negra, la barrera la deniega y las lectoras la reciben.",
                            ]}
                            aviso={sabido?.vigilancia ? <p className="text-[12px] font-semibold tono-aviso">Ya está en la lista: al agregarla te pregunta si cambiar su categoría.</p> : undefined}
                            alerta alElegir={() => setPaso("vigilancia")} />
                    </CajonSeccion>

                    {/* Qué cambia en el sistema con cada una: lo que el guardia ve después, no cómo se carga. */}
                    <CajonSeccion titulo="Cómo se comporta el sistema" icono={Info}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="rounded-[10px] border border-border bg-card p-3.5 space-y-2">
                                <p className="text-[12.5px] font-bold flex items-center gap-1.5"><UserPlus size={13} className="text-muted-foreground" /> Persona del barrio</p>
                                <ul className="space-y-1.5 text-[12px] text-foreground/80 leading-snug">
                                    <li><b>Monitor:</b> sale como registrada, con su nombre y su lote.</li>
                                    <li><b>Guardia:</b> no recibe «entró sin registrarse».</li>
                                    <li><b>Barrera:</b> la deja pasar cuando la matrícula está en las lectoras.</li>
                                    <li><b>Proveedor:</b> se le abre la visita sola, con su tiempo.</li>
                                </ul>
                            </div>
                            <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_34%,transparent)] bg-[var(--mal-suave)] p-3.5 space-y-2">
                                <p className="text-[12.5px] font-bold flex items-center gap-1.5 tono-mal"><Eye size={13} /> Matrícula en seguimiento</p>
                                <ul className="space-y-1.5 text-[12px] text-foreground/80 leading-snug">
                                    <li><b>Monitor:</b> se destaca con su categoría cada vez que pasa.</li>
                                    <li><b>Avisos:</b> si se marca «Avisa», sale el aviso al detectarla.</li>
                                    <li><b>Lista negra:</b> toda lectura queda denegada y las lectoras la reciben.</li>
                                    <li><b>VIP y En búsqueda:</b> se destacan, sin cambiar la decisión de la barrera.</li>
                                </ul>
                            </div>
                        </div>
                    </CajonSeccion>
                </CajonContenido>
            </Cajon>

            {paso === "persona" && (
                <CajonUsuario open onOpenChange={(o) => { if (!o) alCerrar(); }}
                    initialData={{ plate }} units={units} groups={groups} devices={devices} parkingSlots={parkingSlots}
                    onSuccess={() => { alTerminar(); alCerrar(); }} />
            )}
            {paso === "vigilancia" && (
                <WatchlistDialog plateInicial={plate} onClose={() => { alTerminar(); alCerrar(); }} />
            )}
        </>
    );
}

