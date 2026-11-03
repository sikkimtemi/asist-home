import { ASR_MODEL_SPECS, offeredAsrModels, type ResolvedAsrModel } from './asr-models'
import type { MessageKey } from './i18n'
import type { SpeechCatalog } from './speech-catalog'
import { IRODORI_TTS_MODEL, QWEN_TTS_MODELS } from './tts-models'

/** The groups of the credits, in the order the about page shows them. */
export type CreditGroup = 'local' | 'api' | 'data' | 'bundled' | 'software'

/**
 * One model, service or data source ASIST uses. The name, the provider, the license and the address
 * are written as their owners write them, so they stay the same in every language; what ASIST uses it
 * for is a sentence of the dictionary.
 */
export interface Credit {
  readonly id: string
  readonly group: CreditGroup
  readonly name: string
  readonly provider: string
  /** Null where the provider publishes terms of its own instead of a named license. */
  readonly license: string | null
  readonly url: string
  /** Wording the terms require to be shown as written. It stands in for the provider's name as the text of the link. */
  readonly notice?: string
}

/**
 * ExchangeRate-API asks for this exact sentence linking to their site, and the Japan Meteorological
 * Agency asks for its name and for a note that the values are processed, which the `use` sentence of
 * `jma` carries. Open-Meteo and Mimi are Creative Commons and need the license named beside the
 * source.
 */
