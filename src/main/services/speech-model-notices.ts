import fs from 'node:fs'
import { z } from 'zod'
import { errorText } from '@shared/i18n/error-text'
import type { SpeechModelNotice } from '@shared/ipc'
import { localSpeechModelsInUse } from '@shared/local-speech-models'
import type { PinnedFile } from '@shared/pinned-file'
import { storedContent, type StoredFormat } from '@shared/stored-format'
import { platformCapabilities } from './platform'
import { getSettings } from './settings'
import { fileInstalled, pinnedSpeechModelFiles, speechCatalog } from './speech-models'
import { dataPath, writeJson } from './store'
import { openStoredFileSync } from './stored-file'

/**
 * Telling the user, once, that a local speech model the settings use needs preparing. Nothing downloads a
 * model on its own, so after an update that pinned other files, a model prepared before would otherwise stop
 * being used without a word: replies are read with the OS's voice and the microphone does not listen. Which
 * pinned files the user has been told about is kept in userData/speech-model-notices.json. It is a record of
 * this computer's model files, not a choice of the user's, so it is not a setting.
 */

const FILE = 'speech-model-notices.json'

/**
 * A pinned file as the record names it: by its content, so that a pin moved to a later commit of the same file is
 * not told about again.
 */
type PinName = Pick<PinnedFile, 'repo' | 'file' | 'sha256'>

const pinNameSchema = z.strictObject({ repo: z.string(), file: z.string(), sha256: z.string() })

export const SPEECH_MODEL_NOTICES_FORMAT: StoredFormat<PinName[]> = {
  name: FILE,
  version: 2,
  upgrades: {
    // Version 1 named a file by the commit of its pin, which does not tell its content, so a file it named that is
    // still missing is told about once more.
    1: () => ({ told: [] })
  },
  parse: (content) => z.array(pinNameSchema).parse((content as { told?: unknown } | null)?.told),
  serialize: (told) => ({ told })
}

const samePin = (a: PinName, b: PinName): boolean => a.repo === b.repo && a.file === b.file && a.sha256 === b.sha256

/** Only a missing file counts as nothing told yet, so that an unreadable one is never replaced by an empty record. */
function readTold(): PinName[] {
  const file = dataPath(FILE)
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let stored: unknown
  try {
    stored = JSON.parse(source)
  } catch (error) {
    throw new Error(errorText('app.storage.jsonBroken', { file: FILE }), { cause: error })
  }
  return openStoredFileSync(file, stored, SPEECH_MODEL_NOTICES_FORMAT)
}

/**
 * The models in use whose files are not all there and whose files the user has not been told about, each of
 * them told once: they are recorded as told before they are returned. A model whose pin changes in any file
 * is told about again. The record keeps only the files of current pins, so it does not grow with each update.
 */
export function takeSpeechModelNotices(): SpeechModelNotice[] {
  const told = readTold()
  const due = localSpeechModelsInUse(getSettings(), platformCapabilities(), speechCatalog()).filter(({ files }) => !files.every(fileInstalled) && !files.every((file) => told.some((pin) => samePin(pin, file))))
  if (due.length === 0) return []
  const pinned = pinnedSpeechModelFiles()
  const record = told.filter((pin) => pinned.some((file) => samePin(file, pin)))
  for (const { repo, file, sha256 } of due.flatMap((model) => model.files)) {
    if (!record.some((pin) => samePin(pin, { repo, file, sha256 }))) record.push({ repo, file, sha256 })
  }
  writeJson(FILE, storedContent(SPEECH_MODEL_NOTICES_FORMAT, record))
  return due.map(({ target, label, files }) => ({
    target,
    label,
    downloadBytes: files.filter((file) => !fileInstalled(file)).reduce((sum, file) => sum + file.bytes, 0)
  }))
}
