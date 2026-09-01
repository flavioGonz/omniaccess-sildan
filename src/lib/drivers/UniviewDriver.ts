import { IDeviceDriver } from "./IDeviceDriver";
import { Device, Credential } from "@prisma/client";

export class UniviewDriver implements IDeviceDriver {
    async upsertCredential(credential: Credential, device: Device): Promise<void> {
    }

    async triggerRelay(device: Device): Promise<void> {
    }
}
