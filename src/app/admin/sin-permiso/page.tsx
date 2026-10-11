"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { permisoDeRuta } from "@/lib/permisos";
import { useSessionRole } from "@/hooks/useSessionRole";

/**
 * Adonde cae quien abre una pantalla que su rol no incluye. Dice QUÉ permiso falta y qué rol
 * tiene, para que pueda pedirlo con nombre y apellido en vez de "no me deja entrar".
 */
export default function SinPermisoPage() {
    const sp = useSearchParams();
    const ruta = sp.get("ruta") || "";
    const permiso = permisoDeRuta(ruta);
    const { rolApp, name } = useSessionRole();
    return (
        <div className="flex flex-col items-center justify-center h-[70vh] text-center gap-3 text-muted-foreground p-8">
            <ShieldCheck size={40} className="text-[var(--aviso)]" />
            <h2 className="text-lg font-bold text-foreground">Esta pantalla no está en tu rol</h2>
            <p className="text-sm max-w-md">
                {name ? <>Tu usuario <b className="text-foreground">{name}</b></> : "Tu usuario"}{rolApp ? <> tiene el rol <b className="text-foreground">{rolApp}</b></> : null}, y
                {permiso ? <> ese rol no incluye el permiso <b className="text-foreground">«{permiso.rotulo}»</b> ({permiso.descripcion})</> : <> no puede abrir <code className="text-foreground">{ruta}</code></>}.
                Un administrador puede agregarlo en Ajustes → Accesos al panel; después hay que volver a iniciar sesión.
            </p>
            <Link href="/admin" className="mt-2 text-sm font-semibold text-[var(--accion)] underline">Volver al panel</Link>
        </div>
    );
}
