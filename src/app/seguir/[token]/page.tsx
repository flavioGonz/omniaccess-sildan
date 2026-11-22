import type { Metadata } from "next";
import { Seguir } from "./Seguir";

export const dynamic = "force-dynamic";
/* Un enlace que muestra dónde está un vehículo no tiene que aparecer en un buscador ni dejar su
   dirección en el sitio al que se salga desde acá. */
export const metadata: Metadata = { title: "Seguimiento · OmniAccess", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * /seguir/<token> — la página que abre quien recibe un enlace compartido. No tiene sesión ni menú:
 * un mapa, el vehículo y cuánto le queda al enlace. Todo lo que muestra lo pide a
 * /api/gps/seguir/<token>, que es quien decide si el enlace todavía sirve.
 */
export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <Seguir token={token} />;
}
