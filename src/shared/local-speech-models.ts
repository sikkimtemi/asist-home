import { asrModelFiles, asrModelSpec, recommendAsrModel, resolveAsrModel } from './asr-models'
import type { PinnedFile } from './pinned-file'
import type { PlatformCapabilities } from './platform'
import type { AppSettings } from './settings'
import type { SpeechCatalog } from './speech-catalog'
import { isLocalTtsEngine, localTtsModel } from './tts-models'
import { isLiveEngine } from './voice-engine'

/** A local speech model the settings put to use, with the files its current pin needs. */
export interface LocalSpeechModelInUse {
  target: 'asr' | 'tts'
  /** The model's name, such as Irodori-TTS or Qwen3-ASR 1.7B, which tells one model from another. */
  label: string
  files: readonly PinnedFile[]
}

/**
 * The local speech models the settings put to use on this machine: under the cascade engine, wherever local
 * speech runs, the speech recognition model the setting stands for, and Irodori-TTS or Qwen3-TTS when the
 * replies are read with it. A live engine listens and speaks by itself and uses neither. Main tells from it
 * which models need preparing, and the page whether a notice still names a model in use.
 */
export function localSpeechModelsInUse(
  settings: Pick<AppSettings, 'voiceEngine' | 'ttsEngine' | 'qwenTtsSize' | 'asrModel'>,
  capabilities: PlatformCapabilities,
  catalog: SpeechCatalog
): LocalSpeechModelInUse[] {
  if (isLiveEngine(settings.voiceEngine)) return []
  const { localAsr, localTts } = capabilities
  const used: LocalSpeechModelInUse[] = []
  if (localAsr.backend !== null) {
    const recognition = asrModelSpec(resolveAsrModel(settings.asrModel, recommendAsrModel(localAsr.backend, localAsr.memoryGb, localAsr.memoryType)))
    used.push({ target: 'asr', label: recognition.label, files: asrModelFiles(recognition, catalog) })
  }
  if (localTts.backend !== null && isLocalTtsEngine(settings.ttsEngine)) {
    const { label, files } = localTtsModel(settings.ttsEngine, settings.qwenTtsSize, catalog)
    used.push({ target: 'tts', label, files })
  }
  return used
}