export const CREDITS = [
  {
    id: 'asrWhisperOnnx',
    group: 'local',
    name: 'Whisper small (ONNX)',
    provider: 'OpenAI',
    license: 'MIT',
    url: 'https://huggingface.co/onnx-community/whisper-small'
  },
  {
    id: 'vad',
    group: 'local',
    name: 'Silero VAD',
    provider: 'Silero Team',
    license: 'MIT',
    url: 'https://github.com/snakers4/silero-vad'
  },
  {
    id: 'denoiser',
    group: 'local',
    name: 'DeepFilterNet3',
    provider: 'Rikorose',
    license: 'MIT, Apache-2.0',
    url: 'https://github.com/Rikorose/DeepFilterNet'
  },
  {
    id: 'dacvae',
    group: 'local',
    name: 'DACVAE (dacvae-watermarked)',
    provider: 'Meta',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/facebook/dacvae-watermarked'
  },
  {
    id: 'maai',
    group: 'local',
    name: 'MaAI (vap_jp_kyoto, bc_det_jp, vap_bc_2type_jp, vap_nod_jp)',
    provider: 'Kyoto University MaAI team',
    license: 'MIT',
    url: 'https://huggingface.co/maai-kyoto'
  },
  {
    id: 'mimi',
    group: 'local',
    name: 'Mimi',
    provider: 'Kyutai',
    license: 'CC BY 4.0',
    url: 'https://huggingface.co/kyutai/mimi'
  },
  {
    id: 'cpc',
    group: 'local',
    name: 'CPC_audio',
    provider: 'Meta AI Research',
    license: 'MIT',
    url: 'https://github.com/facebookresearch/CPC_audio'
  },
  {
    id: 'aizuchi',
    group: 'local',
    name: 'modernbert-ja-70m-aizuchi',
    provider: 'Sakasegawa, SB Intuitions',
    license: 'MIT',
    url: 'https://huggingface.co/sakasegawa/modernbert-ja-70m-aizuchi'
  },
  {
    id: 'embedding',
    group: 'local',
    name: 'multilingual-e5-small',
    provider: 'intfloat',
    license: 'MIT',
    url: 'https://huggingface.co/intfloat/multilingual-e5-small'
  },
  {
    id: 'voicevox',
    group: 'local',
    name: 'VOICEVOX',
    provider: 'VOICEVOX',
    license: null,
    url: 'https://voicevox.hiroshiba.jp/term/'
  },
  {
    id: 'aivisspeech',
    group: 'local',
    name: 'AivisSpeech',
    provider: 'Aivis Project',
    license: null,
    url: 'https://aivis-project.com/'
  },
  {
    id: 'anthropic',
    group: 'api',
    name: 'Claude Sonnet 5, Claude Haiku 4.5, Claude Opus 5',
    provider: 'Anthropic',
    license: null,
    url: 'https://www.anthropic.com/legal/commercial-terms'
  },
  {
    id: 'openai',
    group: 'api',
    name: 'GPT-5.6 Luna, GPT-5.6 Terra, GPT-6 Luna, GPT-6.1 Terra',
    provider: 'OpenAI',
    license: null,
    url: 'https://openai.com/policies/'
  },
  {
    id: 'google',
    group: 'api',
    name: 'Gemini 3.8 Flash, Gemini 3.5 Flash Lite, gemini-3.8-live, gemini-3.8-live-extended-thinking',
    provider: 'Google',
    license: null,
    url: 'https://ai.google.dev/gemini-api/terms'
  },
  {
    id: 'cerebras',
    group: 'api',
    name: 'Qwen 3.8 27B, GPT OSS 120B',
    provider: 'Cerebras',
    license: null,
    url: 'https://www.cerebras.ai/terms-of-service'
  },
  {
    id: 'codex',
    group: 'api',
    name: 'Codex',
    provider: 'OpenAI',
    license: 'Apache-2.0',
    url: 'https://github.com/openai/codex'
  },
  {
    id: 'claudeCode',
    group: 'api',
    name: 'Claude Code',
    provider: 'Anthropic',
    license: null,
    url: 'https://claude.com/product/claude-code'
  },
  {
    id: 'jma',
    group: 'data',
    name: '気象庁',
    provider: 'Japan Meteorological Agency',
    license: null,
    url: 'https://www.jma.go.jp/jma/kishou/info/coment.html'
  },
  {
    id: 'openMeteo',
    group: 'data',
    name: 'Open-Meteo',
    provider: 'Open-Meteo.com',
    license: 'CC BY 4.0',
    url: 'https://open-meteo.com'
  },
  {
    id: 'exchangeRate',
    group: 'data',
    name: 'ExchangeRate-API',
    provider: 'ExchangeRate-API',
    license: null,
    url: 'https://www.exchangerate-api.com',
    notice: 'Rates By Exchange Rate API'
  },
  {
    id: 'googleNews',
    group: 'data',
    name: 'Google News',
    provider: 'Google',
    license: null,
    url: 'https://news.google.com'
  },
  {
    id: 'mapsEmbed',
    group: 'data',
    name: 'Google Maps Embed API',
    provider: 'Google',
    license: null,
    url: 'https://cloud.google.com/maps-platform/terms'
  },
  {
    id: 'jmaRegions',
    group: 'bundled',
    name: '気象庁',
    provider: 'Japan Meteorological Agency',
    license: null,
    url: 'https://www.jma.go.jp/bosai/'
  },
  {
    id: 'gsi',
    group: 'bundled',
    name: '国土地理院',
    provider: 'Geospatial Information Authority of Japan',
    license: null,
    url: 'https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html'
  },
  {
    id: 'uv',
    group: 'software',
    name: 'uv',
    provider: 'Astral',
    license: 'MIT, Apache-2.0',
    url: 'https://github.com/astral-sh/uv'
  },
  {
    id: 'git',
    group: 'software',
    name: 'Git',
    provider: 'The Git Project',
    license: 'GPL-2.0',
    url: 'https://www.kernel.org/pub/software/scm/git/'
  },
  {
    id: 'speechCpp',
    group: 'software',
    name: 'speech.cpp',
    provider: 'Sakasegawa',
    license: 'MIT',
    url: 'https://github.com/nyosegawa/speech.cpp'
  }
] as const satisfies readonly Credit[]

/** A credit as the about page lists it, with the key of the sentence that says what ASIST uses it for. */
export interface ListedCredit extends Credit {
  readonly use: Extract<MessageKey, `settingsAbout.use.${string}`>
}

