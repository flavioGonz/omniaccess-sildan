import Link from "next/link";
import { VISTAS } from "@/lib/monitor/vistas";

/** La lista de vistas de pantalla, para /monitor y para una vista que no existe. */
export function ListaVistas({ titulo = "Vistas de pantalla", subtitulo = "Cada una tiene su URL y se abre a pantalla completa." }: { titulo?: string; subtitulo?: string }) {
    return (
        <div className="absolute inset-0 grid place-items-center p-8">
            <div className="max-w-xl w-full">
                <h1 className="text-[32px] font-bold">{titulo}</h1>
                <p className="text-[17px] text-muted-foreground mt-1">{subtitulo}</p>
                <ul className="mt-4 divide-y divide-border rounded-2xl border border-border overflow-hidden">
                    {VISTAS.map((v) => (
                        <li key={v.clave}><Link href={`/monitor/${v.clave}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-accent"><span className="text-[18px] font-semibold">{v.nombre}</span><span className="text-[14px] text-muted-foreground truncate">{v.paraQuien}</span></Link></li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
