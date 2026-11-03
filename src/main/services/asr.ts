import {
  asrDownloadGb,
  asrModelSpec,
  isAsrModel,
  recommendAsrModel,
  resolveAsrModel,
  type AsrHardwareRecommendation,
  type AsrModel,
  type AsrModelSpec,
  type ResolvedAsrModel
} from '@shared/asr-models'
import { speechEngineState, type SetupProgress, type SetupStatus, type SpeechEngineState } from '@shared/ipc'
import { errorText } from '@shared/i18n/error-text'
import { LOCAL_SPEECH_UNAVAILABLE_TEXT, type LocalSpeechUnavailable } from '@shared/platform'
import { t } from './i18n'
import { platformCapabilities } from './platform'
import { getSettings } from './settings'
import { speechCatalog } from './speech-models'
import * as local from './local-asr'

/** The model the setting stands for on this machine, or why this machine cannot run one. */
type Resolution =
  | { model: ResolvedAsrModel; spec: AsrModelSpec; recommendation: AsrHardwareRecommendation }
  | { model: null; reason: LocalSpeechUnavailable }

function resolve(selected: AsrModel = getSettings().asrModel): Resolution {
  const { localAsr } = platformCapabilities()
  if (localAsr.backend === null) return { model: null, reason: localAsr.reason }
  const recommendation = recommendAsrModel(localAsr.backend, localAsr.memoryGb, localAsr.memoryType)
  const model = resolveAsrModel(selected, recommendation)
  return { model, spec: asrModelSpec(model), recommendation }
}

/** The model to transcribe with; on a machine that cannot run it the reason is thrown for the user. */
function modelOrThrow(): AsrModelSpec {
  const resolution = resolve()
  if (resolution.model === null) throw new Error(errorText(LOCAL_SPEECH_UNAVAILABLE_TEXT[resolution.reason]))
  return resolution.spec
}

/** The model the setting stands for, or null where there is none to start. */
function startable(selected?: AsrModel): AsrModelSpec | null {
  const resolution = resolve(selected)
  return resolution.model === null ? null : resolution.spec
}

export async function installationStatus(selected: AsrModel = getSettings().asrModel): Promise<SetupStatus['asr']> {
  const resolution = resolve(selected)
  if (resolution.model === null) return null
  const { model, spec, recommendation } = resolution
  const installed = local.installationStatus(spec)
  return {
    selectedModel: selected,
    resolvedModel: model,
    recommendedModel: recommendation.recommendedModel,
    label: spec.label,
    totalMemoryGb: recommendation.totalMemoryGb,
    ...installed,
    downloadGb: asrDownloadGb(spec, speechCatalog(), installed.modelInstalled)
  }
}

/** Whether the selected model is installed, so that its worker can be started at all. */
export function installed(): boolean {
  const spec = startable()
  return spec !== null && local.installationStatus(spec).modelInstalled
}

export async function available(): Promise<boolean> {
  const spec = startable()
  return spec !== null && local.available(spec)
}

/** How the speech recognition stands, given whether the microphone wants it loaded. */
export function state(wanted: boolean): SpeechEngineState {
  const spec = startable()
  if (spec === null) return 'down'
  return speechEngineState({
    answers: local.available(spec),
    starting: local.isStarting(spec),
    wanted,
    prepared: local.installationStatus(spec).modelInstalled
  })
}

/** Stops the worker, which fails the transcriptions still waiting on it. */
export const stop = local.stop

export async function ensureWorker(): Promise<boolean> {
  const spec = startable()
  return spec !== null && (await local.ensureWorker(spec))
}

export async function revive(): Promise<boolean> {
  const spec = startable()
  if (spec === null) return false
  return local.available(spec) || local.ensureWorker(spec)
}

export async function transcribe(samples: Float32Array, requestId?: string): Promise<string> {
  return local.transcribe(modelOrThrow(), samples, requestId)
}

export async function transcribePartial(samples: Float32Array): Promise<string> {
  return local.transcribePartial(modelOrThrow(), samples)
}

export const cancelTranscription = local.cancelTranscription

/**
 * Moves the worker to the model the setting stands for now, from the one `previous` stood for. Auto and the
 * model auto stands for are the same model, whose worker and the transcription under way on it go on.
 */
export function switchModel(previous: AsrModel): Promise<boolean> {
  if (startable(previous) !== startable()) local.stop()
  return ensureWorker()
}

export async function prepareModel(
  selected: AsrModel,
  onProgress: (progress: SetupProgress) => void
): Promise<{ ok: boolean; message: string }> {
  if (!isAsrModel(selected)) return { ok: false, message: t('speechRecognition.errors.unknownModel') }
  const resolution = resolve(selected)
  if (resolution.model === null) return { ok: false, message: t(LOCAL_SPEECH_UNAVAILABLE_TEXT[resolution.reason]) }
  const { spec } = resolution
  return local.prepare(spec, () => startable() === spec, onProgress)
}

export const cancelPreparation = local.cancelPreparation
