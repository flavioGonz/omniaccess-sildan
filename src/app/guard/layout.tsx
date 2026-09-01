import React from "react";
import { Montserrat } from "next/font/google";

const montserrat = Montserrat({
    subsets: ["latin"],
    weight: ["400", "700", "800", "900"],
    variable: "--font-montserrat",
});

import { PushNotificationManager } from "@/components/PushNotificationManager";

export default function GuardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className={`${montserrat.variable} font-sans fixed inset-0 bg-slate-100 text-slate-900 overflow-hidden selection:bg-[#B20D30] selection:text-white`}>
            <PushNotificationManager />
            {children}
        </div>
    );
}
