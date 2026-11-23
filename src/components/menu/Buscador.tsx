"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { HojaConGrupo } from "@/lib/menu";
import { buscarPantallas } from "@/lib/menu-buscar";
import { ICONOS_MENU } from "@/components/menu/MenuLateral";
import { cn } from "@/lib/utils";

/**
 * El buscador del panel (23/11): Ctrl K desde cualquier pantalla, escribir dos letras, Enter.
 *
 * Es la otra mitad del menú por módulos: agrupar las treinta pantallas en doce entradas las ordena,
 * pero a la que está adentro de un módulo se llega en dos pasos en vez de uno. Con esto se llega en
 * ninguno —y con el menú oculto o en íconos, sin tener que llamarlo—.
 *
 * Qué pantallas hay lo dice el mismo árbol que dibuja el menú, así que acá no aparece nada que el
 * rol no vea ahí. Cuáles responden a lo escrito y en qué orden, lib/menu-buscar.ts.
 *
 * Está armado con las piezas que ya había (ui/dialog y ui/command), no con una caja propia. A la
 * lista se le apaga el filtro de la pieza porque el nuestro ignora tildes y conoce los sinónimos
 * («cámaras» → Monitor CCTV), y porque el paso que sigue trae matrículas, personas y tags del
 * servidor, que ya vienen filtrados.
 */

/** Cualquier pantalla puede abrirlo: `window.dispatchEvent(new Event("oa:buscar"))`. */
const PEDIDO = "oa:buscar";
export const abrirBuscador = () => window.dispatchEvent(new Event(PEDIDO));

/* En una Mac la tecla es ⌘. El servidor no sabe qué teclado hay: dice «Ctrl K» y el navegador corrige. */
const nunca = () => () => { };
const useEsMac = () => useSyncExternalStore(nunca, () => /Mac|iPhone|iPad/i.test(navigator.platform || ""), () => false);

export function Buscador({ hojas }: { hojas: HojaConGrupo[] }) {
    const router = useRouter();
    const [abierto, setAbierto] = useState(false);
    const [texto, setTexto] = useState("");
    const abrir = (si: boolean) => { setAbierto(si); if (!si) setTexto(""); };

    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
                /* Se le saca la tecla al navegador (en Firefox, Ctrl K lleva a su barra de búsqueda): en una
                   herramienta que se usa todo el día, el atajo es de la herramienta. */
                e.preventDefault();
                setAbierto((a) => !a); setTexto("");
            }
        };
        const pedido = () => { setAbierto(true); setTexto(""); };
        window.addEventListener("keydown", tecla); window.addEventListener(PEDIDO, pedido);
        return () => { window.removeEventListener("keydown", tecla); window.removeEventListener(PEDIDO, pedido); };
    }, []);

    const halladas = abierto ? buscarPantallas(hojas, texto) : [];
    const ir = (h: HojaConGrupo) => { abrir(false); router.push(h.href); };

    return (
        <Dialog open={abierto} onOpenChange={abrir}>
            {/* Arriba y no al centro: la lista crece y se achica al escribir, y centrada el campo saltaba de lugar.
                Flota de verdad sobre la pantalla, así que lleva la sombra de lo que flota. */}
            <DialogContent showCloseButton={false} aria-describedby="buscador-ayuda"
                className="top-[10vh] translate-y-0 gap-0 overflow-hidden rounded-[14px] p-0 shadow-[var(--sombra-flotante)] sm:top-[14vh] sm:max-w-[580px]">
                <DialogTitle className="sr-only">Buscar una pantalla</DialogTitle>
                <DialogDescription id="buscador-ayuda" className="sr-only">Escribí el nombre de una pantalla o de un módulo; con las flechas se elige y con Enter se va.</DialogDescription>
                <Command shouldFilter={false} loop label="Buscar una pantalla" className="rounded-none bg-background **:data-[slot=command-input-wrapper]:h-[50px] **:data-[slot=command-input-wrapper]:px-3.5">
                    {/* 16 px: con menos, el teléfono agranda la página al tocar el campo. */}
                    <CommandInput value={texto} onValueChange={setTexto} placeholder="Buscar una pantalla…" className="h-[50px] text-[16px] sm:text-[15px]" />
                    <CommandList className="max-h-[min(56vh,430px)] p-1.5">
                        <CommandEmpty className="px-4 py-7 text-center text-[13.5px] text-muted-foreground">
                            Ninguna pantalla con «{texto.trim()}». Probá con el nombre del módulo: matrículas, video, guardia…
                        </CommandEmpty>
                        {halladas.length > 0 && (
                            <CommandGroup heading={texto.trim() ? "Pantallas" : "Todas las pantallas"} className="p-0 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11.5px]">
                                {halladas.map((h) => {
                                    const Icono = ICONOS_MENU[h.icono];
                                    return (
                                        <CommandItem key={h.id} value={h.id} onSelect={() => ir(h)} className="min-h-10 cursor-pointer gap-2.5 rounded-lg px-2.5 text-[14px]">
                                            <Icono size={16} strokeWidth={1.7} className="shrink-0 text-muted-foreground" />
                                            <span className="min-w-0 flex-1 truncate">{h.rotulo}</span>
                                            {h.rotuloGrupo && <span className="shrink-0 pl-2 text-[12px] text-muted-foreground">{h.rotuloGrupo}</span>}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        )}
                    </CommandList>
                    {/* Las teclas, para quien tiene teclado: en un teléfono no dicen nada. */}
                    <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 text-[11.5px] text-muted-foreground max-sm:hidden">
                        <span><Tecla>↑</Tecla> <Tecla>↓</Tecla> elegir</span>
                        <span><Tecla>Enter</Tecla> ir</span>
                        <span className="ml-auto"><Tecla>Esc</Tecla> cerrar</span>
                    </div>
                </Command>
            </DialogContent>
        </Dialog>
    );
}

function Tecla({ children }: { children: React.ReactNode }) {
    return <kbd className="rounded border border-border bg-muted/60 px-1.5 py-px font-sans text-[10.5px] font-medium text-foreground/80">{children}</kbd>;
}

/** El botón que lo abre, arriba del menú. Plegado, la lupa sola. */
export function BotonBuscar({ plegado }: { plegado: boolean }) {
    const mac = useEsMac();
    if (plegado) {
        return (
            <button type="button" onClick={abrirBuscador} title={`Buscar una pantalla (${mac ? "⌘" : "Ctrl "}K)`} aria-label="Buscar una pantalla"
                className="mx-auto grid h-9 w-[54px] place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--accion)]">
                <Search size={16} strokeWidth={1.7} />
            </button>
        );
    }
    return (
        <button type="button" onClick={abrirBuscador} aria-label="Buscar una pantalla"
            className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 text-left text-[13.5px] text-muted-foreground outline-none transition-colors",
                "hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--accion)]")}>
            <Search size={15} strokeWidth={1.7} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Buscar…</span>
            {/* El atajo, donde hay teclado. */}
            <kbd className="shrink-0 rounded border border-border px-1.5 font-sans text-[10.5px] font-medium leading-[17px] max-sm:hidden">{mac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
    );
}
