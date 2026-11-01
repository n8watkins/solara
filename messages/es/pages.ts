// Spanish for the static pages (lib/page-language.ts): the landing page, the city pages
// and the frame they share. Built into the pages' HTML at export; never part of the app's
// chunks.
import cityPages from './city-pages'
import landing from './landing'
import site from './site'

const pages = { cityPages, landing, site }

export default pages
