import type { SkinType } from '@/lib/types'
import { SKIN_SWATCHES } from '@/lib/onboarding'

/** A round sample of a skin type's tone, beside its name (decorative). */
export default function SkinSwatch({ skin, size = 22 }: { skin: SkinType; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]"
      style={{ width: size, height: size, background: SKIN_SWATCHES[skin] }}
    />
  )
}
