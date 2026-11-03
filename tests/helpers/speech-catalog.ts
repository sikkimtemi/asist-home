import { parseSpeechCatalog, type SpeechCatalog } from '../../src/shared/speech-catalog'
import listed from '../fixtures/speech-models.json'

/**
 * The catalog file from speech.cpp 0.10.1, imported so that tests that mock node:fs can still read it.
 */
export const SPEECH_MODELS_OUTPUT = JSON.stringify(listed)

/** The files of the local speech models as that catalog pins them. */
export const TEST_SPEECH_CATALOG: SpeechCatalog = parseSpeechCatalog(SPEECH_MODELS_OUTPUT)

/** The renderer's catalog, for `vi.mock('@/speech-catalog', () => import('./helpers/speech-catalog'))`. */
export const speechCatalog = (): SpeechCatalog => TEST_SPEECH_CATALOG
export const loadSpeechCatalog = async (): Promise<void> => {}
