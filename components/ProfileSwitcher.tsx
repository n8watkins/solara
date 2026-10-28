'use client'
import { ChevronDown, Pencil, Users } from 'lucide-react'
import { useState, useRef, useEffect, useId } from 'react'
import clsx from 'clsx'
import type { User } from 'firebase/auth'
import type { UserPreferences, Profile, TierLevel } from '@/lib/types'
import {
  activeProfile,
  defaultProfile,
  selectProfile,
  SKIN_TYPE_LABELS,
  toggleGroupMemberPatch,
} from '@/lib/profiles'
import { groupMembers, planningFor } from '@solara/core'
import { newProfileDraft, removeProfilePatch, saveProfilePatch } from '@/lib/profile-patches'
import { isCheckoutConfigured } from '@/lib/billing'
import { TIER_LIMITS, canUseFamilyProfiles, getProfileLimit } from '@/lib/tiers'
import ProfileEditor from './ProfileEditor'
import { PricingModal } from './deferred'

interface Props {
  prefs: UserPreferences
  tier: TierLevel
  /** The signed-in account, for the Pro offer's waitlist. */
  user?: User | null
  onApply: (patch: Partial<UserPreferences>) => void
}

const ROW = 'flex flex-1 items-center gap-2 rounded-[9px] border px-[9px] py-[7px] text-left'

/**
 * The header's profile picker: switch between the people (and pets) Solara plans for,
 * add, edit or remove them, and, on Pro, plan for a group by the most sensitive person
 * in it (planningFor in packages/core/src/prefs.ts). A disclosure panel that closes on Escape, an
 * outside click or tabbing away. On Free it says what family profiles are and offers
 * Pro honestly: a waitlist until checkout is switched on.
 */
