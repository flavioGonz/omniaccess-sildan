import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const plate = searchParams.get("plate");
        const limit = parseInt(searchParams.get("limit") || "10");

        if (!plate) {
            return NextResponse.json({ error: "Plate parameter is required" }, { status: 400 });
        }

        const events = await prisma.accessEvent.findMany({
            where: {
                plateDetected: plate,
            },
            include: {
                device: {
                    select: {
                        id: true,
                        name: true,
                        location: true,
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    }
                }
            },
            orderBy: {
                timestamp: 'desc'
            },
            take: limit
        });

        return NextResponse.json({ events });
    } catch (error) {
        console.error("Error fetching events:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
