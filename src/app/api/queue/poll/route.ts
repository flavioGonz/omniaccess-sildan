import { NextRequest, NextResponse } from "next/server";
import {
    pollBoschDevices,
    getActiveSubscriptions,
    startAutoPolling,
    stopAutoPolling,
    isAutoPollingActive,
} from "@/lib/onvif-polling";

/**
 * GET /api/queue/poll
 *
 * Poll all Bosch QUEUE_COUNTER devices for ONVIF VCA events.
 *
 * Query params:
 *   ?info=1       → return subscription & polling status
 *   ?start=1      → start auto-polling (every 8s)
 *   ?stop=1       → stop auto-polling
 *   (no params)   → single poll run
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    // Start auto-polling
    if (searchParams.get("start")) {
        const interval = parseInt(searchParams.get("interval") || "1000", 10);
        startAutoPolling(interval);
        return NextResponse.json({
            status: "ok",
            message: `Auto-polling started (every ${interval / 1000}s)`,
            autoPolling: true,
        });
    }

    // Stop auto-polling
    if (searchParams.get("stop")) {
        stopAutoPolling();
        return NextResponse.json({
            status: "ok",
            message: "Auto-polling stopped",
            autoPolling: false,
        });
    }

    // Info mode
    if (searchParams.get("info")) {
        return NextResponse.json({
            status: "ok",
            autoPolling: isAutoPollingActive(),
            subscriptions: getActiveSubscriptions(),
            timestamp: new Date().toISOString(),
        });
    }

    // Single poll
    try {
        const result = await pollBoschDevices();
        return NextResponse.json({
            status: "ok",
            autoPolling: isAutoPollingActive(),
            ...result,
            timestamp: new Date().toISOString(),
        });
    } catch (err: any) {
        console.error("[Queue Poll] Error:", err);
        return NextResponse.json(
            { status: "error", message: err.message },
            { status: 500 }
        );
    }
}
