"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Tooltip } from "react-tooltip";
import {
    DoorOpen, DoorClosed, Zap, Tag, Type, MapPin, Plug, Network, User, KeyRound, ShieldCheck, Loader2, Save, X, AlertTriangle, Check,
    ListChecks, History, LogIn, LogOut, Hash, RefreshCw, BellRing, Lock, ExternalLink, PlugZap, Fingerprint,
} from "lucide-react";
import { Cajon, CajonContenido, CajonCerrar } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Estado } from "@/components/ui/celdas";
import { useConfirmar } from "@/components/ui/use-confirmar";
import { Bloque, Campo, Etiqueta, Opcion, TT_FICHA } from "@/components/devices/CajonDispositivo";
import { createDevice, updateDevice } from "@/app/actions/devices";
import { fichaPortero, abrirPuertaPortero, probarPortero, type FichaPortero } from "@/app/actions/portero";
import { comoAbre, MARCAS_PORTERO, ROTULO_MARCA, textoSegundos, type Puerta } from "@/lib/aperturas";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/*
 * La ficha de un portero (13/11, Nico: «no tiene drawer, llama al modal viejo; debe ser el drawer
 * típico pero adaptado a porteros, como hik, akuvox, dahua, intelbras… explorá las aperturas»).
 *
 * «Editar configuración» de un portero abría «Sincronizar nodo», el formulario de cuatro fases
 * pensado para dar de alta una lectora. Un portero se mira por sus PUERTAS: cuáles tiene (se le
 * pregunta al equipo), cuánto las deja abiertas, si OmniAccess sabe pedirle que abra y si ese
 * pedido se probó alguna vez. Usa las piezas de la ficha de las cámaras (CajonDispositivo).
 *
 * Sirve para editar (`device`) y para dar de alta (`device` null): al crear, la ficha se queda
 * abierta sobre el equipo nuevo, para ver enseguida qué puertas declaró.
 */

/** Las órdenes que declara un equipo, dichas como las diría quien está en la guardia. */
const ORDEN: Record<string, string> = { open: "abrir", close: "cerrar", alwaysOpen: "dejar abierta", alwaysClose: "dejar cerrada", resume: "volver a normal" };

const TIPOS = [
    { valor: "DOOR_INTERCOM", titulo: "Portero", detalle: "Con botón de llamada, y casi siempre cámara.", icono: BellRing },
    { valor: "ACCESS_CONTROL", titulo: "Control de acceso", detalle: "Lectora o controladora, sin llamada.", icono: Fingerprint },
] as const;

