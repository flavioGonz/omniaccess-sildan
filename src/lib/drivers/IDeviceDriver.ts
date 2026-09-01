import { Device, Credential } from "@prisma/client";

/**
 * Base interface for all device drivers.
 * Every driver MUST implement these two methods.
 */
export interface IDeviceDriver {
    upsertCredential(credential: Credential, device: Device): Promise<void>;
    triggerRelay(device: Device): Promise<void>;
}

/**
 * Driver capable of managing LPR (License Plate Recognition) whitelists.
 */
export interface ILprDriver extends IDeviceDriver {
    getPlates(device: Device): Promise<string[]>;
    getPlatesPage?(device: Device, searchId: string, start: number, max?: number): Promise<{
        plates: string[];
        totalMatches: number;
        numOfMatches: number;
        isLastPage: boolean;
    }>;
    addPlateToCamera(device: Device, plate: string): Promise<void>;
    deleteCredential(credentialValue: string, device: Device): Promise<void>;
    clearWhiteList?(device: Device): Promise<void>;
}

/**
 * Driver capable of managing facial recognition identities.
 */
export interface IFaceDriver extends IDeviceDriver {
    getFacesFromCamera(device: Device): Promise<any[]>;
    getFaceImage?(device: Device, faceId: string): Promise<Buffer | null>;
    syncUserWithFace(user: any, device: Device): Promise<void>;
    deleteFace?(device: Device, faceId: string, userId?: string, userCode?: string): Promise<boolean>;
}

/**
 * Driver capable of managing RFID tags/cards.
 */
export interface IRfidDriver extends IDeviceDriver {
    syncRfKey(credential: Credential, device: Device): Promise<void>;
}

/**
 * Driver capable of retrieving access/door logs from the device.
 */
export interface ILogDriver extends IDeviceDriver {
    getDoorlog(device: Device, num?: number, offset?: number): Promise<any[]>;
    getCalllog?(device: Device, num?: number, offset?: number): Promise<any[]>;
}

/**
 * Driver capable of reporting device statistics.
 */
export interface IStatsDriver extends IDeviceDriver {
    getDeviceStats(device: Device): Promise<{ faces: number; tags: number }>;
}

/**
 * Type guard helpers
 */
export function isLprDriver(driver: IDeviceDriver): driver is ILprDriver {
    return 'getPlates' in driver && 'addPlateToCamera' in driver;
}

export function isFaceDriver(driver: IDeviceDriver): driver is IFaceDriver {
    return 'getFacesFromCamera' in driver && 'syncUserWithFace' in driver;
}

export function isRfidDriver(driver: IDeviceDriver): driver is IRfidDriver {
    return 'syncRfKey' in driver;
}

export function isLogDriver(driver: IDeviceDriver): driver is ILogDriver {
    return 'getDoorlog' in driver;
}

export function isStatsDriver(driver: IDeviceDriver): driver is IStatsDriver {
    return 'getDeviceStats' in driver;
}
