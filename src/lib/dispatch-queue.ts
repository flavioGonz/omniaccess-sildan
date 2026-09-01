import { Queue } from "bullmq";
import { makeRedisConnection } from "./redis";
import { prisma } from "./prisma";

/**
 * Dispatch queue (BullMQ over Redis). The web process enqueues; the
 * standalone `dispatch-worker.js` (PM2) consumes and sends with retries.
 * Each enqueue also writes a DispatchJob row so /admin/despachos can show
 * the outbox state independently of Redis.
 */
let _queue: Queue | null = null;
export function getDispatchQueue(): Queue {
    if (!_queue) _queue = new Queue("dispatch", { connection: makeRedisConnection() });
    return _queue;
}

export type DispatchInput = {
    type: "ALERT" | "REPORT";
    channel: string;          // telegram | email
    payload: any;
    ruleId?: string | null;
    deviceId?: string | null;
    maxAttempts?: number;
    delayMs?: number;
};

export async function enqueueDispatch(input: DispatchInput) {
    const maxAttempts = input.maxAttempts ?? 5;
    const job = await prisma.dispatchJob.create({
        data: {
            type: input.type,
            channel: input.channel,
            status: "PENDING",
            payload: input.payload,
            ruleId: input.ruleId || null,
            deviceId: input.deviceId || null,
            maxAttempts,
        },
    });
    try {
        const q = getDispatchQueue();
        const bull = await q.add("dispatch", { dispatchJobId: job.id }, {
            attempts: maxAttempts,
            backoff: { type: "exponential", delay: 5000 },
            delay: input.delayMs || 0,
            removeOnComplete: 2000,
            removeOnFail: 2000,
        });
        await prisma.dispatchJob.update({ where: { id: job.id }, data: { bullJobId: String(bull.id) } });
    } catch (e: any) {
        await prisma.dispatchJob.update({
            where: { id: job.id },
            data: { status: "FAILED", lastError: "No se pudo encolar: " + (e?.message || e) },
        });
    }
    return job;
}