const hace = (iso: string | null) => {
    if (!iso) return null;
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

type Resultado = { ok: boolean; mensaje: string; cuando: number };
/** Lo que la ficha le pide al servidor. Va junto para poder mostrar la ficha con datos de prueba, sin equipo ni sesión. */
const ACCIONES = { ficha: fichaPortero, abrir: abrirPuertaPortero, probar: probarPortero, crear: createDevice, actualizar: updateDevice };
const VACIO = { name: "", location: "", ip: "", httpPort: "", username: "admin", password: "", authType: "DIGEST", brand: "HIKVISION", deviceType: "DOOR_INTERCOM", direction: "ENTRY" };

export function CajonPortero({ device, open, onOpenChange, onSuccess, acciones }: {
    /** El portero a editar; `null` para dar de alta uno. */
    device: any | null; open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void;
    acciones?: Partial<typeof ACCIONES>;
}) {
    const servidor = { ...ACCIONES, ...acciones };
    const [id, setId] = useState<string | null>(null);
    const [ficha, setFicha] = useState<FichaPortero | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [f, setF] = useState({ ...VACIO });
    const [guardando, setGuardando] = useState(false);
    const [abriendo, setAbriendo] = useState<number | null>(null);
    const [resultados, setResultados] = useState<Record<number, Resultado>>({});
    const [prueba, setPrueba] = useState<{ corriendo: boolean; ok?: boolean; texto?: string } | null>(null);
    const { confirmar, elemento } = useConfirmar();
    const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

    const traer = useCallback(async (cual: string, primera: boolean) => {
        try {
            const r = await servidor.ficha(cual);
            setFicha(r); setError(null);
            if (primera) setF({ name: r.name, location: r.location || "", ip: r.ip, httpPort: r.httpPort ? String(r.httpPort) : "", username: r.username || "", password: "", authType: r.authType || "DIGEST", brand: r.brand, deviceType: r.deviceType, direction: r.direction });
        } catch (e: any) { setError(e?.message || "No se pudo leer el equipo"); }
        // `servidor` se arma en cada render con las mismas funciones: no es una dependencia real.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!open) return;
        setFicha(null); setError(null); setResultados({}); setPrueba(null);
        setId(device?.id || null);
        if (device?.id) traer(device.id, true); else setF({ ...VACIO });
    }, [open, device?.id, traer]);

    const alta = !id;
    const como = ficha?.como || comoAbre(f.brand);
    const marca = ROTULO_MARCA[f.brand] || f.brand;
    const tipo = TIPOS.find((t) => t.valor === f.deviceType) || TIPOS[0];
    const ipValida = /^\d{1,3}(\.\d{1,3}){3}$/.test(f.ip.trim());

    const guardar = async () => {
        if (!f.name.trim()) { toast.error({ title: "Falta el nombre" }); return; }
        if (!ipValida) { toast.error({ title: "La IP no es válida", description: "Ejemplo: 192.168.1.60" }); return; }
        setGuardando(true);
        try {
            const fd = new FormData();
            fd.set("name", f.name.trim()); fd.set("ip", f.ip.trim()); fd.set("location", f.location.trim());
            fd.set("brand", f.brand); fd.set("deviceType", f.deviceType); fd.set("direction", f.direction);
            fd.set("username", f.username.trim()); fd.set("authType", f.authType); fd.set("httpPort", f.httpPort.trim());
            // Vacía = no se toca (updateDevice): la clave guardada no viaja al navegador.
            if (f.password) fd.set("password", f.password);
            if (ficha?.deviceModel) fd.set("deviceModel", ficha.deviceModel);
            if (ficha?.mac) fd.set("mac", ficha.mac);
            if (alta) {
                const r: any = await servidor.crear(fd);
                toast.success({ title: "Portero agregado", description: f.name });
                onSuccess();
                // La ficha se queda sobre el equipo nuevo: lo primero que hay que ver son sus puertas.
                if (r?.id) { setId(r.id); setFicha(null); traer(r.id, true); } else onOpenChange(false);
            } else {
                await servidor.actualizar(id!, fd);
                toast.success({ title: "Cambios guardados", description: f.name });
                onSuccess(); onOpenChange(false);
            }
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    const probar = async () => {
        if (!ipValida) { toast.error({ title: "La IP no es válida" }); return; }
        setPrueba({ corriendo: true });
        try {
            const r = await servidor.probar({ ip: f.ip.trim(), httpPort: Number(f.httpPort) || null, brand: f.brand, username: f.username.trim(), password: f.password, authType: f.authType, id: id || undefined });
            const lista = r.puertas.map((p) => p.nombre).join(", ");
            setPrueba({ corriendo: false, ok: r.ok, texto: !r.ok ? (r.error || "No contestó") : r.leidas ? `Contestó. Declara ${r.puertas.length === 1 ? "una puerta" : `${r.puertas.length} puertas`}: ${lista}.` : `${marca} no informa sus relés: no se puede comprobar desde acá sin abrir.` });
        } catch (e: any) { setPrueba({ corriendo: false, ok: false, texto: e?.message || "No se pudo probar" }); }
    };

    const abrir = async (p: Puerta) => {
        if (!ficha || abriendo != null) return;
        const si = await confirmar({
            titulo: `Abrir «${p.nombre}» de ${ficha.name}`,
            descripcion: `Se le pide al equipo que abra ahora${p.segundos ? ` (queda abierta ${textoSegundos(p.segundos)})` : ""}. Es una puerta de verdad: abrila sólo si sabés quién está del otro lado. Queda registrado en Auditoría con tu usuario.${como.probado ? "" : " Este pedido todavía no se probó contra un equipo de esta marca: mirá la puerta la primera vez."}`,
            accion: "Abrir", variante: "accion", icono: DoorOpen,
        });
        if (!si) return;
        setAbriendo(p.n);
        try {
            const r = await servidor.abrir(ficha.id, p.n, p.nombre);
            setResultados((x) => ({ ...x, [p.n]: { ...r, cuando: Date.now() } }));
            if (r.ok) toast.success({ title: "El equipo aceptó abrir", description: r.mensaje }); else toast.error({ title: "No abrió", description: r.mensaje });
            traer(ficha.id, false);
        } catch (e: any) { setResultados((x) => ({ ...x, [p.n]: { ok: false, mensaje: e?.message || "No se pudo pedir", cuando: Date.now() } })); }
        finally { setAbriendo(null); }
    };

    const pie = (
        <div className="flex items-center gap-2 w-full">
            <span className="text-[11.5px] text-muted-foreground mr-auto">{alta ? "Al agregarlo se le pregunta qué puertas tiene." : "La contraseña vacía deja la que está guardada."}</span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>{alta ? "Cancelar" : "Cerrar"}</Button>
            <Button onClick={guardar} disabled={guardando || (!alta && !ficha)} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {alta ? "Agregar portero" : "Guardar cambios"}</Button>
        </div>
    );

    return (
        <Cajon open={open} onOpenChange={(x) => { if (!guardando && abriendo == null) onOpenChange(x); }}>
            <CajonContenido ancho="intermedio" tituloOculto sinCabecera titulo={f.name || device?.name || "Portero"} descripcion={`${tipo.titulo} · ${marca}`} pie={pie}>
                <CabeceraPortero id={id} titulo={f.name || device?.name || (alta ? "Portero nuevo" : "Portero")} subtitulo={[tipo.titulo, marca, ficha?.deviceModel].filter(Boolean).join(" · ")}
                    ip={f.ip} ficha={ficha} />

                {!alta && error && !ficha ? (
                    <div className="px-6 py-10 text-center">
                        <AlertTriangle size={22} className="mx-auto mb-2 tono-mal" />
                        <div className="text-[13px] font-semibold">No se pudo leer el equipo</div>
                        <div className="text-[12px] text-muted-foreground mt-1">{error}</div>
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => traer(id!, true)}>Reintentar</Button>
                    </div>
                ) : !alta && !ficha ? (
                    <div className="px-6 py-10 grid place-items-center text-muted-foreground text-[13px]"><span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Preguntándole al portero qué puertas tiene…</span></div>
                ) : (
                    <div>
                        {ficha && (
                            <Bloque titulo="Puertas" icono={DoorOpen} ayuda="Lo que el equipo declara que puede abrir. Cada puerta se abre por separado y cada pedido queda en Auditoría."
                                accion={<button type="button" onClick={() => traer(ficha.id, false)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline"><RefreshCw size={12} /> Volver a leer</button>}>
                                {ficha.puertas.length === 0 ? (
                                    <p className="text-[12.5px] text-muted-foreground flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0 tono-aviso" /> {como.nota}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {ficha.puertas.map((p) => <FilaPuerta key={p.n} p={p} abriendo={abriendo === p.n} bloqueada={ficha.soloLectura || !como.puede || (abriendo != null && abriendo !== p.n)} resultado={resultados[p.n]} onAbrir={() => abrir(p)} />)}
                                    </div>
                                )}
                                {/* Si la marca no informa sus relés (Akuvox), lo dice la nota de abajo: acá sólo el fallo de lectura. */}
                                {!ficha.puertasLeidas && ficha.puertasError && ficha.puertas.length > 0 && (
                                    <p className="text-[12px] text-muted-foreground flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0 tono-aviso" />
                                        No se le pudo preguntar al equipo ({ficha.puertasError}). Se muestra la puerta 1, asumida.</p>
                                )}
                                {ficha.soloLectura && (
                                    <p className="text-[12px] text-muted-foreground flex items-start gap-1.5"><Lock size={13} className="mt-0.5 shrink-0 tono-aviso" />
                                        Este servidor tiene a este equipo como de sólo lectura: desde acá se mira, no se abre. Se abre desde el servidor de ese lugar.</p>
                                )}
                                {como.puede && (
                                    <div className="rounded-lg bg-muted/50 px-3 py-2.5 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <Estado tono={como.probado ? "bien" : "aviso"} className="shrink-0">{como.probado ? "Apertura probada" : "Apertura sin probar"}</Estado>
                                            <span className="text-[11px] font-mono text-muted-foreground truncate" {...{ "data-tooltip-id": TT_FICHA, "data-tooltip-content": "El pedido que OmniAccess le manda al equipo para abrir." }}>{como.metodo}</span>
                                        </div>
                                        <p className="text-[11.5px] text-muted-foreground leading-snug">{como.nota}</p>
                                    </div>
                                )}
                                {ficha.aperturas.length > 0 && (
                                    <div>
                                        <Etiqueta texto="Últimas aperturas pedidas desde OmniAccess" />
                                        <div className="space-y-1">
                                            {ficha.aperturas.map((a, i) => (
                                                <div key={i} className="flex items-center gap-2 text-[12px] h-7">
                                                    <History size={12} className="text-muted-foreground shrink-0" />
                                                    <span className="font-semibold shrink-0">{a.quien}</span>
                                                    <span className="text-muted-foreground truncate">{(a.detalle || "").split(" · ").slice(1).join(" · ")}</span>
                                                    <span className={cn("ml-auto shrink-0 text-[11px] font-semibold", a.ok ? "tono-bien" : "tono-mal")}>{a.ok ? "aceptó" : "no abrió"}</span>
                                                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums w-[70px] text-right">{hace(a.cuando)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </Bloque>
                        )}

                        {ficha && (
                            <Bloque titulo={`Qué hace OmniAccess con un ${marca}`} icono={ListChecks} ayuda="Lo que está probado contra equipos reales de esta marca. Lo que no figura, no se hace: no se simula.">
                                {ficha.hace.length ? (
                                    <ul className="space-y-1">{ficha.hace.map((h) => <li key={h.clave} className="flex items-center gap-2 text-[12.5px]"><Check size={13} className="tono-bien shrink-0" /> {h.que}</li>)}</ul>
                                ) : <p className="text-[12.5px] text-muted-foreground">Nada probado todavía con esta marca.</p>}
                                {ficha.notaMarca && <p className="text-[11.5px] text-muted-foreground leading-snug">{ficha.notaMarca}</p>}
                                <p className="text-[12px] text-muted-foreground flex items-start gap-1.5">
                                    <PlugZap size={13} className="mt-0.5 shrink-0" />
                                    {ficha.grupos.length ? <>Está en {ficha.grupos.length === 1 ? "el grupo de acceso" : "los grupos de acceso"} <b className="text-foreground font-semibold">{ficha.grupos.join(", ")}</b>.</> : <>No está en ningún grupo de acceso: sus puertas se abren sólo a mano, desde acá.</>}
                                    <Link href="/admin/groups" className="ml-1 inline-flex items-center gap-1 font-semibold text-[var(--accion)] hover:underline shrink-0">Grupos <ExternalLink size={11} /></Link>
                                </p>
                            </Bloque>
                        )}

                        {alta && (
                            <Bloque titulo="Qué equipo es" icono={BellRing} ayuda="La marca decide cómo se le pide que abra. Al lado de cada una dice si esa apertura se probó contra un equipo real.">
                                <div className="grid grid-cols-2 gap-3">
                                    {TIPOS.map((t) => <Opcion key={t.valor} activa={f.deviceType === t.valor} onClick={() => set("deviceType", t.valor)} icono={t.icono} color="text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" titulo={t.titulo} detalle={t.detalle} />)}
                                </div>
                                <div>
                                    <Etiqueta texto="Marca" />
                                    <div className="grid gap-2">
                                        {MARCAS_PORTERO.map((m) => {
                                            const c = comoAbre(m);
                                            return (
                                                <button key={m} type="button" onClick={() => { set("brand", m); setPrueba(null); }}
                                                    className={cn("rounded-lg border px-3 h-11 text-left flex items-center gap-3 transition-colors", f.brand === m ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/60")}>
                                                    <span className="font-bold text-[13.5px] w-[104px] shrink-0">{ROTULO_MARCA[m]}</span>
                                                    <Estado tono={!c.puede ? "mal" : c.probado ? "bien" : "aviso"} className="shrink-0">{!c.puede ? "No abre todavía" : c.probado ? "Apertura probada" : "Apertura sin probar"}</Estado>
                                                    {f.brand === m && <Check size={15} className="ml-auto text-[var(--accion)] shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[11.5px] text-muted-foreground leading-snug mt-2">{como.nota}</p>
                                </div>
                            </Bloque>
                        )}

                        <Bloque titulo="Identidad" icono={Tag} ayuda="Cómo se llama, dónde está y de qué lado del acceso. Es lo que se ve en el historial cuando alguien pasa por él.">
                            <Campo etiqueta="Nombre" icono={Type} value={f.name} onChange={(x) => set("name", x)} placeholder="Timbre proveedores" autoFocus={alta} />
                            <Campo etiqueta="Ubicación" icono={MapPin} value={f.location} onChange={(x) => set("location", x)} placeholder="Portón de servicio" />
                            <div>
                                <Etiqueta texto="Sentido" ayuda="Los pasos por este portero quedan en el historial como entradas o como salidas." />
                                <div className="grid grid-cols-2 gap-3">
                                    <Opcion activa={f.direction === "ENTRY"} onClick={() => set("direction", "ENTRY")} icono={LogIn} color="text-emerald-600 bg-emerald-500/10" titulo="Entrada" />
                                    <Opcion activa={f.direction === "EXIT"} onClick={() => set("direction", "EXIT")} icono={LogOut} color="text-muted-foreground bg-muted" titulo="Salida" />
                                </div>
                            </div>
                        </Bloque>

                        <Bloque titulo="Conexión" icono={Plug} ayuda="Cómo le habla OmniAccess al portero: para leer sus puertas, abrirlas y, si la marca lo permite, cargarle rostros y tarjetas."
                            accion={<button type="button" onClick={probar} disabled={prueba?.corriendo} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline disabled:opacity-60">{prueba?.corriendo ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Probar sin guardar</button>}>
                            <div className="grid grid-cols-[1fr_120px] gap-4">
                                <Campo etiqueta="IP" icono={Network} value={f.ip} onChange={(x) => { set("ip", x); setPrueba(null); }} mono placeholder="192.168.1.60" />
                                <Campo etiqueta="Puerto HTTP" ayuda="Vacío = 80." icono={Hash} value={f.httpPort} onChange={(x) => set("httpPort", x.replace(/\D/g, ""))} mono placeholder="80" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <Campo etiqueta="Usuario" icono={User} value={f.username} onChange={(x) => set("username", x)} placeholder="admin" />
                                <Campo etiqueta="Contraseña" icono={KeyRound} tipo="password" value={f.password} onChange={(x) => set("password", x)} placeholder={alta ? "" : "Sin cambios"} />
                            </div>
                            <div>
                                <Etiqueta texto="Autenticación" ayuda="Hikvision, Dahua e Intelbras piden Digest. Akuvox depende de cómo esté configurada su API HTTP." />
                                <div className="grid grid-cols-2 gap-3">
                                    <Opcion activa={f.authType === "DIGEST"} onClick={() => set("authType", "DIGEST")} icono={ShieldCheck} color="text-emerald-600 bg-emerald-500/10" titulo="Digest" detalle="La de casi todos." />
                                    <Opcion activa={f.authType === "BASIC"} onClick={() => set("authType", "BASIC")} icono={KeyRound} color="text-muted-foreground bg-muted" titulo="Básica" detalle="Usuario y clave en claro." />
                                </div>
                            </div>
                            {prueba && !prueba.corriendo && (
                                <p className="text-[12px] flex items-start gap-1.5">{prueba.ok ? <Check size={14} className="mt-0.5 shrink-0 tono-bien" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 tono-mal" />}<span className={prueba.ok ? "text-foreground" : "tono-mal"}>{prueba.texto}</span></p>
                            )}
                        </Bloque>
                    </div>
                )}
                <Tooltip id={TT_FICHA} place="top" className="!max-w-[300px] !text-[12px] !leading-snug !rounded-lg !z-[9999]" />
                {elemento}
            </CajonContenido>
        </Cajon>
    );
}

/** Una puerta del equipo: qué es, cuánto queda abierta, qué acepta, y el botón para abrirla. */
function FilaPuerta({ p, abriendo, bloqueada, resultado, onAbrir }: { p: Puerta; abriendo: boolean; bloqueada: boolean; resultado?: Resultado; onAbrir: () => void }) {
    const I = p.clase === "rele" ? Zap : DoorClosed;
    // «Relé A · Relé» no dice nada: la clase se escribe sólo cuando el nombre no la trae.
    const detalle = [/^rel[eé]/i.test(p.nombre) ? null : p.clase === "rele" ? "Relé" : "Cerradura", p.segundos ? `queda abierta ${textoSegundos(p.segundos)}` : null].filter(Boolean).join(" · ");
    const acepta = p.ordenes.map((o) => ORDEN[o] || o);
    return (
        <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><I size={19} /></span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="font-bold text-[13.5px] truncate">{p.nombre}</span><span className="text-[11px] font-semibold text-muted-foreground tabular-nums shrink-0">n.º {p.n}</span></span>
                    {detalle && <span className="block text-[11.5px] text-muted-foreground leading-snug">{detalle}</span>}
                    {acepta.length > 0 && <span className="block text-[11.5px] text-muted-foreground leading-snug">Acepta: {acepta.join(", ")}.</span>}
                </span>
                <Button variant="outline" size="sm" onClick={onAbrir} disabled={bloqueada || abriendo} className="gap-1.5 shrink-0">{abriendo ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} />} {abriendo ? "Abriendo…" : "Abrir"}</Button>
            </div>
            {resultado && (
                <p className={cn("mt-2 text-[12px] flex items-start gap-1.5", resultado.ok ? "tono-bien" : "tono-mal")}>
                    {resultado.ok ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                    <span>{resultado.ok ? "El equipo aceptó abrir." : `No abrió: ${resultado.mensaje}`}</span>
                </p>
            )}
        </div>
    );
}

/** El video del portero arriba (es lo que ve quien toca el timbre). En el alta, sin equipo todavía, una franja con el título. */
function CabeceraPortero({ id, titulo, subtitulo, ip, ficha }: { id: string | null; titulo: string; subtitulo: string; ip?: string; ficha: FichaPortero | null }) {
    const [listo, setListo] = useState(false);
    const [falla, setFalla] = useState(false);
    useEffect(() => { setListo(false); setFalla(false); }, [id]);
    const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-black/45 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";
    return (
        <div className="sticky top-0 z-20">
            <div className={cn("relative w-full overflow-hidden bg-black", id ? "aspect-video" : "h-28 bg-gradient-to-br from-sky-950 via-neutral-900 to-black")}>
                {id && (<>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/snapshot/${id}?w=960`} alt="" className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", listo ? "opacity-0" : "opacity-100")} onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                    {!falla && <video key={id} src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${id}`)}&video=h264`} autoPlay muted playsInline
                        onPlaying={() => setListo(true)} onError={() => setFalla(true)} className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", listo ? "opacity-100" : "opacity-0")} />}
                    {!listo && (
                        <span className="absolute inset-x-0 bottom-12 grid place-items-center text-white/75 text-[12px] font-semibold">
                            {falla ? <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Sin video del portero</span> : <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Conectando el vivo…</span>}
                        </span>
                    )}
                    <span className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
                    <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />
                </>)}
                <div className="absolute left-5 top-4 right-4 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[19px] font-bold text-white leading-tight truncate drop-shadow">{titulo}</h2>
                        <p className="text-[12px] text-white/75 truncate drop-shadow">{subtitulo}</p>
                        {id && (
                            <div className="flex items-center gap-1.5 mt-2">
                                <span className={chip}><BellRing size={12} /> Portero</span>
                                {listo && <span className={cn(chip, "!bg-red-600/85")}><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> EN VIVO</span>}
                            </div>
                        )}
                    </div>
                    <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md text-white grid place-items-center ring-1 ring-white/15 transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
                </div>
                {id && (
                    <div className="absolute left-4 right-4 bottom-3 flex items-center gap-1.5 flex-wrap">
                        {ip && <span className={cn(chip, "font-mono")}><Network size={11} /> {ip}</span>}
                        {ficha && <span className={cn(chip, ficha.enLinea ? "!bg-emerald-600/80" : "!bg-red-600/80")}>{ficha.enLinea ? <Check size={11} /> : <AlertTriangle size={11} />} {ficha.enLinea ? "Contesta" : "Sin respuesta"}</span>}
                        {ficha && ficha.puertas.length > 0 && <span className={chip}><DoorClosed size={11} /> {ficha.puertas.length === 1 ? "1 puerta" : `${ficha.puertas.length} puertas`}{ficha.puertasLeidas ? "" : " (sin leer)"}</span>}
                    </div>
                )}
            </div>
        </div>
    );
}
