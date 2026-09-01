import { NextRequest, NextResponse } from "next/server";

/**
 * DEPRECATED: Hikvision webhooks are handled by server.js (port 10000).
 * This Next.js route exists only as a fallback/health-check.
 * Configure your Hikvision cameras to point to :10000, NOT :10001.
 */

export async function GET(req: NextRequest) {
    return NextResponse.json({
        status: "ok",
        message: "Hikvision webhook endpoint. NOTE: Production webhooks are handled by server.js on port 10000.",
        timestamp: new Date().toISOString()
    });
}

export async function POST(req: NextRequest) {
    console.warn("[Webhook Hik] Received event on Next.js route — this should go to server.js:10000 instead");
    
    // Log what we received for debugging
    const contentType = req.headers.get("content-type") || "";
    console.warn(`[Webhook Hik] Content-Type: ${contentType}`);
    
    return NextResponse.json({
        warning: "This webhook was received by Next.js (:10001) but should be directed to server.js (:10000) for full processing.",
        received: true
    }, { status: 200 });
}
