/**
 * Akuvox Device Models Reference
 * Based on "Action URLs Supported by Different Models" documentation
 * 
 * IMPORTANT: Akuvox Action URLs do NOT send images!
 * Face images must be retrieved from the device's doorlog API after an event.
 */

export interface AkuvoxModelInfo {
    model: string;
    label: string;
    category: 'FACE_TERMINAL' | 'DOOR_INTERCOM' | 'ACCESS_CONTROLLER' | 'INDOOR_STATION';
    hasFaceRecognition: boolean;
    hasCardReader: boolean;
    hasQRCode: boolean;
    hasPinCode: boolean;
    relayCount: number;
    inputCount: number;
    supportsDigest: boolean;
    supportsPost: boolean;
    firmwareBase: string;
    photo?: string;
}

export const AKUVOX_MODELS: Record<string, AkuvoxModelInfo> = {
    // A Series - Face Terminals
    'A01': {
        model: 'A01',
        label: 'A01 Facial Recognition Terminal',
        category: 'FACE_TERMINAL',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '101.30',
        photo: 'https://www.akuvox.com/Upload/products/202103/17/20210317153829425.png'
    },
    'A02': {
        model: 'A02',
        label: 'A02 Facial Recognition Terminal',
        category: 'FACE_TERMINAL',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '102.30',
        photo: 'https://www.akuvox.com/Upload/products/202306/06/20230606092618728.png'
    },
    'A03': {
        model: 'A03',
        label: 'A03 Facial Recognition Terminal',
        category: 'FACE_TERMINAL',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '103.30',
        photo: 'https://www.akuvox.com/Upload/products/202103/17/20210317154028105.png'
    },
    'A05': {
        model: 'A05',
        label: 'A05 Facial Recognition Terminal',
        category: 'FACE_TERMINAL',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '205.30',
        photo: 'https://www.akuvox.com/Upload/products/202103/17/20210317154215865.png'
    },
    'A094': {
        model: 'A094',
        label: 'A094 Facial Recognition Terminal',
        category: 'FACE_TERMINAL',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '194.30'
    },
    'A095': {
        model: 'A095',
        label: 'A095 Facial Recognition Terminal',
        category: 'FACE_TERMINAL',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 2,
        inputCount: 2,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '195.30'
    },

    // R Series - Door Intercoms
    'R20': {
        model: 'R20',
        label: 'R20 Series Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: false,
        hasCardReader: true,
        hasQRCode: false,
        hasPinCode: true, // R20K variant
        relayCount: 2,
        inputCount: 2,
        supportsDigest: false, // Exception
        supportsPost: false,
        firmwareBase: '320.30',
        photo: 'https://www.akuvox.com/Upload/products/202005/18/20200518105739832.png'
    },
    'R25': {
        model: 'R25',
        label: 'R25 Series Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: false,
        hasCardReader: true,
        hasQRCode: false,
        hasPinCode: true,
        relayCount: 2,
        inputCount: 2,
        supportsDigest: false, // Exception
        supportsPost: false,
        firmwareBase: '225.30'
    },
    'R28V2': {
        model: 'R28V2',
        label: 'R28 V2 Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 2,
        inputCount: 2,
        supportsDigest: false, // Exception
        supportsPost: false,
        firmwareBase: '228.30'
    },
    'R29': {
        model: 'R29',
        label: 'R29 Smart Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 3,
        inputCount: 3,
        supportsDigest: true,
        supportsPost: true, // Supports POST
        firmwareBase: '29.30',
        photo: 'https://www.akuvox.com/Upload/products/202007/31/20200731095548552.png'
    },

    // X Series - Premium Intercoms
    'X910': {
        model: 'X910',
        label: 'X910 Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 2,
        inputCount: 2,
        supportsDigest: true,
        supportsPost: true,
        firmwareBase: '910.30'
    },
    'X912': {
        model: 'X912',
        label: 'X912 Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 3,
        inputCount: 3,
        supportsDigest: true,
        supportsPost: true,
        firmwareBase: '912.30'
    },
    'X915V2': {
        model: 'X915V2',
        label: 'X915 V2 Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 3,
        inputCount: 3,
        supportsDigest: true,
        supportsPost: true,
        firmwareBase: '915.30',
        photo: 'https://www.akuvox.com/Upload/products/202309/14/20230914160512365.png'
    },
    'X916': {
        model: 'X916',
        label: 'X916 Smart Door Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 4,
        inputCount: 4,
        supportsDigest: true,
        supportsPost: true,
        firmwareBase: '916.30',
        photo: 'https://www.akuvox.com/Upload/products/202302/27/20230227113947580.png'
    },

    // S Series - Smart Intercoms
    'S532': {
        model: 'S532',
        label: 'S532 Smart Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 2,
        inputCount: 2,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '532.30'
    },
    'S535': {
        model: 'S535',
        label: 'S535 Smart Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 3,
        inputCount: 3,
        supportsDigest: true,
        supportsPost: true,
        firmwareBase: '535.30'
    },
    'S539': {
        model: 'S539',
        label: 'S539 Smart Intercom',
        category: 'DOOR_INTERCOM',
        hasFaceRecognition: true,
        hasCardReader: true,
        hasQRCode: true,
        hasPinCode: true,
        relayCount: 4,
        inputCount: 4,
        supportsDigest: true,
        supportsPost: true,
        firmwareBase: '539.30'
    },

    // E Series - Indoor Stations
    'E12': {
        model: 'E12',
        label: 'E12 Indoor Station',
        category: 'INDOOR_STATION',
        hasFaceRecognition: false,
        hasCardReader: false,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '212.30'
    },
    'E13': {
        model: 'E13',
        label: 'E13 Indoor Station',
        category: 'INDOOR_STATION',
        hasFaceRecognition: false,
        hasCardReader: false,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: false, // Exception
        supportsPost: false,
        firmwareBase: '213.30'
    },
    'E16V2': {
        model: 'E16V2',
        label: 'E16 V2 Indoor Station',
        category: 'INDOOR_STATION',
        hasFaceRecognition: false,
        hasCardReader: false,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 1,
        inputCount: 1,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '216.30'
    },
    'E18': {
        model: 'E18',
        label: 'E18 Indoor Station',
        category: 'INDOOR_STATION',
        hasFaceRecognition: false,
        hasCardReader: false,
        hasQRCode: false,
        hasPinCode: false,
        relayCount: 2,
        inputCount: 2,
        supportsDigest: true,
        supportsPost: false,
        firmwareBase: '218.30'
    },
};

