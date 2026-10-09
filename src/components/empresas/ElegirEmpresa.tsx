"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bike, Building2, Car, Check, Package } from "lucide-react";
import { getEmpresas } from "@/app/actions/empresas";
import { RUBROS, empresaDe, normalizarNombre, type Empresa, type Rubro } from "@/lib/empresas";
import { cn } from "@/lib/utils";

/**
 * El campo «Empresa»: se elige del catálogo (Ajustes → Empresas) o se escribe.
 *
 * No es un select cerrado a propósito: un proveedor puede ser «UTE» o «Jardinería Pérez»,
 * que no son empresas que valga la pena catalogar. Lo que cambia es que, si lo escrito
 * coincide con una del catálogo (por nombre o alias), se guarda con el nombre del catálogo
 * y se ve su logo — así "pedidos ya" y "PedidosYa" dejan de ser dos empresas.
 */

const ICONO: Record<Rubro, React.ComponentType<{ size?: number; className?: string }>> = { delivery: Bike, envios: Package, taxi: Car, otro: Building2 };

/** El catálogo se pide una vez por pestaña: no cambia mientras se carga una ficha. */
let catalogo: Promise<Empresa[]> | null = null;
const traerCatalogo = () => (catalogo ||= getEmpresas().then((l) => l.filter((e) => e.activa)).catch(() => { catalogo = null; return []; }));

export function ElegirEmpresa({ name, defaultValue, value: controlado, onChange, alElegir, placeholder = "Elegí o escribí la empresa", className }: {
    /** Si viene, el valor viaja en el formulario con este nombre. */
    name?: string;
    defaultValue?: string | null;
    value?: string;
    onChange?: (v: string) => void;
    /** La empresa del catálogo que corresponde a lo escrito (o null): para usar su logo afuera. */
    alElegir?: (e: Empresa | null) => void;
    placeholder?: string;
    className?: string;
}) {
    const [propio, setPropio] = useState(defaultValue || "");
    const valor = controlado ?? propio;
    const poner = (v: string) => { if (controlado === undefined) setPropio(v); onChange?.(v); };
    const [lista, setLista] = useState<Empresa[]>([]);
    const [abierto, setAbierto] = useState(false);
    const [foco, setFoco] = useState(0);
    const caja = useRef<HTMLDivElement | null>(null);
    const idLista = useId();

    useEffect(() => { traerCatalogo().then(setLista); }, []);
    useEffect(() => { if (controlado === undefined) setPropio(defaultValue || ""); }, [defaultValue]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!abierto) return;
        const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
        document.addEventListener("mousedown", fuera);
        return () => document.removeEventListener("mousedown", fuera);
    }, [abierto]);

    const elegida = useMemo(() => empresaDe(valor, lista), [valor, lista]);
    useEffect(() => { alElegir?.(elegida); }, [elegida]); // eslint-disable-line react-hooks/exhaustive-deps
    const opciones = useMemo(() => {
        const q = normalizarNombre(valor);
        // Con una ya elegida se muestran todas: el que abre la lista quiere cambiarla.
        const base = !q || elegida ? lista : lista.filter((e) => normalizarNombre(e.nombre).includes(q) || e.alias.some((a) => normalizarNombre(a).includes(q)));
        return [...base].sort((a, b) => RUBROS.findIndex((r) => r.clave === a.rubro) - RUBROS.findIndex((r) => r.clave === b.rubro) || a.nombre.localeCompare(b.nombre));
    }, [valor, lista, elegida]);

    const elegir = (e: Empresa) => { poner(e.nombre); setAbierto(false); };

    return (
        <div ref={caja} className={cn("relative", className)}>
            {name && <input type="hidden" name={name} value={elegida ? elegida.nombre : valor.trim()} />}
            <div className={cn("flex items-center h-9 rounded-md border border-input bg-background px-2.5 gap-2 focus-within:ring-2 focus-within:ring-ring/40 focus-within:border-[var(--accion)]")}>
                {elegida?.logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={elegida.logo} alt="" className="h-5 w-auto max-w-[56px] object-contain shrink-0" />
                    : elegida ? (() => { const Ic = ICONO[elegida.rubro]; return <Ic size={14} className="text-muted-foreground shrink-0" />; })() : null}
                <input value={valor} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={abierto} aria-controls={idLista} aria-autocomplete="list"
                    onChange={(e) => { poner(e.target.value); setAbierto(true); setFoco(0); }}
                    onFocus={() => setAbierto(true)}
                    onKeyDown={(e) => {
                        if (!abierto && (e.key === "ArrowDown" || e.key === "Enter")) { setAbierto(true); return; }
                        if (e.key === "ArrowDown") { e.preventDefault(); setFoco((f) => Math.min(opciones.length - 1, f + 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setFoco((f) => Math.max(0, f - 1)); }
                        else if (e.key === "Enter" && opciones[foco]) { e.preventDefault(); elegir(opciones[foco]); }
                        else if (e.key === "Escape" && abierto) { e.stopPropagation(); setAbierto(false); }
                    }}
                    className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
                {elegida && <Check size={14} className="tono-bien shrink-0" aria-label="En el catálogo" />}
            </div>
            {abierto && opciones.length > 0 && (
                <div id={idLista} role="listbox" className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-[10px] border border-border bg-popover shadow-[var(--sombra-flotante)] py-1">
                    {opciones.map((e, i) => {
                        const Ic = ICONO[e.rubro];
                        return (
                            <button key={e.clave} type="button" role="option" aria-selected={elegida?.clave === e.clave}
                                onMouseDown={(ev) => ev.preventDefault()} onClick={() => elegir(e)} onMouseEnter={() => setFoco(i)}
                                className={cn("w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left", i === foco && "bg-accent")}>
                                <span className="w-14 h-6 grid place-items-center shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    {e.logo ? <img src={e.logo} alt="" className="max-h-6 max-w-14 object-contain" /> : <Ic size={14} className="text-muted-foreground" />}
                                </span>
                                <span className="text-[13px] font-semibold text-foreground truncate flex-1">{e.nombre}</span>
                                <span className="text-[11px] text-muted-foreground">{RUBROS.find((r) => r.clave === e.rubro)?.nombre}</span>
                                {elegida?.clave === e.clave && <Check size={13} className="tono-accion" />}
                            </button>
                        );
                    })}
                    {valor.trim() && !elegida && (
                        <div className="px-2.5 pt-1.5 pb-1 mt-1 border-t border-border text-[11px] text-muted-foreground">
                            Si no está en la lista, queda «{valor.trim()}» como texto.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
