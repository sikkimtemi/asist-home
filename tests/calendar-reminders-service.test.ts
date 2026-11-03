import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '@shared/calendar'

const mocks = vi.hoisted(() => ({
  folder: '',
  settings: { calendar: { enabled: true, readCalendarIds: ['family'], writeCalendarId: null }, calendarReminders: { enabled: true, leadMinutes: 30, pollSeconds: 1800 } },
  status: vi.fn(), list: vi.fn(), dispatch: vi.fn(), owner: false,
  scheduler: { activeTurnId: null as number | null },
  quit: null as (() => void) | null,
  resume: null as (() => void) | null
}))
vi.mock('electron', () => ({ app: { once: (_: string, callback: () => void) => { mocks.quit = callback } }, powerMonitor: { on: (_: string, callback: () => void) => { mocks.resume = callback } } }))
vi.mock('../src/main/services/store', () => ({ dataPath: (name: string) => path.join(mocks.folder, name) }))
vi.mock('../src/main/services/settings', () => ({ getSettings: () => mocks.settings }))
vi.mock('../src/main/services/calendar', () => ({ calendarStatus: mocks.status, listCalendar: mocks.list }))
vi.mock('../src/main/services/brain/session', () => ({ turnScheduler: mocks.scheduler, conversationOwner: () => mocks.owner ? {} : null }))
vi.mock('../src/main/services/brain/calendar-reminder', () => ({ dispatchCalendarReminder: mocks.dispatch }))

const at = (hour: number, minute = 0): number => new Date(2026, 9, 18, hour, minute).getTime()
const a: CalendarEvent = { id: 'a', title: 'Aの塾', calendarId: 'family', calendarTitle: '家族', start: at(17, 30), end: at(19), allDay: false, timeZone: 'Asia/Tokyo', location: '', notes: '', revision: 'r1', recurring: false, hasAttendees: false, writable: true }
const b: CalendarEvent = { ...a, id: 'b', title: 'Bの塾', start: at(19, 30), end: at(21, 30) }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(at(16, 59))
  mocks.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'asist-reminders-'))
  mocks.settings = { calendar: { enabled: true, readCalendarIds: ['family'], writeCalendarId: null }, calendarReminders: { enabled: true, leadMinutes: 30, pollSeconds: 1800 } }
  mocks.status.mockResolvedValue({ signIn: 'signedIn', account: 'me@example.com', calendars: [] })
  mocks.list.mockResolvedValue([a, b])
  mocks.scheduler.activeTurnId = null
  mocks.owner = false
  mocks.quit = null
  mocks.resume = null
})
afterEach(() => {
  mocks.quit?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(mocks.folder, { recursive: true, force: true })
})

describe('calendar reminder integration', () => {
  it('delivers at the deadline even with a 30-minute polling interval', async () => {
    const service = await import('../src/main/services/calendar-reminders')
    service.startCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith([a, b], at(17))
    await vi.advanceTimersByTimeAsync(29 * 60000)
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not fetch anything unless both integration and reminders are enabled', async () => {
    mocks.settings.calendarReminders.enabled = false
    const service = await import('../src/main/services/calendar-reminders')
    service.startCalendarReminders()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.list).not.toHaveBeenCalled()
    mocks.settings.calendarReminders.enabled = true
    service.refreshCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    mocks.settings.calendar.enabled = false
    service.refreshCalendarReminders()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
  })

  it('invalidates a stale request when settings change while fetching', async () => {
    let resolve!: (events: CalendarEvent[]) => void
    mocks.list.mockImplementationOnce(() => new Promise<CalendarEvent[]>((done) => { resolve = done }))
    const service = await import('../src/main/services/calendar-reminders')
    service.startCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    mocks.settings.calendarReminders.enabled = false
    service.refreshCalendarReminders()
    resolve([a, b])
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('keeps missed delivery durable while hidden and never replays it when restored', async () => {
    const service = await import('../src/main/services/calendar-reminders')
    const presence = await import('../src/main/services/window-presence')
    service.startCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    presence.setWindowAway(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(service.calendarReminderStatus().missed).toBe(true)
    presence.setWindowAway(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    service.acknowledgeMissedCalendarReminders()
    expect(JSON.parse(fs.readFileSync(path.join(mocks.folder, 'calendar-reminders.json'), 'utf8')).missed).toBe(false)
  })

  it('surfaces sync failures, pauses stale schedules, and recovers at the next fetch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = await import('../src/main/services/calendar-reminders')
    service.startCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    mocks.list.mockRejectedValueOnce(new Error('network unavailable'))
    service.refreshCalendarReminders()
    await vi.advanceTimersByTimeAsync(60000)
    expect(service.calendarReminderStatus().error).toContain('network unavailable')
    expect(mocks.dispatch).not.toHaveBeenCalled()
    service.refreshCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.calendarReminderStatus().error).toBeNull()
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite corrupt or future persistence and does not start polling', async () => {
    const source = '{"version":999,"receipts":[],"missed":false}'
    fs.writeFileSync(path.join(mocks.folder, 'calendar-reminders.json'), source)
    const service = await import('../src/main/services/calendar-reminders')
    expect(() => service.startCalendarReminders()).toThrow()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.status).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(mocks.folder, 'calendar-reminders.json'), 'utf8')).toBe(source)
  })

  it('refreshes immediately on resume and recomputes elapsed deadlines', async () => {
    const service = await import('../src/main/services/calendar-reminders')
    service.startCalendarReminders()
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(at(18))
    mocks.resume!()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(service.calendarReminderStatus().missed).toBe(true)
  })
})
