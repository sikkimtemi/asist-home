import { asrModelSpec, asrRecommendationSize, type AsrModelChoice } from '@shared/asr-models'
import type { SetupStatus } from '@shared/ipc'
import type { Translate } from '@shared/i18n'
import type { LocalSpeechCapability } from '@shared/platform'

type AsrStatus = NonNullable<SetupStatus['asr']>

/** Whether the model in use is the one `auto` picks for this machine, the only model the screens mark as recommended. */
export const usesRecommendedAsr = (asr: AsrStatus): boolean => asr.resolvedModel === asr.recommendedModel

/**
 * What the screens say about the model in use: why it suits this machine when it is the recommended one, from the
 * memory the main process reports (the Mac's own on metal, the GPU's on vulkan), and otherwise which model is
 * recommended.
 */
export function asrChoiceReason(t: Translate, capability: Extract<LocalSpeechCapability, { memoryGb: number }>, asr: AsrStatus): string {
  if (!usesRecommendedAsr(asr)) return t('speechRecognition.recommendedForThisComputer', { model: asrModelSpec(asr.recommendedModel).label })
  const { backend, memoryType } = capability
  if (backend === 'vulkan' && memoryType === 'shared') return t('speechRecognition.recommendation.sharedGpu')
  return t(`speechRecognition.recommendation.${backend}.${asrRecommendationSize(backend, asr.totalMemoryGb, memoryType)}`, { memoryGb: asr.totalMemoryGb })
}

/** A model as the setup and the voice page list it, with what preparing it downloads. */
export function asrChoiceLabel(t: Translate, formatLocale: string, choice: AsrModelChoice): string {
  return t('speechRecognition.modelOption', { model: choice.label, sizeGb: new Intl.NumberFormat(formatLocale, { maximumFractionDigits: 1 }).format(choice.sizeGb) })
}