/**
 * Akuvox Action URL Variables
 * These are the variables that can be used in Action URLs
 */
export const AKUVOX_VARIABLES = {
    // Device Info
    '$mac': 'Device MAC address',
    '$ip': 'Device IP address',
    '$model': 'Device model name',
    '$firmware': 'Firmware version',

    // Event Context
    '$active_url': 'The action URL that was triggered',
    '$active_user': 'The active user context',
    '$time': 'Event timestamp (Unix)',

    // User Info (for card/face events)
    '$userid': 'User ID',
    '$user_name': 'User name (registered)',
    '$schedule': 'User schedule info',

    // Access Methods
    '$card_sn': 'Card serial number',
    '$code': 'PIN code entered',
    '$unlocktype': 'Unlock type (Face, QR Code, etc.)',
    '$qrcode': 'QR code content',

    // Relay/Input Status
    '$relay1status': 'Relay A status (1=Open, 0=Closed)',
    '$relay2status': 'Relay B status',
    '$relay3status': 'Relay C status',
    '$relay4status': 'Relay D status',
    '$input1status': 'Input A status (1=Triggered, 0=Not)',
    '$input2status': 'Input B status',
    '$input3status': 'Input C status',
    '$input4status': 'Input D status',

    // Call Info
    '$remote': 'Remote SIP/IP number',
};

/**
 * Akuvox Event Types
 * Maps event names to their Action URL field names
 */
export const AKUVOX_EVENTS = {
    // Call Events
    MAKE_CALL: 'Callnumber',
    HANG_UP: 'Callnumber',

    // Relay Events
    RELAY_A_TRIGGERED: 'relaytrigger',
    RELAY_B_TRIGGERED: 'relaytrigger',
    RELAY_C_TRIGGERED: 'relaytrigger',
    RELAY_D_TRIGGERED: 'relaytrigger',
    RELAY_A_CLOSED: 'relayclose',
    RELAY_B_CLOSED: 'relayclose',
    RELAY_C_CLOSED: 'relayclose',
    RELAY_D_CLOSED: 'relayclose',

    // Input Events
    INPUT_A_TRIGGERED: 'inputtrigger',
    INPUT_B_TRIGGERED: 'inputtrigger',
    INPUT_C_TRIGGERED: 'inputtrigger',
    INPUT_D_TRIGGERED: 'inputtrigger',
    INPUT_A_CLOSED: 'inputclose',
    INPUT_B_CLOSED: 'inputclose',
    INPUT_C_CLOSED: 'inputclose',
    INPUT_D_CLOSED: 'inputclose',

    // Access Events
    VALID_CODE: 'validcode',
    INVALID_CODE: 'invalidcode',
    VALID_CARD: 'validcard',
    INVALID_CARD: 'invalidcard',
    VALID_FACE: 'unlocktype', // $unlocktype = "Face"
    INVALID_FACE: 'unlocktype', // $unlocktype = "Null" or empty
    VALID_QR: 'unlocktype', // $unlocktype = "QR Code"
    INVALID_QR: 'unlocktype',

    // Alarm Events
    TAMPER_ALARM: 'tampertri',
    BREAK_IN_ALARM: 'inputtrigger',

    // System Events
    SETUP_COMPLETED: 'model',
};

/**
 * Get the doorlog API endpoint for retrieving face images
 * Note: Face images from events are NOT sent via Action URLs!
 * You must query the doorlog API to get the associated image.
 */
export function getDoorlogApiUrl(deviceIp: string): string {
    return `http://${deviceIp}/api/doorlog/get`;
}

/**
 * Get the user face image URL for a registered user
 */
export function getUserFaceUrl(deviceIp: string, userId: string): string {
    return `http://${deviceIp}/api/user/get?id=${userId}`;
}
