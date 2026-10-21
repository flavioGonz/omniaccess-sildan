"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, DoorOpen, Flame, ListOrdered, SquareParking, FlaskConical, GraduationCap, ListVideo, ScanEye, ScanLine, ScanSearch, ShieldCheck, Sparkles, Spline, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las pantallas de OmniVision, en un solo lugar: la barra de arriba de /admin/vision/* y el
 * menú «OmniVision» de Ajustes leen esta misma lista. Antes cada pantalla tenía sus propios
 * botones a las otras, y cada una enlazaba a un subconjunto distinto.
 *
 * El orden es el del trabajo: qué analíticas se prenden, dónde se aplican (reglas), qué
 * quedó registrado, y las herramientas (relecturas, laboratorio).
 */
type Seccion = { href: string; rotulo: string; menu: string; icono: LucideIcon; exacta?: boolean; hijos?: Seccion[] };

/*
 * Las analíticas (accesos, filas, calor, estacionamiento, las entrenables) cuelgan de «Analíticas»
 * (20/10, Nico: «todas las analíticas como estacionamiento, etc., deben ser submenús de Analíticas,
 * no tener un propio item principal del menú»). Eran cinco pestañas sueltas al lado de Reglas o
 * Buscar, como si fueran del mismo nivel; son resultados de una analítica que se creó en Analíticas
 * (lib/analiticas: «sin-lectura», «colado», «estacionamiento», «mapa-calor», «zona-entrenable»…).
 */
export const ANALITICAS_OMNIVISION: Seccion[] = [
    { href: "/admin/vision/analiticas", rotulo: "Crear y administrar", menu: "Crear las analíticas", icono: Sparkles },
    { href: "/admin/vision/accesos", rotulo: "Accesos", menu: "Accesos: sin lectura y colados", icono: DoorOpen },
    { href: "/admin/vision/filas", rotulo: "Filas", menu: "Conteo de filas", icono: ListOrdered },
    { href: "/admin/vision/calor", rotulo: "Mapa de calor", menu: "Mapa de calor", icono: Flame },
    { href: "/admin/vision/estacionamiento", rotulo: "Estacionamiento", menu: "Estacionamiento", icono: SquareParking },
    { href: "/admin/vision/entrenar", rotulo: "Entrenables", menu: "Analíticas entrenables", icono: GraduationCap },
];

export const SECCIONES_OMNIVISION: Seccion[] = [
    { href: "/admin/vision/analiticas", rotulo: "Analíticas", menu: "Analíticas", icono: Sparkles, hijos: ANALITICAS_OMNIVISION },
    { href: "/admin/vision/reglas", rotulo: "Reglas", menu: "Reglas analíticas", icono: Spline },
    { href: "/admin/vision/detecciones", rotulo: "Detecciones", menu: "Detecciones", icono: ListVideo },
    { href: "/admin/vision/buscar", rotulo: "Buscar", menu: "Búsqueda de objetos", icono: ScanSearch },
    { href: "/admin/vision/relecturas", rotulo: "Relecturas", menu: "Relecturas", icono: ScanLine },
    { href: "/admin/vision/verificacion", rotulo: "Verificación", menu: "Doble verificación", icono: ShieldCheck },
    { href: "/admin/vision", rotulo: "Laboratorio", menu: "Laboratorio", icono: FlaskConical, exacta: true },
];

const activa = (ruta: string, s: Seccion): boolean =>
    (s.exacta ? ruta === s.href : ruta === s.href || ruta.startsWith(s.href + "/")) || !!s.hijos?.some((h) => activa(ruta, h));

export function NavOmniVision() {
    const ruta = usePathname() || "";
    const [abierto, setAbierto] = useState<string | null>(null);
    const caja = useRef<HTMLDivElement>(null);
    useEffect(() => { setAbierto(null); }, [ruta]);
    useEffect(() => {
        if (!abierto) return;
        const fuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(null); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(null); };
        window.addEventListener("pointerdown", fuera); window.addEventListener("keydown", esc);
        return () => { window.removeEventListener("pointerdown", fuera); window.removeEventListener("keydown", esc); };
    }, [abierto]);
    const pestana = (on: boolean) => cn("inline-flex items-center gap-1.5 h-10 px-3 -mb-px border-b-2 text-[13px] font-semibold shrink-0 transition-colors",
        on ? "border-[var(--accion)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");
    /*
     * Sin segunda fila de submenú (21/10, Nico: «ese menú no debe estar ahí fijo, ya tenemos
     * submenús en Analíticas»): los hijos se eligen en el desplegable de «Analíticas», que queda
     * marcada mientras se está en uno de ellos, y cada pantalla dice en su título cuál es.
     */
    return (
        <div ref={caja}>
            <nav className="relative flex items-center gap-1 border-b border-border" aria-label="OmniVision">
                <span className="inline-flex items-center gap-1.5 pr-3 mr-1 text-[13px] font-bold shrink-0"><ScanEye size={16} /> OmniVision</span>
                <div className="flex items-center gap-1 overflow-x-auto">
                    {SECCIONES_OMNIVISION.map((s) => {
                        const on = activa(ruta, s);
                        const I = s.icono;
                        if (!s.hijos) return <Link key={s.href} href={s.href} aria-current={on ? "page" : undefined} className={pestana(on)}><I size={15} /> {s.rotulo}</Link>;
                        return (
                            <button key={s.href} type="button" onClick={() => setAbierto(abierto === s.href ? null : s.href)} aria-expanded={abierto === s.href} aria-haspopup="menu" className={pestana(on)}>
                                <I size={15} /> {s.rotulo} <ChevronDown size={13} className={cn("transition-transform", abierto === s.href && "rotate-180")} />
                            </button>
                        );
                    })}
                </div>
                {/* El menú de una sección con hijos. Fuera del contenedor que se desplaza: si no, lo recorta. */}
                {SECCIONES_OMNIVISION.filter((s) => s.hijos && abierto === s.href).map((s) => (
                    <div key={s.href} role="menu" className="absolute left-[118px] top-[calc(100%+6px)] z-50 w-[260px] rounded-[14px] bg-popover text-popover-foreground border border-border shadow-xl p-1.5">
                        {s.hijos!.map((h) => {
                            const I = h.icono, on = activa(ruta, h);
                            return (
                                <Link key={h.href} href={h.href} role="menuitem" aria-current={on ? "page" : undefined}
                                    className={cn("flex items-center gap-2.5 px-2.5 h-9 rounded-[8px] text-[13px] transition-colors", on ? "bg-muted font-semibold" : "hover:bg-muted")}>
                                    <I size={15} className={on ? "text-[var(--accion)]" : "text-muted-foreground"} /> <span className="flex-1">{h.menu}</span>
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>
        </div>
    );
}
