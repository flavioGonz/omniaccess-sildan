import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    try {
        const { id, x, y } = await req.json();

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
