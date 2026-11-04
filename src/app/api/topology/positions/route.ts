import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";

export async function GET() {
    try {
        const positions = await prisma.topologyNode.findMany();

        const positionMap: Record<string, { x: number; y: number }> = {};
        positions.forEach(pos => {
            positionMap[pos.id] = { x: pos.x, y: pos.y };
        });

        return NextResponse.json(positionMap);
    } catch (error: any) {
        console.error("Error loading topology positions:", error);
        // Return empty object if table doesn't exist yet (migration pending)
        return NextResponse.json({});
    }
}

export async function POST(req: NextRequest) {
    // Mover un nodo del mapa es una acción del panel (lo hace el dashboard con la sesión). Estaba
    // en la lista pública del middleware, así que cualquiera podía crear/mover filas (4/11).
    const a = await verifyApiAuth();
    if (!a.authenticated || a.pantalla) return unauthorizedResponse();
    try {
        const { id, x, y } = await req.json();
        if (typeof id !== "string" || !id || id.length > 200 || typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
            return NextResponse.json({ success: false, error: "Datos inválidos" }, { status: 400 });
        }

        await prisma.topologyNode.upsert({
            where: { id },
            update: { x, y },
            create: { id, x, y }
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Error saving topology position:", error);
        // Return success false if table doesn't exist yet (migration pending)
        return NextResponse.json({ success: false, error: "Table not ready yet" });
    }
}
