"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bike, Building2, Car, ImageOff, ImageUp, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado } from "@/components/ui/celdas";
import { Cajon, CajonCampo, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { getEmpresas, guardarEmpresas, quitarLogoEmpresa, subirLogoEmpresa } from "@/app/actions/empresas";
import { RUBROS, normalizarNombre, type Empresa, type Rubro } from "@/lib/empresas";
import { cn } from "@/lib/utils";

/**
 * Ajustes → Empresas: los deliveries, envíos y taxis que entran al barrio, con su logo.
 *
 * El logo se pinta encima de la captura en el monitor cuando la matrícula es de esa
 * empresa (un proveedor registrado o una visita abierta con esa empresa). Por eso se pide
 * PNG con fondo transparente, y la vista previa lo muestra sobre un damero: un logo con
 * fondo blanco se ve acá igual que se va a ver sobre la foto, como un rectángulo.
 */

const ICONO_RUBRO: Record<Rubro, React.ComponentType<{ size?: number; className?: string }>> = { delivery: Bike, envios: Package, taxi: Car, otro: Building2 };

/** Damero para ver la transparencia de un logo. Los tonos son los de la superficie, no colores nuevos. */
const DAMERO: React.CSSProperties = { background: "repeating-conic-gradient(var(--muted) 0 25%, var(--card) 0 50%) 0 0 / 12px 12px" };

export function LogoEmpresa({ e, alto = 28, className }: { e: Pick<Empresa, "logo" | "nombre">; alto?: number; className?: string }) {
    if (!e.logo) return <span style={{ height: alto }} className={cn("inline-flex items-center text-muted-foreground/40", className)}><ImageOff size={14} /></span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={e.logo} alt={e.nombre} style={{ height: alto }} className={cn("w-auto max-w-[120px] object-contain", className)} />;
}

export default function EmpresasSection() {
    const [lista, setLista] = useState<Empresa[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rubro, setRubro] = useState<Rubro | null>(null);
    const [abierta, setAbierta] = useState<string | null>(null); // clave, o "" para una nueva

    const cargar = () => { setError(null); getEmpresas().then(setLista).catch((e) => setError(e?.message || "No se pudo leer el catálogo.")); };
    useEffect(cargar, []);

    const guardarLista = async (nueva: Empresa[]) => {
        const r = await guardarEmpresas(nueva);
        if (!r.ok) { toast.error(r.error); return false; }
        setLista(r.empresas); return true;
    };

    const filas = useMemo(() => (lista || []).filter((e) => !rubro || e.rubro === rubro), [lista, rubro]);
    const cuenta = (r: Rubro) => (lista || []).filter((e) => e.rubro === r).length;
    const sinLogo = (lista || []).filter((e) => e.activa && !e.logo).length;

    const columnas: ColumnaTabla<Empresa>[] = [
        { clave: "logo", titulo: "Logo", ancho: 140, auxiliar: true, celda: (e) => <span className="inline-flex items-center h-9 px-2 rounded-md" style={e.logo ? DAMERO : undefined}><LogoEmpresa e={e} alto={24} /></span> },
        { clave: "nombre", titulo: "Empresa", valor: (e) => e.nombre, ordenable: true, celda: (e) => (
            <div className="leading-tight min-w-0">
                <div className="text-[13px] font-semibold text-foreground truncate">{e.nombre}</div>
                {e.alias.length > 0 && <div className="text-[11px] text-muted-foreground truncate">También: {e.alias.join(", ")}</div>}
            </div>
        ) },
        { clave: "rubro", titulo: "Rubro", ancho: 120, valor: (e) => RUBROS.find((r) => r.clave === e.rubro)?.nombre, ordenable: true, celda: (e) => {
            const Ic = ICONO_RUBRO[e.rubro];
            return <span className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground"><Ic size={13} className="text-muted-foreground" />{RUBROS.find((r) => r.clave === e.rubro)?.nombre}</span>;
        } },
        { clave: "estadoLogo", titulo: "Sobre la captura", ancho: 160, ayuda: "Si el logo se puede pintar encima de la foto. Necesita fondo transparente.",
            valor: (e) => !e.logo ? "Sin logo" : e.transparente ? "Listo" : "Con fondo",
            celda: (e) => !e.logo ? <Estado tono="neutro">Sin logo</Estado> : e.transparente ? <Estado tono="bien">Listo</Estado> : <Estado tono="aviso">Con fondo</Estado> },
        { clave: "activa", titulo: "Activa", ancho: 90, valor: (e) => e.activa ? "Sí" : "No", celda: (e) => (
            <span onClick={(ev) => ev.stopPropagation()}>
                <Switch checked={e.activa} onCheckedChange={(v) => guardarLista((lista || []).map((x) => x.clave === e.clave ? { ...x, activa: v } : x))} aria-label={`Activa: ${e.nombre}`} />
            </span>
        ) },
    ];

    const rubroChip = (clave: Rubro | null, nombre: string, n: number) => (
        <button key={clave || "todas"} type="button" onClick={() => setRubro(clave)} aria-pressed={rubro === clave}
            className={cn("h-7 px-3 rounded-full border text-[12px] font-semibold transition-colors",
                rubro === clave ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
            {nombre} <span className="tabular-nums opacity-70">{n}</span>
        </button>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-[14px] font-bold"><Building2 size={15} className="text-muted-foreground" /> Empresas que entran al barrio</h3>
                    <p className="text-[12px] text-muted-foreground mt-0.5 max-w-3xl">
                        Deliveries, envíos y taxis. Se eligen en la ficha de un proveedor y al registrar una visita, y su logo aparece sobre la captura cuando entra una matrícula de esa empresa.
                        {sinLogo > 0 && <> Hay <b>{sinLogo}</b> activas sin logo.</>}
                    </p>
                </div>
                <Button onClick={() => setAbierta("")}><Plus size={14} /> Nueva empresa</Button>
            </div>

            <Tabla<Empresa>
                id="empresas" filas={filas} clave={(e) => e.clave} columnas={columnas}
                cargando={lista === null && !error} error={error} alReintentar={cargar}
                vacio={{ icono: Building2, titulo: "Sin empresas", ayuda: rubro ? "No hay ninguna de este rubro." : "Agregá la primera con «Nueva empresa»." }}
                alClickFila={(e) => setAbierta(e.clave)} nombreArchivo="empresas" controles={false}
                barra={<div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                    {rubroChip(null, "Todas", lista?.length || 0)}
                    {RUBROS.map((r) => rubroChip(r.clave, r.nombre, cuenta(r.clave)))}
                </div>}
            />

            <CajonEmpresa clave={abierta} lista={lista || []} onClose={() => setAbierta(null)}
                alGuardar={guardarLista} alCambiarLogo={(e) => setLista((l) => (l || []).map((x) => x.clave === e.clave ? e : x))} />
        </div>
    );
}

function CajonEmpresa({ clave, lista, onClose, alGuardar, alCambiarLogo }: {
    clave: string | null; lista: Empresa[]; onClose: () => void;
    alGuardar: (l: Empresa[]) => Promise<boolean>; alCambiarLogo: (e: Empresa) => void;
}) {
    const abierto = clave !== null;
    const actual = clave ? lista.find((e) => e.clave === clave) || null : null;
    const [nombre, setNombre] = useState("");
    const [rubro, setRubro] = useState<Rubro>("delivery");
    const [alias, setAlias] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [borrar, setBorrar] = useState(false);
    const archivo = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!abierto) return;
        setNombre(actual?.nombre || ""); setRubro(actual?.rubro || "delivery"); setAlias(actual?.alias.join(", ") || "");
    }, [abierto, clave]); // eslint-disable-line react-hooks/exhaustive-deps

    const repetida = !actual && lista.some((e) => e.clave === normalizarNombre(nombre));

    const guardar = async () => {
        if (!nombre.trim() || repetida) return;
        setGuardando(true);
        const fila: Empresa = { clave: actual?.clave || normalizarNombre(nombre), nombre: nombre.trim(), rubro, alias: alias.split(",").map((a) => a.trim()).filter(Boolean), logo: actual?.logo || null, transparente: actual?.transparente || false, activa: actual?.activa ?? true };
        const ok = await alGuardar(actual ? lista.map((e) => e.clave === actual.clave ? fila : e) : [...lista, fila]);
        setGuardando(false);
        if (ok) { toast.success(actual ? "Empresa guardada" : "Empresa agregada"); if (!actual) onClose(); }
    };

    const subir = async (f: File) => {
        if (!actual) return;
        setSubiendo(true);
        const fd = new FormData(); fd.set("clave", actual.clave); fd.set("archivo", f);
        const r = await subirLogoEmpresa(fd);
        setSubiendo(false);
        if (!r.ok) { toast.error(r.error); return; }
        alCambiarLogo(r.empresa);
        if (r.empresa.transparente) toast.success("Logo cargado");
        else toast.warning("Logo cargado, pero sin fondo transparente: sobre la captura se va a ver como un rectángulo.");
    };

    return (
        <Cajon open={abierto} onOpenChange={(o) => !o && onClose()}>
            <CajonContenido ancho="angosto" titulo={actual ? actual.nombre : "Nueva empresa"}
                descripcion={actual ? "Nombre, rubro, otras formas de escribirla y el logo que va sobre la captura." : "Primero el nombre y el rubro; el logo se sube después de guardarla."}
                pie={<>
                    {actual && (
                        <ConfirmarAccion id={actual.clave} open={borrar} onOpenChange={setBorrar}
                            title={`Sacar «${actual.nombre}» del catálogo`}
                            description="Las fichas y visitas que la nombran conservan el texto, pero dejan de mostrar el logo."
                            etiquetaAccion="Sacar del catálogo"
                            onDelete={async () => { const ok = await alGuardar(lista.filter((e) => e.clave !== actual.clave)); return ok ? { success: true } : { success: false, error: "No se pudo guardar" }; }}
                            onSuccess={onClose} />
                    )}
                    {actual && <Button variant="ghost" className="mr-auto tono-mal" onClick={() => setBorrar(true)}><Trash2 size={14} /> Sacar</Button>}
                    <Button variant="outline" onClick={onClose}>Cerrar</Button>
                    <Button onClick={guardar} disabled={guardando || !nombre.trim() || repetida}>{guardando && <Loader2 size={14} className="animate-spin" />} Guardar</Button>
                </>}>
                <div className="px-6 py-5 space-y-6">
                    <CajonSeccion titulo="La empresa" icono={Building2}>
                        <div className="space-y-4">
                            <CajonCampo etiqueta="Nombre" pista={<>Como se la conoce en el barrio. Ej.: <b>PedidosYa</b>, <b>Radio Taxi 141</b>.</>}>
                                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. PedidosYa" autoFocus={!actual} />
                                {repetida && <p className="text-[11.5px] tono-mal mt-1">Ya hay una empresa con ese nombre.</p>}
                            </CajonCampo>
                            <CajonCampo etiqueta="Rubro" pista="Ordena el catálogo y la lista donde el guardia la elige.">
                                <div className="grid grid-cols-2 gap-2">
                                    {RUBROS.map((r) => {
                                        const Ic = ICONO_RUBRO[r.clave];
                                        return (
                                            <Pista key={r.clave} texto={r.ayuda}>
                                                <button type="button" onClick={() => setRubro(r.clave)} aria-pressed={rubro === r.clave}
                                                    className={cn("w-full h-10 px-3 rounded-md border flex items-center gap-2 text-[12.5px] font-semibold transition-colors",
                                                        rubro === r.clave ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border text-foreground hover:bg-accent")}>
                                                    <Ic size={14} /> {r.nombre}
                                                </button>
                                            </Pista>
                                        );
                                    })}
                                </div>
                            </CajonCampo>
                            <CajonCampo etiqueta="También se escribe" pista={<>Otras formas en que aparece en fichas viejas o en lo que tipea el guardia, separadas por coma. Ej.: <b>Pedidos Ya, PYA</b>. Mayúsculas, tildes y espacios no cuentan.</>}>
                                <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Ej. Pedidos Ya, PYA" />
                            </CajonCampo>
                        </div>
                    </CajonSeccion>

                    {actual && (
                        <CajonSeccion titulo="Logo sobre la captura" icono={ImageUp}
                            pista="Se pinta en una esquina de la foto cuando entra una matrícula de esta empresa. PNG o SVG con fondo transparente; se recorta el margen y se guarda a 160 px de alto.">
                            <div className="space-y-3">
                                <div className="h-28 rounded-[10px] border border-border grid place-items-center" style={DAMERO}>
                                    {actual.logo ? <LogoEmpresa e={actual} alto={56} /> : <span className="text-[12px] text-muted-foreground">Sin logo todavía</span>}
                                </div>
                                {actual.logo && !actual.transparente && (
                                    <p className="text-[12px] tono-aviso">Este logo tiene fondo: sobre la captura se va a ver como un rectángulo. Conviene subir la versión con fondo transparente.</p>
                                )}
                                <div className="flex items-center gap-2">
                                    <input ref={archivo} type="file" accept="image/png,image/svg+xml,image/webp" className="hidden"
                                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) subir(f); }} />
                                    <Button variant="outline" onClick={() => archivo.current?.click()} disabled={subiendo}>
                                        {subiendo ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />} {actual.logo ? "Cambiar logo" : "Subir logo"}
                                    </Button>
                                    {actual.logo && (
                                        <Button variant="ghost" onClick={async () => { const r = await quitarLogoEmpresa(actual.clave); if (!r.ok) toast.error(r.error); else alCambiarLogo({ ...actual, logo: null, transparente: false }); }}>
                                            Quitar
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CajonSeccion>
                    )}
                </div>
            </CajonContenido>
        </Cajon>
    );
}
