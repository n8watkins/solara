'use client'

import { useState } from 'react'
import { UserPreferences, SkinType, Activity } from '@/lib/types'
import { DEFAULT_ACTIVITIES } from '@/lib/weather'

interface Props {
  prefs: UserPreferences
  onSave: (updated: UserPreferences) => void
  onClose: () => void
}

const SKIN_OPTIONS: { value: SkinType; label: string }[] = [
  { value: 'very-fair', label: 'Very fair' },
  { value: 'fair',      label: 'Fair' },
  { value: 'medium',    label: 'Medium' },
  { value: 'olive',     label: 'Olive' },
  { value: 'dark',      label: 'Dark' },
]

export default function PreferencesModal({ prefs, onSave, onClose }: Props) {
  const [skinType, setSkinType]   = useState<SkinType>(prefs.skinType)
  const [sunscreen, setSunscreen] = useState(prefs.sunscreen)
  const [activities, setActivities] = useState<Activity[]>(
    prefs.activities.length ? prefs.activities : DEFAULT_ACTIVITIES
  )

  function updateDuration(id: string, mins: number) {
    setActivities(prev =>
      prev.map(a => a.id === id ? { ...a, durationMins: Math.max(5, mins) } : a)
    )
  }

  function handleSave() {
    onSave({ ...prefs, skinType, sunscreen, activities })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Preferences</h2>
          <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={onClose}>×</button>
        </div>

        <div className="mb-5">
          <p className="text-sm font-medium text-gray-700 mb-2">Skin type</p>
          <div className="flex flex-wrap gap-2">
            {SKIN_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setSkinType(o.value)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${
                  skinType === o.value
                    ? 'border-orange-400 bg-orange-50 text-orange-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <p className="text-sm font-medium text-gray-700 mb-2">Sunscreen preference</p>
          <div className="flex gap-2">
            {[false, true].map(val => (
              <button
                key={String(val)}
                onClick={() => setSunscreen(val)}
                className={`flex-1 py-2 rounded-xl border text-sm transition-all ${
                  sunscreen === val
                    ? 'border-orange-400 bg-orange-50 text-orange-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {val ? 'Wear SPF 30+' : 'No sunscreen'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">Activity durations</p>
          <div className="space-y-2">
            {activities.map(a => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-base w-6">{a.icon}</span>
                <span className="text-sm text-gray-700 flex-1">{a.name}</span>
                <div className="flex items-center gap-1">
                  <button
                    className="w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm"
                    onClick={() => updateDuration(a.id, a.durationMins - 15)}
                  >−</button>
                  <span className="text-sm text-gray-900 w-14 text-center">
                    {a.durationMins < 60 ? `${a.durationMins}m` : `${a.durationMins / 60}h`}
                  </span>
                  <button
                    className="w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm"
                    onClick={() => updateDuration(a.id, a.durationMins + 15)}
                  >+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn flex-1 justify-center" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
