import { OmniLogo } from "@/components/brand/OmniLogo";
import { COLOR, EN_TAPA } from "@/lib/informes/paleta";

/**
 * La tapa de un informe imprimible (24/11).
 *
 * Nico: «el informe con mapa también tiene que tener portada premium de OmniAccess con su logo». El
 * PDF de rastreo ya abría con una (lib/informes/gps-pdf.ts, 23/11) y el informe con mapa no: arrancaba
 * directo en el título y las cifras, y puestos uno al lado del otro parecían de dos productos.
 *
 * Es la misma tapa, dibujada por el navegador en vez de por jsPDF —este informe es una página y no
 * un PDF del servidor porque lleva un mapa de verdad—: oscura y a sangre, OmniAccess arriba a la
 * izquierda y quien recibe a la derecha, de quién es y de cuándo, las cifras del período, qué trae
 * adentro, y abajo con qué vara se midió y quién lo emitió. Si se cambia una, mirar la otra.
 *
 * No sabe de rastreo: recibe los textos ya armados, así el próximo informe imprimible no dibuja la
 * suya.
 *
 * Cómo ocupa la hoja entera al imprimir lo resuelve `ESTILO_DE_TAPA`, que tiene que ir en la página
 * que la usa.
 */
export type MarcaDeTapa = { empresa: string; logoUrl: string; primario: string };
export type CifraDeTapa = { valor: string; que: string; tono?: "mal" | "aviso" };

/**
 * La hoja de la tapa no lleva margen y las demás sí: se le dice a la PRIMERA página, no a todas —con
 * margen cero en todas, una tabla que pasa de hoja quedaría pegada al borde del papel—.
 *
 * El alto va un pelo por debajo de los 297 mm: con el alto justo, el redondeo de algunas impresoras
 * empuja una hoja en blanco detrás de la tapa.
 */
export const ESTILO_DE_TAPA = `
    @page :first { margin: 0; }
    @media print {
        .tapa-informe { width: 210mm !important; max-width: none !important; height: 296.6mm !important; min-height: 0 !important; aspect-ratio: auto !important; margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; }
    }
`;

