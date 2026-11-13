export type CompatibleChannelConfig = {
  baseUrl: string
  apiKey: string
  defaultHeaders?: Record<string, string>
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
}

export type ImageGenerationOptions = {
  model: string
  prompt: string
  size?: string
  quality?: string
  background?: 'transparent' | 'opaque' | 'auto'
  n?: number
}

export type MotionGenerationOptions = {
  model: string
  prompt: string
  inputImage?: string
  duration?: number
  width?: number
  height?: number
  outputFormat?: 'gif' | 'mp4' | 'frames'
  protocol?: 'images-gif' | 'videos'
  frameCount?: number
  frameDurationMs?: number
}

export type CompatibleApiError = Error & { status?: number; body?: unknown }

/**
 * OpenAI-compatible transport shared by all three model roles.
 * The browser UI uses this client only when a real, unmasked key is configured.
 * A production desktop shell can move the same class behind a local proxy.
 */
export class OpenAICompatibleClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly defaultHeaders: Record<string, string>

  constructor(config: CompatibleChannelConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.defaultHeaders = config.defaultHeaders ?? {}
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...(init.headers ?? {}),
      },
    })
    const raw = await response.text()
    let body: unknown = undefined
    try { body = raw ? JSON.parse(raw) : undefined } catch { body = raw }
    if (!response.ok) {
      const error = new Error(`兼容接口请求失败（${response.status}）`) as CompatibleApiError
      error.status = response.status
      error.body = body
      throw error
    }
    return body as T
  }

  async listModels(): Promise<{ data: Array<{ id: string; owned_by?: string }> }> {
    return this.request('/models', { method: 'GET', headers: { 'Content-Type': 'application/json' } })
  }

  async chatCompletion(input: { model: string; messages: ChatMessage[]; temperature?: number; responseFormat?: 'json_object' | 'text' }) {
    return this.request<{ id: string; choices: Array<{ message: { content: string } }> }>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.7,
        ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {}),
      }),
    })
  }

  async generateImage(input: ImageGenerationOptions) {
    return this.request<{ created: number; data: Array<{ url?: string; b64_json?: string }> }>('/images/generations', {
      method: 'POST',
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        size: input.size ?? '1024x1024',
        n: input.n ?? 1,
        ...(input.quality ? { quality: input.quality } : {}),
        ...(input.background ? { background: input.background } : {}),
      }),
    })
  }

  /**
   * Motion providers differ slightly, so the adapter uses the conventional
   * /videos endpoint and keeps provider-specific fields in the payload.
   */
  async generateMotion(input: MotionGenerationOptions) {
    const protocol = input.protocol ?? 'videos'
    const outputFormat = input.outputFormat ?? 'gif'
    const frameCount = input.frameCount ?? 6
    const frameDurationMs = input.frameDurationMs ?? Math.max(20, Math.round(((input.duration ?? 1) * 1000) / frameCount / 10) * 10)
    if (protocol === 'images-gif') {
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        size: `${input.width ?? 240}x${input.height ?? 240}`,
        n: 1,
        output_format: outputFormat,
        frame_count: frameCount,
        frame_duration_ms: frameDurationMs,
      }
      if (input.inputImage) body.input_image = input.inputImage
      return this.request<{ created?: number; data?: Array<{ url?: string; b64_json?: string }> }>('/images/generations', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    }
    return this.request<{ id: string; status: string; output?: string; frames?: string[] }>('/videos', {
      method: 'POST',
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        ...(input.inputImage ? { input_image: input.inputImage } : {}),
        duration: input.duration ?? 1,
        size: `${input.width ?? 240}x${input.height ?? 240}`,
        output_format: outputFormat,
      }),
    })
  }
}

export function isConfiguredKey(value: string) {
  return Boolean(value && !value.includes('•') && value.length > 12)
}

export function dataUrlFromBase64(base64: string, mimeType = 'image/png') {
  return `data:${mimeType};base64,${base64}`
}
