import type { Metadata } from "next";
import { PantallaKiosco } from "./PantallaKiosco";

/**
 * /k/<slug>?t=<token> — la pantalla de una fila, para un monitor de sala de espera.
 *
 * Corta a propósito (`/k/`): se tipea con el control remoto de una tele. Abre sin sesión; los
 * datos los da /api/pantalla/<slug>, que valida el token. Las pantallas se administran en
 * /admin/kiosko.
 */
export const metadata: Metadata = { title: "Fila" };

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }) {
    const { slug } = await params;
    const { t } = await searchParams;
    return <PantallaKiosco slug={slug} token={t || ""} />;
}
