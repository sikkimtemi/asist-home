import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponsesClientEvent } from 'openai/resources/responses/responses'
import type { ResponsesStreamMessage } from 'openai/resources/responses/internal-base'
import type { ConversationRequest, ToolCallPart } from '@shared/conversation'
import { apiErrorKey, isChatGptUsageLimit, isTransientApiError } from '@shared/api-errors'
import { classifyApiKeyValidationError } from '@shared/api-key-validation'
import { CHATGPT_SIGN_IN, CHATGPT_USAGE_LIMIT } from '@shared/chatgpt'
import { errorText } from '@shared/i18n/error-text'
import type { ProviderCredential } from '../src/main/services/llm/credential'
import { FakeResponsesSocket, completedResponse } from './helpers/responses-socket'

/**
 * The ChatGPT adapter: the requests the plan's route takes, over a WebSocket of the Responses API, with the
 * access token of the sign-in, which is renewed and sent again once when OpenAI refuses it.
 */

const mocks = vi.hoisted(() => ({
  answer: null as ((event: ResponsesClientEvent, socket: FakeResponsesSocket) => ResponsesStreamMessage[] | void) | null,
  opened: [] as FakeResponsesSocket[]
}))

vi.mock('openai/resources/responses/ws', () => ({
  ResponsesWS: class {
    constructor(client: { apiKey: string }) {
      const socket = new FakeResponsesSocket(client.apiKey, (event, self) => mocks.answer?.(event, self))
      mocks.opened.push(socket)
      return socket
    }
  }
}))

const MODEL = { provider: 'chatgpt' as const, id: 'gpt-5.6-terra' }

const request = (over: Partial<ConversationRequest> = {}): ConversationRequest => ({
  model: MODEL,
  locale: 'ja-JP',
  maxTokens: 1000,
  system: [{ name: 'base', text: 'BASE' }],
  tools: [{ name: 'show_weather', description: '天気', inputSchema: { type: 'object', properties: { location: { type: 'string' } } } }],
  webSearch: true,
  messages: [{ role: 'user', parts: [{ type: 'text', text: '大阪の天気' }] }],
  signal: new AbortController().signal,
  ...over
})

/** A sign-in whose tokens are `tokens` in turn, renewed only after a refusal. */
function credential(...tokens: string[]): ProviderCredential & { refusedTokens: string[] } {
  let current = 0
  const refusedTokens: string[] = []
  return {
    identity: 'oaiapp_user-1:user-1',
    refusedTokens,
    token: async () => tokens[Math.min(current, tokens.length - 1)],
    refused: (token) => {
      refusedTokens.push(token)
      current++
    }
  }
}

const created = (socket: FakeResponsesSocket): Record<string, unknown> => socket.sent.at(-1) as unknown as Record<string, unknown>

beforeEach(() => {
  vi.resetModules()
  mocks.answer = () => completedResponse('晴れです。')
  mocks.opened.length = 0
})

