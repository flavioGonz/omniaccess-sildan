import { prisma } from "@/lib/prisma";
import GuardConsole from "./GuardConsole";
import { getGuardsList } from "../actions/users";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function GuardPage() {
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') || '';
    // Solo TELÉFONOS van a la consola compacta: los teléfonos Android llevan "Mobile" en el UA,
    // las tablets no (y las tablets deben ver la consola completa GuardConsole).
    const isMobile = /iPhone|iPod/i.test(userAgent) || (/Android/i.test(userAgent) && /Mobile/i.test(userAgent));

    if (isMobile) {
        redirect('/guard-iphone');
    }

    // La bitácora la pide el cliente ya filtrada por el guardia identificado (getBitacoraPage):
    // antes se mandaban acá los 500 últimos registros de TODOS los guardias (~700 KB de HTML).
    const initialEntries: any[] = [];

    const [logoSetting, headerColorSetting, iconsSetting, globalLogoSetting, guards] = await Promise.all([
        prisma.setting.findUnique({ where: { key: "GUARD_MAIN_LOGO" } }),
        prisma.setting.findUnique({ where: { key: "GUARD_TABLE_HEADER_COLOR" } }),
        prisma.setting.findUnique({ where: { key: "GUARD_APP_ICONS" } }),
        prisma.setting.findUnique({ where: { key: "COMPANY_LOGO" } }),
        getGuardsList(),
    ]);

    // Fetch units for selection
    const units = await prisma.unit.findMany({
        orderBy: { name: "asc" },
        select: {
            id: true, name: true, number: true, contactName: true,
            users: { select: { name: true, vehicles: { select: { plate: true, brand: true, model: true, color: true } } } },
        },
    });

    return (
        <GuardConsole
            initialEntries={initialEntries}
            logo={logoSetting?.value || globalLogoSetting?.value || "/logo-transparent.png"}
            headerColor={headerColorSetting?.value || "#000000"}
            initialIcons={iconsSetting?.value ? JSON.parse(iconsSetting.value) : {}}
            units={units}
            guards={guards}
        />
    );
}
