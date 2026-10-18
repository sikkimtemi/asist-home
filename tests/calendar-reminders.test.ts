import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '@shared/calendar'
import { CALENDAR_REMINDERS_FORMAT, CalendarReminderManager, DEFAULT_CALENDAR_REMINDERS, EMPTY_CALENDAR_REMINDER_STATE, remainingCalendarEvents, type CalendarReminderState } from '@shared/calendar-reminders'

const at = (hour: number, minute = 0): number => new Date(2026, 9, 18, hour, minute).getTime()
const event = (id: string, start: number, patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, calendarId: 'family', calendarTitle: '家族', title: id, start, end: start + 90 * 60000,
  allDay: false, location: '', notes: '', timeZone: 'Asia/Tokyo', revision: 'r1', recurring: false, hasAttendees: false, writable: true, ...patch
})
const a = event('Aの塾', at(17, 30))
const b = event('Bの塾', at(19, 30))

function setup(initial: CalendarReminderState = structuredClone(EMPTY_CALENDAR_REMINDER_STATE)) {
  let now = at(16)
  let saved = structuredClone(initial)
  let idle = true
  const dispatch = vi.fn()
  const save = vi.fn((value: CalendarReminderState) => { saved = structuredClone(value) })
  const create = (): CalendarReminderManager => new CalendarReminderManager({
    load: () => structuredClone(saved), save, dispatch, canDispatch: () => idle, changed: vi.fn(), now: () => now
  })
  const manager = create()
  const snapshot = (events = [a, b], account = 'family@example.com', leadMinutes = 30): void => {
    manager.replaceSnapshot(account, events, { ...DEFAULT_CALENDAR_REMINDERS, enabled: true, leadMinutes })
  }
  return { manager, dispatch, save, create, snapshot, saved: () => saved, time: (value: number) => { now = value }, busy: (value: boolean) => { idle = !value } }
}

