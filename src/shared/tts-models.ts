import type { TtsEngine } from './ipc'
import type { MessageKey } from './i18n'
import type { PinnedFile } from './pinned-file'
import type { PlatformCapabilities, SpeechBackend } from './platform'
import type { SpeechCatalog, SpeechModelName } from './speech-catalog'

/** The engines whose model ASIST downloads and runs itself, in speech.cpp's worker on the GPU. */
export type LocalTtsEngine = Extract<TtsEngine, 'irodori' | 'qwen3tts'>

export const isLocalTtsEngine = (engine: TtsEngine): engine is LocalTtsEngine => engine === 'irodori' || engine === 'qwen3tts'

/** The sizes of Qwen3-TTS the setting can name. */
export const QWEN_TTS_SIZES = ['0.6b', '1.7b'] as const

export type QwenTtsSize = (typeof QWEN_TTS_SIZES)[number]

/** One size of Qwen3-TTS for speech.cpp, whose one file holds the codec it speaks through. */
export interface QwenTtsModelSpec {
  label: string
  /** The model's name in speech.cpp's catalog, which pins its file. */
  model: SpeechModelName
}

/**
 * The sizes, in Q8_0 on Japanese sentences. On an M5 with Metal and speech.cpp v0.3.0 (2026-10-01), 0.6B
 * speaks its first audio 0.04 s after the request at 0.37 of real time in 1.8 GB, and 1.7B 0.06 s and 0.47
 * in 2.8 GB. On an RTX 2080 with Vulkan, 0.6B took 0.04 s, 0.30 and 1.4 GB of VRAM with speech.cpp v0.3.0
 * (2026-10-01), and 1.7B 0.08 s, 0.36 and 2.7 GB with qwen3-tts-ggml v0.1.1 (2026-09-29). 1.7B makes almost
 * no silence before the voice, which 0.6B makes for up to a second.
 */
export const QWEN_TTS_MODELS: Readonly<Record<QwenTtsSize, QwenTtsModelSpec>> = {
  '0.6b': {
    label: 'Qwen3-TTS 0.6B',
    model: 'qwen3-tts-0.6b'
  },
  '1.7b': {
    label: 'Qwen3-TTS 1.7B',
    model: 'qwen3-tts-1.7b'
  }
}

/**
 * Irodori-TTS v4.1-Small-MF in F16, with the codec it speaks through in the same file. On an M5 with Metal and
 * speech.cpp v0.3.0 (2026-10-01) it speaks a sentence's first audio 0.19 to 0.38 s after the request, later
 * the longer the sentence, at 0.17 of real time in 2.1 GB. It makes the whole sentence before the first audio,
 * while Qwen3-TTS streams it frame by frame.
 */
export const IRODORI_TTS_MODEL = {
  label: 'Irodori-TTS',
  model: 'irodori-tts-mf'
} as const satisfies { label: string; model: SpeechModelName }

/**
 * The voices ASIST ships for Irodori-TTS, each a voice file under resources/irodori-voices made from a
 * reference recording. Irodori-TTS speaks in the voice of a reference and predicts a sentence's length from
 * it, and for 12 of the sixteen references speech-bench made it predicted 1.3 to 3.6 s for "うん。" and filled
 * the time with words of its own. These three read the 39 backchannels of the bank and 10 other short
 * replies five times each, 735 takes, without a word added (Qwen3-ASR 1.7B, 2026-10-01).
 */
export const IRODORI_TTS_VOICES = [
  { id: 'calm-young-woman', gender: 'female', label: 'settingsVoice.speech.irodoriVoices.calmYoungWoman' },
  { id: 'soft-young-woman', gender: 'female', label: 'settingsVoice.speech.irodoriVoices.softYoungWoman' },
  { id: 'energetic-young-man', gender: 'male', label: 'settingsVoice.speech.irodoriVoices.energeticYoungMan' }
] as const satisfies ReadonlyArray<{ id: string; gender: 'female' | 'male'; label: MessageKey }>

export type IrodoriTtsVoice = (typeof IRODORI_TTS_VOICES)[number]['id']

export const IRODORI_TTS_VOICE_IDS = IRODORI_TTS_VOICES.map((voice) => voice.id) as [IrodoriTtsVoice, ...IrodoriTtsVoice[]]

/** The model a local engine runs, as the settings name it: its name in the messages and the files it needs. */
export interface LocalTtsModel {
  label: string
  files: readonly PinnedFile[]
}

export function localTtsModel(engine: LocalTtsEngine, qwenTtsSize: QwenTtsSize, catalog: SpeechCatalog): LocalTtsModel {
  if (engine === 'irodori') return { label: IRODORI_TTS_MODEL.label, files: [catalog[IRODORI_TTS_MODEL.model]] }
  return { label: QWEN_TTS_MODELS[qwenTtsSize].label, files: [catalog[QWEN_TTS_MODELS[qwenTtsSize].model]] }
}

