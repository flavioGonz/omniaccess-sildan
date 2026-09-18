"use server";

import { prisma } from "@/lib/prisma";

/** Alertas abiertas: dispositivos con alerta activa + camaras caidas ahora mismo. */
export async function contarAlertasActivas(): Promise<{ total: number; criticas: number }> {
    try {
        const [alertas, criticas, caidas] = await Promise.all([
            prisma.deviceAlert.count({ where: { active: true } }),
            prisma.deviceAlert.count({ where: { active: true, severity: "critical" } }),
            prisma.cameraOutage.count({ where: { endedAt: null } }),
        ]);
        return { total: alertas + caidas, criticas };
    } catch {
        return { total: 0, criticas: 0 };
    }
}

/** Lecturas por dia para el mapa de actividad (ultimos N dias). */
export async function actividadPorDia(dias = 180): Promise<{ date: string; count: number }[]> {
    try {
        const desde = new Date();
        desde.setHours(0, 0, 0, 0);
        desde.setDate(desde.getDate() - dias);

        // Cuenta accesos Y avistamientos, que es lo que muestra el historial.
        //
        // Contaba solo AccessEvent, y en una instalación sin barreras dadas de alta eso es
        // cero para siempre: el mapa salía vacío mientras la tabla de abajo tenía ochenta
        // lecturas. Un gráfico que contradice a la tabla que tiene al lado es peor que no
        // tener gráfico.
        const filas: any[] = await prisma.$queryRawUnsafe(
            `select date, sum(count)::int as count from (
                 select to_char(date_trunc('day', "timestamp"), 'YYYY-MM-DD') as date, count(*)::int as count
                 from "AccessEvent" where "timestamp" >= $1 group by 1
                 union all
                 select to_char(date_trunc('day', "timestamp"), 'YYYY-MM-DD') as date, count(*)::int as count
                 from "PlateSighting" where "timestamp" >= $1 group by 1
             ) t group by date order by date`,
            desde
        );
        return filas.map((f) => ({ date: f.date, count: Number(f.count) }));
    } catch {
        return [];
    }
}
