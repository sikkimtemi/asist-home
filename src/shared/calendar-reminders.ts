import { z } from 'zod'
import type { CalendarEvent } from './calendar'
import type { StoredFormat } from './stored-format'
import { errorText } from './i18n/error-text'

/** Polling is independent of delivery: each fetched event is scheduled against the wall clock. */
export const calendarReminderSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  leadMinutes: z.number().int().min(1).max(1440),
  pollSeconds: z.number().int().min(60).max(86400)
})
export type CalendarReminderSettings = z.infer<typeof calendarReminderSettingsSchema>
/** The development default favors quick validation; daily operation uses a separately configured interval. */
export const DEFAULT_CALENDAR_REMINDERS: CalendarReminderSettings = { enabled: false, leadMinutes: 30, pollSeconds: 60 }

const receiptSchema = z.strictObject({
  key: z.string(),
  startsAt: z.number().finite(),
  dueAt: z.number().finite(),
  status: z.enum(['scheduled', 'dispatched', 'missed'])
})
const stateSchema = z.strictObject({ receipts: z.array(receiptSchema), missed: z.boolean() })
export type CalendarReminderState = z.infer<typeof stateSchema>
/** A missing file has no claims and no pending missed-delivery notice. */
export const EMPTY_CALENDAR_REMINDER_STATE: CalendarReminderState = { receipts: [], missed: false }

/** A claimed delivery is never replayed, including when the process dies before the LLM answers. */
export const CALENDAR_REMINDERS_FORMAT: StoredFormat<CalendarReminderState> = {
  name: 'calendar-reminders.json',
  version: 1,
  upgrades: {},
  parse: (value) => {
    const result = stateSchema.safeParse(value)
    if (!result.success || new Set(result.data.receipts.map((receipt) => receipt.key)).size !== result.data.receipts.length)
      throw new Error(errorText('calendarReminders.errors.invalidState'))
    return result.data
  },
  serialize: (value) => value
}

/** The settings page can explain a failed refresh without exposing the skipped event details on restore. */
export interface CalendarReminderStatus {
  lastSyncedAt: number | null
  error: string | null
  missed: boolean
}

interface ReminderDependencies {
  load: () => CalendarReminderState
  save: (state: CalendarReminderState) => void
  canDispatch: () => boolean
  dispatch: (events: CalendarEvent[], now: number) => void
  changed: () => void
  now?: () => number
}

/** The upcoming timed events on this computer's remaining calendar day, including one starting now. */
export function remainingCalendarEvents(events: CalendarEvent[], now: number): CalendarEvent[] {
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  return events.filter((event) => !event.allDay && event.start >= now && event.start < end.getTime()).sort((a, b) => a.start - b.start)
}

/** Owns durable claims and missed deliveries; callers supply polling and the conversation's idle state. */
export class CalendarReminderManager {
  private state: CalendarReminderState | null = null
  private events: CalendarEvent[] = []
  private account = ''
  private settings = DEFAULT_CALENDAR_REMINDERS
  private away = false
  private awaySince: number | null = null
  private awayPeriods: Array<{ from: number; until: number }> = []
  private readonly now: () => number

  constructor(private readonly deps: ReminderDependencies) {
    this.now = deps.now ?? Date.now
  }

  initialize(): void {
    if (!this.state) this.state = this.deps.load()
  }

  get missed(): boolean {
    this.initialize()
    return this.state!.missed
  }

  acknowledgeMissed(): void {
    this.initialize()
    if (this.state!.missed) this.commit({ ...this.state!, missed: false })
  }

  clearSnapshot(): void {
    this.events = []
    this.account = ''
  }

  replaceSnapshot(account: string, events: CalendarEvent[], settings: CalendarReminderSettings): void {
    this.initialize()
    const now = this.now()
    const receipts = this.state!.receipts.filter((receipt) => receipt.startsAt >= now - 90 * 86400000)
    for (const event of events) {
      const key = this.key(account, event, settings)
      const dueAt = event.start - settings.leadMinutes * 60000
      if (!event.allDay && (event.start >= now || this.wasAwayAt(dueAt)) && !receipts.some((receipt) => receipt.key === key)) {
        receipts.push({ key, startsAt: event.start, dueAt, status: 'scheduled' })
      }
    }
    this.commit({ ...this.state!, receipts })
    this.account = account
    this.settings = settings
    this.events = events
    this.tick()
  }

  setAway(away: boolean): void {
    const now = this.now()
    if (away && !this.away) this.awaySince = now
    if (!away && this.away) {
      this.awayPeriods = this.awayPeriods.filter((period) => period.until >= now - 90 * 86400000)
      this.awayPeriods.push({ from: this.awaySince!, until: now })
      this.awaySince = null
    }
    this.away = away
    try {
      this.tick()
    } finally {
      this.deps.changed()
    }
  }

  tick(): void {
    if (!this.state || !this.account) return
    const now = this.now()
    const end = new Date(now)
    end.setHours(24, 0, 0, 0)
    const keys = new Set(this.events.filter((event) => !event.allDay).map((event) => this.key(this.account, event, this.settings)))
    const due = this.state.receipts.filter((receipt) => keys.has(receipt.key) && receipt.status === 'scheduled' && receipt.dueAt <= now && receipt.startsAt < end.getTime())
    if (!due.length) return
    // A refresh may first discover an event after restore whose reminder fell due while hidden.
    const missed = due.filter((receipt) => this.away || receipt.startsAt < now || this.wasAwayAt(receipt.dueAt))
    const deliver = due.filter((receipt) => !missed.includes(receipt))
    const dispatch = deliver.length > 0 && this.deps.canDispatch()
    if (!missed.length && !dispatch) return
    const missedKeys = new Set(missed.map((receipt) => receipt.key))
    const dispatchKeys = new Set(dispatch ? deliver.map((receipt) => receipt.key) : [])
    this.commit({
      missed: this.state.missed || missed.length > 0,
      receipts: this.state.receipts.map((receipt) => missedKeys.has(receipt.key)
        ? { ...receipt, status: 'missed' }
        : dispatchKeys.has(receipt.key) ? { ...receipt, status: 'dispatched' } : receipt)
    })
    // Saving happens before dispatch. An uncertain outcome must never generate the same input twice.
    if (dispatch) this.deps.dispatch(remainingCalendarEvents(this.events, now), now)
  }

  private key(account: string, event: CalendarEvent, settings: CalendarReminderSettings): string {
    return JSON.stringify([account, event.id, event.start, settings.leadMinutes])
  }

  private wasAwayAt(at: number): boolean {
    return (this.awaySince !== null && at >= this.awaySince && at <= this.now()) || this.awayPeriods.some((period) => at >= period.from && at <= period.until)
  }

  private commit(next: CalendarReminderState): void {
    this.deps.save(next)
    this.state = next
    this.deps.changed()
  }
}