export function TapaInforme({ marca, linea, rotulo, titulo, debajo, periodo, cifras, adentro, vara, emitido, por }: {
    marca: MarcaDeTapa;
    /** De qué línea de OmniAccess es el informe, bajo el nombre: «Rastreo satelital». */
    linea: string;
    /** Qué informe es: «Informe de recorrido». */
    rotulo: string;
    /** De quién: el vehículo, la cámara, el barrio. */
    titulo: string;
    debajo?: string | null;
    periodo: string;
    cifras: CifraDeTapa[];
    /** Qué trae adentro, con su cantidad. `null` en la cantidad la deja en una raya. */
    adentro: { que: string; cuanto: string | null }[];
    /** Con qué vara se midió: la velocidad permitida, el horario. */
    vara?: string;
    emitido: string;
    por?: string | null;
}) {
    /* El nombre de un vehículo puede ser largo: se achica antes que partirse en tres renglones. */
    const tam = titulo.length <= 14 ? 58 : titulo.length <= 22 ? 46 : 36;
    return (
        <section className="tapa-informe relative mx-auto my-5 flex w-full max-w-[820px] flex-col overflow-hidden px-[68px] pb-[44px] pt-[60px] shadow-[0_2px_18px_rgba(0,0,0,.12)] sm:aspect-[210/297] max-sm:px-7 max-sm:pt-10"
            style={{ background: marca.primario, color: EN_TAPA.texto }}>
            {/* Un filo de luz arriba: el único azul de la hoja. */}
            <div className="absolute inset-x-0 top-0 h-[6px]" style={{ background: COLOR.accion }} />
            {/* El recuadro de detección de la marca, enorme y apenas visible, saliéndose por la derecha:
                dice de quién es la hoja sin competir con el título. */}
            <OmniLogo size={760} className="pointer-events-none absolute -right-[300px] top-[150px] opacity-[0.045]" />

            {/* ── La marca: OmniAccess a la izquierda, quien recibe el informe a la derecha ── */}
            <header className="relative flex items-center gap-3.5">
                <OmniLogo size={46} className="shrink-0" />
                <div className="shrink-0">
                    <p className="text-[19px] font-bold leading-none tracking-[0.14em]">OMNIACCESS</p>
                    <p className="mt-[7px] text-[9px] font-bold uppercase leading-none tracking-[0.14em]" style={{ color: EN_TAPA.apagado }}>{linea}</p>
                </div>
                {/* Lo que cede cuando no entra es el nombre de quien recibe, no la marca. */}
                <div className="flex min-w-0 flex-1 justify-end pl-4">
                    {marca.logoUrl
                        /* eslint-disable-next-line @next/next/no-img-element -- el logo lo sirve el propio OmniAccess, y al imprimir tiene que estar entero */
                        ? <img src={marca.logoUrl} alt={marca.empresa} className="max-h-[42px] max-w-[220px] object-contain" />
                        : marca.empresa && marca.empresa !== "OmniAccess" && <p className="truncate text-[15px] font-bold" style={{ color: EN_TAPA.claro }}>{marca.empresa}</p>}
                </div>
            </header>

            {/* ── De quién y de cuándo ── */}
            <div className="relative mt-[26%] max-sm:mt-14">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: COLOR.accionClaro }}>{rotulo}</p>
                <h1 className="mt-3 max-w-[600px] font-bold leading-[1.04] tracking-[-0.025em] max-sm:!text-[34px]" style={{ fontSize: tam }}>{titulo}</h1>
                {debajo && <p className="mt-3 text-[15px]" style={{ color: EN_TAPA.apagado }}>{debajo}</p>}
                <div className="mt-7 h-[4px] w-[84px]" style={{ background: COLOR.accion }} />
                <p className="mt-5 text-[18px] font-bold leading-snug tracking-[-0.01em]">{periodo}</p>
            </div>

            {/* ── Las cifras del período, y qué trae adentro: sobre la misma grilla de tres ── */}
            <div className="relative mt-auto max-sm:mt-12">
                <dl className="grid grid-cols-3 gap-x-6 gap-y-7 border-t border-white/15 pt-7 max-sm:grid-cols-2">
                    {cifras.map((c) => (
                        <div key={c.que} className="min-w-0">
                            <dd className="text-[25px] font-bold leading-none tracking-[-0.02em] tabular-nums" style={c.tono ? { color: EN_TAPA[c.tono] } : undefined}>{c.valor}</dd>
                            <dt className="mt-2 text-[11.5px] leading-tight" style={{ color: EN_TAPA.apagado }}>{c.que}</dt>
                        </div>
                    ))}
                </dl>
                <div className="mt-9 border-t border-white/15 pt-5">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: EN_TAPA.apagado }}>En este informe</p>
                    <ul className="mt-3 grid grid-cols-3 gap-x-6 gap-y-3 max-sm:grid-cols-1">
                        {adentro.map((a) => (
                            <li key={a.que} className="min-w-0">
                                <p className="text-[12.5px] font-semibold leading-tight" style={{ color: EN_TAPA.claro }}>{a.que}</p>
                                <p className="mt-1 text-[11.5px] tabular-nums" style={{ color: a.cuanto ? EN_TAPA.apagado : EN_TAPA.mudo }}>{a.cuanto || "—"}</p>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* ── El pie: con qué vara se midió, y quién y cuándo lo emitió ── */}
                <footer className="mt-9 flex items-end gap-6 border-t border-white/15 pt-4 text-[11px] leading-snug max-sm:flex-col max-sm:items-start max-sm:gap-2" style={{ color: EN_TAPA.apagado }}>
                    <p className="min-w-0 flex-1">{vara}</p>
                    <p className="shrink-0 text-right max-sm:text-left"><span style={{ color: EN_TAPA.claro }}>Emitido el {emitido}</span>{por && <><br />por {por}</>}</p>
                </footer>
            </div>
        </section>
    );
}
