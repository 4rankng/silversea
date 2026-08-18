import { searchPlaces, geocodePlace } from '../src/services/map4d';
import { config } from '../src/config/index';
console.log('map4dApiUrl=', config.map4dApiUrl, '| key set?', !!config.map4dApiKey, '| key=', config.map4dApiKey.slice(0, 8) + '…');
const s = await searchPlaces('Cảng Hải Phòng', 5);
console.log('searchPlaces("Cảng Hải Phòng") ->', s.length, 'results');
for (const r of s.slice(0, 3)) console.log('   -', r.description, '|', r.lat.toFixed(4), r.lng.toFixed(4));
const g = await geocodePlace('Yên Sơn, Tuyên Quang');
console.log('geocodePlace("Yên Sơn, Tuyên Quang") ->', g);
