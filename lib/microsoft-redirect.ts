// The script of Solara's Microsoft redirect page, /auth/microsoft/ (app/auth/microsoft/
// page.tsx), where Microsoft sends the sign-in popup back (lib/microsoft-auth.ts). It is
// the page's only script (scripts/static-pages.mjs removes the framework's, and
// scripts/csp.mjs allows this one by its hash), so the one-time code reaches nothing but
// the app's own sign-in flow: it posts the answer on the BroadcastChannel named for the
// sign-in's state, removes the query from the address bar and history, and closes the
// popup. Kept apart from microsoft-auth.ts so the page imports nothing else.

/** Must equal MICROSOFT_AUTH_CHANNEL_PREFIX in lib/microsoft-auth.ts (checked by its test). */
const CHANNEL_PREFIX = 'solara-microsoft-auth:'

export const MICROSOFT_REDIRECT_SCRIPT = `(function(){var q=new URLSearchParams(location.search);function g(k,n){return(q.get(k)||'').slice(0,n)}var m={state:g('state',128),code:g('code',4096),error:g('error',128),errorDescription:g('error_description',512),errorSubcode:g('error_subcode',64)};try{history.replaceState(null,'',location.pathname)}catch(e){}if(m.state){try{var c=new BroadcastChannel(${JSON.stringify(CHANNEL_PREFIX)}+m.state);c.postMessage(m);c.close()}catch(e){}}try{window.close()}catch(e){}})()`
