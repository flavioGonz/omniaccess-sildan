"use client";

import { useEffect, useState } from "react";
import { GitHubActivity, type Contribution, type ContributionLevel } from "@/components/ui/github-activity";
import { actividadPorDia } from "@/app/actions/alertas";

/** Mapa de actividad: lecturas registradas por dia, estilo GitHub. */
export default function PlateActivity({ dias = 180, label = "lecturas" }: { dias?: number; label?: string }) {
    const [datos, setDatos] = useState<Contribution[]>([]);

    useEffect(() => {
        (async () => {
            const filas = await actividadPorDia(dias);
            if (!filas.length) { setDatos([]); return; }
            const max = Math.max(...filas.map((f) => f.count), 1);
            setDatos(filas.map((f) => {
                const rel = f.count / max;
                const level: ContributionLevel = f.count === 0 ? 0 : rel > 0.75 ? 4 : rel > 0.5 ? 3 : rel > 0.25 ? 2 : 1;
                return { date: f.date, count: f.count, level };
            }));
        })();
    }, [dias]);

    return (
        <GitHubActivity
            contributions={datos}
            months={Math.max(1, Math.round(dias / 30))}
            label={label}
            accent={["#0ea5e9", "#38bdf8"]}
            cellSize={11}
            showMonths
        />
    );
}
