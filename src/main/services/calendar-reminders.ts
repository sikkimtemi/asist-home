import { app, powerMonitor } from 'electron'
import fs from 'node:fs'
import mitt from 'mitt'
import { CALENDAR_REMINDERS_FORMAT, CalendarReminderManager, EMPTY_CALENDAR_REMINDER_STATE, type CalendarReminderState, type CalendarReminderStatus } from '@shared/calendar-reminders'
import { storedContent } from '@shared/stored-format'
import { errorText } from '@shared/i18n/error-text'
import { errMessage } from '@shared/api-errors'
import { calendarStatus, listCalendar } from './calendar'
import { getSettings } from './settings'
import { dataPath } from './store'
import { openStoredFileSync } from './stored-file'
import { writeJsonFileAtomicSync } from './atomic-json'
import { presenceEvents, windowAway } from './window-presence'
import { conversationOwner, turnScheduler } from './brain/session'
import { dispatchCalendarReminder } from './brain/calendar-reminder'

export const calendarReminderEvents = mitt<{ changed: CalendarReminderStatus }>()
let started = false
let loaded = false
let lastSyncedAt: number | null = null
let error: string | null = null
let generation = 0
let polling: ReturnType<typeof setTimeout> | undefined
let ticking: ReturnType<typeof setInterval> | undefined
let controller: AbortController | null = null

const publish = (): void => calendarReminderEvents.emit('changed', calendarReminderStatus())
const file = (): string => dataPath(CALENDAR_REMINDERS_FORMAT.name)

/** Only a missing file is a fresh state; invalid or inaccessible files must never be overwritten. */
function load(): CalendarReminderState {
  try {
    return openStoredFileSync(file(), JSON.parse(fs.readFileSync(file(), 'utf8')), CALENDAR_REMINDERS_FORMAT)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_CALENDAR_REMINDER_STATE)
    throw new Error(errorText('calendarReminders.errors.readState'), { cause })
  }
}

const manager = new CalendarReminderManager({
  load,
  save: (state) => writeJsonFileAtomicSync(file(), storedContent(CALENDAR_REMINDERS_FORMAT, state)),
  canDispatch: () => turnScheduler.activeTurnId === null && conversationOwner() === null,
  dispatch: dispatchCalendarReminder,
  changed: publish
})

export function calendarReminderStatus(): CalendarReminderStatus {
  return { lastSyncedAt, error, missed: loaded && manager.missed }
}

function failed(cause: unknown): void {
  error = errMessage(cause)
  console.error('Calendar reminders failed:', error)
  publish()
}

function tick(): void {
  try {
    manager.tick()
  } catch (cause) {
    failed(cause)
  }
}

/** The page starts this after subscribing to turns, so an automatic input cannot race its initialization. */
export function startCalendarReminders(): CalendarReminderStatus {
  if (started) return calendarReminderStatus()
  manager.initialize()
  loaded = true
  started = true
  manager.setAway(windowAway())
  ticking = setInterval(tick, 1000)
  presenceEvents.on('changed', (away) => {
    try { manager.setAway(away) } catch (cause) { failed(cause) }
  })
  powerMonitor.on('resume', refreshCalendarReminders)
  app.once('will-quit', () => {
    started = false
    generation++
    controller?.abort()
    clearTimeout(polling)
    clearInterval(ticking)
  })
  refreshCalendarReminders()
  return calendarReminderStatus()
}

export function acknowledgeMissedCalendarReminders(): void {
  manager.acknowledgeMissed()
}

/** Configuration changes invalidate an in-flight read before any of its events can be scheduled. */
export function refreshCalendarReminders(): void {
  if (!started) return
  pauseCalendarReminders()
  const settings = getSettings()
  error = null
  publish()
  if (!settings.calendar.enabled || !settings.calendarReminders.enabled) return
  void poll(generation)
}

/** Signing out stops scheduled deliveries before waiting for Google's revocation request. */
export function pauseCalendarReminders(): void {
  generation++
  controller?.abort()
  clearTimeout(polling)
  manager.clearSnapshot()
}

async function poll(current: number): Promise<void> {
  const settings = getSettings()
  controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
  try {
    const status = await calendarStatus()
    signal.throwIfAborted()
    if (status.signIn !== 'signedIn' || !status.account) throw new Error(errorText('calendar.errors.googleSignedOut'))
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(Date.now() + 48 * 3600000)
    const events = await listCalendar({ start: start.toISOString(), end: end.toISOString() }, signal)
    if (current !== generation || signal.aborted) return
    lastSyncedAt = Date.now()
    error = null
    manager.replaceSnapshot(status.account, events, settings.calendarReminders)
    publish()
  } catch (cause) {
    if (current !== generation) return
    manager.clearSnapshot()
    failed(cause)
  } finally {
    if (started && current === generation) polling = setTimeout(() => void poll(current), settings.calendarReminders.pollSeconds * 1000)
  }
}
