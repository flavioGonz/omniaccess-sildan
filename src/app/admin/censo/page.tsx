"use client";

import { useCallback, useEffect, useState } from "react";
import { Car, Check, CheckCheck, ClipboardList, Clock, Download, Home, Info, ListChecks, Mail, MapPin, MessageSquare, Phone, QrCode, Send, ShieldCheck, TriangleAlert, Users, Wrench, X } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { CajonInvitaciones } from "@/components/censo/CajonInvitaciones";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { fechaHora } from "@/lib/fechas";
import { aprobarPedido, pedidosPendientes, rechazarPedido, type PedidoParaRevisar } from "@/app/actions/pedidos-residente";
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
    const [todas, setTodas] = useState(false);

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
                {pendientes > 0 && (
                    <Button size="sm" className="ml-auto" onClick={() => setTodas(true)}><CheckCheck size={15} /> Aprobar las {pendientes} sin revisar</Button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-5 space-y-4">
            <PedidosDelPortal />

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
            <CajonAprobarTodas abierto={todas} alCerrar={() => setTodas(false)} alTerminar={() => { traer(); }} />
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

/**
 * Aprobar todas las cargas sin revisar de una vez (25/11, Nico: «agregar un botón para aceptar todos
 * los sin revisar»).
 *
 * Es el mismo «Dar de alta en el padrón» de cada carga, una por una y de la más vieja a la más nueva,
 * y el cajón lo dice antes de apretar: qué entra, qué NO se pisa, y al terminar, cuántas salieron y
 * qué quedó para mirar a mano. Aprobar de a muchas sin saber qué hace es la forma de llenar el padrón
 * de algo que después nadie sabe de dónde salió.
 */
function CajonAprobarTodas({ abierto, alCerrar, alTerminar }: { abierto: boolean; alCerrar: () => void; alTerminar: () => void }) {
    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {abierto && <AprobarTodas alCerrar={alCerrar} alTerminar={alTerminar} />}
        </Cajon>
    );
}
type ResultadoTodas = { aprobadas: number; matriculas: number; chapasDeOtro: number; fallaron: number; fallas: string[]; quedan: number };
function AprobarTodas({ alCerrar, alTerminar }: { alCerrar: () => void; alTerminar: () => void }) {
    const [cargas, setCargas] = useState<Carga[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [trabajando, setTrabajando] = useState(false);
    const [hecho, setHecho] = useState<ResultadoTodas | null>(null);
    useEffect(() => {
        let vivo = true;
        fetch("/api/censo?estado=pendiente", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { if (vivo) setCargas(j.cargas); }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo traer la bandeja"); });
        return () => { vivo = false; };
    }, []);
    const n = cargas?.length || 0;
    const chapas = (cargas || []).reduce((k, c) => k + c.vehiculos.length, 0);
    const servicios = (cargas || []).reduce((k, c) => k + c.servicios.length, 0);
    const lotes = new Set((cargas || []).map((c) => c.lote)).size;
    const conPunto = (cargas || []).filter((c) => c.lat != null).length;
    const aprobar = async () => {
        setTrabajando(true);
        try {
            const r = await fetch("/api/censo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "aprobar-todas" }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { toast.error({ title: "No se pudo", description: j?.error }); return; }
            setHecho(j); alTerminar();
            toast.success({ title: `${j.aprobadas} ${j.aprobadas === 1 ? "carga aprobada" : "cargas aprobadas"}`, description: `${j.matriculas} ${j.matriculas === 1 ? "matrícula dada de alta" : "matrículas dadas de alta"}` });
        } finally { setTrabajando(false); }
    };
    const Cifra = ({ v, r, I }: { v: number; r: string; I: typeof Car }) => (
        <div className="rounded-[10px] bg-muted/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><I size={12} />{r}</p>
            <p className="mt-0.5 text-[20px] font-bold tabular-nums leading-tight">{v}</p>
        </div>
    );
    return (
        <CajonContenido ancho="medio" titulo={hecho ? "Listo" : "Aprobar todas las sin revisar"}
            descripcion={hecho ? "Lo que entró al padrón, y lo que quedó para mirar a mano." : "Cada carga se da de alta igual que con su propio botón, una por una, de la más vieja a la más nueva."}
            pie={
                <div className="flex w-full items-center gap-2">
                    <span className="flex-1 text-[12px] text-muted-foreground">{!hecho && n > 0 ? `${n} ${n === 1 ? "carga" : "cargas"} de ${lotes} ${lotes === 1 ? "lote" : "lotes"}` : ""}</span>
                    <Button variant="ghost" onClick={alCerrar}>{hecho ? "Cerrar" : "Cancelar"}</Button>
                    {!hecho && <Button onClick={aprobar} disabled={trabajando || !n}>{trabajando ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} {trabajando ? "Aprobando…" : `Aprobar las ${n}`}</Button>}
                </div>
            }>
            {error ? <div className="p-4"><ErrorEstado mensaje={error} /></div> : !cargas ? <div className="p-6"><Cargando texto="Trayendo las sin revisar…" /></div> : hecho ? (
                <>
                    <CajonSeccion titulo="Resultado" icono={CheckCheck}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            <Cifra v={hecho.aprobadas} r="cargas aprobadas" I={Check} />
                            <Cifra v={hecho.matriculas} r="matrículas dadas de alta" I={Car} />
                            <Cifra v={hecho.quedan} r="quedan sin revisar" I={Clock} />
                        </div>
                    </CajonSeccion>
                    {(hecho.chapasDeOtro > 0 || hecho.fallaron > 0) && (
                        <CajonSeccion titulo="Para mirar a mano" icono={TriangleAlert} ayuda="Nada de esto se resolvió solo: queda anotado en la carga y en el historial de su lote.">
                            <ul className="space-y-1.5 text-[13px]">
                                {hecho.chapasDeOtro > 0 && <li className="flex gap-2"><TriangleAlert size={14} className="mt-0.5 shrink-0 tono-aviso" /> En {hecho.chapasDeOtro} {hecho.chapasDeOtro === 1 ? "carga" : "cargas"} había una matrícula que ya era de otra persona: se dejó como estaba. Está en la nota de cada carga aprobada.</li>}
                                {hecho.fallaron > 0 && <li className="flex gap-2"><X size={14} className="mt-0.5 shrink-0 tono-mal" /> {hecho.fallaron} no se pudieron aprobar{hecho.fallas.length ? `: ${hecho.fallas.join(" · ")}` : ""}. Siguen sin revisar.</li>}
                            </ul>
                        </CajonSeccion>
                    )}
                </>
            ) : n === 0 ? <div className="p-6 text-[13px] text-muted-foreground">No queda ninguna sin revisar.</div> : (
                <>
                    <CajonSeccion titulo="Qué entra al padrón" icono={ListChecks}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Cifra v={n} r={n === 1 ? "carga" : "cargas"} I={ClipboardList} />
                            <Cifra v={lotes} r={lotes === 1 ? "lote" : "lotes"} I={Home} />
                            <Cifra v={chapas} r="matrículas" I={Car} />
                            <Cifra v={servicios} r="servicios" I={Wrench} />
                        </div>
                    </CajonSeccion>
                    <CajonSeccion titulo="Cómo se hace" icono={ShieldCheck} ayuda="Lo mismo que el botón de cada carga. Lo que pueda ser un error no se resuelve solo: se anota.">
                        <ul className="space-y-2 text-[13px] leading-snug">
                            <li className="flex gap-2"><Users size={14} className="mt-0.5 shrink-0 text-muted-foreground" /><span>Cada persona se reconoce entre la gente de su lote (por su correo, su teléfono o su nombre); si no es nadie del lote, se la suma.</span></li>
                            <li className="flex gap-2"><Car size={14} className="mt-0.5 shrink-0 text-muted-foreground" /><span>Sus matrículas quedan dadas de alta. <b>Una matrícula que ya es de otra persona no se le saca a nadie</b>: se deja como estaba y se avisa.</span></li>
                            <li className="flex gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-muted-foreground" /><span>El punto del mapa ({conPunto} {conPunto === 1 ? "carga lo trae" : "cargas lo traen"}) completa la ubicación sólo de los lotes que no tenían: la del plano no se pisa.</span></li>
                            <li className="flex gap-2"><Wrench size={14} className="mt-0.5 shrink-0 text-muted-foreground" /><span>Los servicios (jardinero, piscinero…) quedan escritos en la ficha: no se convierten en autorizaciones de entrada.</span></li>
                            <li className="flex gap-2"><Info size={14} className="mt-0.5 shrink-0 text-muted-foreground" /><span>Cada alta queda en el historial de su lote, firmada por vos.</span></li>
                        </ul>
                    </CajonSeccion>
                    <CajonSeccion titulo="Las cargas" icono={ClipboardList} compacta>
                        <ul className="divide-y divide-border rounded-[10px] border border-border">
                            {cargas.slice(0, 60).map((c) => (
                                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                                    <span className="w-24 shrink-0 text-[12.5px] font-bold tabular-nums">Lote {c.lote}</span>
                                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{[c.nombre, c.apellido].filter(Boolean).join(" ")}</span>
                                    <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums"><Car size={11} /> {c.vehiculos.length}</span>
                                    <span className="w-20 text-right text-[11px] text-muted-foreground">{fechaHora(c.createdAt).split(" ")[0]}</span>
                                </li>
                            ))}
                        </ul>
                        {cargas.length > 60 && <p className="mt-1.5 text-[11.5px] text-muted-foreground">Y {cargas.length - 60} más.</p>}
                    </CajonSeccion>
                </>
            )}
        </CajonContenido>
    );
}

/**
 * Lo que piden los residentes desde su portal (26/11): sumar o sacar una matrícula. Va arriba de la
 * bandeja porque es lo que un vecino está esperando; aprobar pasa por lo mismo que el cajón del lote
 * (la matrícula llega a las cámaras, queda en el historial). Una chapa que ya es de otra persona se
 * avisa antes de aprobar: no se le saca a nadie.
 */
function PedidosDelPortal() {
    const [filas, setFilas] = useState<PedidoParaRevisar[] | null>(null);
    const [vuelta, setVuelta] = useState(0);
    const [trabajando, setTrabajando] = useState<string | null>(null);
    const [rechazando, setRechazando] = useState<{ id: string; motivo: string } | null>(null);
    useEffect(() => { let vivo = true; pedidosPendientes().then((f) => { if (vivo) setFilas(f); }).catch(() => { if (vivo) setFilas([]); }); return () => { vivo = false; }; }, [vuelta]);
    if (!filas || !filas.length) return null;
    const hacer = async (id: string, f: () => Promise<{ ok: boolean; error?: string }>, listo: string) => {
        setTrabajando(id);
        try { const r = await f(); if (!r.ok) toast.error({ title: "No se pudo", description: r.error }); else { toast.success({ title: listo }); setRechazando(null); setVuelta((n) => n + 1); } }
        finally { setTrabajando(null); }
    };
    return (
        <section className="rounded-[14px] border border-[color-mix(in_oklab,var(--info)_35%,transparent)] bg-[color-mix(in_oklab,var(--info)_4%,transparent)] p-4">
            <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-[10px] chip-info"><Car size={15} /></span>
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold">Pedidos del portal <span className="ml-1 text-[12px] font-semibold text-muted-foreground tabular-nums">{filas.length}</span></p>
                    <p className="text-[12px] text-muted-foreground">Matrículas que los vecinos pidieron sumar o sacar desde su portal. Nada cambia hasta que lo aprobás.</p>
                </div>
            </div>
            <ul className="mt-3 divide-y divide-border rounded-[10px] border border-border bg-card">
                {filas.map((p) => (
                    <li key={p.id} className="px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", p.tipo === "MATRICULA_BAJA" ? "chip-aviso" : "chip-info")}>{p.tipo === "MATRICULA_BAJA" ? "Sacar" : "Sumar"}</span>
                            <span className="inline-flex h-7 items-center rounded-md border-2 border-foreground/70 bg-background px-2 text-[13.5px] font-bold tracking-[0.1em] tabular-nums">{p.chapa}</span>
                            <span className="min-w-0 text-[13px]"><b>{p.persona.nombre}</b><span className="text-muted-foreground"> · {p.lote ? `Lote ${p.lote.nombre}` : "sin lote"}{p.detalle.marca || p.detalle.color ? ` · ${[p.detalle.marca, p.detalle.color].filter(Boolean).join(" ")}` : ""}{p.detalle.quien ? ` · ${p.detalle.quien}` : ""} · {fechaHora(p.createdAt)}</span></span>
                            <span className="ml-auto flex gap-1.5">
                                <Button size="sm" disabled={!!trabajando || !p.lote} onClick={() => hacer(p.id, () => aprobarPedido(p.id), p.tipo === "MATRICULA_BAJA" ? `${p.chapa} sacada` : `${p.chapa} sumada`)}>{trabajando === p.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Aprobar</Button>
                                <Button size="sm" variant="ghost" disabled={!!trabajando} onClick={() => setRechazando({ id: p.id, motivo: "" })}><X size={14} /> Rechazar</Button>
                            </span>
                        </div>
                        {p.deOtro && <p className="mt-1.5 flex items-center gap-1.5 text-[12px] tono-aviso"><TriangleAlert size={13} /> {p.chapa} ya es de {p.deOtro}: aprobar no se la saca. Sacásela primero desde su lote si corresponde.</p>}
                        {!p.lote && <p className="mt-1.5 text-[12px] tono-aviso">La persona no está en ningún lote: sumala a su lote antes de aprobar.</p>}
                        {rechazando?.id === p.id && (
                            <div className="mt-2 flex gap-2">
                                <input autoFocus value={rechazando.motivo} onChange={(e) => setRechazando({ id: p.id, motivo: e.target.value })} placeholder="Por qué (lo ve el vecino en su portal)" className="h-9 flex-1 rounded-[6px] border border-border bg-background px-3 text-[13px] outline-none focus-visible:border-[var(--accion)]" />
                                <Button size="sm" variant="destructive" disabled={!!trabajando} onClick={() => hacer(p.id, () => rechazarPedido(p.id, rechazando.motivo), "Pedido rechazado")}>Rechazar</Button>
                                <Button size="sm" variant="ghost" onClick={() => setRechazando(null)}>Cancelar</Button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
