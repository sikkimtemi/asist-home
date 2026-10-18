import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/settings'
import type { CalendarReminderSettings as ReminderSettings } from '@shared/calendar-reminders'
import { HoloSwitch } from '@/components/ui/switch'
import { useSettingsStore } from '@/state/stores'
import { useT } from '@/i18n'
import { displayError } from '@/display-error'
import { Group, Row } from './primitives'

/** Calendar delivery uses the same model and voice as the conversation, with a separately adjustable polling interval. */
export function CalendarReminderSettings({ settings }: { settings: AppSettings }): React.JSX.Element {
  const t = useT()
  const save = useSettingsStore((state) => state.save)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reminders = settings.calendarReminders
  useEffect(() => {
    void window.api.calendarReminderStatus().then((status) => setError(status.error ? displayError(status.error) : '')).catch((cause) => setError(displayError(cause)))
    return window.api.onCalendarReminderChanged((status) => setError(status.error ? displayError(status.error) : ''))
  }, [])
  const persist = async (patch: Partial<ReminderSettings>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await save({ calendarReminders: { ...reminders, ...patch } })
    } catch (cause) {
      setError(displayError(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group title={t('calendarReminders.enable')} description={t('calendarReminders.description')}>
      <Row label={t('calendarReminders.enable')}>
        <HoloSwitch aria-label={t('calendarReminders.enable')} checked={reminders.enabled} disabled={busy || (!settings.calendar.enabled && !reminders.enabled)} onCheckedChange={(enabled) => void persist({ enabled })} />
      </Row>
      <ReminderNumber key={'lead-' + reminders.leadMinutes} label={t('calendarReminders.leadMinutes')} value={reminders.leadMinutes} min={1} max={1440} disabled={busy} save={(leadMinutes) => persist({ leadMinutes })} />
      <ReminderNumber key={'poll-' + reminders.pollSeconds} label={t('calendarReminders.pollSeconds')} hint={t('calendarReminders.pollHint')} value={reminders.pollSeconds} min={60} max={86400} disabled={busy} save={(pollSeconds) => persist({ pollSeconds })} />
      {error && <Row label={t('calendarReminders.error')} hint={<span role="alert">{error}</span>} />}
    </Group>
  )
}

function ReminderNumber({ label, hint, value, min, max, disabled, save }: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  disabled: boolean
  save: (value: number) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  return (
    <Row label={label} hint={hint}>
      <input className="st-input" type="number" aria-label={label} min={min} max={max} step={1} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => {
        if (event.target.validity.valid && draft !== '' && Number(draft) !== value) void save(Number(draft))
        else setDraft(String(value))
      }} />
    </Row>
  )
}
