"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    ArrowUpRight, CalendarPlus, Car, Check, ChevronRight, ClipboardList, Clock, Copy, Download, Home, Info, LogIn, PartyPopper,
    DoorOpen, Pencil, Plus, QrCode, ShieldCheck, Ticket, Trash2, UserPlus, Users, Wrench, X,
} from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { OmniLogo } from "@/components/brand/OmniLogo";
import { getAppBranding } from "@/app/actions/settings";
import {
    addMyGuest, createMyInvitation, extendMyInvitation, getQrSvg, listMyInvitations, revokeMyInvitation,
    type MyGuest, type MyInvitation, type PortalHost,
} from "@/app/actions/invitations";
import {
    anularPedido, editarPersona, editarServicio, editarVehiculo, miPortal, pedirBajaMatricula, pedirBajaServicio, pedirMatricula, pedirServicio, quitarMatricula, quitarPersona,
    type ChapaDelLote, type MiPortal, type PersonaDelLote, type ServicioVisto,
} from "@/app/actions/portal-residente";
import { DIAS, TIPOS_SERVICIO, TIPOS_VEHICULO } from "@/lib/registro-padron";
import { cn } from "@/lib/utils";

/**
 * El portal del residente: una sola app para todo lo del vecino (26/11).
 *
 * Nico: «mejorar el diseño de /residente, y que el registro del lote y las invitaciones QR sean bajo
 * el mismo sistema y el mismo panel: poder invitar, gestionar tus matrículas, etc., en el mismo que
 * ya tenemos». Antes el portal era sólo invitaciones, con un diseño propio (verde, degradés, sin la
 * marca), y el censo vivía en otro enlace que una vez enviado no servía para nada más.
 *
 * Ahora es una app de celular con cuatro pestañas abajo —Inicio, Invitar, Vehículos, Mi lote—, con
 * el sistema de OmniAccess (Outfit, un solo azul de acción, los tonos sólo para estado) y la marca
 * del barrio al lado de la nuestra. Todo lo que se carga va en hojas que suben desde abajo, como
 * los cajones del panel. Lo que cambia el padrón (una matrícula) es un PEDIDO: lo aprueba la
 * administración, y mientras tanto se ve «esperando».
 *
 * Movimiento según la skill apple-design (como el censo): resortes sin rebote, respuesta al tocar,
 * caminos simétricos, y movimiento reducido respetado.
 */

type Pest = "inicio" | "invitar" | "vehiculos" | "lote";
const PESTS: { v: Pest; r: string; I: typeof Home }[] = [
    { v: "inicio", r: "Inicio", I: Home }, { v: "invitar", r: "Invitar", I: Ticket }, { v: "vehiculos", r: "Vehículos", I: Car }, { v: "lote", r: "Mi lote", I: Users },
];
const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.38 };
const PULSABLE = "active:scale-[0.97] transition-transform duration-100 ease-out";
const ENTRADA = "h-12 w-full px-3.5 rounded-[10px] border border-border bg-background text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";
const VINCULO: Record<string, string> = { PROPIETARIO: "Propietario", INQUILINO: "Inquilino", OCUPANTE: "Ocupante", FAMILIA: "Familia" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hm = (d: Date) => d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });
const dia = (d: Date) => cap(d.toLocaleDateString("es-UY", { weekday: "short", day: "numeric", month: "short" }).replace(".", ""));
const rango = (a: string, b: string) => { const f = new Date(a), t = new Date(b); return f.toDateString() === t.toDateString() ? `${dia(f)} · ${hm(f)} a ${hm(t)}` : `${dia(f)} ${hm(f)} → ${dia(t)} ${hm(t)}`; };
const aLocal = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const vigente = (i: MyInvitation) => i.status === "ACTIVE";

export default function PortalResidente() {
    const params = useParams();
    const token = String((params as { token?: string })?.token || "");
    const [marca, setMarca] = useState<{ barrio: string; logoUrl: string }>({ barrio: "", logoUrl: "" });
    const [host, setHost] = useState<PortalHost | null>(null);
    const [items, setItems] = useState<MyInvitation[]>([]);
    const [datos, setDatos] = useState<MiPortal | null>(null);
    const [estado, setEstado] = useState<"cargando" | "listo" | "malo">("cargando");
    const [pest, setPest] = useState<Pest>("inicio");
    const [sentido, setSentido] = useState(1);
    const [hoja, setHoja] = useState<null | { que: "invitar"; kind: "SINGLE" | "EVENT" } | { que: "invitado"; inv: MyInvitation } | { que: "qr"; g: MyGuest } | { que: "matricula" } | { que: "servicio"; sv?: ServicioVisto } | { que: "vehiculo"; c: ChapaDelLote } | { que: "persona"; p: PersonaDelLote }>(null);
    const quieto = useReducedMotion();

    useEffect(() => { getAppBranding().then((b) => setMarca({ barrio: b.barrio || b.name || "", logoUrl: b.logoUrl || "" })).catch(() => { }); }, []);
    const traer = useCallback(async () => {
        try {
            const [r, p] = await Promise.all([listMyInvitations(token), miPortal(token)]);
            if (!r.ok || !p.ok) { setEstado("malo"); return; }
            setHost(r.host!); setItems(r.items || []); setDatos(p.datos!); setEstado("listo");
        } catch { setEstado("malo"); }
    }, [token]);
    useEffect(() => { const t = setTimeout(traer, 0); return () => clearTimeout(t); }, [traer]);
    const ir = (p: Pest) => { setSentido(PESTS.findIndex((x) => x.v === p) >= PESTS.findIndex((x) => x.v === pest) ? 1 : -1); setPest(p); try { window.scrollTo({ top: 0 }); } catch { /* da igual */ } };

    if (estado === "cargando") return <Marco marca={marca}><div className="grid min-h-[60vh] place-items-center"><Loader2 size={28} className="animate-spin text-[var(--accion)]" /></div></Marco>;
    if (estado === "malo" || !host || !datos) return (
        <Marco marca={marca}>
            <div className="mx-auto max-w-[420px] px-6 pt-20 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-[14px] bg-muted"><Ticket size={26} /></span>
                <h1 className="mt-5 text-[24px] font-bold tracking-[-0.02em]">Este enlace ya no sirve</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">Pedile a la administración del barrio que te mande tu enlace de nuevo.</p>
            </div>
        </Marco>
    );

    return (
        <Marco marca={marca} conBarra>
            <main className="mx-auto w-full max-w-[640px] px-4 pb-32 pt-5">
                <AnimatePresence mode="wait" initial={false} custom={sentido}>
                    <motion.div key={pest} custom={sentido} initial={quieto ? { opacity: 0 } : { opacity: 0, x: 22 * sentido }} animate={{ opacity: 1, x: 0 }} exit={quieto ? { opacity: 0 } : { opacity: 0, x: -22 * sentido }} transition={RESORTE}>
                        {pest === "inicio" && <Inicio host={host} datos={datos} items={items} alIr={ir} alInvitar={(kind) => setHoja({ que: "invitar", kind })} alQr={(g) => setHoja({ que: "qr", g })} />}
                        {pest === "invitar" && <Invitaciones token={token} items={items} alNueva={(kind) => setHoja({ que: "invitar", kind })} alQr={(g) => setHoja({ que: "qr", g })} alAgregar={(inv) => setHoja({ que: "invitado", inv })} alCambiar={traer} />}
                        {pest === "vehiculos" && <Vehiculos token={token} datos={datos} alPedir={() => setHoja({ que: "matricula" })} alEditar={(c) => setHoja({ que: "vehiculo", c })} alCambiar={traer} />}
                        {pest === "lote" && <MiLote token={token} datos={datos} alPedir={() => setHoja({ que: "servicio" })} alEditarServicio={(sv) => setHoja({ que: "servicio", sv })} alEditarPersona={(p) => setHoja({ que: "persona", p })} alCambiar={traer} />}
                    </motion.div>
                </AnimatePresence>
            </main>

            <nav className="censo-barra fixed inset-x-0 bottom-0 z-30" aria-label="Secciones">
                <div className="mx-auto grid w-full max-w-[640px] grid-cols-4 px-2 pt-1.5">
                    {PESTS.map((p) => {
                        const activa = pest === p.v;
                        const aviso = p.v === "vehiculos" ? datos.pedidos.filter((x) => x.estado === "PENDIENTE" && x.tipo.startsWith("MATRICULA")).length : p.v === "lote" ? datos.pedidos.filter((x) => x.estado === "PENDIENTE" && x.tipo.startsWith("SERVICIO")).length : p.v === "invitar" ? items.filter(vigente).length : 0;
                        return (
                            <button key={p.v} type="button" onClick={() => ir(p.v)} aria-current={activa ? "page" : undefined}
                                className={cn("relative flex flex-col items-center gap-0.5 rounded-[10px] py-1.5 text-[11px] font-semibold", PULSABLE, activa ? "text-[var(--accion)]" : "text-muted-foreground")}>
                                <span className="relative">
                                    <p.I size={22} strokeWidth={activa ? 2.4 : 2} />
                                    {aviso > 0 && <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accion)] px-1 text-[9.5px] font-bold text-white tabular-nums">{aviso}</span>}
                                </span>
                                {p.r}
                            </button>
                        );
                    })}
                </div>
            </nav>

            <AnimatePresence>
                {hoja?.que === "invitar" && <HojaInvitar key="i" kind={hoja.kind} token={token} alCerrar={() => setHoja(null)} alListo={() => { setHoja(null); traer(); ir("invitar"); }} />}
                {hoja?.que === "invitado" && <HojaInvitado key="g" inv={hoja.inv} token={token} alCerrar={() => setHoja(null)} alListo={() => { setHoja(null); traer(); }} />}
                {hoja?.que === "qr" && <HojaQr key="q" g={hoja.g} alCerrar={() => setHoja(null)} />}
                {hoja?.que === "matricula" && <HojaMatricula key="m" token={token} directo={!!datos?.altaDirecta} alCerrar={() => setHoja(null)} alListo={() => { setHoja(null); traer(); }} />}
                {hoja?.que === "servicio" && <HojaServicio key="s" token={token} directo={!!datos?.altaDirecta} previo={hoja.sv} alCerrar={() => setHoja(null)} alListo={() => { setHoja(null); traer(); }} />}
                {hoja?.que === "vehiculo" && <HojaVehiculo key="v" token={token} c={hoja.c} alCerrar={() => setHoja(null)} alListo={() => { setHoja(null); traer(); }} />}
                {hoja?.que === "persona" && <HojaPersona key="p" token={token} p={hoja.p} puedeQuitar={!!datos?.altaDirecta && !!datos?.soyDueno && !hoja.p.yo} alCerrar={() => setHoja(null)} alListo={() => { setHoja(null); traer(); }} />}
            </AnimatePresence>
        </Marco>
    );
}

