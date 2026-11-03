import { useEffect, useRef } from 'react'
import type { AppSettings, SpeechModelNotice } from '@shared/ipc'
import { osMessageKey } from '@shared/i18n/os-message'
import { localSpeechModelsInUse } from '@shared/local-speech-models'
import { safetyNoticePending } from '@shared/settings'
import { displayError } from '@/display-error'
import { formatLocale, translate } from '@/i18n'
import { platformCapabilities } from '@/platform'
import { speechCatalog } from '@/speech-catalog'
import { prepareAsrModel, prepareTtsModel, usePreparationStore } from '@/state/preparation'
import { useSettingsStore, useToastStore, type Toast } from '@/state/stores'
import { useViewStore } from '@/state/view'

/**
 * Tells, once at launch, about each local speech model the settings use whose files are not on this computer,
 * as after an update that pinned other files. Each one is a toast that stays until it is closed, naming the
 * model and what preparing it downloads. Its button prepares the model as the settings do and opens the voice
 * page, whose row of the model shows the progress. It waits until the notice of the risks, which covers the app,
 * is answered. A launch that opened on the first-run setup asks for nothing: the setup prepares what it chooses.
 *
 * Main records a notice as told when it hands it over, so a notice must not go before its preparation has
 * started: only one preparation runs at a time, and one that is asked for while another runs is not taken.
 * The toast therefore follows the state rather than the press of its button. Its button cannot be pressed
 * while any preparation runs, and the toast goes once the preparation of its model has started, or once the
 * settings no longer use the model it names, whose preparation the button could then no longer start.
 */
export function SpeechModelNotices(): null {
  const settings = useSettingsStore((s) => s.settings)
  const running = usePreparationStore((s) => s.running)
  const asked = useRef<'waiting' | 'asked' | 'setup'>('waiting')
  const shown = useRef<Array<{ toast: number; notice: SpeechModelNotice }>>([])
  useEffect(() => {
    if (!settings || asked.current !== 'waiting') return
    if (settings.onboardingVersion < 1) {
      asked.current = 'setup'
      return
    }
    if (safetyNoticePending(settings)) return
    asked.current = 'asked'
    window.api.speechModelNotices().then(
      (notices) => {
        const { push } = useToastStore.getState()
        for (const notice of notices) shown.current.push({ notice, toast: push(noticeToast(notice)) })
        shown.current = followState(shown.current)
      },
      (error: unknown) => useToastStore.getState().push({ kind: 'error', title: translate('app.status.checkFailed'), body: displayError(error) })
    )
  }, [settings])
  useEffect(() => {
    shown.current = followState(shown.current)
  }, [settings, running])
  return null
}

/** The toast of a notice as the settings and the preparation stand now. */
function noticeToast(notice: SpeechModelNotice): Omit<Toast, 'id'> {
  const settings = useSettingsStore.getState().settings
  const sizeGb = new Intl.NumberFormat(formatLocale(), { maximumFractionDigits: 1 }).format(notice.downloadBytes / 1e9)
  return {
    kind: 'info',
    persistent: true,
    title: translate('settingsModels.notice.title', { model: notice.label }),
    body:
      notice.target === 'tts'
        ? translate(osMessageKey('settingsModels.notice.speech', platformCapabilities().os))
        : translate(settings?.localAsrEnabled ? 'settingsModels.notice.recognitionWhisper' : 'settingsModels.notice.recognition'),
    action: {
      label: translate('settingsModels.notice.prepare', { sizeGb }),
      disabled: usePreparationStore.getState().running !== null,
      keepsToast: true,
      run: () => {
        void (notice.target === 'asr' ? prepareAsrModel() : prepareTtsModel())
        void useViewStore.getState().openApp({ app: 'settings', page: 'voice' })
      }
    }
  }
}

const stillInUse = (notice: SpeechModelNotice, settings: AppSettings | null): boolean =>
  settings !== null &&
  localSpeechModelsInUse(settings, platformCapabilities(), speechCatalog()).some((model) => model.target === notice.target && model.label === notice.label)

/** Brings each toast in line with the state, and returns the notices still shown. */
function followState(shown: Array<{ toast: number; notice: SpeechModelNotice }>): Array<{ toast: number; notice: SpeechModelNotice }> {
  const toasts = useToastStore.getState()
  const { settings } = useSettingsStore.getState()
  const { running } = usePreparationStore.getState()
  return shown.filter(({ toast, notice }) => {
    if (!toasts.toasts.some((one) => one.id === toast)) return false
    if (running?.target === notice.target || !stillInUse(notice, settings)) {
      toasts.remove(toast)
      return false
    }
    toasts.update(toast, noticeToast(notice))
    return true
  })
}
