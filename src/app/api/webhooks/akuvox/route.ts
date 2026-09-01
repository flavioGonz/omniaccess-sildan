import { NextRequest, NextResponse } from "next/server";

/**
 * DEPRECATED: Akuvox webhooks are handled by server.js (port 10000).
 * This Next.js route exists only as a fallback/health-check.
 * Configure your Akuvox devices Action URL to point to :10000, NOT :10001.
 */

export async function GET(req: NextRequest) {
    return NextResponse.json({
        status: "ok",
        message: "Akuvox webhook endpoint. NOTE: Production webhooks are handled by server.js on port 10000.",
        timestamp: new Date().toISOString()
    });
}

export async function POST(req: NextRequest) {
    console.warn("[Webhook Akuvox] Received event on Next.js route — this should go to server.js:10000 instead");
    
    return NextResponse.json({
        warning: "This webhook was received by Next.js (:10001) but should be directed to server.js (:10000) for full processing.",
        received: true
    }, { status: 200 });
}
