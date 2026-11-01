// The cities' names in other languages, for the city pages (lib/city-pages.ts): only the
// names that differ from English (lib/cities/cities.json), and every country.
import type { Locale } from '@solara/core/i18n'

type Names = { name?: string; region?: string }

/** City and region names by slug, where a language writes them its own way. */
export const CITY_NAMES: Readonly<Partial<Record<Locale, Readonly<Record<string, Names>>>>> = {
  es: {
    'new-york': { name: 'Nueva York', region: 'Nueva York' },
    philadelphia: { name: 'Filadelfia', region: 'Pensilvania' },
    'washington-dc': { region: 'Distrito de Columbia' },
    honolulu: { region: 'Hawái' },
    'new-orleans': { name: 'Nueva Orleans', region: 'Luisiana' },
    vancouver: { region: 'Columbia Británica' },
    'mexico-city': { name: 'Ciudad de México', region: 'Ciudad de México' },
    london: { name: 'Londres', region: 'Inglaterra' },
    paris: { name: 'París', region: 'Isla de Francia' },
    berlin: { name: 'Berlín', region: 'Berlín' },
    madrid: { region: 'Comunidad de Madrid' },
    barcelona: { region: 'Cataluña' },
    rome: { name: 'Roma', region: 'Lacio' },
    amsterdam: { name: 'Ámsterdam', region: 'Holanda Septentrional' },
    athens: { name: 'Atenas', region: 'Ática' },
    lisbon: { name: 'Lisboa', region: 'Lisboa' },
    dubai: { name: 'Dubái', region: 'Dubái' },
    singapore: { name: 'Singapur', region: 'Singapur' },
    tokyo: { name: 'Tokio', region: 'Tokio' },
    seoul: { name: 'Seúl', region: 'Seúl' },
    sydney: { name: 'Sídney', region: 'Nueva Gales del Sur' },
    'rio-de-janeiro': { name: 'Río de Janeiro', region: 'Río de Janeiro' },
    'cape-town': { name: 'Ciudad del Cabo', region: 'Cabo Occidental' },
  },
}

/** Country names, by their English name in cities.json. */
export const COUNTRY_NAMES: Readonly<Partial<Record<Locale, Readonly<Record<string, string>>>>> = {
  es: {
    'United States': 'Estados Unidos',
    Canada: 'Canadá',
    Mexico: 'México',
    'United Kingdom': 'Reino Unido',
    France: 'Francia',
    Germany: 'Alemania',
    Spain: 'España',
    Italy: 'Italia',
    Netherlands: 'Países Bajos',
    Greece: 'Grecia',
    Portugal: 'Portugal',
    'United Arab Emirates': 'Emiratos Árabes Unidos',
    India: 'India',
    Singapore: 'Singapur',
    Thailand: 'Tailandia',
    Japan: 'Japón',
    'South Korea': 'Corea del Sur',
    China: 'China',
    Australia: 'Australia',
    'New Zealand': 'Nueva Zelanda',
    Brazil: 'Brasil',
    'South Africa': 'Sudáfrica',
  },
}