describe('scheduled calendar announcements', () => {
  it('announces both remaining events at 17:00 and only B at 19:00', () => {
    const f = setup()
    f.snapshot()
    f.time(at(17))
    f.manager.tick()
    expect(f.dispatch.mock.calls[0]).toEqual([[a, b], at(17)])
    f.time(at(19))
    f.manager.tick()
    expect(f.dispatch.mock.calls[1]).toEqual([[b], at(19)])
  })

  it('does not treat mentioning a later event as delivering that event reminder', () => {
    const f = setup()
    f.snapshot()
    f.time(at(17))
    f.manager.tick()
    expect(f.saved().receipts.map((receipt) => receipt.status)).toEqual(['dispatched', 'scheduled'])
    f.manager.tick()
    f.snapshot()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
  })

  it('persists the claim before sending and never sends it again after a restart', () => {
    const f = setup()
    f.dispatch.mockImplementation(() => expect(f.saved().receipts[0].status).toBe('dispatched'))
    f.snapshot()
    f.time(at(17))
    f.manager.tick()
    const restarted = f.create()
    restarted.replaceSnapshot('family@example.com', [a, b], { ...DEFAULT_CALENDAR_REMINDERS, enabled: true })
    expect(f.dispatch).toHaveBeenCalledTimes(1)
  })

  it('keeps an uncertain dispatch claimed even when delivery throws', () => {
    const f = setup()
    f.snapshot()
    f.dispatch.mockImplementation(() => { throw new Error('process stopped') })
    f.time(at(17))
    expect(() => f.manager.tick()).toThrow('process stopped')
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
  })

  it('sends nothing if saving a claim fails and retries only after storage recovers', () => {
    const f = setup()
    f.snapshot()
    f.save.mockImplementationOnce(() => { throw new Error('disk full') })
    f.time(at(17))
    expect(() => f.manager.tick()).toThrow('disk full')
    expect(f.dispatch).not.toHaveBeenCalled()
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
  })

  it('records missed reminders while minimized and only shows a generic missed state on restore', () => {
    const f = setup()
    f.snapshot()
    f.manager.setAway(true)
    f.time(at(17))
    f.manager.setAway(false)
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.manager.missed).toBe(true)
    expect(f.saved().receipts[0].status).toBe('missed')
    f.manager.acknowledgeMissed()
    expect(f.create().missed).toBe(false)
    f.time(at(19))
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledWith([b], at(19))
  })

  it('waits for the real user turn without interrupting it and recalculates the remaining day', () => {
    const f = setup()
    f.snapshot()
    f.busy(true)
    f.time(at(17))
    f.manager.tick()
    expect(f.dispatch).not.toHaveBeenCalled()
    f.time(at(17, 5))
    f.busy(false)
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledWith([a, b], at(17, 5))
  })

  it('does not replay an event first fetched after restore when its deadline occurred while hidden', () => {
    const f = setup()
    f.snapshot([])
    f.manager.setAway(true)
    f.time(at(17, 5))
    f.manager.setAway(false)
    f.snapshot([a, b])
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.manager.missed).toBe(true)
    expect(f.saved().receipts[0].status).toBe('missed')
  })

  it('shows a missed notice for an event first fetched after it already ended while minimized', () => {
    const f = setup()
    f.snapshot([])
    f.manager.setAway(true)
    f.time(at(20))
    f.manager.setAway(false)
    f.snapshot([a])
    expect(f.manager.missed).toBe(true)
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it('keeps the restored presence after a failed disk write instead of suppressing later reminders', () => {
    const f = setup()
    f.snapshot()
    f.manager.setAway(true)
    f.time(at(17))
    f.save.mockImplementationOnce(() => { throw new Error('disk unavailable') })
    expect(() => f.manager.setAway(false)).toThrow('disk unavailable')
    f.manager.tick()
    f.time(at(19))
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith([b], at(19))
  })

  it('does not read an event that started during a long conversation or sleep', () => {
    const f = setup()
    f.snapshot()
    f.time(at(18))
    f.manager.tick()
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.manager.missed).toBe(true)
  })

  it('coalesces events with the same notification time into one announcement', () => {
    const f = setup()
    const c = event('Cの塾', a.start)
    f.snapshot([a, c, b])
    f.time(at(17))
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith([a, c, b], at(17))
    expect(f.saved().receipts.filter((receipt) => receipt.status === 'dispatched')).toHaveLength(2)
  })

  it('replaces changed event times and cancels deleted events', () => {
    const f = setup()
    f.snapshot()
    const moved = { ...a, start: at(18), end: at(19) }
    f.snapshot([moved])
    f.time(at(17))
    f.manager.tick()
    expect(f.dispatch).not.toHaveBeenCalled()
    f.time(at(17, 30))
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith([moved], at(17, 30))
    f.time(at(19))
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(1)
  })

  it('isolates accounts, repeat occurrences and the configured lead time', () => {
    const f = setup()
    f.snapshot([a])
    f.time(at(17))
    f.manager.tick()
    f.snapshot([a], 'other@example.com')
    f.snapshot([a], 'other@example.com', 60)
    expect(f.dispatch).toHaveBeenCalledTimes(3)
    const next = event('repeat-next', at(19, 30), { recurring: true })
    f.snapshot([next], 'other@example.com')
    f.time(at(19))
    f.manager.tick()
    expect(f.dispatch).toHaveBeenCalledTimes(4)
  })

  it('stops all dispatch while a snapshot is unavailable or integration is disabled', () => {
    const f = setup()
    f.snapshot()
    f.manager.clearSnapshot()
    f.time(at(17))
    f.manager.tick()
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it('filters past, all-day and tomorrow events using local calendar days', () => {
    expect(remainingCalendarEvents([b, a, event('past', at(16)), event('all-day', at(20), { allDay: true }), event('tomorrow', at(24))], at(17))).toEqual([a, b])
    expect(remainingCalendarEvents([event('midnight', at(24)), event('late', at(23, 59))], at(23, 58)).map((one) => one.id)).toEqual(['late'])
  })

  it('rejects invalid or duplicate saved state instead of silently resetting it', () => {
    expect(() => CALENDAR_REMINDERS_FORMAT.parse({ receipts: [], missed: 'no' })).toThrow()
    const receipt = { key: 'one', startsAt: at(17), dueAt: at(16, 30), status: 'dispatched' }
    expect(() => CALENDAR_REMINDERS_FORMAT.parse({ receipts: [receipt, receipt], missed: false })).toThrow()
    const f = setup()
    f.snapshot()
    expect(CALENDAR_REMINDERS_FORMAT.parse(f.saved())).toEqual(f.saved())
  })
})
