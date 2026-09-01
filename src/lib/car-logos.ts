import carLogos from './car-logos.json';

export interface CarLogo {
    name: string;
    slug: string;
    image: {
        source: string;
        thumb: string;
        optimized: string;
        original: string;
    };
}

const BRAND_ALIASES: Record<string, string> = {
    'VW': 'Volkswagen',
    'MB': 'Mercedes-Benz',
    'MERCEDES': 'Mercedes-Benz',
    'BMW': 'BMW',
    'CHEVY': 'Chevrolet',
    'FORD': 'Ford',
    'FIAT': 'Fiat',
    'TOYOTA': 'Toyota',
    'HONDA': 'Honda',
    'HYUNDAI': 'Hyundai',
    'KIA': 'Kia',
    'NISSAN': 'Nissan',
    'PEUGEOT': 'Peugeot',
    'RENAULT': 'Renault',
    'CITROEN': 'Citroën',
    'AUDI': 'Audi',
    'JEEP': 'Jeep',
    'DODGE': 'Dodge',
    'RAM': 'RAM',
    'VOLVO': 'Volvo',
    'MITSUBISHI': 'Mitsubishi',
    'SUZUKI': 'Suzuki',
    'MAZDA': 'Mazda',
    'SUBARU': 'Subaru',
    'CHERY': 'Chery',
    'JAC': 'JAC',
    'LIFAN': 'Lifan',
    'GEELY': 'Geely',
    'HAVAL': 'Haval',
    'GREAT WALL': 'Great Wall',
    'LAND ROVER': 'Land Rover',
    'PORSCHE': 'Porsche',
    'FERRARI': 'Ferrari',
    'LAMBORGHINI': 'Lamborghini',
    'BUGATTI': 'Bugatti',
    'LEXUS': 'Lexus',
    'INFINITI': 'Infiniti',
    'TESLA': 'Tesla',
    '1101': 'Land Rover',
    '1028': 'Audi',
    '1775': 'Isuzu',
    '1128': 'Mitsubishi',
    '1108': 'Maserati',
    '1112': 'Mazda',
    '1849': 'Mini',
    '1552': 'Dongfeng',
    '1031': 'Buick',
};

/**
 * Returns the logo URL for a given car brand name.
 * Uses the dataset from filippofilip95/car-logos-dataset.
 */
export function getCarLogo(brandName: string | null | undefined): string | null {
    if (!brandName) return null;

    const normalizedInput = brandName.trim().toUpperCase();

    // Check aliases first
    const mappedName = BRAND_ALIASES[normalizedInput] || brandName.trim();
    const searchName = mappedName.toLowerCase();

    // Find in dataset
    const logoEntry = (carLogos as CarLogo[]).find(entry =>
        entry.name.toLowerCase() === searchName ||
        entry.slug === searchName ||
        entry.name.toLowerCase().includes(searchName) ||
        searchName.includes(entry.name.toLowerCase())
    );

    if (!logoEntry) return null;

    const url = logoEntry.image.optimized;
    if (url.startsWith('http')) return url;

    // Fallback for local paths to use remote GitHub raw
    const relativePath = logoEntry.image.optimized.replace(/^\./, '');
    return `https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos${relativePath}`;
}

export const VEHICLE_BRANDS = [
    { label: 'Toyota' },
    { label: 'Ford' },
    { label: 'Volkswagen' },
    { label: 'Chevrolet' },
    { label: 'Fiat' },
    { label: 'Renault' },
    { label: 'Peugeot' },
    { label: 'Citroën' },
    { label: 'Honda' },
    { label: 'Hyundai' },
    { label: 'Kia' },
    { label: 'Nissan' },
    { label: 'Mercedes-Benz' },
    { label: 'BMW' },
    { label: 'Audi' },
    { label: 'Jeep' },
    { label: 'Dodge' },
    { label: 'RAM' },
    { label: 'Volvo' },
    { label: 'Mitsubishi' },
    { label: 'Suzuki' },
    { label: 'Mazda' },
    { label: 'Subaru' },
    { label: 'Chery' },
    { label: 'Tesla' },
    { label: 'Land Rover' },
    { label: 'Porsche' },
    { label: 'Ferrari' },
    { label: 'Lamborghini' },
    { label: 'Isuzu' },
].sort((a, b) => a.label.localeCompare(b.label));