/** Who published each speech recognition model that ASIST's file was converted from, and its license, as its model card gives them. */
const SPEECH_RECOGNITION_SOURCES: Readonly<Record<ResolvedAsrModel, Pick<Credit, 'provider' | 'license'>>> = {
  'haas-ja-v1.0': { provider: 'Third Intelligence', license: 'Apache-2.0' },
  'qwen3-asr-1.7b': { provider: 'Alibaba Qwen', license: 'Apache-2.0' },
  'qwen3-asr-0.6b': { provider: 'Alibaba Qwen', license: 'Apache-2.0' },
  'parakeet-tdt_ctc-0.6b-ja': { provider: 'NVIDIA', license: 'CC BY 4.0' },
  'reazonspeech-nemo-v2': { provider: 'Reazon Human Interaction Lab', license: 'Apache-2.0' },
  'parakeet-tdt-0.6b-v3': { provider: 'NVIDIA', license: 'CC BY 4.0' }
}

/**
 * The local speech recognition models, named by the label the voice page gives them, where the local speech runs.
 * Each is converted to GGUF for speech.cpp, which the name says and the link leads to, as CC BY 4.0 asks a change to
 * be indicated.
 */
function speechRecognitionCredits(localSpeechRuns: boolean, catalog: SpeechCatalog): ListedCredit[] {
  if (!localSpeechRuns) return []
  return offeredAsrModels().map((model) => {
    const spec = ASR_MODEL_SPECS[model]
    const { repo } = catalog[spec.model]
    return {
      id: repo,
      group: 'local',
      name: `${spec.label} (GGUF)`,
      ...SPEECH_RECOGNITION_SOURCES[model],
      url: `https://huggingface.co/${repo}`,
      use: 'settingsAbout.use.asr'
    }
  })
}

/** The sizes of Qwen3-TTS, each converted to GGUF in a repository of its own. */
function qwenTtsCredits(catalog: SpeechCatalog): ListedCredit[] {
  return Object.values(QWEN_TTS_MODELS).map((spec) => {
    const { repo } = catalog[spec.model]
    return {
      id: repo,
      group: 'local',
      name: `${spec.label} CustomVoice (GGUF)`,
      provider: 'Alibaba Qwen',
      license: 'Apache-2.0',
      url: `https://huggingface.co/${repo}`,
      use: 'settingsAbout.use.ttsQwen'
    }
  })
}

/** Irodori-TTS and the codec it speaks through, converted to GGUF together in one file of one repository. */
function irodoriTtsCredits(catalog: SpeechCatalog): ListedCredit[] {
  const url = `https://huggingface.co/${catalog[IRODORI_TTS_MODEL.model].repo}`
  return [
    { id: 'ttsIrodori', group: 'local', name: 'Irodori-TTS v4.1-Small-MF (GGUF)', provider: 'Aratako', license: 'MIT', url, use: 'settingsAbout.use.ttsIrodori' },
    { id: 'ttsIrodoriCodec', group: 'local', name: 'Semantic-DACVAE-Japanese-32dim (GGUF)', provider: 'Aratako', license: 'MIT', url, use: 'settingsAbout.use.ttsIrodoriCodec' }
  ]
}

/** The license ASIST itself is published under, as the LICENSE file at the root of the repository states it. */
export const ASIST_LICENSE = { name: 'MIT', url: 'https://opensource.org/license/mit' } as const

/**
 * The credits of a group on a machine where the local speech models run or do not, the local models' repositories as
 * the bundled speech's catalog pins them.
 */
export function creditsOf(group: CreditGroup, localSpeechRuns: boolean, catalog: SpeechCatalog): ListedCredit[] {
  const listed = CREDITS.filter((credit) => credit.group === group).map((credit) => ({
    ...credit,
    use: `settingsAbout.use.${credit.id}` as const
  }))
  if (group !== 'local') return listed
  // The local speech synthesis, Qwen3-TTS beside Irodori-TTS, goes before DACVAE.
  const dacvae = listed.findIndex((credit) => credit.id === 'dacvae')
  return [
    ...speechRecognitionCredits(localSpeechRuns, catalog),
    ...listed.slice(0, dacvae),
    ...qwenTtsCredits(catalog),
    ...irodoriTtsCredits(catalog),
    ...listed.slice(dacvae)
  ]
}