/** La cabecera de siempre: OmniAccess a la izquierda, el barrio a la derecha (ver claude/marca-omniaccess.md). */
function Marco({ marca, conBarra, children }: { marca: { barrio: string; logoUrl: string }; conBarra?: boolean; children: React.ReactNode }) {
    return (
        <div className={cn("min-h-[100dvh] bg-background text-foreground", conBarra && "pb-[env(safe-area-inset-bottom)]")}>
            <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-[640px] items-center gap-2.5 px-4 py-3">
                    <OmniLogo size={24} className="shrink-0" />
                    <span className="text-[16px] font-bold leading-none tracking-[-0.02em]">Omni<span className="font-normal">Access</span></span>
                    {marca.logoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={marca.logoUrl} alt={marca.barrio || "Barrio"} className="ml-auto h-6 max-w-[120px] object-contain" />
                        : marca.barrio && <span className="ml-auto truncate text-[12px] font-semibold text-muted-foreground">{marca.barrio}</span>}
                </div>
            </header>
            {children}
        </div>
    );
}

function Titulo({ rotulo, titulo, bajada }: { rotulo: string; titulo: string; bajada?: string }) {
    return (
        <div className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accion)]">{rotulo}</p>
            <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.025em]">{titulo}</h1>
            {bajada && <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">{bajada}</p>}
        </div>
    );
}

/* ═══════════════════════ Inicio ═══════════════════════ */

