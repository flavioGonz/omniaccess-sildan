import { Link2Off } from "lucide-react";

/**
 * Adónde cae un enlace de pantalla que no sirve. No distingue "inventado" de "revocado" a
 * propósito: quien tiene un enlace malo no necesita saber cuál de las dos cosas pasó.
 * "otra-vista" sí se dice, porque es un error honesto de quien pegó la URL equivocada.
 */
export default async function EnlaceInvalido({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
    const { motivo } = await searchParams;
    const otra = motivo === "otra-vista";
    return (
        <div className="dark min-h-screen bg-background text-foreground grid place-items-center p-8">
            <div className="max-w-lg text-center space-y-4">
                <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[var(--aviso-suave)] text-[var(--aviso-texto)]"><Link2Off size={40} /></span>
                <h1 className="text-[32px] font-bold">{otra ? "Este enlace no abre esta vista" : "Este enlace no sirve"}</h1>
                <p className="text-[18px] text-muted-foreground">{otra ? "El enlace de pantalla fue emitido para otra vista. Abrí la URL tal como se la dio Monitores, o pedí un enlace para esta vista." : "Fue revocado, está mal copiado o nunca existió. Pedile a un administrador un enlace nuevo en el panel, sección Monitores."}</p>
            </div>
        </div>
    );
}
