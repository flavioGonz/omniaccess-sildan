"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Mantiene la pantalla al día con el servidor: si hubo un despliegue, se recarga; si la sesión
 * del panel venció, lleva al login. Va en el layout raíz, así cubre el panel y las paredes.
 *
 * Por qué (15/10, San Nicolás, «el sistema anda un poco lento»): el servidor estaba holgado
 * (carga 1,4 de 8 núcleos), pero entre el 2 y el 14 de octubre registró más de 120.000 acciones
 * rechazadas por venir de una versión vieja, y otras 4.000 por sesión vencida. Las pantallas
 * seguían dibujadas con lo último que tenían y cada consulta volvía en error sin decir nada:
 * un monitor congelado se ve igual que uno lento.
 *
 * Cuándo NO recarga solo: si hay alguien escribiendo (un campo con el foco). Recargar ahí
 * borraría lo que está cargando; se avisa abajo y se recarga cuando suelta el campo. Una
 * pared nunca tiene foco en un campo, así que se recarga enseguida.
 */

/** Cada cuánto se pregunta la versión. Un minuto: a lo sumo un minuto de pantalla vieja. */
const INTERVALO_MS = 60_000;
/** Mientras hay algo pendiente (versión nueva con alguien escribiendo), se vuelve a mirar seguido. */
const REINTENTO_OCUPADO_MS = 5_000;
/** Lo que dice Next cuando una acción viene de otra compilación. */
const ERROR_VERSION = /Failed to find Server Action|older or newer deployment/i;

type Pendiente = null | "version" | "sesion";

/** ¿Hay alguien escribiendo? Un campo editable con el foco. */
function escribiendo(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
        const tipo = (el as HTMLInputElement).type;
        return !["button", "submit", "checkbox", "radio", "range", "color", "file", "reset", "image"].includes(tipo);
    }
    return false;
}

const irAlLogin = () => {
    const volver = window.location.pathname + window.location.search;
    window.location.href = "/login?volver=" + encodeURIComponent(volver);
};

export default function VersionAlDia({ version }: { version: string }) {
    const pathname = usePathname();
    const [pendiente, setPendiente] = useState<Pendiente>(null);
    const mirando = useRef(false);
    // Sólo el panel tiene sesión de usuario; las paredes (/monitor) entran con su enlace.
    const conSesion = !!pathname?.startsWith("/admin");

    const resolver = useCallback((p: Exclude<Pendiente, null>) => {
        if (escribiendo()) { setPendiente(p); return; }
        if (p === "version") window.location.reload(); else irAlLogin();
    }, []);

    const mirar = useCallback(async () => {
        if (!version || mirando.current) return;
        mirando.current = true;
        try {
            const r = await fetch("/api/version", { cache: "no-store" });
            if (!r.ok) return; // servidor reiniciando: se vuelve a mirar en el próximo turno
            const d = await r.json() as { version: string; sesion: boolean };
            if (d.version && d.version !== version) resolver("version");
            else if (conSesion && !d.sesion) resolver("sesion");
        } catch { /* sin red: la próxima vuelta */ } finally { mirando.current = false; }
    }, [version, conSesion, resolver]);

    useEffect(() => {
        if (!version) return;
        const iv = setInterval(mirar, INTERVALO_MS);
        const alVolver = () => { if (document.visibilityState === "visible") mirar(); };
        // El error de Next es la prueba directa de que la pantalla quedó vieja: no se espera al minuto.
        const alError = (e: PromiseRejectionEvent | ErrorEvent) => {
            const m = "reason" in e ? String((e.reason as any)?.message || e.reason || "") : String(e.message || "");
            if (ERROR_VERSION.test(m)) mirar();
        };
        document.addEventListener("visibilitychange", alVolver);
        window.addEventListener("focus", alVolver);
        window.addEventListener("unhandledrejection", alError);
        window.addEventListener("error", alError);
        return () => {
            clearInterval(iv);
            document.removeEventListener("visibilitychange", alVolver);
            window.removeEventListener("focus", alVolver);
            window.removeEventListener("unhandledrejection", alError);
            window.removeEventListener("error", alError);
        };
    }, [version, mirar]);

    // Con algo pendiente, se reintenta seguido: en cuanto suelta el campo, se resuelve.
    useEffect(() => {
        if (!pendiente) return;
        const iv = setInterval(() => resolver(pendiente), REINTENTO_OCUPADO_MS);
        return () => clearInterval(iv);
    }, [pendiente, resolver]);

    if (!pendiente) return null;
    const esVersion = pendiente === "version";
    return (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2500] flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-2.5 text-[13px] shadow-[var(--sombra-flotante)]">
            <span>{esVersion ? "Hay una versión nueva de OmniAccess. Se actualiza sola cuando termines de escribir." : "La sesión venció: lo que guardes ahora no se registra. Volvé a entrar."}</span>
            <Button size="sm" onClick={() => (esVersion ? window.location.reload() : irAlLogin())}>
                {esVersion ? <><RefreshCw /> Actualizar ahora</> : <><LogIn /> Entrar de nuevo</>}
            </Button>
        </div>
    );
}
