import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ASR_MODEL_SPECS,
  asrDownloadGb,
  asrLanguage,
  asrModelChoices,
  asrModelRecognizes,
  recommendAsrModel,
  resolveAsrModel,
  whisperLanguageName
} from '../src/shared/asr-models'
import { CONVERSATION_LOCALES, type ConversationLocale } from '../src/shared/conversation-locale'
import { SETTINGS_FORMAT } from '../src/shared/settings'
import { openStoredContent } from '../src/shared/stored-format'
import { TEST_SPEECH_CATALOG } from './helpers/speech-catalog'

describe('the recommended model on a Mac', () => {
  it('recommends Qwen3-ASR 0.6B on 8 GB, where free memory matters more', () => {
    expect(recommendAsrModel('metal', 8)).toEqual({ totalMemoryGb: 8, recommendedModel: 'qwen3-asr-0.6b' })
  })

  it('recommends Qwen3-ASR 1.7B from 16 GB', () => {
    expect(recommendAsrModel('metal', 16).recommendedModel).toBe('qwen3-asr-1.7b')
    expect(recommendAsrModel('metal', 32)).toEqual({ totalMemoryGb: 32, recommendedModel: 'qwen3-asr-1.7b' })
  })
})

describe('the recommended model on a Windows GPU', () => {
  it('does not mistake plentiful shared GPU memory for dedicated VRAM and preserves an explicit Haas selection', () => {
    const recommendation = recommendAsrModel('vulkan', 16, 'shared')
    expect(resolveAsrModel('auto', recommendation)).toBe('qwen3-asr-0.6b')
    expect(resolveAsrModel('haas-ja-v1.0', recommendation)).toBe('haas-ja-v1.0')
  })
  it('recommends Qwen3-ASR 0.6B on a 4 GB GPU, which 1.7B does not fit beside the desktop', () => {
    expect(recommendAsrModel('vulkan', 4)).toEqual({ totalMemoryGb: 4, recommendedModel: 'qwen3-asr-0.6b' })
  })

  it('recommends Qwen3-ASR 1.7B from 6 GB of VRAM', () => {
    expect(recommendAsrModel('vulkan', 6).recommendedModel).toBe('qwen3-asr-1.7b')
    expect(recommendAsrModel('vulkan', 8).recommendedModel).toBe('qwen3-asr-1.7b')
  })
})

describe('resolving the setting', () => {
  it('resolves auto to the recommendation and keeps a chosen model', () => {
    expect(resolveAsrModel('auto', recommendAsrModel('metal', 8))).toBe('qwen3-asr-0.6b')
    expect(resolveAsrModel('qwen3-asr-0.6b', recommendAsrModel('vulkan', 24))).toBe('qwen3-asr-0.6b')
    expect(resolveAsrModel('qwen3-asr-1.7b', recommendAsrModel('metal', 8))).toBe('qwen3-asr-1.7b')
  })

})

describe('the models to choose from in each conversation language', () => {
  const offered = (locale: ConversationLocale): string[] => asrModelChoices(locale, TEST_SPEECH_CATALOG).map((choice) => choice.id)
  const QWEN3_ASR = ['qwen3-asr-1.7b', 'qwen3-asr-0.6b']

  it('offers both Japanese FastConformer models beside Qwen3-ASR for Japanese, and not the European one', () => {
    expect(offered('ja-JP')).toEqual(expect.arrayContaining([...QWEN3_ASR, 'parakeet-tdt_ctc-0.6b-ja', 'reazonspeech-nemo-v2']))
    expect(offered('ja-JP')).not.toContain('parakeet-tdt-0.6b-v3')
  })

  it.each(['en-US', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'es-419', 'es-ES'] as const)('offers parakeet-tdt-0.6b-v3 beside Qwen3-ASR for %s, and neither Japanese model', (locale) => {
    expect(offered(locale)).toEqual(expect.arrayContaining([...QWEN3_ASR, 'parakeet-tdt-0.6b-v3']))
    expect(offered(locale)).not.toContain('parakeet-tdt_ctc-0.6b-ja')
    expect(offered(locale)).not.toContain('reazonspeech-nemo-v2')
  })

  it.each(['ko-KR', 'hi-IN', 'id-ID'] as const)('offers Qwen3-ASR alone for %s, which no FastConformer model recognizes', (locale) => {
    expect(offered(locale)).toEqual(QWEN3_ASR)
  })

  it('gives each model the label of its table and the size of its file', () => {
    for (const choice of asrModelChoices('ja-JP', TEST_SPEECH_CATALOG)) {
      const spec = ASR_MODEL_SPECS[choice.id]
      expect(choice.label).toBe(spec.label)
      expect(choice.sizeGb).toBeCloseTo(TEST_SPEECH_CATALOG[spec.model].bytes / 1e9, 2)
    }
  })

  it('lets a chosen model recognize only the languages of its file', () => {
    expect(asrModelRecognizes('ja-JP', 'haas-ja-v1.0')).toBe(true)
    for (const locale of CONVERSATION_LOCALES.filter((locale) => locale !== 'ja-JP')) {
      expect(asrModelRecognizes(locale, 'haas-ja-v1.0')).toBe(false)
      expect(offered(locale)).not.toContain('haas-ja-v1.0')
    }
    expect(asrModelRecognizes('ja-JP', 'reazonspeech-nemo-v2')).toBe(true)
    expect(asrModelRecognizes('en-US', 'reazonspeech-nemo-v2')).toBe(false)
    expect(asrModelRecognizes('es-419', 'parakeet-tdt-0.6b-v3')).toBe(true)
    expect(asrModelRecognizes('ja-JP', 'parakeet-tdt-0.6b-v3')).toBe(false)
  })

  it('lets the automatic choice recognize every conversation language, as both sizes of Qwen3-ASR do', () => {
    for (const locale of CONVERSATION_LOCALES) expect(asrModelRecognizes(locale, 'auto'), locale).toBe(true)
  })
})

