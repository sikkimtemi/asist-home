import type { ConversationLocale } from './conversation-locale'
import type { PinnedFile } from './pinned-file'
import type { SpeechBackend, SpeechMemory } from './platform'
import type { SpeechCatalog, SpeechModelName } from './speech-catalog'

/**
 * The speech recognition models the setting can name. Each runs in speech.cpp's worker from the same GGUF file on
 * every machine, so a setting written on one machine means the same model on another.
 */
export const ASR_MODELS = ['auto', 'qwen3-asr-1.7b', 'qwen3-asr-0.6b', 'parakeet-tdt_ctc-0.6b-ja', 'reazonspeech-nemo-v2', 'parakeet-tdt-0.6b-v3', 'haas-ja-v1.0'] as const

export type AsrModel = (typeof ASR_MODELS)[number]
export type ResolvedAsrModel = Exclude<AsrModel, 'auto'>

/** A speech recognition model for speech.cpp, whose one file holds the whole model. */
export interface AsrModelSpec {
  label: string
  /** The family of speech.cpp that runs the file, the `architecture` of its model information, under which its worker logs. */
  family: 'qwen3-asr' | 'fastconformer'
  /** The model's name in speech.cpp's catalog, which pins its file. */
  model: SpeechModelName
  /**
   * The languages the model recognizes, as the BCP 47 tags of the `languages` of the file's model information. The
   * worker refuses a request in any other language.
   */
  languages: readonly string[]
}

/** The languages of both sizes of Qwen3-ASR, which a forced language steers the model toward. */
const QWEN3_ASR_LANGUAGES = ['ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fil', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'mk', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'vi', 'yue', 'zh']

/**
 * The models in the order the screens list them, using the weight types of the bundled catalog. FastConformer
 * takes a language only to check it. On an Apple M5 with Metal and speech.cpp 0.7.1, through ASIST's worker client with
 * the language forced (2026-10-07), Qwen3-ASR 1.7B took 0.62 to 0.74 s for a FLEURS utterance of 10.5 s and 2.1 to
 * 2.6 s for one of 25.5 s, in 2.5 GB; 0.6B took 0.27 to 0.31 s and 0.87 to 1.01 s, in 1.1 GB. For the first 20 s of
 * the 25.5 s one, the longest utterance ASIST sends, parakeet-tdt_ctc-0.6b-ja took 0.24 s and ReazonSpeech 0.36 to
 * 0.46 s, and parakeet-tdt-0.6b-v3 0.25 s for 20 s of English, each in 1.3 GB after it. On the 4,483 clips of Common
 * Voice 8.0 Japanese, read sentences, the characters each model got wrong, accepted spellings allowed, were 4.5% for
 * Qwen3-ASR 1.7B, 6.9% for 0.6B, 2.8% for parakeet-tdt_ctc-0.6b-ja and 4.3% for ReazonSpeech (speech.cpp 0.7.0, RTX
 * 2080, 2026-10-07).
 */
export const ASR_MODEL_SPECS: Readonly<Record<ResolvedAsrModel, AsrModelSpec>> = {
  'qwen3-asr-1.7b': {
    label: 'Qwen3-ASR 1.7B',
    family: 'qwen3-asr',
    model: 'qwen3-asr-1.7b',
    languages: QWEN3_ASR_LANGUAGES
  },
  'qwen3-asr-0.6b': {
    label: 'Qwen3-ASR 0.6B',
    family: 'qwen3-asr',
    model: 'qwen3-asr-0.6b',
    languages: QWEN3_ASR_LANGUAGES
  },
  'parakeet-tdt_ctc-0.6b-ja': {
    label: 'parakeet-tdt_ctc-0.6b-ja',
    family: 'fastconformer',
    model: 'parakeet-tdt_ctc-0.6b-ja',
    languages: ['ja']
  },
  'reazonspeech-nemo-v2': {
    label: 'ReazonSpeech NeMo v2',
    family: 'fastconformer',
    model: 'reazonspeech-v2',
    languages: ['ja']
  },
  'parakeet-tdt-0.6b-v3': {
    label: 'parakeet-tdt-0.6b-v3',
    family: 'fastconformer',
    model: 'parakeet-tdt-0.6b-v3',
    languages: ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk']
  },
  'haas-ja-v1.0': {
    label: 'Haas-ja-v1.0',
    family: 'fastconformer',
    model: 'haas-ja-v1.0',
    languages: ['ja']
  }
}

/** The files a model needs, as the catalog pins them. */
export const asrModelFiles = (spec: AsrModelSpec, catalog: SpeechCatalog): PinnedFile[] => [catalog[spec.model]]

/** Which of the two models is recommended, the larger one or the one that fits less memory. */
export type AsrRecommendationSize = 'larger' | 'smaller'

/** The model `auto` stands for at each size of the recommendation. */
const AUTOMATIC_MODELS: Readonly<Record<AsrRecommendationSize, ResolvedAsrModel>> = { larger: 'qwen3-asr-1.7b', smaller: 'qwen3-asr-0.6b' }