function Inicio({ host, datos, items, alIr, alInvitar, alQr }: { host: PortalHost; datos: MiPortal; items: MyInvitation[]; alIr: (p: Pest) => void; alInvitar: (k: "SINGLE" | "EVENT") => void; alQr: (g: MyGuest) => void }) {
    const adentro = items.filter(vigente).flatMap((i) => i.guests.filter((g) => g.inside));
    const hoy = items.filter((i) => vigente(i) && new Date(i.validFrom).toDateString() === new Date().toDateString());
    const pendientes = datos.pedidos.filter((p) => p.estado === "PENDIENTE");
    const [ahora] = useState(() => Date.now());
    const esSv = (p: { tipo: string }) => p.tipo.startsWith("SERVICIO");
    const quienSv = (p: { detalle: Record<string, string> }) => `${TIPOS_SERVICIO.find((t) => t.id === p.detalle.tipo)?.rotulo || "Proveedor"}${p.detalle.nombre ? ` ${p.detalle.nombre}` : ""}`;
    const recien = datos.pedidos.filter((p) => p.estado !== "PENDIENTE" && ahora - Date.parse(p.createdAt) < 7 * 86400_000).slice(0, 2);
    const tareas: { I: typeof Home; t: string; d: string; tono: string; accion: () => void }[] = [];
    if (datos.censo.enlace && datos.censo.estado === "sin-cargar") tareas.push({ I: ClipboardList, t: "Completá el censo de tu lote", d: "Tus vehículos y quién entra a tu casa. Son dos minutos.", tono: "chip-aviso", accion: () => window.location.assign(datos.censo.enlace!) });
    for (const p of pendientes) tareas.push(esSv(p)
        ? { I: Wrench, t: `${p.tipo === "SERVICIO_BAJA" ? "Dar de baja a" : "Sumar a"} ${quienSv(p)}`, d: "Esperando que la administración lo apruebe.", tono: "chip-info", accion: () => alIr("lote") }
        : { I: Car, t: `${p.tipo === "MATRICULA_BAJA" ? "Sacar" : "Sumar"} ${p.chapa}`, d: "Esperando que la administración lo apruebe.", tono: "chip-info", accion: () => alIr("vehiculos") });
    for (const p of recien.filter(esSv)) tareas.push({ I: p.estado === "APROBADO" ? Check : X, t: `${quienSv(p)}: ${p.estado === "APROBADO" ? "aprobado" : "no se aprobó"}`, d: p.estado === "APROBADO" ? (p.tipo === "SERVICIO_BAJA" ? "Ya no figura en tu lote." : p.detalle.entrada === "si" ? "Entra solo por su matrícula en sus días y horario." : "Ya figura en tu lote.") : p.motivo || "Consultá con la administración.", tono: p.estado === "APROBADO" ? "chip-bien" : "chip-mal", accion: () => alIr("lote") });
    for (const p of recien.filter((x) => !esSv(x))) tareas.push({ I: p.estado === "APROBADO" ? Check : X, t: `${p.chapa}: ${p.estado === "APROBADO" ? "aprobado" : "no se aprobó"}`, d: p.estado === "APROBADO" ? (p.tipo === "MATRICULA_BAJA" ? "Ya no abre el portón." : "La cámara ya la reconoce en la entrada.") : p.motivo || "Consultá con la administración.", tono: p.estado === "APROBADO" ? "chip-bien" : "chip-mal", accion: () => alIr("vehiculos") });

    return (
        <div>
            <Titulo rotulo={datos.lote ? `Lote ${datos.lote.nombre}` : "Tu portal"} titulo={`Hola, ${host.name.split(" ")[0]}`} bajada={datos.lote?.administracion || undefined} />
            <div className="grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => alInvitar("SINGLE")} className={cn("flex flex-col items-start gap-2 rounded-[14px] bg-[var(--accion)] p-4 text-left text-white", PULSABLE)}>
                    <UserPlus size={22} /><span className="text-[15px] font-bold leading-tight">Invitar una visita</span><span className="text-[12px] opacity-85">Su QR entra solo</span>
                </button>
                <button type="button" onClick={() => alInvitar("EVENT")} className={cn("flex flex-col items-start gap-2 rounded-[14px] border border-border bg-card p-4 text-left", PULSABLE)}>
                    <PartyPopper size={22} className="text-[var(--accion)]" /><span className="text-[15px] font-bold leading-tight">Armar un evento</span><span className="text-[12px] text-muted-foreground">Lista de invitados</span>
                </button>
            </div>

            {tareas.length > 0 && (
                <section className="mt-6">
                    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Para vos</h2>
                    <ul className="space-y-2">
                        {tareas.map((t, k) => (
                            <li key={k}><button type="button" onClick={t.accion} className={cn("flex w-full items-center gap-3 rounded-[14px] border border-border bg-card p-3.5 text-left", PULSABLE)}>
                                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[10px]", t.tono)}><t.I size={18} /></span>
                                <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-semibold">{t.t}</span><span className="block text-[12.5px] leading-snug text-muted-foreground">{t.d}</span></span>
                                <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
                            </button></li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="mt-6">
                <div className="mb-2 flex items-baseline gap-2"><h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Hoy</h2>{adentro.length > 0 && <span className="text-[12px] font-semibold tono-bien">● {adentro.length} adentro ahora</span>}</div>
                {hoy.length === 0 ? (
                    <p className="rounded-[14px] border border-dashed border-border p-4 text-[13.5px] text-muted-foreground">No esperás a nadie hoy. Cuando invites a alguien, acá ves si ya entró.</p>
                ) : (
                    <ul className="space-y-2">
                        {hoy.flatMap((i) => i.guests.map((g) => ({ i, g }))).slice(0, 6).map(({ i, g }) => (
                            <li key={g.guestId} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5">
                                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-bold", g.inside ? "pleno-bien" : "bg-muted")}>{(g.name || "?").charAt(0).toUpperCase()}</span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{g.name || "Invitado"}</span><span className="block text-[12.5px] text-muted-foreground">{g.inside ? "Adentro" : g.entries ? "Ya se fue" : `Hasta las ${hm(new Date(i.validTo))}`}{g.plates[0] ? ` · ${g.plates[0]}` : ""}</span></span>
                                <button type="button" onClick={() => alQr(g)} className={cn("grid h-11 w-11 place-items-center rounded-[10px] border border-border", PULSABLE)} aria-label={`QR de ${g.name}`}><QrCode size={19} /></button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="mt-6 grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => alIr("vehiculos")} className={cn("rounded-[14px] border border-border bg-card p-4 text-left", PULSABLE)}>
                    <Car size={18} className="text-muted-foreground" /><p className="mt-2 text-[24px] font-bold leading-none tabular-nums">{datos.chapas.filter((c) => c.mia).length}</p><p className="mt-1 text-[12.5px] text-muted-foreground">tus matrículas</p>
                </button>
                <button type="button" onClick={() => alIr("lote")} className={cn("rounded-[14px] border border-border bg-card p-4 text-left", PULSABLE)}>
                    <Users size={18} className="text-muted-foreground" /><p className="mt-2 text-[24px] font-bold leading-none tabular-nums">{datos.gente.length}</p><p className="mt-1 text-[12.5px] text-muted-foreground">en tu lote</p>
                </button>
            </section>
        </div>
    );
}

/* ═══════════════════════ Invitaciones ═══════════════════════ */

function Invitaciones({ token, items, alNueva, alQr, alAgregar, alCambiar }: { token: string; items: MyInvitation[]; alNueva: (k: "SINGLE" | "EVENT") => void; alQr: (g: MyGuest) => void; alAgregar: (i: MyInvitation) => void; alCambiar: () => void }) {
    const [verPasadas, setVerPasadas] = useState(false);
    const activas = items.filter(vigente), pasadas = items.filter((i) => !vigente(i));
    return (
        <div>
            <Titulo rotulo="Invitaciones" titulo="Tus invitados" bajada="Cada invitado tiene su QR: lo mostrás en la garita o se lo reenviás. Si viene en auto con matrícula, la cámara lo reconoce sola." />
            <div className="grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => alNueva("SINGLE")} className={cn("h-12 rounded-[10px] bg-[var(--accion)] text-[15px] font-bold text-white inline-flex items-center justify-center gap-2", PULSABLE)}><UserPlus size={18} /> Visita</button>
                <button type="button" onClick={() => alNueva("EVENT")} className={cn("h-12 rounded-[10px] border border-border text-[15px] font-bold inline-flex items-center justify-center gap-2", PULSABLE)}><PartyPopper size={18} /> Evento</button>
            </div>
            {activas.length === 0 && <p className="mt-5 rounded-[14px] border border-dashed border-border p-5 text-center text-[14px] text-muted-foreground">No tenés invitaciones vigentes.</p>}
            <div className="mt-5 space-y-3">{activas.map((i) => <Tarjeta key={i.id} inv={i} token={token} alQr={alQr} alAgregar={alAgregar} alCambiar={alCambiar} />)}</div>
            {pasadas.length > 0 && (
                <>
                    <button type="button" onClick={() => setVerPasadas((v) => !v)} className="mt-6 text-[13px] font-semibold text-muted-foreground">{verPasadas ? "Ocultar las anteriores" : `Ver las ${pasadas.length} anteriores`}</button>
                    {verPasadas && <div className="mt-3 space-y-3 opacity-70">{pasadas.slice(0, 20).map((i) => <Tarjeta key={i.id} inv={i} token={token} alQr={alQr} pasada />)}</div>}
                </>
            )}
        </div>
    );
}

function Tarjeta({ inv, token, pasada, alQr, alAgregar, alCambiar }: { inv: MyInvitation; token: string; pasada?: boolean; alQr: (g: MyGuest) => void; alAgregar?: (i: MyInvitation) => void; alCambiar?: () => void }) {
    const [anulando, setAnulando] = useState(false);
    const evento = inv.kind === "EVENT";
    const adentro = inv.guests.filter((g) => g.inside).length;
    const estado = inv.status === "ACTIVE" ? { r: "Vigente", c: "chip-bien" } : inv.status === "REVOKED" ? { r: "Anulada", c: "chip-mal" } : { r: "Vencida", c: "chip-quieto" };
    return (
        <article className="overflow-hidden rounded-[14px] border border-border bg-card">
            <div className="flex items-start gap-3 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-muted">{evento ? <PartyPopper size={18} /> : <Ticket size={18} />}</span>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[15px] font-bold">{inv.title || (evento ? "Evento" : inv.guests[0]?.name || "Visita")}</h3>
                    <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground"><Clock size={12} /> {rango(inv.validFrom, inv.validTo)}</p>
                    {evento && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{inv.guests.length}{inv.maxGuests ? ` de ${inv.maxGuests}` : ""} invitados{adentro ? <span className="font-semibold tono-bien"> · {adentro} adentro</span> : null}</p>}
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", estado.c)}>{estado.r}</span>
            </div>
            <ul className="border-t border-border">
                {inv.guests.map((g) => (
                    <li key={g.guestId} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">{g.name || "Invitado"}</span>
                            <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                                {g.plates.length ? g.plates.map((p) => <span key={p} className="rounded-[5px] border border-border px-1.5 font-bold tracking-wider tabular-nums">{p}</span>) : <span>a pie</span>}
                                {g.inside ? <span className="inline-flex items-center gap-1 font-semibold tono-bien"><LogIn size={11} /> adentro</span> : g.entries > 0 ? <span>entró {g.lastEntryAt ? hm(new Date(g.lastEntryAt)) : ""}</span> : null}
                            </span>
                        </span>
                        <button type="button" onClick={() => alQr(g)} className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-border text-[var(--accion)]", PULSABLE)} aria-label={`QR de ${g.name || "invitado"}`}><QrCode size={19} /></button>
                    </li>
                ))}
            </ul>
            {!pasada && (
                <div className="flex gap-2 border-t border-border p-3">
                    {evento && alAgregar && <button type="button" onClick={() => alAgregar(inv)} className={cn("h-10 flex-1 rounded-[10px] border border-border text-[13px] font-semibold inline-flex items-center justify-center gap-1.5", PULSABLE)}><Plus size={15} /> Invitado</button>}
                    <button type="button" onClick={async () => { await extendMyInvitation(token, inv.id, new Date(new Date(inv.validTo).getTime() + 2 * 3600_000)); alCambiar?.(); }} className={cn("h-10 flex-1 rounded-[10px] border border-border text-[13px] font-semibold inline-flex items-center justify-center gap-1.5", PULSABLE)}><CalendarPlus size={15} /> 2 horas más</button>
                    {anulando ? (
                        <span className="flex flex-1 gap-1.5">
                            <button type="button" onClick={async () => { await revokeMyInvitation(token, inv.id); setAnulando(false); alCambiar?.(); }} className={cn("h-10 flex-1 rounded-[10px] pleno-mal text-[13px] font-bold", PULSABLE)}>Anular</button>
                            <button type="button" onClick={() => setAnulando(false)} className="h-10 px-3 rounded-[10px] border border-border text-[13px]">No</button>
                        </span>
                    ) : <button type="button" onClick={() => setAnulando(true)} className={cn("h-10 flex-1 rounded-[10px] border border-border text-[13px] font-semibold tono-mal inline-flex items-center justify-center gap-1.5", PULSABLE)}><Trash2 size={15} /> Anular</button>}
                </div>
            )}
        </article>
    );
}

/* ═══════════════════════ Vehículos ═══════════════════════ */

function Vehiculos({ token, datos, alPedir, alEditar, alCambiar }: { token: string; datos: MiPortal; alPedir: () => void; alEditar: (c: ChapaDelLote) => void; alCambiar: () => void }) {
    const [sacando, setSacando] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    /* Las de la casa primero; las de proveedores y familiares, después. */
    const mias = datos.chapas.filter((c) => c.mia).sort((a, b) => Number(!!a.uso) - Number(!!b.uso)), delLote = datos.chapas.filter((c) => !c.mia);
    const deChapas = datos.pedidos.filter((p) => p.tipo.startsWith("MATRICULA"));
    const pendientes = deChapas.filter((p) => p.estado === "PENDIENTE");
    const resueltos = deChapas.filter((p) => p.estado !== "PENDIENTE").slice(0, 6);
    const bajaPedida = (c: string) => pendientes.some((p) => p.tipo === "MATRICULA_BAJA" && p.chapa === c);
    return (
        <div>
            <Titulo rotulo="Vehículos" titulo="Tus matrículas" bajada={`Con estas matrículas la cámara te reconoce en la entrada. ${datos.altaDirecta ? "Sumar o sacar una queda al guardar." : "Sumar o sacar una es un pedido: lo aprueba la administración."}`} />
            <button type="button" onClick={alPedir} className={cn("h-12 w-full rounded-[10px] bg-[var(--accion)] text-[15px] font-bold text-white inline-flex items-center justify-center gap-2", PULSABLE)}><Plus size={18} /> Sumar una matrícula</button>
            {error && <p className="mt-3 text-[13px] tono-mal">{error}</p>}

            {pendientes.length > 0 && (
                <section className="mt-6">
                    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Esperando a la administración</h2>
                    <ul className="space-y-2">
                        {pendientes.map((p) => (
                            <li key={p.id} className="flex items-center gap-3 rounded-[14px] border border-[color-mix(in_oklab,var(--info)_35%,transparent)] bg-[color-mix(in_oklab,var(--info)_5%,transparent)] p-3.5">
                                <Chapa p={p.chapa || ""} apagada={p.tipo === "MATRICULA_BAJA"} />
                                <span className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">{p.tipo === "MATRICULA_BAJA" ? "Pediste sacarla" : "Pediste sumarla"} · {dia(new Date(p.createdAt))}</span>
                                <button type="button" onClick={async () => { await anularPedido(token, p.id); alCambiar(); }} className="text-[12.5px] font-semibold text-muted-foreground underline-offset-2 hover:underline">Anular</button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="mt-6">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">A tu nombre</h2>
                {mias.length === 0 ? <p className="rounded-[14px] border border-dashed border-border p-4 text-[13.5px] text-muted-foreground">No tenés matrículas a tu nombre todavía.</p> : (
                    <ul className="space-y-2">
                        {mias.map((c) => (
                            <li key={c.chapa} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5">
                                <Chapa p={c.chapa} />
                                <span className="min-w-0 flex-1 text-[12.5px]">{datos.altaDirecta ? <Vehiculo c={c} /> : bajaPedida(c.chapa) ? <span className="text-muted-foreground">Pediste sacarla</span> : <span className="inline-flex items-center gap-1 font-semibold tono-bien"><ShieldCheck size={13} /> Aprobada</span>}</span>
                                {datos.altaDirecta ? <BotonEditar alTocar={() => alEditar(c)} /> : !bajaPedida(c.chapa) && (sacando === c.chapa ? (
                                    <span className="flex gap-1.5">
                                        <button type="button" onClick={async () => { setError(null); const r = await pedirBajaMatricula(token, c.chapa); setSacando(null); if (!r.ok) setError(r.error || "No se pudo."); alCambiar(); }} className="h-9 px-3 rounded-[8px] pleno-mal text-[12.5px] font-bold">Pedir sacarla</button>
                                        <button type="button" onClick={() => setSacando(null)} className="h-9 px-2.5 rounded-[8px] border border-border text-[12.5px]">No</button>
                                    </span>
                                ) : <button type="button" onClick={() => setSacando(c.chapa)} className="text-[12.5px] font-semibold text-muted-foreground">Sacar</button>)}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {delLote.length > 0 && (
                <section className="mt-6">
                    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">De tu familia en el lote</h2>
                    <ul className="space-y-2">{delLote.map((c) => (
                        <li key={c.chapa} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5">
                            <Chapa p={c.chapa} />
                            <span className="min-w-0 flex-1 text-[12.5px] text-muted-foreground"><span className="block truncate">de {c.de}</span>{c.uso && <span className="block truncate font-semibold text-foreground">{c.uso}</span>}{(c.marca || c.color) && <span className="block truncate">{[c.marca, c.color].filter(Boolean).join(" · ")}</span>}</span>
                            {datos.altaDirecta && datos.soyDueno && <BotonEditar alTocar={() => alEditar(c)} />}
                        </li>
                    ))}</ul>
                    {datos.altaDirecta && datos.soyDueno && <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0" /> Como propietario del lote podés corregir o sacar las matrículas de todos.</p>}
                </section>
            )}

            {resueltos.length > 0 && (
                <section className="mt-6">
                    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Pedidos anteriores</h2>
                    <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
                        {resueltos.map((p) => (
                            <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                                <span className="font-bold tabular-nums tracking-wider">{p.chapa}</span>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.tipo === "MATRICULA_BAJA" ? "sacar" : "sumar"}{p.motivo ? ` · ${p.motivo}` : ""}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", p.estado === "APROBADO" ? "chip-bien" : "chip-quieto")}>{p.estado === "APROBADO" ? "Aprobado" : "No aprobado"}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

/** Marca y color del vehículo, o la invitación a completarlos. */
function Vehiculo({ c }: { c: ChapaDelLote }) {
    const que = [c.marca, c.color].filter(Boolean).join(" · ");
    /* Para qué es va primero cuando no es de la casa: «Proveedor: jardinero» dice más que «sin marca». */
    if (c.uso) return <><span className="block truncate font-semibold">{c.uso}</span>{que && <span className="block truncate text-muted-foreground">{que}</span>}</>;
    return que ? <span className="block truncate font-semibold">{que}</span> : <span className="block text-muted-foreground">Sin marca ni color</span>;
}

/** El lápiz de cada renglón: abre la hoja donde se corrige y, abajo de todo, se elimina. */
function BotonEditar({ alTocar, rotulo = "Editar" }: { alTocar: () => void; rotulo?: string }) {
    return <button type="button" onClick={alTocar} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-border px-3 text-[12.5px] font-semibold", PULSABLE)}><Pencil size={13} /> {rotulo}</button>;
}

function Chapa({ p, apagada }: { p: string; apagada?: boolean }) {
    return (
        <span className={cn("inline-flex flex-col overflow-hidden rounded-[7px] border-2 bg-white text-black", apagada ? "border-black/30 opacity-60" : "border-black/80")}>
            <span className="h-1 bg-[#1d4ed8]" />
            <span className="px-2.5 py-0.5 text-[15px] font-extrabold tabular-nums tracking-[0.14em]">{p}</span>
        </span>
    );
}

/* ═══════════════════════ Mi lote ═══════════════════════ */

function MiLote({ token, datos, alPedir, alEditarServicio, alEditarPersona, alCambiar }: { token: string; datos: MiPortal; alPedir: () => void; alEditarServicio: (sv: ServicioVisto) => void; alEditarPersona: (p: PersonaDelLote) => void; alCambiar: () => void }) {
    const [bajando, setBajando] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pedidosSv = datos.pedidos.filter((p) => p.tipo.startsWith("SERVICIO") && p.estado === "PENDIENTE");
    const bajaPedida = (id: string) => pedidosSv.some((p) => p.tipo === "SERVICIO_BAJA" && p.detalle.servicioId === id);
    if (!datos.lote) return (
        <div><Titulo rotulo="Mi lote" titulo="Sin lote" bajada="Todavía no figurás en ningún lote. Pedile a la administración que te sume al tuyo." /></div>
    );
    const c = datos.censo;
    return (
        <div>
            <Titulo rotulo="Mi lote" titulo={`Lote ${datos.lote.nombre}`} bajada={[datos.lote.administracion, datos.lote.titular ? `Titular: ${datos.lote.titular}` : null].filter(Boolean).join(" · ") || undefined} />
            {c.enlace && (
                <a href={c.enlace} className={cn("flex items-center gap-3.5 rounded-[14px] border p-4", PULSABLE, c.estado === "sin-cargar" ? "border-[color-mix(in_oklab,var(--aviso)_45%,transparent)] bg-[color-mix(in_oklab,var(--aviso)_7%,transparent)]" : "border-border bg-card")}>
                    <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[10px]", c.estado === "aprobado" ? "chip-bien" : c.estado === "esperando" ? "chip-info" : "chip-aviso")}><ClipboardList size={20} /></span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-bold">Censo del lote</span>
                        <span className="block text-[12.5px] leading-snug text-muted-foreground">
                            {c.estado === "aprobado" ? "Aprobado. Podés entrar a agregar o corregir lo que falte." : c.estado === "esperando" ? "Cargado: espera que la administración lo apruebe. Podés corregirlo." : "Todavía no se cargó. Son dos minutos: tus vehículos y quién entra."}
                        </span>
                    </span>
                    <ArrowUpRight size={18} className="shrink-0 text-muted-foreground" />
                </a>
            )}
            <section className="mt-6">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Quiénes están en el lote</h2>
                <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
                    {datos.gente.map((g) => (
                        <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-bold">{g.nombre.charAt(0).toUpperCase()}</span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{g.nombre}{g.yo ? <span className="font-normal text-muted-foreground"> (vos)</span> : null}</span><span className="block text-[12px] text-muted-foreground">{VINCULO[g.vinculo] || g.vinculo}{g.telefono ? <span className="tabular-nums"> · {g.telefono}</span> : null}</span></span>
                            {(g.yo || (datos.altaDirecta && datos.soyDueno)) && <BotonEditar alTocar={() => alEditarPersona(g)} />}
                        </li>
                    ))}
                </ul>
                <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0" /> {datos.altaDirecta && datos.soyDueno ? "Como propietario podés corregir el nombre y el teléfono de cada uno, o sacar del lote a quien ya no vive ahí. Para sumar a alguien, usá el censo del lote." : "Si falta alguien o algo está mal, corregilo en el censo del lote o avisale a la administración."}</p>
            </section>
            <section className="mt-6">
                <div className="mb-2 flex items-baseline gap-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Quiénes vienen a trabajar</h2>
                    <button type="button" onClick={alPedir} className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accion)]"><Plus size={15} /> Sumar</button>
                </div>
                {error && <p className="mb-2 text-[13px] tono-mal">{error}</p>}
                {pedidosSv.length > 0 && (
                    <ul className="mb-2 space-y-2">
                        {pedidosSv.map((p) => (
                            <li key={p.id} className="flex items-center gap-3 rounded-[14px] border border-[color-mix(in_oklab,var(--info)_35%,transparent)] bg-[color-mix(in_oklab,var(--info)_5%,transparent)] p-3.5">
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] chip-info"><Wrench size={16} /></span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{TIPOS_SERVICIO.find((t) => t.id === p.detalle.tipo)?.rotulo || "Proveedor"}{p.detalle.nombre ? ` ${p.detalle.nombre}` : ""}</span><span className="block text-[12px] text-muted-foreground">{p.tipo === "SERVICIO_BAJA" ? "Pediste darlo de baja" : "Pediste sumarlo"} · espera a la administración</span></span>
                                <button type="button" onClick={async () => { await anularPedido(token, p.id); alCambiar(); }} className="text-[12.5px] font-semibold text-muted-foreground underline-offset-2 hover:underline">Anular</button>
                            </li>
                        ))}
                    </ul>
                )}
                {datos.servicios.length === 0 ? (
                    <button type="button" onClick={alPedir} className={cn("w-full rounded-[14px] border border-dashed border-border p-4 text-left text-[13.5px] leading-snug text-muted-foreground", PULSABLE)}>No hay proveedores cargados. Si tenés jardinero, piscinero o limpieza, <b className="text-[var(--accion)]">sumalos acá</b>: la guardia sabe de qué lote son y, si lo pedís, entran solos en su horario.</button>
                ) : (
                    <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
                        {datos.servicios.map((sv) => (
                            <li key={sv.id} className="flex items-center gap-3 px-4 py-3">
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted"><Wrench size={16} /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[14.5px] font-semibold">{sv.nombre || sv.rotulo}</span>
                                    <span className="block text-[12px] text-muted-foreground">{[sv.nombre ? sv.rotulo : null, sv.cuando || null].filter(Boolean).join(" · ") || "Sin días cargados"}</span>
                                </span>
                                <span className="flex shrink-0 flex-col items-end gap-1">
                                    {sv.chapa && <Chapa p={sv.chapa} />}
                                    {sv.entra && <span className="inline-flex items-center gap-1 rounded-full chip-bien px-2 py-0.5 text-[10.5px] font-bold"><DoorOpen size={10} /> Entra en su horario</span>}
                                    {datos.altaDirecta ? <BotonEditar alTocar={() => alEditarServicio(sv)} /> : bajaPedida(sv.id) ? <span className="text-[11.5px] text-muted-foreground">Baja pedida</span> : bajando === sv.id ? (
                                        <span className="flex gap-1.5">
                                            <button type="button" onClick={async () => { setError(null); const r = await pedirBajaServicio(token, sv.id); setBajando(null); if (!r.ok) setError(r.error || "No se pudo."); alCambiar(); }} className="h-8 px-2.5 rounded-[8px] pleno-mal text-[12px] font-bold">Dejó de venir</button>
                                            <button type="button" onClick={() => setBajando(null)} className="h-8 px-2 rounded-[8px] border border-border text-[12px]">No</button>
                                        </span>
                                    ) : <button type="button" onClick={() => setBajando(sv.id)} className="text-[12px] font-semibold text-muted-foreground">Dar de baja</button>}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0" /> La guardia sabe de qué lote son. Los que tienen «Entra en su horario» pasan solos por su matrícula en sus días y horas. {datos.altaDirecta ? "Sumar, corregir o eliminar queda al guardar." : "Sumar o dar de baja es un pedido: lo aprueba la administración."}</p>
            </section>
            {datos.otrosLotes.length > 0 && <p className="mt-4 text-[12.5px] text-muted-foreground">También figurás en: {datos.otrosLotes.join(", ")}.</p>}
            <section className="mt-6">
                <div className="mb-2 flex items-baseline gap-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Tus datos</h2>
                    {(() => { const yo = datos.gente.find((g) => g.yo); return yo ? <button type="button" onClick={() => alEditarPersona(yo)} className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accion)]"><Pencil size={14} /> Corregir</button> : null; })()}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[14px] border border-border bg-card p-4 text-[14px]">
                    <dt className="text-muted-foreground">Nombre</dt><dd className="font-semibold">{datos.nombre}</dd>
                    <dt className="text-muted-foreground">Correo</dt><dd className="truncate">{datos.email || "—"}</dd>
                    <dt className="text-muted-foreground">Teléfono</dt><dd className="tabular-nums">{datos.telefono || "—"}</dd>
                </dl>
            </section>
        </div>
    );
}

/* ═══════════════════════ Las hojas ═══════════════════════ */

/** Una hoja que sube desde abajo, como los cajones del panel en el celular. Se cierra tocando afuera, con la X o con Escape. */
function Hoja({ titulo, bajada, alCerrar, children, pie }: { titulo: string; bajada?: string; alCerrar: () => void; children: React.ReactNode; pie?: React.ReactNode }) {
    const quieto = useReducedMotion();
    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
        window.addEventListener("keydown", k); document.body.style.overflow = "hidden";
        return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
    }, [alCerrar]);
    return (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={titulo}>
            <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={alCerrar} />
            <motion.div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-[640px] flex-col rounded-t-[22px] bg-background"
                initial={quieto ? { opacity: 0 } : { y: "100%" }} animate={quieto ? { opacity: 1 } : { y: 0 }} exit={quieto ? { opacity: 0 } : { y: "100%" }} transition={RESORTE}>
                <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
                <div className="flex items-start gap-3 px-5 pb-3 pt-3">
                    <div className="min-w-0 flex-1"><h2 className="text-[20px] font-bold tracking-[-0.02em]">{titulo}</h2>{bajada && <p className="mt-0.5 text-[13.5px] leading-snug text-muted-foreground">{bajada}</p>}</div>
                    <button type="button" onClick={alCerrar} className="grid h-10 w-10 place-items-center rounded-full bg-muted" aria-label="Cerrar"><X size={18} /></button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
                {pie && <div className="censo-barra px-5 pt-3">{pie}</div>}
            </motion.div>
        </div>
    );
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: React.ReactNode }) {
    return <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">{etiqueta}</span>{children}{ayuda && <span className="mt-1 block text-[12px] text-muted-foreground">{ayuda}</span>}</label>;
}
function Enviar({ ocupado, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { ocupado?: boolean }) {
    return <button type="button" {...p} disabled={ocupado || p.disabled} className={cn("h-12 w-full rounded-[10px] bg-[var(--accion)] text-[15px] font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-50", PULSABLE)}>{ocupado ? <Loader2 size={18} className="animate-spin" /> : null}{children}</button>;
}

function HojaInvitar({ kind, token, alCerrar, alListo }: { kind: "SINGLE" | "EVENT"; token: string; alCerrar: () => void; alListo: () => void }) {
    const evento = kind === "EVENT";
    const [ahora] = useState(() => new Date());
    const [titulo, setTitulo] = useState("");
    const [desde, setDesde] = useState(() => aLocal(ahora));
    const [hasta, setHasta] = useState(() => aLocal(new Date(ahora.getTime() + (evento ? 8 : 4) * 3600_000)));
    const [tope, setTope] = useState(evento ? "40" : "");
    const [filas, setFilas] = useState([{ name: "", plate: "" }]);
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState("");
    const set = (i: number, k: "name" | "plate", v: string) => setFilas((r) => r.map((x, j) => (j === i ? { ...x, [k]: k === "plate" ? v.toUpperCase() : v } : x)));
    const crear = async () => {
        setError("");
        const guests = filas.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), plate: r.plate.trim() || undefined }));
        if (!guests.length) { setError("Poné al menos el nombre de un invitado."); return; }
        if (new Date(hasta) <= new Date(desde)) { setError("La hora de fin tiene que ser después de la de inicio."); return; }
        setOcupado(true);
        try { const r = await createMyInvitation(token, { kind, title: titulo.trim() || undefined, validFrom: desde, validTo: hasta, reentry: "MULTI", maxGuests: evento ? parseInt(tope) || null : null, guests }); if (r.ok) alListo(); else setError(r.error || "No se pudo crear."); }
        finally { setOcupado(false); }
    };
    return (
        <Hoja titulo={evento ? "Armar un evento" : "Invitar una visita"} bajada={evento ? "Una lista de invitados para un rato: cada uno con su QR. Podés sumar más después." : "Su QR entra solo. Si viene en auto, poné la matrícula y la cámara lo reconoce."} alCerrar={alCerrar}
            pie={<><Enviar ocupado={ocupado} onClick={crear}><ShieldCheck size={18} /> {evento ? "Crear el evento" : "Invitar"}</Enviar>{error && <p className="mt-2 text-center text-[13px] tono-mal">{error}</p>}</>}>
            <Campo etiqueta={evento ? "Nombre del evento" : "Para qué (opcional)"}><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={evento ? "Cumple de Mateo" : "Plomero, la abuela, delivery…"} className={ENTRADA} /></Campo>
            <div className="grid grid-cols-2 gap-2.5">
                <Campo etiqueta="Desde"><input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} className={cn(ENTRADA, "text-[14px]")} /></Campo>
                <Campo etiqueta="Hasta"><input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} className={cn(ENTRADA, "text-[14px]")} /></Campo>
            </div>
            {evento && <Campo etiqueta="Cuántos como mucho" ayuda="La garita ve cuántos entraron contra este número."><input inputMode="numeric" value={tope} onChange={(e) => setTope(e.target.value.replace(/\D/g, ""))} className={ENTRADA} /></Campo>}
            <p className="mb-2 text-[13px] font-semibold">{evento ? "Invitados" : "Quién viene"}</p>
            <div className="space-y-2">
                {filas.map((r, i) => (
                    <div key={i} className="flex gap-2">
                        <input value={r.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Nombre" className={cn(ENTRADA, "flex-1")} aria-label={`Nombre del invitado ${i + 1}`} />
                        <input value={r.plate} onChange={(e) => set(i, "plate", e.target.value)} placeholder="Matrícula" className={cn(ENTRADA, "w-[120px] font-bold uppercase tracking-wider")} aria-label={`Matrícula del invitado ${i + 1}`} />
                        {filas.length > 1 && <button type="button" onClick={() => setFilas((x) => x.filter((_, j) => j !== i))} className="grid h-12 w-10 place-items-center text-muted-foreground" aria-label="Quitar"><X size={16} /></button>}
                    </div>
                ))}
            </div>
            <button type="button" onClick={() => setFilas((r) => [...r, { name: "", plate: "" }])} className="mt-2.5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--accion)]"><Plus size={16} /> Otro invitado</button>
        </Hoja>
    );
}

function HojaInvitado({ inv, token, alCerrar, alListo }: { inv: MyInvitation; token: string; alCerrar: () => void; alListo: () => void }) {
    const [nombre, setNombre] = useState(""); const [chapa, setChapa] = useState(""); const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
    return (
        <Hoja titulo="Sumar un invitado" bajada={inv.title || "Evento"} alCerrar={alCerrar}
            pie={<><Enviar ocupado={ocupado} disabled={!nombre.trim()} onClick={async () => { setOcupado(true); try { const r = await addMyGuest(token, inv.id, { name: nombre.trim(), plate: chapa.trim() || undefined }); if (r.ok) alListo(); else setError(r.error || "No se pudo."); } catch { setError("No se pudo: revisá la conexión y probá de nuevo."); } finally { setOcupado(false); } }}><Plus size={18} /> Sumar</Enviar>{error && <p className="mt-2 text-center text-[13px] tono-mal">{error}</p>}</>}>
            <Campo etiqueta="Nombre"><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className={ENTRADA} /></Campo>
            <Campo etiqueta="Matrícula (opcional)" ayuda="Si viene en auto, la cámara lo reconoce en la entrada."><input value={chapa} onChange={(e) => setChapa(e.target.value.toUpperCase())} placeholder="SBC1234" className={cn(ENTRADA, "font-bold tracking-wider")} /></Campo>
        </Hoja>
    );
}

function HojaQr({ g, alCerrar }: { g: MyGuest; alCerrar: () => void }) {
    const [svg, setSvg] = useState("");
    const [copiado, setCopiado] = useState(false);
    const enlace = useMemo(() => (typeof window !== "undefined" ? `${window.location.origin}/invitado/${g.qrToken}` : ""), [g.qrToken]);
    useEffect(() => { getQrSvg(g.qrToken).then(setSvg).catch(() => { }); }, [g.qrToken]);
    const compartir = async () => {
        try {
            if (navigator.share) { await navigator.share({ title: "Tu pase", text: `Pase para entrar${g.name ? `, ${g.name}` : ""}`, url: enlace }); return; }
            await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 1600);
        } catch { /* canceló */ }
    };
    const bajar = () => { const b = new Blob([svg], { type: "image/svg+xml" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `pase-${(g.name || "invitado").replace(/\s+/g, "_")}.svg`; a.click(); URL.revokeObjectURL(u); };
    return (
        <Hoja titulo={g.name || "Invitado"} bajada="Se lo mostrás a la garita o se lo mandás a tu invitado." alCerrar={alCerrar}
            pie={<div className="grid grid-cols-2 gap-2.5">
                <button type="button" onClick={compartir} className={cn("h-12 rounded-[10px] bg-[var(--accion)] text-[15px] font-bold text-white inline-flex items-center justify-center gap-2", PULSABLE)}>{copiado ? <Check size={18} /> : <Copy size={18} />} {copiado ? "Copiado" : "Compartir"}</button>
                <button type="button" onClick={bajar} className={cn("h-12 rounded-[10px] border border-border text-[15px] font-bold inline-flex items-center justify-center gap-2", PULSABLE)}><Download size={18} /> Bajar</button>
            </div>}>
            <div className="mx-auto my-2 w-full max-w-[300px] rounded-[18px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                {svg ? <div className="[&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`QR de ${g.name || "invitado"}`} /> : <div className="grid aspect-square place-items-center"><Loader2 className="animate-spin text-[var(--accion)]" /></div>}
            </div>
            {g.plates.length > 0 && <p className="mt-3 text-center text-[13px] text-muted-foreground">Con la matrícula {g.plates.join(", ")} la cámara lo reconoce sola.</p>}
        </Hoja>
    );
}

/** Pedir un proveedor del lote (26/11): quién es, cuándo viene, en qué vehículo y si entra solo. */
function HojaServicio({ token, directo, previo, alCerrar, alListo }: { token: string; directo: boolean; previo?: ServicioVisto; alCerrar: () => void; alListo: () => void }) {
    const [f, setF] = useState(() => previo
        ? { tipo: previo.tipo, nombre: previo.nombre, telefono: previo.telefono || "", chapa: previo.chapa || "", dias: previo.dias, desde: previo.desde || "", hasta: previo.hasta || "", notas: previo.notas || "", entrada: previo.entra }
        : { tipo: "JARDINERO", nombre: "", telefono: "", chapa: "", dias: [] as string[], desde: "", hasta: "", notas: "", entrada: false });
    const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
    const puedeEntrar = f.chapa.replace(/[^A-Z0-9]/g, "").length >= 5 && f.dias.length > 0;
    const guardar = async () => {
        setError(""); setOcupado(true);
        try {
            const d = { ...f, entrada: f.entrada && puedeEntrar };
            const r = previo ? await editarServicio(token, previo.id, d) : await pedirServicio(token, d);
            if (r.ok) alListo(); else setError(r.error || "No se pudo.");
        } catch { setError("No se pudo: revisá la conexión y probá de nuevo."); } finally { setOcupado(false); }
    };
    return (
        <Hoja titulo={previo ? `Editar ${previo.nombre || previo.rotulo.toLowerCase()}` : "Sumar un proveedor"} bajada={previo ? "Corregí lo que haga falta. Los cambios quedan al guardar." : `Jardinero, piscinero, limpieza: la guardia va a saber de qué lote es. ${directo ? "Queda en tu lote al guardarlo." : "Queda como pedido hasta que la administración lo aprueba."}`} alCerrar={alCerrar}
            pie={<><Enviar ocupado={ocupado} disabled={!f.nombre.trim() && !f.chapa.trim()} onClick={guardar}>{previo ? <><Check size={18} /> Guardar cambios</> : <><Plus size={18} /> {directo ? "Sumarlo" : "Pedir que lo sumen"}</>}</Enviar>{error && <p className="mt-2 text-center text-[13px] tono-mal">{error}</p>}</>}>
            <p className="mb-2 text-[13px] font-semibold">Qué hace</p>
            <div className="mb-4 grid grid-cols-2 gap-2">
                {TIPOS_SERVICIO.map((t) => (
                    <button key={t.id} type="button" onClick={() => setF({ ...f, tipo: t.id })} className={cn("min-h-11 rounded-full border px-2 text-[13px] font-semibold", PULSABLE, f.tipo === t.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)] text-[var(--accion)]" : "border-border")}>{t.rotulo}</button>
                ))}
            </div>
            <Campo etiqueta="Quién es"><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ramón Pérez, o la empresa" className={ENTRADA} /></Campo>
            <div className="grid grid-cols-2 gap-2.5">
                <Campo etiqueta="Teléfono (opcional)"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" placeholder="099 123 456" className={ENTRADA} /></Campo>
                <Campo etiqueta="Matrícula" ayuda="Si viene en vehículo"><input value={f.chapa} onChange={(e) => setF({ ...f, chapa: e.target.value.toUpperCase() })} placeholder="SBC1234" maxLength={10} className={cn(ENTRADA, "font-bold tracking-[0.12em]")} /></Campo>
            </div>
            <p className="mb-2 text-[13px] font-semibold">Qué días viene</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
                {DIAS.map((d) => <button key={d} type="button" aria-pressed={f.dias.includes(d)} onClick={() => setF({ ...f, dias: f.dias.includes(d) ? f.dias.filter((x) => x !== d) : [...f.dias, d] })} className={cn("h-11 w-12 rounded-full border text-[13px] font-semibold capitalize", PULSABLE, f.dias.includes(d) ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border")}>{d}</button>)}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
                <Campo etiqueta="Desde"><input type="time" step={900} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className={ENTRADA} /></Campo>
                <Campo etiqueta="Hasta"><input type="time" step={900} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className={ENTRADA} /></Campo>
            </div>
            <label className={cn("mb-4 flex items-start gap-3 rounded-[14px] border p-3.5", f.entrada && puedeEntrar ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border", !puedeEntrar && "opacity-60")}>
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--accion)]" checked={f.entrada && puedeEntrar} disabled={!puedeEntrar} onChange={(e) => setF({ ...f, entrada: e.target.checked })} />
                <span><span className="flex items-center gap-1.5 text-[14px] font-semibold"><DoorOpen size={15} /> Que entre solo en su horario</span><span className="block text-[12.5px] leading-snug text-muted-foreground">{puedeEntrar ? "La cámara lo reconoce por la matrícula esos días y a esa hora. Fuera de horario, la guardia lo consulta." : "Hacen falta la matrícula y los días que viene."}</span></span>
            </label>
            <Campo etiqueta="Algo para la guardia (opcional)"><input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Viene con un ayudante" className={ENTRADA} /></Campo>
            {previo && <Eliminar que="Eliminar este proveedor" explica="Deja de figurar en tu lote y, si entraba solo, deja de entrar." confirma="Sí, eliminarlo" alEliminar={() => pedirBajaServicio(token, previo.id)} alListo={alListo} />}
        </Hoja>
    );
}

function HojaMatricula({ token, directo, alCerrar, alListo }: { token: string; directo: boolean; alCerrar: () => void; alListo: () => void }) {
    const [f, setF] = useState({ chapa: "", tipo: "PROPIO", marca: "", color: "", quien: "" });
    const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
    return (
        <Hoja titulo="Sumar una matrícula" bajada={directo ? "Queda a tu nombre al guardarla." : "Queda como pedido hasta que la administración lo aprueba. Cuando esté aprobada, la cámara la reconoce en la entrada."} alCerrar={alCerrar}
            pie={<><Enviar ocupado={ocupado} disabled={f.chapa.replace(/[^A-Z0-9]/g, "").length < 5} onClick={async () => { setError(""); setOcupado(true); try { const r = await pedirMatricula(token, f); if (r.ok) alListo(); else setError(r.error || "No se pudo."); } catch { setError("No se pudo: revisá la conexión y probá de nuevo."); } finally { setOcupado(false); } }}><Plus size={18} /> {directo ? "Sumarla" : "Pedir que la sumen"}</Enviar>{error && <p className="mt-2 text-center text-[13px] tono-mal">{error}</p>}</>}>
            <Campo etiqueta="Matrícula"><input autoFocus value={f.chapa} onChange={(e) => setF({ ...f, chapa: e.target.value.toUpperCase() })} placeholder="SBC1234" maxLength={10} className={cn(ENTRADA, "h-14 text-center text-[24px] font-extrabold tracking-[0.18em]")} /></Campo>
            <p className="mb-2 text-[13px] font-semibold">De quién es</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
                {TIPOS_VEHICULO.map((t) => (
                    <button key={t.id} type="button" onClick={() => setF({ ...f, tipo: t.id })} className={cn("min-h-11 rounded-full border px-2 text-[12.5px] font-semibold", PULSABLE, f.tipo === t.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)] text-[var(--accion)]" : "border-border")}>{t.rotulo}</button>
                ))}
            </div>
            {f.tipo !== "PROPIO" && <Campo etiqueta={f.tipo === "FAMILIAR" ? "¿De quién?" : "¿Qué empresa o servicio?"}><input value={f.quien} onChange={(e) => setF({ ...f, quien: e.target.value })} className={ENTRADA} /></Campo>}
            <div className="grid grid-cols-2 gap-2.5">
                <Campo etiqueta="Marca (opcional)"><input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} placeholder="Toyota" className={ENTRADA} /></Campo>
                <Campo etiqueta="Color (opcional)"><input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} placeholder="Blanco" className={ENTRADA} /></Campo>
            </div>
        </Hoja>
    );
}

/**
 * Eliminar, abajo de la hoja y con un segundo toque (27/11). Lo destructivo no va al lado de
 * «Guardar»: se lee, se toca, y recién el segundo toque borra. Sin window.confirm (ver omniaccess-diseno).
 */
function Eliminar({ que, explica, confirma, alEliminar, alListo }: { que: string; explica: string; confirma: string; alEliminar: () => Promise<{ ok: boolean; error?: string }>; alListo: () => void }) {
    const [seguro, setSeguro] = useState(false); const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
    return (
        <div className="mt-2 rounded-[14px] border border-[color-mix(in_oklab,var(--mal)_30%,transparent)] p-3.5">
            {!seguro ? (
                <button type="button" onClick={() => setSeguro(true)} className="flex w-full items-center gap-2.5 text-left">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] chip-mal"><Trash2 size={16} /></span>
                    <span className="min-w-0"><span className="block text-[14px] font-semibold tono-mal">{que}</span><span className="block text-[12px] leading-snug text-muted-foreground">{explica}</span></span>
                </button>
            ) : (
                <div>
                    <p className="text-[13.5px] font-semibold">¿Seguro? No se puede deshacer desde acá.</p>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <button type="button" disabled={ocupado} onClick={async () => { setError(""); setOcupado(true); try { const r = await alEliminar(); if (r.ok) alListo(); else setError(r.error || "No se pudo."); } catch { setError("No se pudo: revisá la conexión y probá de nuevo."); } finally { setOcupado(false); } }}
                            className={cn("h-11 rounded-[10px] pleno-mal text-[14px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60", PULSABLE)}>{ocupado ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} {confirma}</button>
                        <button type="button" onClick={() => setSeguro(false)} className={cn("h-11 rounded-[10px] border border-border text-[14px] font-semibold", PULSABLE)}>No</button>
                    </div>
                    {error && <p className="mt-2 text-[13px] tono-mal">{error}</p>}
                </div>
            )}
        </div>
    );
}

/** Corregir la marca y el color de un vehículo del lote, o sacarlo (27/11). */
function HojaVehiculo({ token, c, alCerrar, alListo }: { token: string; c: ChapaDelLote; alCerrar: () => void; alListo: () => void }) {
    const [f, setF] = useState({ marca: c.marca || "", color: c.color || "", tipo: c.tipo || "PROPIO", quien: c.quien || "" });
    const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
    return (
        <Hoja titulo={`Editar ${c.chapa}`} bajada={c.mia ? "Está a tu nombre. Los cambios quedan al guardar." : `Es de ${c.de}. Como propietario del lote, podés corregirla o sacarla.`} alCerrar={alCerrar}
            pie={<><Enviar ocupado={ocupado} onClick={async () => { setError(""); setOcupado(true); try { const r = await editarVehiculo(token, c.chapa, f); if (r.ok) alListo(); else setError(r.error || "No se pudo."); } catch { setError("No se pudo: revisá la conexión y probá de nuevo."); } finally { setOcupado(false); } }}><Check size={18} /> Guardar cambios</Enviar>{error && <p className="mt-2 text-center text-[13px] tono-mal">{error}</p>}</>}>
            <div className="mb-4 flex justify-center"><Chapa p={c.chapa} /></div>
            <p className="mb-4 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0" /> La matrícula no se edita: si cambiaste de auto, eliminá esta y sumá la nueva.</p>
            <p className="mb-2 text-[13px] font-semibold">De quién es</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
                {TIPOS_VEHICULO.map((t) => (
                    <button key={t.id} type="button" onClick={() => setF({ ...f, tipo: t.id })} className={cn("min-h-11 rounded-full border px-2 text-[12.5px] font-semibold", PULSABLE, f.tipo === t.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)] text-[var(--accion)]" : "border-border")}>{t.rotulo}</button>
                ))}
            </div>
            {f.tipo !== "PROPIO" && <Campo etiqueta={f.tipo === "FAMILIAR" ? "¿De quién?" : "¿Qué empresa o servicio?"} ayuda="Así lo ves en la lista, y la guardia sabe quién llega."><input value={f.quien} onChange={(e) => setF({ ...f, quien: e.target.value })} placeholder={f.tipo === "FAMILIAR" ? "Mateo, mi hijo" : "Jardinero"} className={ENTRADA} /></Campo>}
            <div className="grid grid-cols-2 gap-2.5">
                <Campo etiqueta="Marca"><input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} placeholder="Toyota" className={ENTRADA} /></Campo>
                <Campo etiqueta="Color"><input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} placeholder="Blanco" className={ENTRADA} /></Campo>
            </div>
            <Eliminar que="Eliminar esta matrícula" explica="La cámara deja de reconocerla en la entrada." confirma="Sí, eliminarla" alEliminar={() => quitarMatricula(token, c.chapa)} alListo={alListo} />
        </Hoja>
    );
}

/** Corregir el nombre y el teléfono de alguien del lote, o sacarlo del lote (sólo el propietario, y no a sí mismo). */
function HojaPersona({ token, p, puedeQuitar, alCerrar, alListo }: { token: string; p: PersonaDelLote; puedeQuitar: boolean; alCerrar: () => void; alListo: () => void }) {
    const [f, setF] = useState({ nombre: p.nombre, telefono: p.telefono || "" });
    const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
    return (
        <Hoja titulo={p.yo ? "Tus datos" : `Editar a ${p.nombre.split(" ")[0]}`} bajada={p.yo ? "Así te ve la guardia. Los cambios quedan al guardar." : `${VINCULO[p.vinculo] || p.vinculo} del lote.`} alCerrar={alCerrar}
            pie={<><Enviar ocupado={ocupado} disabled={f.nombre.trim().length < 2} onClick={async () => { setError(""); setOcupado(true); try { const r = await editarPersona(token, p.id, f); if (r.ok) alListo(); else setError(r.error || "No se pudo."); } catch { setError("No se pudo: revisá la conexión y probá de nuevo."); } finally { setOcupado(false); } }}><Check size={18} /> Guardar cambios</Enviar>{error && <p className="mt-2 text-center text-[13px] tono-mal">{error}</p>}</>}>
            <Campo etiqueta="Nombre y apellido"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={ENTRADA} /></Campo>
            <Campo etiqueta="Teléfono" ayuda="La guardia lo usa para avisar que llegó alguien."><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" placeholder="099 123 456" className={ENTRADA} /></Campo>
            {puedeQuitar && <Eliminar que="Sacar del lote" explica="Deja de figurar en este lote. Sus matrículas siguen a su nombre: sacalas antes si ya no entra." confirma="Sí, sacarla" alEliminar={() => quitarPersona(token, p.id)} alListo={alListo} />}
        </Hoja>
    );
}