describe('a conversation request on the ChatGPT plan', () => {
  it.each(['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6.1-sol'])(
    'streams %s with its selected reasoning effort and tool namespace', async (id) => {
      const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
      const result = await chatgptAdapter.stream(request({ model: { provider: 'chatgpt', id, effort: 'max' } }), credential('access-1')).final()
      const body = created(mocks.opened[0])
      expect(body).toMatchObject({ model: id, reasoning: { effort: 'max' }, store: false })
      expect(body.tools).toContainEqual(expect.objectContaining({ type: 'namespace', name: 'asist' }))
      expect(result.message.parts).toEqual([{ type: 'text', text: '晴れです。' }])
    }
  )

  it('groups the tools in a namespace, leaves out the output cap and keeps the cache together', async () => {
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const history = request({
      messages: [
        { role: 'user', parts: [{ type: 'text', text: '大阪の天気' }] },
        { role: 'assistant', parts: [{ type: 'tool_call', id: 'call_0', name: 'show_weather', input: { location: '大阪' } }] },
        { role: 'user', parts: [{ type: 'tool_result', callId: 'call_0', content: '雨のち晴れ、最高気温は21度' }] }
      ]
    })
    const result = await chatgptAdapter.stream(history, credential('access-1')).final()
    const body = created(mocks.opened[0])
    expect(body).toMatchObject({ type: 'response.create', model: 'gpt-5.6-terra', store: false, prompt_cache_key: 'asist', instructions: 'BASE' })
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('stream')
    expect(body.tools).toEqual([
      { type: 'namespace', name: 'asist', description: expect.any(String), tools: [expect.objectContaining({ type: 'function', name: 'show_weather' })] },
      { type: 'web_search', search_context_size: 'low' }
    ])
    expect(body.input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'call_0', name: 'show_weather', namespace: 'asist' }))
    expect(result.message.parts).toEqual([{ type: 'text', text: '晴れです。' }])
    expect(result.usage).toMatchObject({ cacheRead: 4, output: 5 })
  })

  it('hands a namespaced tool call to the turn by the name of the tool', async () => {
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'show_weather', namespace: 'asist', arguments: '{"location":"大阪"}', status: 'completed' }
    mocks.answer = () =>
      [
        { type: 'message', message: { type: 'response.output_item.done', item: call, output_index: 0 } },
        { type: 'message', message: { type: 'response.completed', response: { status: 'completed', output: [call], usage: { input_tokens: 1, output_tokens: 1 } } } }
      ] as unknown as ResponsesStreamMessage[]
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const stream = chatgptAdapter.stream(request(), credential('access-1'))
    const calls: ToolCallPart[] = []
    stream.on('toolCall', (part) => calls.push(part))
    const result = await stream.final()
    expect(calls).toEqual([{ type: 'tool_call', id: 'call_1', name: 'show_weather', input: { location: '大阪' } }])
    expect(result.stop).toBe('tool_calls')
  })

  it('renews a token OpenAI refuses before any event and sends the request once more with the new one', async () => {
    mocks.answer = (_event, socket) =>
      socket.token === 'stale' ? ([{ type: 'error', error: new Error('Unexpected server response: 401') }] as unknown as ResponsesStreamMessage[]) : completedResponse('どうぞ。')
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const signIn = credential('stale', 'fresh')
    const result = await chatgptAdapter.stream(request(), signIn).final()
    expect(signIn.refusedTokens).toEqual(['stale'])
    expect(mocks.opened.map((socket) => socket.token)).toEqual(['stale', 'fresh'])
    expect(result.message.parts).toEqual([{ type: 'text', text: 'どうぞ。' }])
  })

  it('asks the user to sign in again when the renewed token is refused too', async () => {
    mocks.answer = () => [{ type: 'error', error: new Error('Unexpected server response: 401') }] as unknown as ResponsesStreamMessage[]
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const error = await chatgptAdapter.stream(request(), credential('one', 'two')).final().catch((caught: unknown) => caught as Error & { code?: string })
    expect(error.code).toBe(CHATGPT_SIGN_IN)
    expect(apiErrorKey(error)).toBe('conversation.reply.chatgptSignIn')
    expect(isTransientApiError(error)).toBe(false)
  })

  it('stops on the plan usage limit without a retry and says so', async () => {
    mocks.answer = () =>
      [
        { type: 'message', message: { type: 'response.failed', response: { status: 'failed', error: { code: CHATGPT_USAGE_LIMIT, message: 'limit' } } } }
      ] as unknown as ResponsesStreamMessage[]
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const error = await chatgptAdapter.stream(request(), credential('access-1')).final().catch((caught: unknown) => caught)
    expect(isChatGptUsageLimit(error)).toBe(true)
    expect(isTransientApiError(error)).toBe(false)
    expect(apiErrorKey(error)).toBe('conversation.reply.chatgptUsageLimit')
  })
})

describe('a one-shot JSON request on the ChatGPT plan', () => {
  it('uses the bridge default and its shallow effort for structured output', async () => {
    const { defaultModelsFor, effortFor } = await import('@shared/llm-catalog')
    const { bridgeModel } = defaultModelsFor('chatgpt')
    mocks.answer = () => completedResponse('{"bridge":"確認しますね。"}')
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const response = await chatgptAdapter.completeJson(
      { model: bridgeModel, system: 'S', user: 'U', schema: { type: 'object' }, maxTokens: 100, signal: new AbortController().signal },
      credential('access-1')
    )
    expect(created(mocks.opened[0])).toMatchObject({ model: bridgeModel.id, reasoning: { effort: effortFor(bridgeModel) }, text: { format: { type: 'json_schema', strict: true } } })
    expect(response.value()).toEqual({ bridge: '確認しますね。' })
  })

  it('is streamed with the schema and returns the JSON and the usage', async () => {
    mocks.answer = () => completedResponse('{"bridge":true}')
    const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
    const response = await chatgptAdapter.completeJson(
      { model: MODEL, system: 'S', user: 'U', schema: { type: 'object' }, maxTokens: 100, signal: new AbortController().signal },
      credential('access-1')
    )
    const body = created(mocks.opened[0])
    expect(body).toMatchObject({ instructions: 'S', input: [{ role: 'user', content: 'U' }], text: { format: { type: 'json_schema', strict: true } }, store: false })
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(response.value()).toEqual({ bridge: true })
    expect(response.usage.output).toBe(5)
  })
})

describe('checking a model on the ChatGPT plan', () => {
  it.each(['gpt-5.6-terra', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-luna'])('accepts listed %s and refuses a hidden model', async (id) => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ slug: id, visibility: 'list' }, { slug: 'gpt-reserve', visibility: 'hide' }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { chatgptAdapter } = await import('../src/main/services/llm/chatgpt')
      const signal = new AbortController().signal
      await expect(chatgptAdapter.retrieveModel(id, credential('access-1'), signal)).resolves.toBeUndefined()
      const refused = await chatgptAdapter.retrieveModel('gpt-reserve', credential('access-1'), signal).catch((caught: unknown) => caught)
      const classified = classifyApiKeyValidationError(refused, { label: 'MODEL', provider: 'chatgpt', id: 'gpt-reserve' })
      expect(classified.message).toBe(errorText('chatgpt.errors.modelNotListed', { target: 'MODEL (gpt-reserve)' }))
      expect(fetchMock.mock.calls[0]).toEqual(['https://api.openai.com/v1/models', expect.objectContaining({ headers: { authorization: 'Bearer access-1' } })])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
