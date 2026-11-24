"use client";

import { useCallback, useEffect, useState } from "react";
import { Car, Check, ClipboardList, Clock, Download, Home, Mail, MapPin, MessageSquare, Phone, QrCode, Send, Users, Wrench, X } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { CajonInvitaciones } from "@/components/censo/CajonInvitaciones";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { fechaHora } from "@/lib/fechas";
import { TENENCIAS, TIPOS_SERVICIO, TIPOS_VEHICULO, type ServicioCargado, type VehiculoCargado } from "@/lib/registro-padron";


/**
 * La bandeja del censo: lo que carga la gente desde el QR (/registro), antes de ser padrón.
 *
 * Existe porque el formulario es una URL pública: cualquiera puede escribir que es del lote 42 y
 * cargar una matrícula que abre un portón. Nada entra solo. Acá se mira, y recién ahí se da de
 * alta la persona, su lote y sus matrículas.
 */

type Carga = {
    id: string; lote: string; apellido: string; nombre: string; tenencia: string; telefono: string; email: string;
    vehiculos: VehiculoCargado[]; servicios: ServicioCargado[]; comentario: string;
    lat: number | null; lng: number | null;
    estado: string; revisadaPor: string | null; revisadaAt: string | null; nota: string | null; createdAt: string;
};

const VISTAS = [
    { valor: "pendiente", rotulo: "Sin revisar" },
    { valor: "aprobada", rotulo: "Aprobadas" },
    { valor: "rechazada", rotulo: "Rechazadas" },
    { valor: "todas", rotulo: "Todas" },
];

/* El mapa de la ficha sólo se dibuja cuando la carga TRAE punto, y entonces se centra en él:
   este valor es el respaldo que el mapa pide y que en la práctica no se usa. */
const CENTRO_RESPALDO: [number, number] = [-34.9011, -56.1645];

const MapaPunto = dynamic(() => import("@/components/mapa/MapaPunto"), { ssr: false, loading: () => <div className="h-[190px] w-full animate-pulse rounded-[10px] bg-card" /> });

const tel = (t: string) => (t.startsWith("598") ? `0${t.slice(3)}` : t).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");

