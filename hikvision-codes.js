// Mapeo de códigos Hikvision a valores legibles
// Basado en la documentación de Hikvision ANPR

// Códigos de Color de Vehículo
const HIKVISION_VEHICLE_COLORS = {
    0: 'Unknown',
    1: 'White',
    2: 'Silver',
    3: 'Gray',
    4: 'Black',
    5: 'Red',
    6: 'Dark Blue',
    7: 'Blue',
    8: 'Yellow',
    9: 'Green',
    10: 'Brown',
    11: 'Pink',
    12: 'Purple',
    13: 'Dark Purple',
    14: 'Cyan'
};

// Códigos de Marca de Vehículo (los más comunes)
const HIKVISION_VEHICLE_BRANDS = {
    0: 'Unknown',
    1: 'Volkswagen',
    2: 'Buick',
    3: 'BMW',
    4: 'Honda',
    5: 'Nissan',
    6: 'Audi',
    7: 'Citroen',
    8: 'Benz',
    9: 'Peugeot',
    10: 'Ford',
    11: 'Mazda',
    12: 'Chevrolet',
    13: 'Chery',
    14: 'Toyota',
    15: 'Kia',
    16: 'Hyundai',
    17: 'Mitsubishi',
    18: 'Renault',
    19: 'Suzuki',
    20: 'Fiat',
    1028: 'Audi',
    1030: 'Porsche',
    1031: 'Buick',
    1036: 'Mercedes-Benz',
    1037: 'BMW',
    1038: 'Baojun',
    1043: 'Honda',
    1044: 'Peugeot',
    1045: 'BYD',
    1048: 'Great Wall',
    1050: 'DS',
    1053: 'Volkswagen',
    1056: 'Dodge',
    1060: 'Toyota',
    1063: 'Ferrari',
    1064: 'Ford',
    1067: 'Fiat',
    1079: 'Hummer',
    1083: 'Geely',
    1084: 'Ford',
    1088: 'Chrysler',
    1101: 'Land Rover',
    1102: 'Suzuki',
    1104: 'Lexus',
    1105: 'Renault',
    1107: 'Mini',
    1108: 'Fiat',
    1112: 'Mazda',
    1116: 'Opel',
    1120: 'Chery',
    1121: 'Volkswagen',
    1123: 'Nissan',
    1128: 'Mitsubishi',
    1133: 'Subaru',
    1139: 'Tesla',
    1144: 'Volvo',
    1149: 'Hyundai',
    1151: 'Chevrolet',
    1152: 'Citroën',
    1156: 'Infiniti',
    1167: 'Isuzu',
    1179: 'JAC',
    1552: 'Dongfeng',
    1559: 'Foton',
    1561: 'GMC',
    1579: 'JAC',
    1581: 'JMC',
    1629: 'FAW',
    1631: 'Iveco',
    1639: 'JMC',
    1691: 'Changan',
    1707: 'Zhongtong',
    1709: 'BAIC Motor',
    1745: 'Changan',
    1747: 'Lynk & Co',
    1765: 'Jetour',
    1775: 'Isuzu',
    1834: 'Dongfeng',
    1843: 'Changan',
    1849: 'Mini',
    1857: 'Maxus',
    1869: 'Geely',
    1877: 'MAN',
    1885: 'BYD',
    1945: 'Shacman',
    1951: 'FAW',
    1995: 'Hino'
};

// Códigos de Tipo de Vehículo
const HIKVISION_VEHICLE_TYPES = {
    0: 'Unknown',
    1: 'Passenger Car',
    2: 'Large Vehicle',
    3: 'Motorcycle',
    4: 'Non-motor Vehicle',
    5: 'Small Truck',
    6: 'Light Truck',
    7: 'Medium Truck',
    8: 'Heavy Truck',
    9: 'Minibus',
    10: 'Large Bus',
    11: 'SUV',
    12: 'MPV',
    13: 'Pickup Truck',
    14: 'Sedan',
    15: 'Hatchback',
    16: 'Coupe',
    17: 'Wagon',
    18: 'Van'
};

/**
 * Convierte un código de color de Hikvision a texto legible
 */
function getVehicleColorName(code) {
    const numCode = typeof code === 'string' ? parseInt(code, 10) : code;
    return HIKVISION_VEHICLE_COLORS[numCode] || `Color ${code}`;
}

/**
 * Convierte un código de marca de Hikvision a texto legible
 */
function getVehicleBrandName(code) {
    const numCode = typeof code === 'string' ? parseInt(code, 10) : code;
    return HIKVISION_VEHICLE_BRANDS[numCode] || `Brand ${code}`;
}

/**
 * Convierte un código de tipo de Hikvision a texto legible
 */
function getVehicleTypeName(code) {
    const numCode = typeof code === 'string' ? parseInt(code, 10) : code;
    return HIKVISION_VEHICLE_TYPES[numCode] || code.toString();
}

module.exports = {
    HIKVISION_VEHICLE_COLORS,
    HIKVISION_VEHICLE_BRANDS,
    HIKVISION_VEHICLE_TYPES,
    getVehicleColorName,
    getVehicleBrandName,
    getVehicleTypeName
};
