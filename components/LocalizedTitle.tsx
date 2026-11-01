import type { StaticMessage } from '@/messages/static'

/**
 * The tab title of a page that has no message catalogue (the 404 page, the share target
 * fallback), in the language LANGUAGE_INIT_SCRIPT (lib/i18n.ts) gave the page; its
 * metadata title is the English one (REVIEW10 QA L3). An inline script rather than a
 * client component: Next.js loads the 404 page's client code with every page, the app's
 * first load included. It keeps the title should Next.js write the metadata's back.
 * The text is fixed per page, so scripts/csp.mjs hashes it like every inline script.
 */
export default function LocalizedTitle({ title }: { title: StaticMessage }) {
  const script = `(function(){try{var l=document.documentElement.lang,t=${JSON.stringify(title)}[l];if(!t||l==="en")return;var s=function(){if(document.title!==t)document.title=t};s();new MutationObserver(s).observe(document.head,{childList:true,subtree:true,characterData:true})}catch(e){}})()`
  return <script data-static="" dangerouslySetInnerHTML={{ __html: script }} />
}
