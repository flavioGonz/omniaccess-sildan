"use client";

import { useMemo } from "react";
import { Ban, Search, ShieldAlert } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Identidad, Matricula, Momento, Nada } from "@/components/ui/celdas";
import { Pista } from "@/components/ui/pista";
import type { FichaListaNegra } from "@/app/actions/padron";
import { NIVELES, SIN_IDENTIFICAR, estadoRevision, textoRevision, TONO_REVISION, REVISION_DIAS } from "@/lib/padron";

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

export function TablaListaNegra({ fichas, cargando, error, alReintentar, alAbrir, barra, conBusqueda = true, amarilla = false }: {
    fichas: FichaListaNegra[];
    /**
     * La pestaña Lista Amarilla: suma la columna «Revisión», cuenta las lecturas de la última
     * semana (lo mismo que dice el aviso) y guarda sus columnas aparte de las de la lista negra.
     */
    amarilla?: boolean;
    /** Sin «Lista Amarilla» (función de LPR) todas son alerta máxima: la columna «Si aparece» no dice nada. */
    conBusqueda?: boolean;
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    alAbrir: (f: FichaListaNegra) => void;
    barra?: React.ReactNode;
}) {
    const columnas = useMemo<ColumnaTabla<FichaListaNegra>[]>(() => {
        const todas: ColumnaTabla<FichaListaNegra>[] = [
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
            ayuda: "Alerta máxima: la barrera la deniega siempre, se carga en la lista negra de las lectoras y suena la alarma. Lista Amarilla: pasa, pero se avisa con el motivo.",
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
                ? <div className="leading-tight"><Momento t={f.vistaUltima} /><div className="text-[10.5px] text-muted-foreground tabular-nums">{amarilla ? `${f.vistas7} en 7 días` : `${f.vecesVista} lectura${f.vecesVista === 1 ? "" : "s"}`}</div></div>
                : <span className="text-[11.5px] text-muted-foreground">Nunca</span>,
        },
        {
            clave: "revision", titulo: "Revisión", ancho: 150, ordenable: true,
            tituloAyuda: "Cuándo toca volver a mirarla",
            ayuda: `Cada ficha amarilla se revisa cada ${REVISION_DIAS} días: ¿sigue valiendo la pena seguirla? Vencer no la apaga —sigue avisando—; es un recordatorio. Se renueva desde la ficha.`,
            // Las dadas de baja van al final al ordenar, y no muestran nada: no hay qué revisar.
            valor: (f) => f.activa ? (f.revisarEl || "0") : "9",
            celda: (f) => {
                if (!f.activa) return <Nada />;
                const e = estadoRevision(f.revisarEl);
                return <Estado tono={TONO_REVISION[e.estado]}>{textoRevision(e)}</Estado>;
            },
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
                ? <Estado tono={amarilla ? "aviso" : "mal"}>activa</Estado>
                : <Pista titulo="Dada de baja" texto={f.bajaEn ? `El ${new Date(f.bajaEn).toLocaleString("es-UY", { timeZone: "America/Montevideo" })}. Desde su ficha se la vuelve a activar.` : "Desde su ficha se la vuelve a activar."}><span><Estado tono="quieto">baja</Estado></span></Pista>,
        },
    ];
        return todas.filter((c) => (conBusqueda || c.clave !== "nivel") && (amarilla || c.clave !== "revision"));
    }, [conBusqueda, amarilla]);

    return (
        <Tabla<FichaListaNegra>
            id={amarilla ? "lista-amarilla" : "lista-negra"}
            nombreArchivo={amarilla ? "lista-amarilla" : "lista-negra"}
            filas={fichas}
            clave={(f) => f.clave}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            alClickFila={alAbrir}
            vacio={{ icono: amarilla ? Search : ShieldAlert, titulo: "Sin fichas", ayuda: amarilla
                ? "Acá van los vehículos a los que conviene seguirles el paso: pasan, pero cada lectura avisa con el motivo y con cuánto se los vio."
                : "Lo que se cargue acá, desde el monitor o por el bot, aparece en esta lista." }}
            alto="calc(100vh - 300px)"
            pie={<span className="tabular-nums">{fichas.length} ficha{fichas.length === 1 ? "" : "s"}</span>}
        />
    );
}
