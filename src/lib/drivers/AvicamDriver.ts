import { IDeviceDriver } from "./IDeviceDriver";
import { Device, Credential } from "@prisma/client";
import axios from "axios";

export class AvicamDriver implements IDeviceDriver {
    private async request(method: "GET" | "POST", path: string, data: any, device: Device): Promise<any> {
        const url = `${this.getBaseUrl(device)}${path}`;
        // This is a placeholder for actual API implementation
        return { success: true };
    }

    public getBaseUrl(device: Device): string {
        return `http://${device.ip}`;
    }

    async upsertCredential(credential: Credential, device: Device): Promise<void> {
    }

    async triggerRelay(device: Device): Promise<void> {
        // Traditional face terminals often use /api/relay/trig or similar
        // await this.request("POST", "/api/relay/trig", { action: "open" }, device);
    }

    async syncUserWithFace(user: any, device: Device): Promise<void> {
    }
}
