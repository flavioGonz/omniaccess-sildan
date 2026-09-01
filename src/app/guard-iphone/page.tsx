import { prisma } from "@/lib/prisma";
import GuardIphoneConsole from "@/components/GuardIphoneConsole";
import { getGuardsList } from "../actions/users";

export const dynamic = "force-dynamic";

export const metadata = {
    manifest: "/manifest-iphone.json"
};

import { PushNotificationManager } from "@/components/PushNotificationManager";

export default async function GuardIphonePage() {
    const initialEntries = await prisma.bitacora.findMany({
        take: 50,
        orderBy: { timestamp: "desc" },
        include: {
            accessEvent: true
        }
    });

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
        include: {
            users: {
                include: {
                    vehicles: true
                }
            }
        }
    });

    const initialFaceEntries = await prisma.accessEvent.findMany({
        where: { accessType: "FACE" },
        take: 50,
        orderBy: { timestamp: "desc" },
        include: {
            user: true,
            device: true
        }
    });

    return (
        <>
            <PushNotificationManager />
            <GuardIphoneConsole
                initialEntries={initialEntries}
                initialFaceEntries={initialFaceEntries}
                logo={logoSetting?.value || globalLogoSetting?.value || "/logo-transparent.png"}
                headerColor={headerColorSetting?.value || "#000000"}
                initialIcons={iconsSetting?.value ? JSON.parse(iconsSetting.value) : {}}
                units={units}
                guards={guards}
            />
        </>
    );
}