/**
 * The memory from which 1.7B is recommended, in GB as the capabilities give it. On a Mac the models share
 * the memory with every other app, so 1.7B waits for 16 GB; on Windows it is the GPU's own, which 1.7B
 * fits from 6 GB beside the desktop.
 */
const LARGER_FROM_GB: Readonly<Record<SpeechBackend, number>> = { metal: 16, vulkan: 6 }

/** The model's files together, in GB of 10^9 bytes. */
export const asrModelSizeGb = (spec: AsrModelSpec, catalog: SpeechCatalog): number =>
  Math.round(asrModelFiles(spec, catalog).reduce((sum, file) => sum + file.bytes, 0) / 1e7) / 100

/** What preparing a model downloads, in GB of 10^9 bytes: nothing once it is installed. */
export function asrDownloadGb(spec: AsrModelSpec, catalog: SpeechCatalog, modelInstalled: boolean): number {
  return modelInstalled ? 0 : asrModelSizeGb(spec, catalog)
}

export interface AsrHardwareRecommendation {
  totalMemoryGb: number
  recommendedModel: ResolvedAsrModel
}

export function isAsrModel(value: unknown): value is AsrModel {
  return typeof value === 'string' && (ASR_MODELS as readonly string[]).includes(value)
}

/** Every model the setting can name, whatever the conversation language, in the order the screens list them. */
export const offeredAsrModels = (): ResolvedAsrModel[] => Object.keys(ASR_MODEL_SPECS) as ResolvedAsrModel[]

export const asrModelSpec = (model: ResolvedAsrModel): AsrModelSpec => ASR_MODEL_SPECS[model]

/**
 * Whether the model a setting names recognizes the conversation language, as its `languages` list it. `auto`
 * recognizes a language when every model it can stand for does.
 */
export function asrModelRecognizes(locale: ConversationLocale, model: AsrModel): boolean {
  const models = model === 'auto' ? Object.values(AUTOMATIC_MODELS) : [model]
  return models.every((one) => ASR_MODEL_SPECS[one].languages.includes(asrLanguage(locale)))
}

/** Which model a backend recommends for this much memory: the Mac's for metal, the GPU's for vulkan. */
export const asrRecommendationSize = (backend: SpeechBackend, totalMemoryGb: number, memoryType: SpeechMemory = backend === 'metal' ? 'shared' : 'dedicated'): AsrRecommendationSize =>
  !(backend === 'vulkan' && memoryType === 'shared') && totalMemoryGb >= LARGER_FROM_GB[backend] ? 'larger' : 'smaller'

/** The model for a machine whose local speech has this much memory. */
export function recommendAsrModel(backend: SpeechBackend, totalMemoryGb: number, memoryType: SpeechMemory = backend === 'metal' ? 'shared' : 'dedicated'): AsrHardwareRecommendation {
  return { totalMemoryGb, recommendedModel: AUTOMATIC_MODELS[asrRecommendationSize(backend, totalMemoryGb, memoryType)] }
}

/** The model a setting stands for: `auto` is the recommendation, any other value that model. */
export function resolveAsrModel(selected: AsrModel, recommendation: AsrHardwareRecommendation): ResolvedAsrModel {
  return selected === 'auto' ? recommendation.recommendedModel : selected
}

/** A model the screens let the user choose, with what preparing it downloads. */
export interface AsrModelChoice {
  id: ResolvedAsrModel
  label: string
  sizeGb: number
}

/** The models to choose from for a conversation language: those that recognize it. */
export function asrModelChoices(locale: ConversationLocale, catalog: SpeechCatalog): AsrModelChoice[] {
  return offeredAsrModels()
    .filter((id) => asrModelRecognizes(locale, id))
    .map((id) => ({ id, label: ASR_MODEL_SPECS[id].label, sizeGb: asrModelSizeGb(ASR_MODEL_SPECS[id], catalog) }))
}

/** The English name of the conversation language, which Whisper in the browser takes in lower case. */
const WHISPER_LANGUAGE_NAMES: Record<ConversationLocale, string> = {
  'ja-JP': 'Japanese',
  'en-US': 'English',
  'fr-FR': 'French',
  'de-DE': 'German',
  'hi-IN': 'Hindi',
  'id-ID': 'Indonesian',
  'it-IT': 'Italian',
  'ko-KR': 'Korean',
  'pt-BR': 'Portuguese',
  'es-419': 'Spanish',
  'es-ES': 'Spanish'
}

/** Transformers.js takes the language of a Whisper transcription as the English name in lower case. */
export const whisperLanguageName = (locale: ConversationLocale): string => WHISPER_LANGUAGE_NAMES[locale].toLowerCase()

/**
 * The language a model is told to transcribe in, as the BCP 47 tag of speech.cpp's `language` option: the language
 * of the locale without its region, as the models' languages list it. speech.cpp turns it into the start of Qwen3-ASR's
 * answer, as the official implementation does, which steers the model toward that language. The FastConformer
 * models have no input for a language, and the worker only checks it against theirs.
 */
export const asrLanguage = (locale: ConversationLocale): string => new Intl.Locale(locale).language
