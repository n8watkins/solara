// Keeps a page's tab title in its language. The static HTML carries the English title,
// and Next.js may write the page's metadata title again after hydration, so a change to
// <head> that brings another title back is answered with this one.

let watch: MutationObserver | null = null
let kept: string | null = null

/** Shows `title` in the tab and keeps it there for as long as the page is open. */
export function keepDocumentTitle(title: string): void {
  kept = title
  if (document.title !== title) document.title = title
  if (watch || typeof MutationObserver === 'undefined') return
  watch = new MutationObserver(() => {
    if (kept !== null && document.title !== kept) document.title = kept
  })
  watch.observe(document.head, { childList: true, subtree: true, characterData: true })
}