/** The files of a model together, in GB of 10^9 bytes. */
export function localTtsSizeGb(model: LocalTtsModel): number {
  return Math.round(model.files.reduce((sum, file) => sum + file.bytes, 0) / 1e7) / 100
}

/**
 * The memory from which a local engine is offered beside the speech recognition, in GB as the capabilities
 * give it: the Mac's own, which every app shares, and the GPU's on Windows, where 1.7B speech recognition held
 * 7.1 GB of an 8 GB RTX 2080 with Irodori-TTS and 6.4 GB with Qwen3-TTS 0.6B, the desktop's 1.9 GB included
 * (speech.cpp v0.3.0, 2026-10-01), more than a 6 GB GPU has.
 */
const RECOMMENDED_FROM_GB: Readonly<Record<SpeechBackend, number>> = { metal: 16, vulkan: 8 }

/** The memory from which Qwen3-TTS 1.7B is offered too; with 1.7B recognition it took 7.7 GB of the same 8 GB. */
const LARGER_FROM_GB: Readonly<Record<SpeechBackend, number>> = { metal: 24, vulkan: 10 }

/**
 * The preset voices of the pinned model. Every voice can speak every language the model supports;
 * `native` is the BCP 47 tag of the language the voice was recorded in, where it sounds most natural.
 */
export const QWEN_TTS_VOICES = [
  { id: 'ono_anna', name: 'Ono Anna', gender: 'female', native: 'ja' },
  { id: 'ryan', name: 'Ryan', gender: 'male', native: 'en' },
  { id: 'aiden', name: 'Aiden', gender: 'male', native: 'en' },
  { id: 'sohee', name: 'Sohee', gender: 'female', native: 'ko' },
  { id: 'vivian', name: 'Vivian', gender: 'female', native: 'zh' },
  { id: 'serena', name: 'Serena', gender: 'female', native: 'zh' },
  { id: 'uncle_fu', name: 'Uncle Fu', gender: 'male', native: 'zh' },
  { id: 'dylan', name: 'Dylan', gender: 'male', native: 'zh' },
  { id: 'eric', name: 'Eric', gender: 'male', native: 'zh' }
] as const

export type QwenTtsVoice = (typeof QWEN_TTS_VOICES)[number]['id']

export const QWEN_TTS_VOICE_IDS = QWEN_TTS_VOICES.map((voice) => voice.id) as [QwenTtsVoice, ...QwenTtsVoice[]]

/**
 * The languages the model speaks, as the BCP 47 tags the worker lists in `ready` and takes in a request.
 * Hindi and Indonesian are not among them.
 */
const QWEN_TTS_LANGUAGES: readonly string[] = ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'zh']

/** The tag a request names for the language of a locale such as `ja-JP`, or null when the model cannot speak it. */
export function qwenTtsLanguage(locale: string): string | null {
  const language = locale.split('-')[0].toLowerCase()
  return QWEN_TTS_LANGUAGES.includes(language) ? language : null
}

/** Whether this machine can run a local engine at all: wherever the local speech runs. */
export function localTtsRuns(
  localTts: PlatformCapabilities['localTts']
): localTts is Extract<PlatformCapabilities['localTts'], { memoryGb: number }> {
  return localTts.backend !== null
}

/**
 * Whether the engine can run on this machine at all. A saved engine that cannot, such as Qwen3-TTS in
 * settings brought over from a Mac, is treated like one that cannot speak the conversation language:
 * it is not offered, not counted as something to prepare, and reading with it fails with the reason.
 */
export const ttsEngineRuns = (engine: TtsEngine, localTts: PlatformCapabilities['localTts']): boolean =>
  !isLocalTtsEngine(engine) || localTtsRuns(localTts)

/** Whether to offer the local engines: a machine that runs them, with the memory for one beside the speech recognition. */
export function recommendLocalTts(localTts: PlatformCapabilities['localTts']): boolean {
  return localTtsRuns(localTts) && localTts.memoryGb >= RECOMMENDED_FROM_GB[localTts.backend]
}

/** The sizes to choose from on this machine: 0.6B wherever Qwen3-TTS runs, 1.7B where the memory holds it. */
export function offeredQwenTtsSizes(localTts: PlatformCapabilities['localTts']): QwenTtsSize[] {
  if (!localTtsRuns(localTts)) return []
  return localTts.memoryGb >= LARGER_FROM_GB[localTts.backend] ? ['0.6b', '1.7b'] : ['0.6b']
}
