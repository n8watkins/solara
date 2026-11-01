'use client'
import { useEffect } from 'react'
import { isLocale } from '@solara/core/i18n'
import { keepDocumentTitle } from '@/lib/document-title'
import type { StaticMessage } from '@/messages/static'

/**
 * The tab title of a page that has no message catalogue (the 404 page, the share target
 * fallback), in the language LANGUAGE_INIT_SCRIPT (lib/i18n.ts) gave the page: its
 * metadata title is the English one (REVIEW10 QA L3).
 */
export default function LocalizedTitle({ title }: { title: StaticMessage }) {
  useEffect(() => {
    const lang = document.documentElement.lang
    if (isLocale(lang) && lang !== 'en') keepDocumentTitle(title[lang])
  }, [title])
  return null
}
