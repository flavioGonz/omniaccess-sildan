"use client";

import { useMemo } from "react";
import { Ban, Search, ShieldAlert } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Identidad, Matricula, Momento, Nada } from "@/components/ui/celdas";
import { Pista } from "@/components/ui/pista";
import type { FichaListaNegra } from "@/app/actions/padron";
import { NIVELES, SIN_IDENTIFICAR } from "@/lib/padron";

/**
 * La pestaña Lista negra: una fila por FICHA (persona o vehículo), no por matrícula.
 *
 * La tabla vieja era por matrícula: el mismo auto con dos chapas eran dos filas sin relación,
 * y una persona marcada con tres autos, tres filas que había que leer juntas. La pregunta que
 * se hace quien abre esta lista es «¿quién es, qué pasa si aparece, y cuándo se lo vio?»: son
 * las columnas.
 */

const ORIGEN: Record<FichaListaNegra["origen"], string> = {
    ficha: "Cargada en esta pestaña",
    suelta: "Cargada desde el monitor o el bot, sin nombre todavía",
    persona: "Una persona del padrón, marcada desde su ficha",
    rol: "Tiene el rol «Lista negra» del módulo facial",
};

export function TablaListaNegra({ fichas, cargando, error, alReintentar, alAbrir, barra }: {
    fichas: FichaListaNegra[];
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    alAbrir: (f: FichaListaNegra) => void;
    barra?: React.ReactNode;
}) {
    const columnas = useMemo<ColumnaTabla<FichaListaNegra>[]>(() => [
        {
            clave: "ficha", titulo: "Quién", ancho: 300, ordenable: true,
            valor: (f) => f.nombre || SIN_IDENTIFICAR,
            celda: (f) => (
                <div className={f.activa ? "" : "opacity-55"}>
                    <Identidad foto={f.fotoUrl} nombre={f.nombre || SIN_IDENTIFICAR}
                        sub={<Pista titulo="De dónde sale" texto={ORIGEN[f.origen]}><span>{f.motivo || <span className="italic">Sin motivo</span>}</span></Pista>} />
                </div>
            ),
        },
        {
            clave: "nivel", titulo: "Si aparece", ancho: 150, ordenable: true,
            tituloAyuda: "Qué pasa cuando una cámara la lee",
            ayuda: "Alerta máxima: la barrera la deniega siempre, se carga en la lista negra de las lectoras y suena la alarma. En búsqueda: pasa, pero se avisa con el motivo.",
            valor: (f) => NIVELES[f.nivel].titulo,
            celda: (f) => <Estado tono={f.activa ? NIVELES[f.nivel].tono : "quieto"} icono={f.nivel === "BLACKLISTED" ? Ban : Search}>{NIVELES[f.nivel].corto}</Estado>,
        },
        {
            clave: "matriculas", titulo: "Matrículas", ancho: 170,
            valor: (f) => f.matriculas.join(" "),
            celda: (f) => {
                if (!f.matriculas.length) return <Nada />;
                if (f.matriculas.length === 1) return <Matricula p={f.matriculas[0]} />;
                return (
                    <Pista titulo="Matrículas" texto={<span className="block space-y-0.5">{f.matriculas.map((p) => <span key={p} className="block tabular-nums tracking-wider">{p}</span>)}</span>}>
                        <span className="inline-flex items-center gap-1 cursor-help"><Matricula p={f.matriculas[0]} /><span className="text-[10px] text-muted-foreground">+{f.matriculas.length - 1}</span></span>
                    </Pista>
                );
            },
        },
        {
            clave: "vista", titulo: "Vista por última vez", ancho: 150, ordenable: true,
            valor: (f) => f.vistaUltima || "",
            celda: (f) => f.vistaUltima
                ? <div className="leading-tight"><Momento t={f.vistaUltima} /><div className="text-[10.5px] text-muted-foreground tabular-nums">{f.vecesVista} lectura{f.vecesVista === 1 ? "" : "s"}</div></div>
                : <span className="text-[11.5px] text-muted-foreground">Nunca</span>,
        },
        {
            clave: "desde", titulo: "Desde", ancho: 130, ordenable: true,
            valor: (f) => f.desde || "",
            celda: (f) => f.desde ? <div className="leading-tight"><Momento t={f.desde} soloFecha />{f.cargo && <div className="text-[10.5px] text-muted-foreground truncate max-w-[120px]" title={f.cargo}>{f.cargo}</div>}</div> : <Nada />,
        },
        {
            clave: "estado", titulo: "Estado", ancho: 110,
            valor: (f) => f.activa ? "activa" : "baja",
            celda: (f) => f.activa
                ? <Estado tono="mal">activa</Estado>
                : <Pista titulo="Dada de baja" texto={f.bajaEn ? `El ${new Date(f.bajaEn).toLocaleString("es-UY", { timeZone: "America/Montevideo" })}. Desde su ficha se la vuelve a activar.` : "Desde su ficha se la vuelve a activar."}><span><Estado tono="quieto">baja</Estado></span></Pista>,
        },
    ], []);

    return (
        <Tabla<FichaListaNegra>
            id="lista-negra"
            nombreArchivo="lista-negra"
            filas={fichas}
            clave={(f) => f.clave}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            alClickFila={alAbrir}
            vacio={{ icono: ShieldAlert, titulo: "Sin fichas", ayuda: "Lo que se cargue acá, desde el monitor o por el bot, aparece en esta lista." }}
            alto="calc(100vh - 300px)"
            pie={<span className="tabular-nums">{fichas.length} ficha{fichas.length === 1 ? "" : "s"}</span>}
        />
    );
}