export default function ProfileSwitcher({ prefs, tier, user, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null) // profile being edited, or a blank draft for "add"
  const [showPricing, setShowPricing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const panelId = `${id}-panel`
  const titleId = `${id}-title`
  const groupHintId = `${id}-group-hint`

  function close({ returnFocus }: { returnFocus: boolean }) {
    setOpen(false)
    setEditing(null)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const saved = prefs.profiles ?? []
  // Always show at least the implicit "Me" so the control is meaningful before setup.
  const list: Profile[] = saved.length ? saved : [defaultProfile(prefs.skinType)]
  const active = activeProfile(prefs)
  const limit = getProfileLimit(tier)
  // The implicit "Me" counts: adding the first person saves Me and them (saveProfilePatch).
  const canAdd = list.length < limit
  const family = canUseFamilyProfiles(tier)
  const planning = planningFor(prefs)
  const grouped = !!prefs.groupMode
  const members = new Set(groupMembers(prefs).map(p => p.id))
  // Group planning needs two people to choose between.
  const canGroup = family && saved.length >= 2

  function switchTo(p: Profile) {
    onApply(selectProfile(p))
    close({ returnFocus: true })
  }

  function saveProfile(p: Profile) {
    if (!p.name.trim()) return
    onApply(saveProfilePatch(prefs, p))
    setEditing(null)
  }

  function removeProfile(id: string) {
    onApply(removeProfilePatch(prefs, id))
    setEditing(null)
  }

  const triggerName = planning.group ? `Group of ${planning.group.length}` : active.name
  const triggerLabel = planning.group
    ? `Profile: group of ${planning.group.length}, planned for ${planning.mostSensitive?.name}`
    : `Profile: ${active.name}`

  return (
    <div
      ref={ref}
      className="relative inline-block"
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          close({ returnFocus: true })
        }
      }}
      onBlur={event => {
        // Tabbing out of the switcher closes it, like a click outside does.
        if (open && !ref.current?.contains(event.relatedTarget as Node | null)) {
          close({ returnFocus: false })
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen(o => !o)}
        title="Switch profile"
        className="flex items-center gap-[5px] rounded-full border-[0.5px] border-line-strong bg-surface-metric py-1 pr-[9px] pl-[7px] text-[12px] whitespace-nowrap text-ink-2"
      >
        {planning.group ? (
          <Users aria-hidden="true" size={14} strokeWidth={2.25} className="text-ink-2" />
        ) : (
          <span aria-hidden="true" className="text-[13px]">
            {active.icon ?? '🧑'}
          </span>
        )}
        {/* Phones show the icon only; the button's label names the profile. */}
        <span className="font-semibold max-sm:hidden">{triggerName}</span>
        <ChevronDown size={14} className="text-ink-3" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="absolute top-[calc(100%+6px)] right-0 z-100 w-72 max-w-[calc(100vw-32px)] rounded-[14px] border-[0.5px] border-line-strong bg-surface-card p-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
        >
          <h2
            id={titleId}
            className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink uppercase"
          >
            Profiles
          </h2>

          {editing ? (
            <ProfileEditor
              labelPrefix={id}
              draft={editing}
              isNew={!saved.some(p => p.id === editing.id)}
              onChange={setEditing}
              onSave={() => saveProfile(editing)}
              onCancel={() => setEditing(null)}
              onDelete={
                saved.some(p => p.id === editing.id) ? () => removeProfile(editing.id) : undefined
              }
            />
          ) : (
            <>
              {grouped && canGroup && (
                <p className="mb-2 text-[12px] leading-[1.45] text-ink-3">
                  Tick who&apos;s going. Plans and burn times follow whoever burns fastest.
                </p>
              )}
              <div className="mb-2 flex flex-col gap-[3px]">
                {list.map(p => {
                  const isActive = p.id === active.id
                  const isMember = members.has(p.id)
                  const leads = planning.mostSensitive?.id === p.id
                  return (
                    <div key={p.id} className="flex items-center gap-1">
                      {grouped && canGroup ? (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isMember}
                          onClick={() => onApply(toggleGroupMemberPatch(prefs, p.id))}
                          className={clsx(
                            ROW,
                            isMember ? 'border-accent-border bg-accent-soft' : 'border-transparent',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={clsx(
                              'flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[11px] leading-none font-bold',
                              isMember
                                ? 'border-accent bg-accent text-(--on-accent)'
                                : 'border-line-strong bg-surface-card',
                            )}
                          >
                            {isMember && '✓'}
                          </span>
                          <span aria-hidden="true" className="text-[16px]">
                            {p.icon ?? '🧑'}
                          </span>
                          <ProfileText profile={p} />
                          {leads && (
                            <span className="text-[11px] font-bold whitespace-nowrap text-accent">
                              Most sensitive
                            </span>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => switchTo(p)}
                          className={clsx(
                            ROW,
                            isActive ? 'border-accent-border bg-accent-soft' : 'border-transparent',
                          )}
                        >
                          <span aria-hidden="true" className="text-[16px]">
                            {p.icon ?? '🧑'}
                          </span>
                          <ProfileText profile={p} />
                          {isActive && (
                            <span aria-hidden="true" className="text-[11px] font-bold text-accent">
                              Active
                            </span>
                          )}
                        </button>
                      )}
                      {saved.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          className="min-h-7 min-w-7 rounded-[7px] p-1 text-[13px] text-ink-3"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {canAdd && (
                <button
                  type="button"
                  className="btn w-full justify-center text-[13px]"
                  onClick={() => setEditing(newProfileDraft(prefs))}
                >
                  ＋ Add person or pet
                </button>
              )}
              {family && !canAdd && (
                <p className="text-[12px] leading-[1.45] text-ink-3">
                  Profile limit reached ({limit}).
                </p>
              )}

              {canGroup && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t-[0.5px] border-line-strong pt-3">
                  <div className="min-w-0">
                    <p id={`${id}-group`} className="text-[13px] font-semibold text-ink">
                      Plan for a group
                    </p>
                    <p id={groupHintId} className="mt-0.5 text-[11px] leading-[1.4] text-ink-3">
                      Use the most sensitive person&apos;s skin for every plan.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={grouped}
                    id={`${id}-group-toggle`}
                    aria-labelledby={`${id}-group ${id}-group-toggle`}
                    aria-describedby={groupHintId}
                    onClick={() => onApply({ groupMode: !grouped })}
                    className="btn shrink-0 text-[12px] whitespace-nowrap"
                  >
                    {grouped ? '✓ On' : 'Off'}
                  </button>
                </div>
              )}
              {family && saved.length < 2 && (
                <p className="mt-2.5 text-[11px] leading-[1.45] text-ink-3">
                  Add someone to plan for a group by its most sensitive person.
                </p>
              )}

              {!family && <FamilyOffer onSeePro={() => setShowPricing(true)} />}
            </>
          )}
        </div>
      )}

      {showPricing && (
        <PricingModal
          user={user}
          email={user?.email ?? prefs.upgradeInterest?.email}
          alreadyWaitlisted={!!prefs.upgradeInterest}
          onJoinWaitlist={
            user
              ? email =>
                  onApply({
                    upgradeInterest: {
                      email: email || undefined,
                      createdAt: new Date().toISOString(),
                    },
                  })
              : undefined
          }
          onClose={() => setShowPricing(false)}
        />
      )}
    </div>
  )
}

function ProfileText({ profile }: { profile: Profile }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[13px] font-semibold text-ink">{profile.name}</span>
      <span className="block text-[11px] text-ink-3">
        {SKIN_TYPE_LABELS[profile.skinType]} skin
      </span>
    </span>
  )
}

/**
 * What family profiles are, for a plan without them, and an honest way to Pro: a
 * waitlist while checkout is not switched on (lib/billing.ts isCheckoutConfigured).
 */
function FamilyOffer({ onSeePro }: { onSeePro: () => void }) {
  const waitlist = !isCheckoutConfigured()
  return (
    <div className="mt-1 rounded-[10px] border-[0.5px] border-brand/30 bg-[linear-gradient(180deg,rgba(249,115,22,0.09),rgba(249,115,22,0.03))] px-3 py-2.5">
      <p className="text-[13px] font-semibold text-ink">Family profiles come with Pro</p>
      <p className="mt-1 text-[12px] leading-[1.45] text-ink-2">
        Plan for up to {TIER_LIMITS.paid.profiles} people and pets, each with their own skin type,
        and plan a family day around whoever burns fastest.
        {waitlist && ' Pro is not on sale yet: join the waitlist to hear when it opens.'}
      </p>
      <button type="button" className="btn mt-2 text-[12px]" onClick={onSeePro}>
        {waitlist ? 'Join the Pro waitlist' : 'See Pro'}
      </button>
    </div>
  )
}