export default function BandejaCenso() {
    const [vista, setVista] = useState("pendiente");
    const [cargas, setCargas] = useState<Carga[] | null>(null);
    const [pendientes, setPendientes] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<Carga | null>(null);
    const [qr, setQr] = useState(false);
    const [invitaciones, setInvitaciones] = useState(false);

    const traer = useCallback(async () => {
        try {
            const r = await fetch(`/api/censo?estado=${vista}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setCargas(j.cargas); setPendientes(j.pendientes); setError(null);
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo traer la bandeja"); }
    }, [vista]);
    useEffect(() => { setCargas(null); traer(); }, [traer]);

    async function resolver(c: Carga, accion: "aprobar" | "rechazar", motivo?: string) {
        const r = await fetch("/api/censo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, accion, motivo }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { toast.error({ title: "No se pudo", description: j?.error }); return; }
        if (accion === "aprobar") {
            toast.success({
                title: `${j.persona} en ${j.unidad}`,
                description: [`${j.matriculas} ${j.matriculas === 1 ? "matrícula dada de alta" : "matrículas dadas de alta"}`, ...(j.avisos || [])].join(" · "),
            });
        } else toast.success({ title: "Rechazada" });
        setAbierta(null); traer();
    }

    return (
        /* El armazón es el de las demás pantallas del panel (Usuarios, Unidades): alto completo,
           encabezado fijo con su barra, y el cuerpo que scrollea. Antes era un `div` con padding y
           `max-w-[1100px]`, y con el menú plegado la pantalla no se ensanchaba: quedaba una columna
           angosta pegada a la izquierda y media pantalla vacía. */
        <div className="relative h-full flex flex-col overflow-hidden bg-background">
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-4 min-w-0">
                    <span className="w-11 h-11 shrink-0 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                        <ClipboardList size={20} />
                    </span>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-foreground">Censo del barrio</h1>
                        <p className="text-sm text-muted-foreground mt-1 truncate">
                            Lo que carga cada lote desde el QR. Nada entra al padrón hasta que lo aprobás acá.
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" onClick={() => setInvitaciones(true)}><Send size={15} /> Invitaciones</Button>
                    <Button variant="outline" onClick={() => setQr(true)}><QrCode size={15} /> El QR</Button>
                </div>
            </header>

            <div className="px-8 py-4 border-b border-border flex items-center gap-3 flex-wrap shrink-0">
                <Filtros grupos={[{ clave: "e", titulo: "Ver", valor: vista, alElegir: setVista, opciones: VISTAS }]} />
                {pendientes > 0 && <Chip tono="aviso">{pendientes} sin revisar</Chip>}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-5 space-y-4">

            {error && !cargas ? <ErrorEstado mensaje={error} alReintentar={traer} />
                : !cargas ? <Cargando texto="Trayendo la bandeja…" />
                    : cargas.length === 0 ? (
                        <div className="rounded-[10px] border border-dashed border-border p-10 text-center">
                            <Users size={20} className="mx-auto mb-2 text-muted-foreground" />
                            <p className="text-[13px] text-muted-foreground">Todavía no hay cargas acá. El QR las trae solas.</p>
                        </div>
                    ) : (
                        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {cargas.map((c) => (
                                <button key={c.id} type="button" onClick={() => setAbierta(c)}
                                    className="text-left rounded-[10px] border border-border bg-card p-3.5 hover:bg-accent/40 transition-colors">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[15px] font-bold">Lote {c.lote}</span>
                                        <span className="text-[14px] font-semibold truncate">{[c.nombre, c.apellido].filter(Boolean).join(" ")}</span>
                                        {c.estado === "aprobada" && <Chip tono="bien" className="ml-auto">Aprobada</Chip>}
                                        {c.estado === "rechazada" && <Chip tono="mal" className="ml-auto">Rechazada</Chip>}
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground tabular-nums">
                                        <span className="inline-flex items-center gap-1"><Car size={12} /> {c.vehiculos.length}</span>
                                        <span className="inline-flex items-center gap-1"><Wrench size={12} /> {c.servicios.length}</span>
                                        <span className="inline-flex items-center gap-1"><Clock size={12} /> {fechaHora(c.createdAt)}</span>
                                    </div>
                                    {!!c.vehiculos.length && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {c.vehiculos.slice(0, 4).map((v) => (
                                                <span key={v.chapa} className="rounded-[6px] border border-border px-1.5 py-0.5 text-[11.5px] font-bold tracking-[0.08em] tabular-nums">{v.chapa}</span>
                                            ))}
                                            {c.vehiculos.length > 4 && <span className="text-[11.5px] text-muted-foreground">+{c.vehiculos.length - 4}</span>}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

            </div>

            <Ficha carga={abierta} alCerrar={() => setAbierta(null)} alResolver={resolver} centro={CENTRO_RESPALDO} />
            <CajonQr abierto={qr} alCerrar={() => setQr(false)} />
            <CajonInvitaciones abierto={invitaciones} alCerrar={() => { setInvitaciones(false); traer(); }} />
        </div>
    );
}

/**
 * La ficha de una carga.
 *
 * El cuerpo va en `CajonSeccion` y no en un `div` con `space-y`: la sección trae la canaleta de
 * 24 px, el aire de 32 entre bloques y el rótulo con su ícono, que es lo que hace que un cajón
 * de este sistema se vea como los demás. Antes el contenido arrancaba pegado al borde mientras
 * el título respiraba, y eso es exactamente lo que se ve como «mal alineado».
 */
function Ficha({ carga, alCerrar, alResolver, centro }: {
    carga: Carga | null;
    alCerrar: () => void;
    alResolver: (c: Carga, a: "aprobar" | "rechazar", motivo?: string) => Promise<void>;
    centro: [number, number];
}) {
    const [trabajando, setTrabajando] = useState<"aprobar" | "rechazar" | null>(null);
    const [motivo, setMotivo] = useState("");
    useEffect(() => { setMotivo(""); setTrabajando(null); }, [carga?.id]);
    const hacer = async (a: "aprobar" | "rechazar") => { if (!carga) return; setTrabajando(a); try { await alResolver(carga, a, motivo); } finally { setTrabajando(null); } };
    const pendiente = carga?.estado === "pendiente";
    const punto: [number, number] | null = carga?.lat != null && carga?.lng != null ? [carga.lat, carga.lng] : null;

    return (
        <Cajon open={!!carga} onOpenChange={(o) => { if (!o && !trabajando) alCerrar(); }}>
            <CajonContenido ancho="intermedio" titulo={carga ? `Lote ${carga.lote} · ${[carga.nombre, carga.apellido].filter(Boolean).join(" ")}` : ""}
                descripcion={carga ? `${TENENCIAS.find((t) => t.id === carga.tenencia)?.rotulo} · cargado ${fechaHora(carga.createdAt)}` : ""}
                pie={pendiente ? (
                    <>
                        <Button variant="outline" onClick={() => hacer("rechazar")} disabled={!!trabajando}>
                            {trabajando === "rechazar" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Rechazar
                        </Button>
                        <Button onClick={() => hacer("aprobar")} disabled={!!trabajando}>
                            {trabajando === "aprobar" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Dar de alta en el padrón
                        </Button>
                    </>
                ) : undefined}>
                {carga && (
                    <>
                        <CajonSeccion titulo="Quién es" icono={Users} compacta>
                            <div className="rounded-[10px] border border-border divide-y divide-border">
                                <Dato icono={Home} rotulo="Lote" valor={carga.lote} />
                                <Dato icono={Phone} rotulo="Teléfono" valor={tel(carga.telefono)} />
                                {carga.email && <Dato icono={Mail} rotulo="Correo" valor={carga.email} />}
                            </div>
                        </CajonSeccion>

                        <CajonSeccion titulo={`Vehículos · ${carga.vehiculos.length}`} icono={Car} compacta>
                            {carga.vehiculos.length === 0
                                ? <p className="text-[12.5px] text-muted-foreground">No cargó ninguno.</p>
                                : (
                                    <div className="rounded-[10px] border border-border divide-y divide-border">
                                        {carga.vehiculos.map((v) => (
                                            <div key={v.chapa} className="flex items-center gap-3 px-3 py-2.5">
                                                <span className="w-[86px] shrink-0 text-[13.5px] font-bold tracking-[0.08em] tabular-nums">{v.chapa}</span>
                                                <span className="text-[12.5px] text-muted-foreground">{TIPOS_VEHICULO.find((t) => t.id === v.tipo)?.rotulo}</span>
                                                {v.quien && <span className="truncate text-[12.5px] text-muted-foreground">· {v.quien}</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                        </CajonSeccion>

                        {carga.servicios.length > 0 && (
                            <CajonSeccion titulo={`Quién entra seguido · ${carga.servicios.length}`} icono={Wrench} compacta
                                ayuda="Quedan anotados en la ficha de la persona. Todavía no se convierten solos en autorizaciones: eso se arma en Visitas, mirándolo.">
                                <div className="rounded-[10px] border border-border divide-y divide-border">
                                    {carga.servicios.map((s, i) => (
                                        <div key={i} className="px-3 py-2.5 text-[13px]">
                                            <span className="font-semibold">{TIPOS_SERVICIO.find((t) => t.id === s.tipo)?.rotulo}</span>
                                            {s.nombre && <span> · {s.nombre}</span>}
                                            {!!s.dias?.length && <span className="text-muted-foreground"> · {s.dias.join(", ")}</span>}
                                            {(s.desde || s.hasta) && <span className="text-muted-foreground tabular-nums"> · {s.desde || "?"} a {s.hasta || "?"}</span>}
                                            {s.chapa && <span className="font-bold tabular-nums tracking-[0.08em]"> · {s.chapa}</span>}
                                        </div>
                                    ))}
                                </div>
                            </CajonSeccion>
                        )}

                        {/* La ubicación, dicha de las dos maneras: con el mapa cuando la marcó, y con una
                            línea cuando no — que un bloque desaparezca sin explicación deja pensando si
                            la pantalla se rompió. Al aprobar, este punto completa el lote si no tenía. */}
                        <CajonSeccion titulo="Dónde queda el lote" icono={MapPin} compacta>
                            {punto ? (
                                <div className="space-y-2">
                                    <MapaPunto punto={punto} centro={centro} soloVer alto={190} />
                                    <p className="text-[11.5px] text-muted-foreground tabular-nums">
                                        {punto[0].toFixed(5)}, {punto[1].toFixed(5)} · se guarda en el lote al aprobar, si todavía no tenía ubicación
                                    </p>
                                </div>
                            ) : (
                                <p className="flex items-start gap-2 text-[12.5px] leading-snug text-muted-foreground">
                                    <MapPin size={14} className="mt-0.5 shrink-0 opacity-50" />
                                    No marcó la ubicación: es opcional en el formulario. El lote se puede ubicar después en Mapa.
                                </p>
                            )}
                        </CajonSeccion>

                        {carga.comentario && (
                            <CajonSeccion titulo="Dijo" icono={MessageSquare} compacta>
                                <p className="rounded-[10px] bg-muted/50 p-3 text-[13px] leading-relaxed">{carga.comentario}</p>
                            </CajonSeccion>
                        )}

                        <CajonSeccion titulo={pendiente ? "Si la rechazás" : "Cómo se resolvió"} icono={ClipboardList} compacta>
                            {pendiente ? (
                                <label className="block">
                                    <span className="mb-1.5 block text-[12.5px] text-muted-foreground">El motivo le llega a quien la cargó.</span>
                                    <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ese lote ya lo cargó otra persona"
                                        className="h-10 w-full rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[var(--accion)]/30" />
                                </label>
                            ) : (
                                <p className="text-[12.5px] text-muted-foreground">
                                    {carga.estado === "aprobada" ? "Aprobada" : "Rechazada"} por {carga.revisadaPor || "alguien"} el {fechaHora(carga.revisadaAt)}.
                                    {carga.nota ? ` ${carga.nota}` : ""}
                                </p>
                            )}
                        </CajonSeccion>
                    </>
                )}
            </CajonContenido>
        </Cajon>
    );
}

function Dato({ icono: I, rotulo, valor }: { icono: typeof Home; rotulo: string; valor: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-2">
            <I size={13} className="text-muted-foreground shrink-0" />
            <span className="text-[12.5px] text-muted-foreground">{rotulo}</span>
            <span className="ml-auto text-[13.5px] font-semibold tabular-nums">{valor}</span>
        </div>
    );
}

function CajonQr({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
    const url = typeof window !== "undefined" ? `${window.location.origin}/registro` : "/registro";
    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="angosto" titulo="El QR del censo" descripcion="Lo generamos nosotros: la dirección no pasa por ninguna página de afuera.">
                <div className="space-y-4">
                    <div className="rounded-[10px] border border-border bg-white p-4 grid place-items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/api/censo/qr?formato=png&tam=720" alt="QR del censo" className="w-full max-w-[320px]" />
                    </div>
                    <p className="text-[13px] text-center font-semibold tabular-nums break-all">{url}</p>
                    <div className="grid grid-cols-2 gap-2">
                        <a href="/api/censo/qr?formato=svg" download="qr-censo.svg"
                            className="h-10 rounded-full border border-border text-[13px] font-semibold hover:bg-accent inline-flex items-center justify-center gap-2"><Download size={14} /> SVG, para imprimir</a>
                        <a href="/api/censo/qr?formato=png&tam=2048" download="qr-censo.png"
                            className="h-10 rounded-full border border-border text-[13px] font-semibold hover:bg-accent inline-flex items-center justify-center gap-2"><Download size={14} /> PNG, para proyectar</a>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                        El SVG no se pixela por más grande que se imprima. Si el barrio tiene logo cargado en Ajustes →
                        Branding, va en el medio del PNG: el código se lee igual porque está hecho con corrección alta.
                    </p>
                </div>
            </CajonContenido>
        </Cajon>
    );
}
