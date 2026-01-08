/**
 * Configuración de rutas y destinos disponibles
 * Define los aeropuertos, ciudades y rutas más comunes
 */

const AIRPORTS = {
  // España
  MAD: { city: 'Madrid', country: 'España', region: 'Europa' },
  BCN: { city: 'Barcelona', country: 'España', region: 'Europa' },
  AGP: { city: 'Málaga', country: 'España', region: 'Europa' },
  IBZ: { city: 'Ibiza', country: 'España', region: 'Europa' },
  
  // Europa
  FCO: { city: 'Roma', country: 'Italia', region: 'Europa' },
  LIS: { city: 'Lisboa', country: 'Portugal', region: 'Europa' },
  BER: { city: 'Berlín', country: 'Alemania', region: 'Europa' },
  CDG: { city: 'París', country: 'Francia', region: 'Europa' },
  AMS: { city: 'Ámsterdam', country: 'Holanda', region: 'Europa' },
  LHR: { city: 'Londres', country: 'Reino Unido', region: 'Europa' },
  
  // Argentina
  AEP: { city: 'Buenos Aires (Ezeiza)', country: 'Argentina', region: 'América del Sur' },
  COR: { city: 'Córdoba', country: 'Argentina', region: 'América del Sur' },
  MEN: { city: 'Mendoza', country: 'Argentina', region: 'América del Sur' },
  
  // Estados Unidos
  MIA: { city: 'Miami', country: 'Estados Unidos', region: 'América del Norte' },
  MCO: { city: 'Orlando', country: 'Estados Unidos', region: 'América del Norte' },
  JFK: { city: 'Nueva York', country: 'Estados Unidos', region: 'América del Norte' },
  LAX: { city: 'Los Ángeles', country: 'Estados Unidos', region: 'América del Norte' },
  ORD: { city: 'Chicago', country: 'Estados Unidos', region: 'América del Norte' },
};

const POPULAR_ROUTES = [
  { origin: 'MAD', destination: 'AEP', label: 'Madrid → Buenos Aires', economical: true },
  { origin: 'BCN', destination: 'AEP', label: 'Barcelona → Buenos Aires', economical: true },
  { origin: 'FCO', destination: 'AEP', label: 'Roma → Buenos Aires', economical: false },
  { origin: 'LIS', destination: 'AEP', label: 'Lisboa → Buenos Aires', economical: true },
  { origin: 'BER', destination: 'AEP', label: 'Berlín → Buenos Aires', economical: true },
  
  { origin: 'MIA', destination: 'AEP', label: 'Miami → Buenos Aires', economical: true },
  { origin: 'MCO', destination: 'AEP', label: 'Orlando → Buenos Aires', economical: true },
  { origin: 'JFK', destination: 'AEP', label: 'Nueva York → Buenos Aires', economical: false },
  
  { origin: 'AEP', destination: 'MAD', label: 'Buenos Aires → Madrid', economical: true },
  { origin: 'AEP', destination: 'MIA', label: 'Buenos Aires → Miami', economical: true },
  
  { origin: 'MAD', destination: 'COR', label: 'Madrid → Córdoba', economical: true },
  { origin: 'BCN', destination: 'COR', label: 'Barcelona → Córdoba', economical: true },
  { origin: 'COR', destination: 'MAD', label: 'Córdoba → Madrid', economical: true },
];

// Precios estimados por ruta (para generar datos realistas)
const ESTIMATED_PRICES = {
  'MAD-AEP': { min: 450, max: 1200, avg: 750 },
  'BCN-AEP': { min: 480, max: 1250, avg: 800 },
  'FCO-AEP': { min: 500, max: 1300, avg: 850 },
  'LIS-AEP': { min: 420, max: 1100, avg: 700 },
  'BER-AEP': { min: 500, max: 1300, avg: 850 },
  'MIA-AEP': { min: 300, max: 800, avg: 500 },
  'MCO-AEP': { min: 350, max: 900, avg: 600 },
  'JFK-AEP': { min: 400, max: 1000, avg: 650 },
  'AEP-MAD': { min: 450, max: 1200, avg: 750 },
  'AEP-MIA': { min: 300, max: 800, avg: 500 },
  'MAD-COR': { min: 120, max: 400, avg: 250 },
  'BCN-COR': { min: 150, max: 450, avg: 280 },
  'COR-MAD': { min: 120, max: 400, avg: 250 },
};

const AIRLINES = [
  'Ryanair',
  'Vueling',
  'Iberia',
  'Air Europa',
  'Lufthansa',
  'EasyJet',
  'LATAM',
  'Aerolíneas Argentinas',
  'ITA Airways',
  'Air Transat',
  'Air Canada',
  'United Airlines',
];

module.exports = {
  AIRPORTS,
  POPULAR_ROUTES,
  ESTIMATED_PRICES,
  AIRLINES,
};
