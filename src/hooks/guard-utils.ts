// Shared utility functions for Guard consoles
"use client";

/**
 * Play a short tactile feedback sound using WebAudio API
 * @param duration - Duration in seconds (default 0.08)
 * @param volume - Initial gain volume (default 0.03)
 */
export function playTactileSound(duration = 0.08, volume = 0.03) {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) { /* AudioContext not available */ }
}

/**
 * Format seconds into mm:ss display
 */
export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Normalize a license plate: uppercase, remove non-alphanumeric
 */
export function normalizePlate(plate: string): string {
    return plate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

/**
 * Format a timestamp for display in guard console entries
 */
export function formatEntryTime(timestamp: string | Date): string {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Format a full date+time for detailed views
 */
export function formatEntryDateTime(timestamp: string | Date): string {
    const d = new Date(timestamp);
    return d.toLocaleString("es-UY", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
