"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, ListVideo, ScanEye, ScanLine, ScanSearch, ShieldCheck, Sparkles, Spline, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las pantallas de OmniVision, en un solo lugar: la barra de arriba de /admin/vision/* y el
 * menú «OmniVision» de Ajustes leen esta misma lista. Antes cada pantalla tenía sus propios
 * botones a las otras, y cada una enlazaba a un subconjunto distinto.
 *
 * El orden es el del trabajo: qué analíticas se prenden, dónde se aplican (reglas), qué
 * quedó registrado, y las herramientas (relecturas, laboratorio).
 */
export const SECCIONES_OMNIVISION: { href: string; rotulo: string; menu: string; icono: LucideIcon; exacta?: boolean }[] = [
    { href: "/admin/vision/analiticas", rotulo: "Analíticas", menu: "Crear las analíticas", icono: Sparkles },
    { href: "/admin/vision/reglas", rotulo: "Reglas", menu: "Reglas analíticas", icono: Spline },
    { href: "/admin/vision/detecciones", rotulo: "Detecciones", menu: "Detecciones", icono: ListVideo },
    { href: "/admin/vision/buscar", rotulo: "Buscar", menu: "Búsqueda de objetos", icono: ScanSearch },
    { href: "/admin/vision/relecturas", rotulo: "Relecturas", menu: "Relecturas", icono: ScanLine },
    { href: "/admin/vision/verificacion", rotulo: "Verificación", menu: "Doble verificación", icono: ShieldCheck },
    { href: "/admin/vision", rotulo: "Laboratorio", menu: "Laboratorio", icono: FlaskConical, exacta: true },
];

export function NavOmniVision() {
    const ruta = usePathname() || "";
    return (
        <nav className="flex items-center gap-1 border-b border-border overflow-x-auto" aria-label="OmniVision">
            <span className="inline-flex items-center gap-1.5 pr-3 mr-1 text-[13px] font-bold shrink-0"><ScanEye size={16} /> OmniVision</span>
            {SECCIONES_OMNIVISION.map((s) => {
                const activa = s.exacta ? ruta === s.href : ruta.startsWith(s.href);
                const I = s.icono;
                return (
                    <Link key={s.href} href={s.href} aria-current={activa ? "page" : undefined}
                        className={cn("inline-flex items-center gap-1.5 h-10 px-3 -mb-px border-b-2 text-[13px] font-semibold shrink-0 transition-colors",
                            activa ? "border-[var(--accion)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                        <I size={15} /> {s.rotulo}
                    </Link>
                );
            })}
        </nav>
    );
}
