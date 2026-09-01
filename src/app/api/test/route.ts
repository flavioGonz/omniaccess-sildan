import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    return new NextResponse("OK - Test endpoint working", {
        status: 200,
        headers: {
            'Content-Type': 'text/plain',
        },
    });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.text();

        return new NextResponse("OK - Received", {
            status: 200,
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    } catch (error: any) {
        return new NextResponse(`Error: ${error.message}`, {
            status: 500,
        });
    }
}