describe('the download of a model', () => {
  it('is its model file, and nothing once it is installed', () => {
    const spec = ASR_MODEL_SPECS['qwen3-asr-1.7b']
    expect(asrDownloadGb(spec, TEST_SPEECH_CATALOG, false)).toBeCloseTo(TEST_SPEECH_CATALOG[spec.model].bytes / 1e9, 2)
    expect(asrDownloadGb(spec, TEST_SPEECH_CATALOG, true)).toBe(0)
  })
})

/** The languages of Qwen3-ASR's model files, as `speech info --json` lists them and the worker takes them. */
const QWEN3_ASR_LANGUAGES = ['ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fil', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'mk', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'vi', 'yue', 'zh']

describe('the language of a transcription request', () => {
  it('gives the worker the BCP 47 tag of the language, without the region the model does not take', () => {
    expect(asrLanguage('ja-JP')).toBe('ja')
    expect(asrLanguage('pt-BR')).toBe('pt')
    expect(asrLanguage('es-419')).toBe('es')
  })

  it('tells Qwen3-ASR a language it recognizes for every conversation language', () => {
    for (const locale of CONVERSATION_LOCALES) expect(QWEN3_ASR_LANGUAGES, locale).toContain(asrLanguage(locale))
  })

  it('gives transformers.js the English name in lower case', () => {
    expect(whisperLanguageName('ja-JP')).toBe('japanese')
    expect(whisperLanguageName('id-ID')).toBe('indonesian')
    expect(whisperLanguageName('es-ES')).toBe('spanish')
  })
})

describe('the speech recognition model of an older settings file', () => {
  const sample = (version: number) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'stored', `settings.v${version}.json`), 'utf8')) as Record<string, unknown>
  const open = (version: number, asrModel: unknown) => openStoredContent(SETTINGS_FORMAT, { ...sample(version), asrModel }).value

  it('preserves the previous selection during upgrade and round-trips a Haas selection in the current format', () => {
    expect(open(15, 'reazonspeech-nemo-v2').asrModel).toBe('reazonspeech-nemo-v2')
    expect(open(16, 'haas-ja-v1.0').asrModel).toBe('haas-ja-v1.0')
    expect(ASR_MODEL_SPECS['haas-ja-v1.0'].languages).toEqual(['ja'])
  })

  it.each([
    ['auto', 'auto'],
    ['qwen3-asr-1.7b-mlx', 'qwen3-asr-1.7b'],
    ['whisper-large-v3-turbo-mlx', 'auto']
  ] as const)('upgrades %s of version 3 to %s', (stored, upgraded) => {
    expect(open(3, stored).asrModel).toBe(upgraded)
  })

  it.each([
    ['auto', 'auto'],
    ['qwen3-asr-1.7b', 'qwen3-asr-1.7b'],
    ['qwen3-asr-0.6b', 'qwen3-asr-0.6b'],
    // Whisper is not among the local models; the recommendation for the machine's memory takes its place.
    ['whisper-large-v3-turbo', 'auto']
  ] as const)('upgrades %s of version 4 to %s, with the 0.6B Qwen3-TTS version 4 always spoke with', (stored, upgraded) => {
    const opened = open(4, stored)
    expect(opened.asrModel).toBe(upgraded)
    expect(opened.qwenTtsSize).toBe('0.6b')
  })

  it('refuses a value an older version did not allow rather than guessing a model', () => {
    expect(() => open(3, 'qwen3-asr-large')).toThrow()
    expect(() => open(4, 'qwen3-asr-large')).toThrow()
    expect(() => open(4, undefined)).toThrow()
  })
})
