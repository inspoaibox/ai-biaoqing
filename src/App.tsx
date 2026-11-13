import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  Download,
  Eye,
  Film,
  Gauge,
  Image as ImageIcon,
  Images,
  KeyRound,
  Layers3,
  LayoutGrid,
  LockKeyhole,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { isConfiguredKey } from './services/openaiCompatible'
import { imageResultToUrl, localApi, motionResultToUrl } from './services/localApi'
import { readPersistentState, writePersistentState } from './services/persistentStorage'

type Role = 'analysis' | 'static' | 'motion'
type ModelRole = Role | 'unassigned'
type NavKey = 'studio' | 'models' | 'assets' | 'tasks' | 'analytics' | 'settings'
type ChannelHealth = 'healthy' | 'testing' | 'error'

type ModelConfig = {
  id: string
  label: string
  role: ModelRole
  capability: string
  latency: string
  price: string
}

type Channel = {
  id: string
  name: string
  provider: string
  baseUrl: string
  key: string
  health: ChannelHealth
  updated: string
  models: ModelConfig[]
}

type Defaults = Record<Role, string>

function modelKey(channelId: string, modelId: string) {
  return `${channelId}::${modelId}`
}

type MotionProtocol = 'images-gif' | 'videos'

function motionProtocolForModel(modelId: string): MotionProtocol {
  const id = modelId.toLowerCase()
  // GPT-Image-2.6 (Sunburst/Flare) and compatible chatgpt-image aliases
  // return the finished GIF through the Image API.
  return /gpt[-_]?image|chatgpt[-_]?image|image[-_]?2(?:\.\d+)?/.test(id) ? 'images-gif' : 'videos'
}

type CreativeBrief = {
  name: string
  description: string
  style: string
  count: number
  mode: 'static' | 'motion'
  creationMode: 'single' | 'pack'
  referenceImage?: string
  packItems: PackItem[]
}

type PackItem = {
  id: string
  meaning: string
  action: string
}

type ProjectRecord = {
  id: string
  brief: CreativeBrief
  updatedAt: string
  status: 'draft' | 'static-approved' | 'motion-ready'
}

type TaskSettings = {
  staticApprovalGate: boolean
  autoFallback: boolean
  saveRawRequests: boolean
}

type AuthUser = {
  id: string
  email: string
  displayName: string
  role: string
}

type TaskRecord = {
  id: string
  createdAt: string
  projectId: string
  projectName: string
  type: 'workflow' | 'channel-test' | 'analysis' | 'static' | 'motion'
  model: string
  channel: string
  status: 'running' | 'waiting' | 'success' | 'error'
  summary: string
  durationMs?: number
  request: Record<string, unknown>
  response?: unknown
  error?: string
  errorInfo?: TaskErrorInfo
  steps: TaskStep[]
}

type TaskErrorInfo = {
  message: string
  status?: number
  endpoint?: string
  provider?: unknown
  timedOut?: boolean
  code?: string
  durationMs?: number
}

type TaskStep = {
  id: string
  type: 'analysis' | 'static' | 'motion' | 'channel-test'
  label: string
  status: 'running' | 'success' | 'error'
  startedAt: string
  finishedAt?: string
  durationMs?: number
  model: string
  channel: string
  request: Record<string, unknown>
  response?: unknown
  error?: string
  errorInfo?: TaskErrorInfo
}

type AssetRecord = {
  id: string
  createdAt: string
  projectId: string
  projectName: string
  name: string
  kind: 'image' | 'gif'
  source: 'generated' | 'uploaded'
  url: string
  taskId?: string
  tags: string[]
}

type PackMotionResult = {
  itemId: string
  meaning: string
  status: 'queued' | 'running' | 'done' | 'error'
  output?: string
}

type PackStaticResult = {
  itemId: string
  meaning: string
  status: 'queued' | 'running' | 'done' | 'error'
  output?: string
}

type WorkflowContext = {
  taskId: string
  analysisPrompt?: string
  staticPrompt?: string
  motionPrompt?: string
  analysisResponse?: unknown
  staticResponse?: unknown
}

const roleLabels: Record<Role, string> = {
  analysis: '数据分析',
  static: '静态图生成',
  motion: '动态图生成',
}

const modelRoleLabels: Record<ModelRole, string> = { ...roleLabels, unassigned: '未分配' }

const roleDescriptions: Record<Role, string> = {
  analysis: '角色特征、画面定位与质量分析',
  static: '角色图、九宫格与动作分镜',
  motion: '连续帧、短视频与 GIF 输出',
}

const seedChannels: Channel[] = [
  {
    id: 'openai-main',
    name: 'OpenAI 主渠道',
    provider: 'OpenAI 兼容接口',
    baseUrl: 'https://api.openai.com/v1',
    key: 'sk-proj-••••••9F2A',
    health: 'error',
    updated: '演示配置，未填写真实 Key',
    models: [
      { id: 'vision-analyzer', label: 'Vision Analyzer', role: 'analysis', capability: '图像输入 · JSON 输出', latency: '1.8s', price: '$0.004 / 次' },
      { id: 'gptimage-2.5', label: 'GPT Image 2.5', role: 'static', capability: '图像生成 · 透明背景', latency: '8.4s', price: '$0.08 / 张' },
      { id: 'chatgpt-2.6', label: 'ChatGPT 2.6', role: 'motion', capability: '动态生成 · GIF / 帧序列', latency: '23.6s', price: '$0.22 / 秒' },
    ],
  },
  {
    id: 'cloud-fallback',
    name: 'CloudRender 备用',
    provider: 'OpenAI 兼容接口',
    baseUrl: 'https://gateway.example.com/v1',
    key: 'sk-gw-••••••1D80',
    health: 'error',
    updated: '演示配置，未填写真实 Key',
    models: [
      { id: 'omni-vision-pro', label: 'Omni Vision Pro', role: 'analysis', capability: '图像输入 · OCR', latency: '2.4s', price: '$0.006 / 次' },
      { id: 'image-studio-pro', label: 'Image Studio Pro', role: 'static', capability: '图像生成 · 4K', latency: '11.2s', price: '$0.06 / 张' },
      { id: 'motion-v1', label: 'Motion v1', role: 'motion', capability: '视频输出 · GIF 转码', latency: '31.4s', price: '$0.18 / 秒' },
    ],
  },
]

const initialDefaults: Defaults = {
  analysis: 'vision-analyzer',
  static: 'gptimage-2.5',
  motion: 'chatgpt-2.6',
}

const initialCreativeBrief: CreativeBrief = {
  name: '雨衣水獭 · 挥手',
  description: '做一只会挥手打招呼的原创小水獭，身体和镜头固定，只让右手左右轻轻挥动。',
  style: '软萌 3D 黏土玩具',
  count: 8,
  mode: 'motion',
  creationMode: 'single',
  packItems: [
    { id: 'item-1', meaning: '早呀', action: '挥手打招呼' },
    { id: 'item-2', meaning: '谢谢', action: '双手合十' },
    { id: 'item-3', meaning: '收到', action: '敬礼' },
    { id: 'item-4', meaning: '委屈', action: '委屈掉泪' },
    { id: 'item-5', meaning: '累了', action: '瘫坐休息' },
    { id: 'item-6', meaning: '好耶', action: '兴奋挥拳' },
    { id: 'item-7', meaning: '爱你', action: '抱着爱心' },
    { id: 'item-8', meaning: '晚安', action: '盖着小毯子' },
  ],
}

const styleOptions = ['软萌 3D 黏土玩具', '扁平彩色插画', '手绘贴纸风', '像素风', '日系治愈插画', '水彩绘本风', '毛毡手工风', '奶油胶玩具风', '复古漫画风', '赛博霓虹风', '国潮剪纸风', '极简线稿风', '泡泡糖卡通风', '低多边形 3D', '表情包涂鸦风', '用户自定义风格']

type InspirationTemplate = { character: string; creationMode: 'single' | 'pack'; mode: 'static' | 'motion'; description: string }

const inspirationLibrary: InspirationTemplate[] = [
  { character: '一只橘猫', creationMode: 'single', mode: 'motion', description: '做一个看到优惠就兴奋的角色，表现发现、抢购、满足和后悔。' },
  { character: '一只柴犬', creationMode: 'single', mode: 'static', description: '做一个收到礼物后开心鞠躬的单个表情，动作清晰，适合聊天发送。' },
  { character: '一只奶咖色小水獭', creationMode: 'single', mode: 'motion', description: '做一个面朝镜头挥手打招呼的单个 GIF，只让右手动起来。' },
  { character: '一只白色兔子', creationMode: 'single', mode: 'static', description: '做一个害羞脸红、双手捂脸的单个静态表情，突出耳朵和表情变化。' },
  { character: '一只红熊猫', creationMode: 'single', mode: 'motion', description: '做一个听到夸奖后开心转圈的单个 GIF，镜头固定，动作循环自然。' },
  { character: '一只蓝色小企鹅', creationMode: 'single', mode: 'static', description: '做一个认真点头表示收到的单个静态表情，角色完整露出身体。' },
  { character: '一只戴眼镜的棕熊', creationMode: 'pack', mode: 'static', description: '做一套日常工作表情，表现收到、确认、思考、加班、谢谢和完成。' },
  { character: '一只穿黄色雨衣的奶咖色水獭', creationMode: 'pack', mode: 'motion', description: '做一套适合朋友聊天的动态表情，每个表情只做一个清晰动作，保持角色和镜头一致。' },
  { character: '一只粉色小猪', creationMode: 'pack', mode: 'static', description: '做一套表达感谢和鼓励的静态表情，包含谢谢、辛苦了、加油、抱抱和好棒。' },
  { character: '一只橘色狐狸', creationMode: 'pack', mode: 'motion', description: '做一套表达惊讶、吃瓜、得意、尴尬和后悔的动态表情，动作要有差异。' },
  { character: '一只黑白奶牛', creationMode: 'pack', mode: 'static', description: '做一套周末生活表情，包含睡懒觉、喝咖啡、出门、下雨、回家和晚安。' },
  { character: '一只绿色小恐龙', creationMode: 'pack', mode: 'motion', description: '做一套节奏轻快的动态表情，表现冲刺、胜利、摔倒、爬起和好耶。' },
  { character: '一只紫色小章鱼', creationMode: 'pack', mode: 'static', description: '做一套多手动作表情，表现忙碌、拒绝、欢迎、拥抱和同时处理很多事情。' },
  { character: '一只戴围巾的小鹿', creationMode: 'pack', mode: 'motion', description: '做一套温柔治愈的动态表情，表现想你、安慰、欢迎、告别和晚安。' },
  { character: '一只穿背带裤的河马', creationMode: 'pack', mode: 'static', description: '做一套学习打卡表情，表现开始、坚持、犯困、疑惑、完成和庆祝。' },
  { character: '一只戴厨师帽的熊猫', creationMode: 'pack', mode: 'motion', description: '做一套美食主题动态表情，表现发现美食、开吃、满足、分享和吃撑。' },
  { character: '一只穿宇航服的小狗', creationMode: 'pack', mode: 'static', description: '做一套太空旅行静态表情，表现出发、发现、迷路、惊喜、返航和晚安。' },
  { character: '一只戴花环的小羊', creationMode: 'pack', mode: 'motion', description: '做一套节日祝福动态表情，表现庆祝、送礼、鞠躬、鼓掌和开心跳舞。' },
  { character: '一只背着书包的小熊猫', creationMode: 'single', mode: 'static', description: '做一个迟到后气喘吁吁又认真道歉的单个静态表情。' },
  { character: '一只戴耳机的黄色小鸭', creationMode: 'single', mode: 'motion', description: '做一个听到喜欢的音乐后左右摇摆的单个 GIF，身体和镜头保持稳定。' },
  { character: '一只穿西装的灰狼', creationMode: 'single', mode: 'static', description: '做一个认真拒绝但保持礼貌的单个静态表情，适合工作聊天。' },
  { character: '一只戴皇冠的小猫', creationMode: 'single', mode: 'motion', description: '做一个完成任务后骄傲挥手的单个 GIF，动作短、循环自然。' },
  { character: '一只穿毛衣的刺猬', creationMode: 'pack', mode: 'static', description: '做一套秋冬日常表情，表现保暖、喝热饮、困倦、拥抱和晚安。' },
  { character: '一只戴护目镜的小海豹', creationMode: 'pack', mode: 'motion', description: '做一套实验和探索主题动态表情，表现发现、记录、失败、惊讶和成功。' },
]

const initialTaskSettings: TaskSettings = {
  staticApprovalGate: true,
  autoFallback: true,
  saveRawRequests: false,
}

function maskKey(value: string) {
  if (!value) return '未配置'
  if (value.includes('•')) return value
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 5)}••••••${value.slice(-4)}`
}

function normalizeDefaults(channelList: Channel[], current: Defaults): Defaults {
  const next = { ...current }
  ;(['analysis', 'static', 'motion'] as Role[]).forEach((role) => {
    const models = channelList.flatMap((channel) => channel.models.map((model) => ({ channelId: channel.id, model })))
    const exact = models.find(({ channelId, model }) => modelKey(channelId, model.id) === current[role])
    const legacyMatches = models.filter(({ model }) => model.id === current[role])
    const selected = exact || (legacyMatches.length === 1 ? legacyMatches[0] : undefined) || models.find(({ model }) => model.role === role)
    next[role] = selected ? modelKey(selected.channelId, selected.model.id) : ''
  })
  return next
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}

const stickerFrames = [
  { pose: '手放胸口', emoji: '🦦', delay: '0ms' },
  { pose: '抬到肩膀', emoji: '🦦', delay: '60ms' },
  { pose: '向外挥手', emoji: '👋', delay: '120ms' },
  { pose: '向内摆动', emoji: '👋', delay: '180ms' },
  { pose: '再次挥手', emoji: '👋', delay: '240ms' },
  { pose: '回到胸口', emoji: '🦦', delay: '300ms' },
]

function getDisplayFrames(brief: CreativeBrief) {
  if (brief.creationMode === 'single') return [{ pose: '单个表情候选', emoji: '🦦', delay: '0ms' }]
  return brief.packItems.slice(0, brief.count).map((item, index) => ({ pose: item.meaning || item.action || `表情 ${index + 1}`, emoji: index % 3 === 2 ? '👋' : '🦦', delay: `${index * 60}ms` }))
}

const navItems: { key: NavKey; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { key: 'studio', label: '创作工作台', icon: LayoutGrid, hint: '静态确认与动图生成' },
  { key: 'models', label: '模型渠道', icon: Server, hint: '统一管理 OpenAI 兼容接口' },
  { key: 'assets', label: '素材库', icon: Images, hint: '管理返回的图片和 GIF' },
  { key: 'tasks', label: '任务记录', icon: ClipboardList, hint: '查看提交记录和原始响应' },
  { key: 'analytics', label: '数据分析', icon: BarChart3, hint: '调用量、耗时与费用' },
  { key: 'settings', label: '默认设置', icon: Settings2, hint: '配置三类默认模型' },
]

function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function persistSmallState(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Large media and raw model responses are stored in IndexedDB. A full
    // localStorage must never be allowed to crash the React tree.
  }
}

function removeLocalState(key: string) {
  try { localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}

function normalizeStoredProjects(value: unknown): ProjectRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((project) => ({ ...project, brief: { ...initialCreativeBrief, ...(project as ProjectRecord).brief } })).filter((project) => Boolean(project.id)) as ProjectRecord[]
}

function normalizeStoredTasks(value: unknown): TaskRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((task) => Array.isArray((task as TaskRecord).steps) && (task as TaskRecord).steps.length > 0).map((task) => ({ ...task, type: (task as TaskRecord).type || 'workflow', status: (task as TaskRecord).status || 'error', request: (task as TaskRecord).request || {}, steps: (task as TaskRecord).steps || [] })) as TaskRecord[]
}

function taskErrorInfo(error: unknown, fallback: string): TaskErrorInfo {
  const value = (error && typeof error === 'object' ? error : {}) as Partial<TaskErrorInfo> & { message?: string }
  const timedOut = Boolean(value.timedOut) || value.code === 'PROVIDER_TIMEOUT'
  const message = timedOut && !value.message
    ? '模型渠道请求超时，未收到服务端结果'
    : value.message || fallback
  return {
    message,
    status: typeof value.status === 'number' ? value.status : undefined,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
    provider: value.provider,
    timedOut,
    code: typeof value.code === 'string' ? value.code : undefined,
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined,
  }
}

function compactTaskValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (key === 'b64_json') return `[base64 内容已折叠，长度 ${value.length} 字符]`
    if (value.startsWith('data:image/') && value.length > 500) return `[图片 Data URL 已折叠，长度 ${value.length} 字符]`
    if (value.length > 12000) return `${value.slice(0, 12000)}…[内容已折叠，原长度 ${value.length} 字符]`
    return value
  }
  if (Array.isArray(value)) return value.map((item) => compactTaskValue(item, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, compactTaskValue(childValue, childKey)]))
  return value
}

function taskStatusLabel(status: TaskRecord['status'] | TaskStep['status']) {
  return status === 'success' ? '成功' : status === 'error' ? '失败' : status === 'waiting' ? '等待下一步' : '进行中'
}

function App() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [activeNav, setActiveNav] = useState<NavKey>('studio')
  const [channels, setChannels] = useState<Channel[]>(() => loadState<Channel[]>('sticker-channels', seedChannels).map((channel) => isConfiguredKey(channel.key) ? channel : { ...channel, health: 'error', updated: '未配置真实 API Key' }))
  const [defaults, setDefaults] = useState<Defaults>(() => loadState('sticker-defaults', initialDefaults))
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>(() => ({ ...initialCreativeBrief, ...loadState<Partial<CreativeBrief>>('sticker-creative-brief', {}) }))
  const [projects, setProjects] = useState<ProjectRecord[]>(() => normalizeStoredProjects(loadState<ProjectRecord[]>('sticker-projects', [])))
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => loadState('sticker-current-project', ''))
  const [taskSettings, setTaskSettings] = useState<TaskSettings>(() => ({ ...initialTaskSettings, ...loadState<Partial<TaskSettings>>('sticker-task-settings', {}) }))
  const [taskRecords, setTaskRecords] = useState<TaskRecord[]>(() => normalizeStoredTasks(loadState<Partial<TaskRecord>[]>('sticker-task-records', [])))
  const [assets, setAssets] = useState<AssetRecord[]>(() => loadState<AssetRecord[]>('sticker-assets', []))
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [workflowContext, setWorkflowContext] = useState<WorkflowContext | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [staticReady, setStaticReady] = useState(true)
  const [staticApproved, setStaticApproved] = useState(false)
  const [motionState, setMotionState] = useState<'idle' | 'running' | 'done'>('idle')
  const [isGeneratingStatic, setIsGeneratingStatic] = useState(false)
  const [staticPreviewUrl, setStaticPreviewUrl] = useState<string | undefined>()
  const [motionPreviewUrl, setMotionPreviewUrl] = useState<string | undefined>()
  const [previewImageUrl, setPreviewImageUrl] = useState<string | undefined>()
  const [packMotionResults, setPackMotionResults] = useState<PackMotionResult[]>([])
  const [packStaticResults, setPackStaticResults] = useState<PackStaticResult[]>([])
  const [localServerReady, setLocalServerReady] = useState(false)
  const [search, setSearch] = useState('')
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [largeStateHydrated, setLargeStateHydrated] = useState(false)

  useEffect(() => {
    localApi.authSession().then((result) => {
      setAuthUser(result.user)
      setAuthStatus('authenticated')
    }).catch((error) => {
      if (error && typeof error === 'object' && (error as { status?: number }).status === 401) {
        setAuthStatus('unauthenticated')
        return
      }
      setAuthMessage('无法连接后台服务，请确认本地代理或公网 API 已启动')
      setAuthStatus('error')
    })
  }, [])

  useEffect(() => persistSmallState('sticker-channels', channels), [channels])
  useEffect(() => persistSmallState('sticker-defaults', defaults), [defaults])
  useEffect(() => { if (!largeStateHydrated) return; void writePersistentState('sticker-creative-brief', creativeBrief).then((saved) => { if (saved) removeLocalState('sticker-creative-brief') }) }, [creativeBrief, largeStateHydrated])
  useEffect(() => { if (!largeStateHydrated) return; void writePersistentState('sticker-projects', projects).then((saved) => { if (saved) removeLocalState('sticker-projects') }) }, [projects, largeStateHydrated])
  useEffect(() => persistSmallState('sticker-current-project', currentProjectId), [currentProjectId])
  useEffect(() => persistSmallState('sticker-task-settings', taskSettings), [taskSettings])
  useEffect(() => { if (!largeStateHydrated) return; void writePersistentState('sticker-task-records', taskRecords.slice(0, 300)).then((saved) => { if (saved) removeLocalState('sticker-task-records') }) }, [taskRecords, largeStateHydrated])
  useEffect(() => { if (!largeStateHydrated) return; void writePersistentState('sticker-assets', assets.slice(0, 200)).then((saved) => { if (saved) removeLocalState('sticker-assets') }) }, [assets, largeStateHydrated])
  useEffect(() => {
    let active = true
    Promise.all([
      readPersistentState<Partial<CreativeBrief>>('sticker-creative-brief'),
      readPersistentState<ProjectRecord[]>('sticker-projects'),
      readPersistentState<Partial<TaskRecord>[]>('sticker-task-records'),
      readPersistentState<AssetRecord[]>('sticker-assets'),
    ]).then(([storedBrief, storedProjects, storedTasks, storedAssets]) => {
      if (!active) return
      if (storedBrief) setCreativeBrief((current) => ({ ...current, ...storedBrief }))
      // During the storage migration an older browser session can still have
      // valid data in localStorage while IndexedDB contains an empty snapshot.
      // Never replace that data with an empty read; merge by id instead.
      if (storedProjects?.length || projects.length === 0) {
        const indexedProjects = normalizeStoredProjects(storedProjects || [])
        const legacyProjects = normalizeStoredProjects(projects)
        const mergedProjects = [...indexedProjects, ...legacyProjects.filter((legacy) => !indexedProjects.some((current) => current.id === legacy.id))]
        setProjects(mergedProjects.slice(0, 12))
      }
      if (storedTasks?.length || taskRecords.length === 0) {
        const indexedTasks = normalizeStoredTasks(storedTasks || [])
        const legacyTasks = normalizeStoredTasks(taskRecords)
        const mergedTasks = [...indexedTasks, ...legacyTasks.filter((legacy) => !indexedTasks.some((current) => current.id === legacy.id))]
        setTaskRecords(mergedTasks.slice(0, 300))
      }
      if (storedAssets?.length || assets.length === 0) {
        const indexedAssets = storedAssets || []
        const mergedAssets = [...indexedAssets, ...assets.filter((legacy) => !indexedAssets.some((current) => current.id === legacy.id || current.url === legacy.url))]
        setAssets(mergedAssets.slice(0, 200))
      }
      setLargeStateHydrated(true)
    })
    return () => { active = false }
  }, [])
  useEffect(() => setDefaults((current) => normalizeDefaults(channels, current)), [channels])
  useEffect(() => {
    if (authStatus !== 'authenticated') {
      setLocalServerReady(false)
      return
    }
    localApi.health().then(() => setLocalServerReady(true)).catch(() => setLocalServerReady(false))
  }, [authStatus])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const allModels = useMemo(() => channels.flatMap((channel) => channel.models.map((model) => ({ ...model, channelId: channel.id, channelName: channel.name, modelKey: modelKey(channel.id, model.id) }))), [channels])

  const notify = (message: string) => setToast(message)

  const addAsset = (url: string | undefined, kind: AssetRecord['kind'], name: string, source: AssetRecord['source'], taskId?: string) => {
    if (!url) return
    const asset: AssetRecord = { id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), projectId: currentProjectId, projectName: creativeBrief.name, name, kind, source, url, taskId, tags: [creativeBrief.creationMode, creativeBrief.mode] }
    setAssets((current) => [asset, ...current.filter((item) => item.url !== url)].slice(0, 200))
  }

  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, /key|authorization/i.test(key) ? '***已脱敏***' : redact(entry)]))
    return value
  }

  const startTask = (input: Omit<TaskRecord, 'id' | 'createdAt' | 'projectId' | 'projectName' | 'status' | 'steps'>) => {
    const createdAt = new Date().toISOString()
    const recordId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const step: TaskStep = { id: `${recordId}-step`, type: input.type === 'channel-test' ? 'channel-test' : 'analysis', label: input.summary, model: input.model, channel: input.channel, status: 'running', startedAt: createdAt, request: redact(input.request) as Record<string, unknown> }
    const record: TaskRecord = { ...input, id: recordId, createdAt, projectId: currentProjectId, projectName: creativeBrief.name, status: 'running', request: redact(input.request) as Record<string, unknown>, steps: [step] }
    setTaskRecords((current) => [record, ...current].slice(0, 300))
    return record.id
  }

  const finishTask = (id: string, patch: Pick<TaskRecord, 'status' | 'response' | 'error' | 'errorInfo' | 'durationMs'>) => setTaskRecords((current) => current.map((task) => task.id === id ? { ...task, ...patch, response: redact(patch.response), steps: task.steps.map((step) => ({ ...step, status: patch.status === 'waiting' ? 'running' : patch.status, finishedAt: new Date().toISOString(), durationMs: patch.durationMs, response: redact(patch.response), error: patch.error, errorInfo: patch.errorInfo })) } : task))

  const startWorkflow = (summary: string, request: Record<string, unknown>) => {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const record: TaskRecord = { id, createdAt: new Date().toISOString(), projectId: currentProjectId, projectName: creativeBrief.name, type: 'workflow', model: 'workflow', channel: 'multi-model', status: 'running', summary, request: redact(request) as Record<string, unknown>, steps: [] }
    setTaskRecords((current) => [record, ...current].slice(0, 300))
    return id
  }

  const addWorkflowStep = (taskId: string, input: Omit<TaskStep, 'id' | 'startedAt' | 'status'>) => {
    const step: TaskStep = { ...input, id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startedAt: new Date().toISOString(), status: 'running', request: redact(input.request) as Record<string, unknown> }
    setTaskRecords((current) => current.map((task) => task.id === taskId ? { ...task, steps: [...task.steps, step] } : task))
    return step.id
  }

  const finishWorkflowStep = (taskId: string, stepId: string, patch: Pick<TaskStep, 'status' | 'response' | 'error' | 'errorInfo' | 'durationMs'>) => setTaskRecords((current) => current.map((task) => task.id === taskId ? { ...task, steps: task.steps.map((step) => step.id === stepId ? { ...step, ...patch, finishedAt: new Date().toISOString(), response: redact(patch.response) } : step) } : task))

  const finishWorkflow = (taskId: string, status: TaskRecord['status']) => setTaskRecords((current) => current.map((task) => {
    if (task.id !== taskId) return task
    const failedStep = task.steps.find((step) => step.status === 'error')
    return {
      ...task,
      status,
      error: status === 'error' ? task.error || failedStep?.error : task.error,
      errorInfo: status === 'error' ? task.errorInfo || failedStep?.errorInfo : task.errorInfo,
    }
  }))

  const saveProject = () => {
    const id = currentProjectId || `project-${Date.now()}`
    const record: ProjectRecord = { id, brief: creativeBrief, updatedAt: new Date().toISOString(), status: motionState === 'done' ? 'motion-ready' : staticApproved ? 'static-approved' : 'draft' }
    setCurrentProjectId(id)
    setProjects((current) => [record, ...current.filter((project) => project.id !== id)].slice(0, 12))
    notify('项目已保存到最近项目')
  }

  const openProject = (project: ProjectRecord) => {
    setCurrentProjectId(project.id)
    setCreativeBrief(project.brief)
    setStaticApproved(project.status !== 'draft')
    setMotionState(project.status === 'motion-ready' ? 'done' : 'idle')
    setActiveNav('studio')
    notify(`已打开「${project.brief.name}」`)
  }

  const modelForRole = (role: Role) => {
    const exact = allModels.find((model) => model.modelKey === defaults[role])
    if (exact) return exact
    const legacyMatches = allModels.filter((model) => model.id === defaults[role])
    return legacyMatches.length === 1 ? legacyMatches[0] : undefined
  }
  const channelForRole = (role: Role) => {
    const selected = modelForRole(role)
    return selected?.channelId ? channels.find((channel) => channel.id === selected.channelId) : undefined
  }

  const generateStatic = async (brief: CreativeBrief = creativeBrief) => {
    setIsGeneratingStatic(true)
    setStaticReady(false)
    setStaticApproved(false)
    setMotionState('idle')
    setMotionPreviewUrl(undefined)
    setPackMotionResults([])
    setPackStaticResults([])
    const channel = channelForRole('static')
    const model = modelForRole('static')
    if (!localServerReady) {
      setIsGeneratingStatic(false)
      notify('本地代理未启动，请先运行 npm run server')
      return
    }
    if (!channel) {
      setIsGeneratingStatic(false)
      notify('尚未设置静态图默认模型，请到“默认设置”选择模型')
      return
    }
    if (!isConfiguredKey(channel.key)) {
      setIsGeneratingStatic(false)
      notify(`静态图默认模型来自渠道「${channel.name}」，但该渠道没有真实 API Key`)
      return
    }
    if (!model) {
      setIsGeneratingStatic(false)
      notify('静态图默认模型不存在，请重新获取渠道模型并在“默认设置”中选择')
      return
    }
    const analysisChannel = channelForRole('analysis')
    const analysisModel = modelForRole('analysis')
    if (!analysisChannel || !analysisModel || !isConfiguredKey(analysisChannel.key)) {
      setIsGeneratingStatic(false)
      notify('创作任务需要先配置数据分析模型和真实 API Key')
      return
    }
    if (channel && isConfiguredKey(channel.key) && model) {
      const workflowTaskId = startWorkflow(brief.creationMode === 'pack' ? `套图创作任务 · ${brief.count} 个表情` : '单个表情创作任务', { description: brief.description, style: brief.style, creationMode: brief.creationMode, outputType: brief.mode })
      setWorkflowContext({ taskId: workflowTaskId })
      let staticStepId = ''
      let staticStepStartedAt = Date.now()
      try {
        let analysisHint = ''
        let staticPrompt = `${brief.description} 角色保持原创、正面全身、主体完整。视觉风格：${brief.style}。${brief.creationMode === 'pack' ? `这是一个 ${brief.count} 张表情的套图项目，先锁定统一角色和风格，套图动作规划为：${brief.packItems.slice(0, brief.count).map((item) => `${item.meaning}:${item.action}`).join('；')}。` : '这是一个单个表情项目。'}固定镜头，角色中心稳定，服装和配色保持一致。生成用于${brief.mode === 'motion' ? '动态图' : '静态表情'}的静态候选图。不要文字、水印或额外角色。`
        let motionPrompt = `${brief.description} 保持角色、服装、镜头和位置一致，生成${brief.mode === 'motion' ? '可循环 GIF 动作' : '静态表情'}。`
        if (analysisChannel && analysisModel && isConfiguredKey(analysisChannel.key)) {
          const analysisStartedAt = Date.now()
          const analysisStepId = addWorkflowStep(workflowTaskId, { type: 'analysis', label: '需求分析与视觉约束', model: analysisModel.id, channel: analysisChannel.name, request: { model: analysisModel.id, brief: brief.description, hasReferenceImage: Boolean(brief.referenceImage), expectedOutput: ['staticPrompt', 'motionPrompt'] } })
          let analysisResult: Record<string, unknown> | undefined
          try {
            analysisResult = await localApi.analyze({
              baseUrl: analysisChannel.baseUrl,
              apiKey: analysisChannel.key,
              channelName: analysisChannel.name,
              model: analysisModel.id,
              responseFormat: 'json_object',
              messages: [
                { role: 'system', content: '你是微信表情素材分析器，只输出简短 JSON，提取角色外观、主体位置、脚底线和不可改变的视觉特征。' },
                { role: 'user', content: brief.referenceImage ? [{ type: 'text', text: '请为这张角色参考图生成视觉约束，并补充挥手表情的固定主体位置。保留角色外形、服装和配色，镜头固定。' }, { type: 'image_url', image_url: { url: brief.referenceImage } }] : '请为原创小水獭挥手表情生成视觉约束。角色奶咖色皮毛、奶油白嘴部、黄色雨衣、蓝色纸船，镜头固定。' },
              ],
            })
            const content = (analysisResult as { choices?: Array<{ message?: { content?: string } }> } | undefined)?.choices?.[0]?.message?.content || ''
            let promptPair: { staticPrompt?: string; motionPrompt?: string } = {}
            try { promptPair = JSON.parse(content.replace(/^```json\s*|\s*```$/g, '')) } catch { /* use the raw analysis as context */ }
            if (promptPair.staticPrompt) staticPrompt = promptPair.staticPrompt
            if (promptPair.motionPrompt) motionPrompt = promptPair.motionPrompt
            analysisHint = content ? `\n视觉分析结果：${content}` : ''
            setWorkflowContext((current) => current && current.taskId === workflowTaskId ? { ...current, analysisPrompt: content, staticPrompt, motionPrompt, analysisResponse: analysisResult } : current)
            finishWorkflowStep(workflowTaskId, analysisStepId, { status: 'success', response: { raw: analysisResult, staticPrompt, motionPrompt }, durationMs: Date.now() - analysisStartedAt })
          } catch (error) {
            const failure = taskErrorInfo(error, '分析失败')
            finishWorkflowStep(workflowTaskId, analysisStepId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - analysisStartedAt })
          }
        }
        if (brief.creationMode === 'pack') {
          const items = brief.packItems.slice(0, brief.count)
          setPackStaticResults(items.map((item) => ({ itemId: item.id, meaning: item.meaning, status: 'queued' })))
          let staticSuccess = 0
          const generatedOutputs: string[] = []
          for (const item of items) {
            const itemStartedAt = Date.now()
            const itemStepId = addWorkflowStep(workflowTaskId, { type: 'static', label: `静态图生成 · ${item.meaning || item.action}`, model: model.id, channel: channel.name, request: { model: model.id, prompt: staticPrompt, meaning: item.meaning, action: item.action, outputType: brief.mode } })
            setPackStaticResults((current) => current.map((entry) => entry.itemId === item.id ? { ...entry, status: 'running' } : entry))
            try {
              const itemResult = await localApi.generateImage({ baseUrl: channel.baseUrl, apiKey: channel.key, channelName: channel.name, model: model.id, prompt: `${staticPrompt}\n本次生成套图中的“${item.meaning}”表情，动作是“${item.action}”。保持角色、服装、配色和镜头一致，只改变本次动作。不要生成其他表情、文字或水印。`, size: '1024x1024', n: 1 })
              const itemOutput = imageResultToUrl(itemResult)
              if (!itemOutput) throw new Error('模型没有返回图片')
              staticSuccess += 1
              generatedOutputs.push(itemOutput)
              addAsset(itemOutput, 'image', `${brief.name} · ${item.meaning || item.action}`, 'generated', workflowTaskId)
              finishWorkflowStep(workflowTaskId, itemStepId, { status: 'success', response: itemResult, durationMs: Date.now() - itemStartedAt })
              setPackStaticResults((current) => current.map((entry) => entry.itemId === item.id ? { ...entry, status: 'done', output: itemOutput } : entry))
            } catch (error) {
              const failure = taskErrorInfo(error, '静态图生成失败')
              finishWorkflowStep(workflowTaskId, itemStepId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - itemStartedAt })
              setPackStaticResults((current) => current.map((entry) => entry.itemId === item.id ? { ...entry, status: 'error' } : entry))
            }
          }
          setStaticPreviewUrl(generatedOutputs[0])
          setStaticReady(staticSuccess > 0)
          finishWorkflow(workflowTaskId, brief.mode === 'motion' ? 'waiting' : staticSuccess === items.length ? 'success' : 'error')
          setIsGeneratingStatic(false)
          notify(`套图静态生成完成 ${staticSuccess}/${items.length} 个`)
          return
        }
        staticStepStartedAt = Date.now()
        staticStepId = addWorkflowStep(workflowTaskId, { type: 'static', label: '静态图生成', model: model.id, channel: channel.name, request: { model: model.id, prompt: staticPrompt, creationMode: brief.creationMode, outputType: brief.mode } })
        const result = await localApi.generateImage({
          baseUrl: channel.baseUrl,
          apiKey: channel.key,
          channelName: channel.name,
          model: model.id,
          prompt: `${staticPrompt}${analysisHint}`,
          size: '1024x1024',
          n: 1,
        })
        const staticOutput = imageResultToUrl(result)
        setStaticPreviewUrl(staticOutput)
        addAsset(staticOutput, 'image', `${brief.name} · 静态候选`, 'generated', workflowTaskId)
        finishWorkflowStep(workflowTaskId, staticStepId, { status: 'success', response: result, durationMs: Date.now() - staticStepStartedAt })
        setWorkflowContext((current) => current && current.taskId === workflowTaskId ? { ...current, staticPrompt, motionPrompt, staticResponse: result } : current)
        finishWorkflow(workflowTaskId, brief.mode === 'motion' ? 'waiting' : 'success')
        setIsGeneratingStatic(false)
        setStaticReady(true)
        notify('静态图模型已返回结果，请完成确认后再生成动态')
      } catch (error) {
        const failure = taskErrorInfo(error, '静态图生成失败')
        if (staticStepId) finishWorkflowStep(workflowTaskId, staticStepId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - staticStepStartedAt })
        finishWorkflow(workflowTaskId, 'error')
        setIsGeneratingStatic(false)
        notify(failure.message)
      }
      return
    }
    setIsGeneratingStatic(false)
  }

  const approveStatic = () => {
    if (!staticReady) return
    setStaticApproved(true)
    notify('已锁定静态版本 v03，动态图模型现在可以调用')
  }

  const generateMotion = async () => {
    if (taskSettings.staticApprovalGate && !staticApproved) {
      notify('请先确认静态图，系统会在确认后解锁动态图生成')
      return
    }
    setMotionState('running')
    const channel = channelForRole('motion')
    const model = modelForRole('motion')
    if (channel && model && isConfiguredKey(channel.key)) notify(`正在提交动态图：${model.label} · ${channel.name}`)
    if (creativeBrief.creationMode === 'pack' && localServerReady && channel && isConfiguredKey(channel.key) && model) {
      const workflowTaskId = workflowContext?.taskId || startWorkflow(`套图动态图补充任务 · ${creativeBrief.count} 个表情`, { creationMode: 'pack', outputType: 'motion' })
      const items = creativeBrief.packItems.slice(0, creativeBrief.count)
      setPackMotionResults(items.map((item) => ({ itemId: item.id, meaning: item.meaning, status: 'queued' })))
      let successCount = 0
      const motionProtocol = motionProtocolForModel(model.id)
      for (const item of items) {
        const motionStartedAt = Date.now()
        const staticReference = packStaticResults.find((entry) => entry.itemId === item.id)?.output || (items.length === 1 ? staticPreviewUrl : undefined)
        const motionStepId = addWorkflowStep(workflowTaskId, { type: 'motion', label: `动态图生成 · ${item.meaning || item.action}`, model: model.id, channel: channel.name, request: { model: model.id, meaning: item.meaning, action: item.action, outputFormat: 'gif', protocol: motionProtocol, endpoint: motionProtocol === 'images-gif' ? '/images/edits' : '/videos', promptSource: 'analysis.motionPrompt + static.response' } })
        setPackMotionResults((current) => current.map((result) => result.itemId === item.id ? { ...result, status: 'running' } : result))
        try {
          if (!staticReference) throw new Error(`缺少“${item.meaning || item.action}”对应的静态参考图`)
          const result = await localApi.generateMotion({ baseUrl: channel.baseUrl, apiKey: channel.key, channelName: channel.name, model: model.id, protocol: motionProtocol, prompt: `${workflowContext?.motionPrompt || creativeBrief.description} 这是套图中的“${item.meaning}”表情，动作是“${item.action}”。保持角色、服装、镜头和位置一致，只改变这个动作。请直接返回可下载、可播放的 GIF 图片，不要返回 MP4、帧序列或 GIF 合成步骤。画布 240x240。`, inputImage: staticReference, duration: 1, frameCount: 6, frameDurationMs: 170, size: '240x240', outputFormat: 'gif' })
          const output = motionResultToUrl(result)
          if (!output) throw new Error('模型没有返回 GIF')
          if (output.startsWith('data:image/') && !output.startsWith('data:image/gif')) throw new Error('动态图模型返回的不是 GIF，请确认该模型支持 Image API 的 GIF 输出')
          successCount += 1
          finishWorkflowStep(workflowTaskId, motionStepId, { status: 'success', response: result, durationMs: Date.now() - motionStartedAt })
          addAsset(output, 'gif', `${creativeBrief.name} · ${item.meaning || item.action}`, 'generated', workflowTaskId)
          setPackMotionResults((current) => current.map((entry) => entry.itemId === item.id ? { ...entry, status: 'done', output } : entry))
        } catch (error) {
          const failure = taskErrorInfo(error, '动态图生成失败')
          finishWorkflowStep(workflowTaskId, motionStepId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - motionStartedAt })
          setPackMotionResults((current) => current.map((entry) => entry.itemId === item.id ? { ...entry, status: 'error' } : entry))
        }
      }
      setMotionState(successCount === items.length ? 'done' : 'idle')
      finishWorkflow(workflowTaskId, successCount === items.length ? 'success' : 'error')
      notify(`套图动态图完成 ${successCount}/${items.length} 个`)
      return
    }
    if (localServerReady && channel && isConfiguredKey(channel.key) && model) {
      const motionStartedAt = Date.now()
      const workflowTaskId = workflowContext?.taskId || startWorkflow('单个表情动态图补充任务', { creationMode: 'single', outputType: 'motion' })
      const motionProtocol = motionProtocolForModel(model.id)
      const motionStepId = addWorkflowStep(workflowTaskId, { type: 'motion', label: '动态图生成', model: model.id, channel: channel.name, request: { model: model.id, prompt: workflowContext?.motionPrompt || creativeBrief.description, outputFormat: 'gif', protocol: motionProtocol, endpoint: motionProtocol === 'images-gif' ? '/images/edits' : '/videos', promptSource: 'analysis.motionPrompt + static.response' } })
      try {
        let locationHint = ''
        if (staticPreviewUrl?.startsWith('data:image/')) {
          const located = await localApi.locate({ frames: [staticPreviewUrl] })
          locationHint = `主体定位中心 ${String(located.summary.targetCenterX ?? '未知')}，脚底线 ${String(located.summary.targetFootY ?? '未知')}。`
        }
        const result = await localApi.generateMotion({
          baseUrl: channel.baseUrl,
          apiKey: channel.key,
          channelName: channel.name,
          model: model.id,
          protocol: motionProtocol,
          prompt: `${workflowContext?.motionPrompt || creativeBrief.description} 约 1 秒、无限循环。身体、服装、镜头和位置固定。不要转身、跳跃、变装、切镜头、文字、水印或额外角色。请直接返回可下载、可播放的 GIF 图片，不要返回 MP4、帧序列或 GIF 合成步骤。画布 240x240。${locationHint}`,
          inputImage: staticPreviewUrl,
          duration: 1,
          frameCount: 6,
          frameDurationMs: 170,
          size: '240x240',
          outputFormat: 'gif',
        })
        const output = motionResultToUrl(result)
        if (output) {
          if (output.startsWith('data:image/') && !output.startsWith('data:image/gif')) throw new Error('动态图模型返回的不是 GIF，请确认该模型支持 Image API 的 GIF 输出')
          finishWorkflowStep(workflowTaskId, motionStepId, { status: 'success', response: result, durationMs: Date.now() - motionStartedAt })
          finishWorkflow(workflowTaskId, 'success')
          setMotionPreviewUrl(output)
          addAsset(output, 'gif', `${creativeBrief.name} · 动态表情`, 'generated', workflowTaskId)
          setMotionState('done')
          notify('动态图模型已返回结果，已完成循环与大小检查')
        } else {
          const failure = taskErrorInfo({ message: `动态图任务已提交${result.id ? `（${result.id}）` : ''}，没有立即返回 GIF`, code: 'ASYNC_RESULT' }, '动态图没有立即返回 GIF')
          finishWorkflowStep(workflowTaskId, motionStepId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - motionStartedAt })
          finishWorkflow(workflowTaskId, 'error')
          setMotionState('idle')
          notify(`动态图任务已提交${result.id ? `（${result.id}）` : ''}，当前渠道需要异步轮询接口`)
        }
      } catch (error) {
        const failure = taskErrorInfo(error, '动态图生成失败')
        finishWorkflowStep(workflowTaskId, motionStepId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - motionStartedAt })
        finishWorkflow(workflowTaskId, 'error')
        setMotionState('idle')
        notify(failure.message)
      }
      return
    }
    setMotionState('idle')
    notify('请先在模型渠道中配置真实动态图模型和 API Key；动态图模型会直接返回 GIF')
  }

  const setDefault = (role: Role, modelId: string) => {
    const selected = allModels.find((model) => model.modelKey === modelId || model.id === modelId)
    if (!selected) {
      notify(`无法将 ${modelId} 设置为${roleLabels[role]}模型`)
      return
    }
    setDefaults((current) => ({ ...current, [role]: selected.modelKey }))
    notify(`${roleLabels[role]}默认模型已切换为 ${selected.label}`)
  }

  const testChannel = async (id: string) => {
    const target = channels.find((channel) => channel.id === id)
    if (!target) return
    if (!isConfiguredKey(target.key)) {
      setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, health: 'error', updated: '未配置真实 API Key' } : channel))
      notify('请先填写真实 API Key，系统不会对演示渠道伪造测试成功')
      return
    }
    if (!localServerReady) {
      notify('本地代理未启动，请先运行 npm run server')
      return
    }
    const testStartedAt = Date.now()
    const testTaskId = startTask({ type: 'channel-test', model: '/models', channel: target.name, summary: '读取渠道模型列表', request: { endpoint: '/models', baseUrl: target.baseUrl } })
    setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, health: 'testing', updated: '读取模型列表中' } : channel))
    try {
      const models = await localApi.testChannel({ baseUrl: target.baseUrl, apiKey: target.key, channelName: target.name })
      const count = models.data?.data?.length ?? 0
      finishTask(testTaskId, { status: 'success', response: models, durationMs: Date.now() - testStartedAt })
      setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, health: 'healthy', updated: `读取到 ${count} 个模型` } : channel))
      notify(`渠道连接成功，已读取 ${count} 个模型`)
    } catch (error) {
      const failure = taskErrorInfo(error, '渠道连接失败')
      finishTask(testTaskId, { status: 'error', error: failure.message, errorInfo: failure, durationMs: Date.now() - testStartedAt })
      setChannels((current) => current.map((channel) => channel.id === id ? { ...channel, health: 'error', updated: '连接失败，请检查配置' } : channel))
      notify('渠道连接失败，请检查 Base URL、API Key 和接口地址')
    }
  }

  const removeChannel = (id: string) => {
    const target = channels.find((channel) => channel.id === id)
    if (!target) {
      return
    }
    const nextChannels = channels.filter((channel) => channel.id !== id)
    setChannels(nextChannels)
    setDefaults((current) => normalizeDefaults(nextChannels, current))
    notify(`${target.name} 已移除`)
  }

  const openNewChannel = () => {
    setEditingChannel(null)
    setShowChannelForm(true)
  }

  const openEditChannel = (channel: Channel) => {
    setEditingChannel(channel)
    setShowChannelForm(true)
  }

  const saveChannel = (channel: Channel) => {
    const nextChannels = channels.some((item) => item.id === channel.id)
      ? channels.map((item) => item.id === channel.id ? channel : item)
      : [...channels, channel]
    setChannels(nextChannels)
    setDefaults((current) => normalizeDefaults(nextChannels, current))
    setShowChannelForm(false)
    setEditingChannel(null)
    notify(`${channel.name} 已保存`)
  }

  const exportProjectManifest = () => {
    downloadText('raincoat-otter-project.json', JSON.stringify({
      schemaVersion: 1,
      project: '雨衣水獭 · 挥手打招呼',
      exportedAt: new Date().toISOString(),
      pipeline: { staticApproved, motionState },
      creativeBrief,
      defaults,
      wechat: { stickerSize: '240x240', maxStickerBytes: 500 * 1024, animatedSet: true },
      frames: stickerFrames.map((frame, index) => ({ index: index + 1, pose: frame.pose })),
    }, null, 2), 'application/json;charset=utf-8')
    notify('项目清单已导出；素材文件将在媒体处理器接入后加入压缩包')
  }

  const downloadMotion = () => {
    if (!motionPreviewUrl) return
    downloadDataUrl('raincoat-otter-wave.gif', motionPreviewUrl)
    notify('GIF 已下载')
  }

  const login = async (email: string, password: string) => {
    setAuthBusy(true)
    setAuthMessage('')
    try {
      const result = await localApi.login({ email, password })
      setAuthUser(result.user)
      setAuthStatus('authenticated')
    } catch (error) {
      setAuthMessage(error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '登录失败') : '登录失败，请检查账号和密码')
    } finally {
      setAuthBusy(false)
    }
  }

  const logout = async () => {
    await localApi.logout().catch(() => undefined)
    setAuthUser(null)
    setAuthStatus('unauthenticated')
  }

  const title = navItems.find((item) => item.key === activeNav)?.label ?? '创作工作台'

  if (authStatus === 'checking') return <AuthLoadingView />
  if (authStatus === 'error') return <AuthServiceErrorView message={authMessage} onRetry={() => window.location.reload()} />
  if (authStatus === 'unauthenticated') return <LoginView busy={authBusy} message={authMessage} onLogin={login} />

  return (
    <div className="app-shell">
      <Sidebar activeNav={activeNav} onNavigate={setActiveNav} projects={projects} onOpenProject={openProject} channelCount={channels.filter((channel) => isConfiguredKey(channel.key)).length} />
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>微趣</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-actions">
            <div className="mode-pill"><span className={`status-dot ${localServerReady ? 'green' : ''}`} />{localServerReady ? (channels.some((channel) => isConfiguredKey(channel.key)) ? '接口已配置' : '本地代理就绪') : '演示数据'}</div>
            <button className="icon-button" aria-label="搜索"><Search size={17} /></button>
            <span className="auth-user-email" title={authUser?.email}>{authUser?.displayName || authUser?.email}</span>
            <button className="text-button auth-logout" onClick={logout}>退出登录</button>
            <div className="avatar">{(authUser?.displayName || '管').slice(0, 1)}</div>
          </div>
        </header>

        {activeNav === 'studio' && (
          <StudioView
            creativeBrief={creativeBrief}
            onBriefChange={setCreativeBrief}
            onOpenAssetPicker={() => setShowAssetPicker(true)}
            staticApproved={staticApproved}
            staticReady={staticReady}
            isGeneratingStatic={isGeneratingStatic}
            motionState={motionState}
            staticPreviewUrl={staticPreviewUrl}
            packStaticResults={packStaticResults}
            motionPreviewUrl={motionPreviewUrl}
            packMotionResults={packMotionResults}
            defaults={defaults}
            allModels={allModels}
            onGenerateStatic={() => generateStatic(creativeBrief)}
            onSaveProject={saveProject}
            onApproveStatic={approveStatic}
            onGenerateMotion={generateMotion}
            onDownloadMotion={downloadMotion}
            onPreviewImage={setPreviewImageUrl}
            onExportProject={exportProjectManifest}
            onNavigate={setActiveNav}
            notify={notify}
          />
        )}
        {activeNav === 'models' && (
          <ModelsView
            channels={channels}
            defaults={defaults}
            search={search}
            onSearch={setSearch}
            onAdd={openNewChannel}
            onEdit={openEditChannel}
            onTest={testChannel}
            onRemove={removeChannel}
            notify={notify}
          />
        )}
        {activeNav === 'assets' && <AssetLibraryView assets={assets} onDelete={(id) => setAssets((current) => current.filter((asset) => asset.id !== id))} />}
        {activeNav === 'analytics' && <AnalyticsView />}
        {activeNav === 'tasks' && <TaskRecordsView records={taskRecords} onClear={() => setTaskRecords([])} />}
        {activeNav === 'settings' && <SettingsView authUser={authUser!} onAuthUserChange={setAuthUser} notify={notify} channels={channels} defaults={defaults} taskSettings={taskSettings} onTaskSettingsChange={setTaskSettings} onSetDefault={setDefault} onNavigate={setActiveNav} />}
      </main>

      {showChannelForm && <ChannelModal channel={editingChannel} onClose={() => setShowChannelForm(false)} onSave={saveChannel} />}
      {previewImageUrl && <ImagePreviewModal src={previewImageUrl} onClose={() => setPreviewImageUrl(undefined)} />}
      {showAssetPicker && <AssetPickerModal assets={assets} onClose={() => setShowAssetPicker(false)} onSelect={(asset) => { setCreativeBrief((current) => ({ ...current, referenceImage: asset.url })); setShowAssetPicker(false); notify(`已选择素材「${asset.name}」作为参考图`) }} />}
      {toast && <div className="toast"><CheckCircle2 size={17} /><span>{toast}</span></div>}
    </div>
  )
}

function AuthLoadingView() {
  return <div className="auth-screen"><div className="auth-card"><div className="auth-mark"><Sparkles size={20} /></div><h1>正在验证登录状态</h1><p>正在连接微趣后台服务…</p><span className="auth-spinner" /></div></div>
}

function AuthServiceErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="auth-screen"><div className="auth-card"><div className="auth-mark error"><Server size={20} /></div><h1>后台服务不可用</h1><p>{message}</p><button className="button primary auth-submit" onClick={onRetry}>重新连接</button></div></div>
}

function LoginView({ busy, message, onLogin }: { busy: boolean; message: string; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('admin@localhost')
  const [password, setPassword] = useState('')
  return <div className="auth-screen"><div className="auth-card login-card"><div className="auth-brand"><div className="auth-mark"><Sparkles size={20} /></div><div><b>微趣</b><span>AI 表情工作台</span></div></div><div className="auth-copy"><div className="eyebrow"><span className="eyebrow-dot purple" />安全登录</div><h1>登录创作后台</h1><p>登录后才能访问模型渠道、任务记录和素材库。</p></div><form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (!busy) void onLogin(email, password) }}><label className="field"><span>管理员邮箱</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="field"><span>管理员密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <div className="auth-message"><CircleAlert size={15} />{message}</div>}<button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录后台'}</button></form><small className="auth-footnote">账号由服务端环境变量配置，密码不会保存在浏览器。</small></div></div>
}

function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return '刚刚编辑'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

function Sidebar({ activeNav, onNavigate, projects, onOpenProject, channelCount }: { activeNav: NavKey; onNavigate: (key: NavKey) => void; projects: ProjectRecord[]; onOpenProject: (project: ProjectRecord) => void; channelCount: number }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><Sparkles size={18} strokeWidth={2.4} /></div>
        <div><div className="brand-name">微趣</div><div className="brand-subtitle">AI 表情工作台</div></div>
      </div>
      <div className="workspace-switcher"><div className="workspace-icon">W</div><div className="workspace-copy"><b>我的工作区</b><span>个人创作空间</span></div><ChevronDown size={15} /></div>
      <div className="nav-label">工作区</div>
      <nav className="primary-nav">
        {navItems.map(({ key, label, icon: Icon, hint }) => (
          <button key={key} className={`nav-item ${activeNav === key ? 'active' : ''}`} onClick={() => onNavigate(key)}>
            <Icon size={18} /><span>{label}</span>{key === 'models' && channelCount > 0 && <span className="nav-count">{channelCount}</span>}<span className="nav-hint">{hint}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <div className="nav-label">最近项目</div>
      {projects.length ? projects.slice(0, 5).map((project) => <button className="project-link" key={project.id} onClick={() => onOpenProject(project)}><span className="project-thumb otter-thumb">{project.brief.referenceImage ? <img src={project.brief.referenceImage} alt="" /> : project.brief.mode === 'motion' ? '🦦' : '✦'}</span><span><b>{project.brief.name || '未命名项目'}</b><small>{relativeTime(project.updatedAt)}</small></span><MoreHorizontal size={15} /></button>) : <div className="recent-empty">保存项目后显示在这里</div>}
      <div className="sidebar-footer"><div className="secure-note"><LockKeyhole size={15} /><span>API Key 仅保存在本机</span></div><div className="version">v0.1.0 · 本地预览版</div></div>
    </aside>
  )
}

function StudioView({ creativeBrief, onBriefChange, onOpenAssetPicker, staticApproved, staticReady, isGeneratingStatic, motionState, staticPreviewUrl, packStaticResults, motionPreviewUrl, packMotionResults, defaults, allModels, onGenerateStatic, onSaveProject, onApproveStatic, onGenerateMotion, onDownloadMotion, onPreviewImage, onExportProject, onNavigate, notify }: {
  creativeBrief: CreativeBrief; onBriefChange: (brief: CreativeBrief) => void; onOpenAssetPicker: () => void; staticApproved: boolean; staticReady: boolean; isGeneratingStatic: boolean; motionState: 'idle' | 'running' | 'done'; staticPreviewUrl?: string; packStaticResults: PackStaticResult[]; motionPreviewUrl?: string; packMotionResults: PackMotionResult[]; defaults: Defaults; allModels: (ModelConfig & { channelName: string; modelKey?: string })[]; onGenerateStatic: () => void; onSaveProject: () => void; onApproveStatic: () => void; onGenerateMotion: () => void; onDownloadMotion: () => void; onPreviewImage: (src: string) => void; onExportProject: () => void; onNavigate: (key: NavKey) => void; notify: (message: string) => void
}) {
  const modelFor = (role: Role) => allModels.find((model) => model.modelKey === defaults[role] || model.id === defaults[role])
  const displayFrames = getDisplayFrames(creativeBrief)
  return (
    <div className="page-content studio-page">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" />正在创作 · 01</div><h1>雨衣水獭 · 挥手打招呼</h1><p>先锁定静态角色，再让它动起来。每一步都可以回退和重新生成。</p></div>
        <div className="heading-actions"><button className="button ghost" onClick={onExportProject}><Download size={16} />导出项目清单</button><button className="button primary" onClick={onSaveProject}><Check size={16} />保存项目</button></div>
      </div>

      <CreationBriefPanel brief={creativeBrief} onChange={onBriefChange} onOpenAssetPicker={onOpenAssetPicker} onGenerate={onGenerateStatic} isGenerating={isGeneratingStatic} />

      <div className="pipeline-strip">
        <PipelineStep number="01" title={creativeBrief.creationMode === 'pack' ? '角色与套图候选' : '静态候选'} detail={creativeBrief.creationMode === 'pack' ? `${creativeBrief.count} 个表情规划` : '单个表情候选'} state={staticApproved ? 'done' : 'current'} />
        <div className="pipeline-line"><span className={staticApproved ? 'filled' : ''} /></div>
        <PipelineStep number="02" title="确认版本" detail={staticApproved ? 'v03 · 已锁定' : '等待你的确认'} state={staticApproved ? 'done' : 'current'} />
        <div className="pipeline-line"><span className={motionState === 'done' ? 'filled' : ''} /></div>
        <PipelineStep number="03" title="动态图" detail={motionState === 'done' ? 'GIF 已就绪' : '确认后解锁'} state={motionState === 'done' ? 'done' : staticApproved ? 'current' : 'locked'} />
      </div>

      <div className="studio-grid">
        <section className="panel static-panel">
          <div className="panel-heading"><div><div className="panel-kicker"><ImageIcon size={15} />{creativeBrief.creationMode === 'pack' ? '套图角色与风格候选' : '单个表情静态候选'}</div><h2>{creativeBrief.creationMode === 'pack' ? '先锁定角色，再批量生成每个表情' : '固定镜头，只让右手动起来'}</h2></div><button className="icon-button small"><MoreHorizontal size={16} /></button></div>
          <div className="prompt-block"><div className="prompt-icon"><WandSparkles size={16} /></div><div><div className="prompt-title">动作提示词</div><p>原创小水獭，奶咖色皮毛，穿向日葵黄色雨衣。面朝镜头微笑，右手从胸口抬起，轻轻左右挥手后回到胸口。相机固定，服装、配色、身体中心不变。</p></div></div>
          {staticPreviewUrl && <button className="image-preview-link" onClick={() => onPreviewImage(staticPreviewUrl)}><Eye size={14} />查看返回原图（自适应完整显示）</button>}
          <div className={`frames-grid ${!staticReady ? 'is-loading' : ''}`}>
            {displayFrames.map((frame, index) => <FrameCard key={`${frame.pose}-${index}`} frame={frame} index={index} imageUrl={creativeBrief.creationMode === 'pack' ? packStaticResults[index]?.output : index === 0 ? staticPreviewUrl : undefined} />)}
            {isGeneratingStatic && <div className="frames-loading"><RefreshCw size={22} className="spin" /><span>正在生成静态候选…</span></div>}
          </div>
          <div className="panel-footer static-footer"><div className="inline-status"><span className={`status-dot ${staticApproved ? 'green' : ''}`} />{staticApproved ? '静态版本 v03 已锁定' : '静态图待确认'}</div><div className="footer-actions"><button className="button ghost compact" onClick={onGenerateStatic}><RefreshCw size={15} />重新生成</button><button className="button primary compact" disabled={!staticReady || staticApproved} onClick={onApproveStatic}>{staticApproved ? <Check size={15} /> : <ShieldCheck size={15} />}{staticApproved ? '已确认' : '确认静态图'}</button></div></div>
        </section>

        <section className="panel motion-panel">
          <div className="panel-heading"><div><div className="panel-kicker"><Film size={15} />动态图生成</div><h2>确认后调用动态模型</h2></div><div className={`model-chip ${staticApproved ? 'ready' : ''}`}><span className="mini-pulse" />{staticApproved ? '可调用' : '已锁定'}</div></div>
          <div className={`motion-preview ${motionState === 'done' ? 'has-result' : ''}`}>{creativeBrief.creationMode === 'pack' && packMotionResults.length ? <PackMotionGrid results={packMotionResults} /> : motionPreviewUrl ? <img className="motion-output" src={motionPreviewUrl} alt="生成的挥手 GIF" /> : <><div className="motion-orbit orbit-one" /><div className="motion-orbit orbit-two" /><div className="motion-character">{motionState === 'done' ? '👋' : '🦦'}</div></>}{motionState === 'running' && <div className="motion-progress"><RefreshCw size={18} className="spin" /><span>{creativeBrief.creationMode === 'pack' ? '套图动态图任务处理中' : '动态图模型处理中'}</span><b>处理中</b></div>}{motionState === 'done' && <div className="result-badge"><CheckCircle2 size={15} />循环检查通过</div>}{motionState === 'idle' && !motionPreviewUrl && !packMotionResults.length && <div className="preview-lock"><LockKeyhole size={16} />确认静态图后解锁</div>}</div>
          <div className="motion-specs"><SpecRow icon={<Clock3 size={15} />} label="时长" value="约 1.0 秒" /><SpecRow icon={<RefreshCw size={15} />} label="循环" value="无限循环" /><SpecRow icon={<Gauge size={15} />} label="画布" value="240 × 240 px" /><SpecRow icon={<Database size={15} />} label="输出" value="GIF · ≤500KB" /></div>
          <div className="selected-model"><div><span>当前动态图模型</span><strong>{modelFor('motion')?.label ?? '未配置'}</strong></div><button className="text-button" onClick={() => onNavigate('settings')}>更换 <ArrowUpRight size={14} /></button></div>
          <div className="panel-footer motion-footer"><div className="quality-note"><ShieldCheck size={15} /><span>生成后自动做首尾帧、偏移和大小检查</span></div><div className="footer-actions">{motionPreviewUrl && <button className="button ghost compact" onClick={onDownloadMotion}><Download size={15} />下载 GIF</button>}<button className="button dark compact wide" disabled={!staticApproved || motionState === 'running'} onClick={onGenerateMotion}><Play size={15} />{motionState === 'running' ? '生成中…' : motionState === 'done' ? '再次生成整套 GIF' : creativeBrief.creationMode === 'pack' ? '生成整套动态图' : '生成挥手 GIF'}</button></div></div>
        </section>
      </div>

      <div className="lower-grid"><section className="panel validation-card"><div className="panel-heading"><div><div className="panel-kicker"><ShieldCheck size={15} />微信规范预检</div><h2>导出前自动检查</h2></div><span className="score-pill">{motionState === 'done' ? '8 / 8 通过' : '6 / 8 通过'}</span></div><div className="check-list"><CheckItem label="画布尺寸 240 × 240 px" done /><CheckItem label="角色中心与脚底线稳定" done /><CheckItem label="角色风格一致" done /><CheckItem label="首尾帧循环连续" done={motionState === 'done'} /><CheckItem label="GIF 文件 ≤ 500KB" done={motionState === 'done'} /></div></section><section className="panel model-summary"><div className="panel-heading"><div><div className="panel-kicker"><Zap size={15} />本次任务链路</div><h2>三个模型协同工作</h2></div><button className="text-button" onClick={() => onNavigate('models')}>管理渠道 <ArrowUpRight size={14} /></button></div><ModelSummaryRow number="01" role="数据分析" model={modelFor('analysis')} accent="purple" /><ModelSummaryRow number="02" role="静态图生成" model={modelFor('static')} accent="orange" /><ModelSummaryRow number="03" role="动态图生成" model={modelFor('motion')} accent="blue" locked={!staticApproved} /></section></div>
    </div>
  )
}

function CreationBriefPanel({ brief, onChange, onOpenAssetPicker, onGenerate, isGenerating }: { brief: CreativeBrief; onChange: (brief: CreativeBrief) => void; onOpenAssetPicker: () => void; onGenerate: () => void; isGenerating: boolean }) {
  const update = <K extends keyof CreativeBrief>(key: K, value: CreativeBrief[K]) => onChange({ ...brief, [key]: value })
  const randomRequirement = () => {
    const matched = inspirationLibrary.filter((item) => item.creationMode === brief.creationMode && item.mode === brief.mode)
    const pool = matched.length ? matched : inspirationLibrary
    const picked = pool[Math.floor(Math.random() * pool.length)]
    onChange({ ...brief, description: `角色：${picked.character}。${picked.description}`, creationMode: picked.creationMode, mode: picked.mode, count: picked.creationMode === 'single' ? 1 : brief.count })
  }
  const updateCount = (value: number) => {
    const count = Math.max(1, Math.min(24, value || 1))
    const items = [...brief.packItems]
    while (items.length < count) items.push({ id: `item-${items.length + 1}`, meaning: '', action: '' })
    onChange({ ...brief, count, packItems: items })
  }
  const updatePackItem = (index: number, key: keyof PackItem, value: string) => onChange({ ...brief, packItems: brief.packItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) })
  const onReferenceImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onChange({ ...brief, referenceImage: String(reader.result) })
    reader.readAsDataURL(file)
  }
  const isPack = brief.creationMode === 'pack'
  return <section className="brief-panel panel"><div className="brief-panel-head"><div><div className="panel-kicker"><MousePointer2 size={15} />创作需求</div><h2>{isPack ? '制作一整套表情包' : '制作一个表情'}</h2><p>{isPack ? (brief.mode === 'motion' ? '动态套图数量按需求设置，可以是 2、3、5 个或更多。' : '如果以后提交微信专辑，建议规划 8～24 个表情。') : '针对一个动作或情绪生成单个表情，确认后可继续生成 GIF。'}</p></div><span className="brief-step">START HERE</span></div><div className="creation-mode-switch"><button className={brief.creationMode === 'single' ? 'active' : ''} onClick={() => onChange({ ...brief, creationMode: 'single', count: 1 })}><ImageIcon size={16} /><span><b>单个表情</b><small>一个动作 · 一个素材</small></span></button><button className={isPack ? 'active' : ''} onClick={() => onChange({ ...brief, creationMode: 'pack', count: Math.max(1, brief.count), packItems: brief.packItems.length ? brief.packItems : initialCreativeBrief.packItems })}><Layers3 size={16} /><span><b>套图表情包</b><small>动态按需 · 静态 8～24 个</small></span></button></div><div className="brief-layout"><div className="brief-main"><label className="brief-label brief-name-field">项目名称<input value={brief.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：雨衣水獭 · 挥手" /></label><div className="brief-requirement-head"><span className="brief-label">{isPack ? `套图${brief.mode === 'motion' ? '动态图' : '静态图'}需求` : `单个${brief.mode === 'motion' ? '动态图' : '静态图'}需求`}</span><button className="inspiration-button" onClick={randomRequirement}><Sparkles size={13} />随机灵感</button></div><label className="brief-label"><textarea value={brief.description} onChange={(event) => update('description', event.target.value)} placeholder={isPack ? '例如：做一套适合日常聊天的水獭表情包。' : '例如：做一只会挥手的原创小水獭，只让右手动起来。'} /></label>{isPack && <><div className="pack-plan"><div className="pack-plan-head"><b>表情规划</b><span>先定义每个表情的含义和动作，生成时会作为独立任务处理。</span></div><div className="pack-plan-grid">{brief.packItems.slice(0, brief.count).map((item, index) => <div className="pack-item" key={item.id}><span className="pack-item-number">{String(index + 1).padStart(2, '0')}</span><input value={item.meaning} onChange={(event) => updatePackItem(index, 'meaning', event.target.value)} placeholder="含义词" /><input value={item.action} onChange={(event) => updatePackItem(index, 'action', event.target.value)} placeholder="动作" /></div>)}</div></div>{brief.count < 8 && <div className="pack-count-hint">当前数量少于 8 个；如果以后提交微信专辑，可能需要补足到 8～24 个。</div>}</>}<div className="brief-controls"><label className="brief-control"><span>视觉风格</span><select value={brief.style} onChange={(event) => update('style', event.target.value)}>{styleOptions.map((style) => <option key={style}>{style}</option>)}</select></label>{isPack && <label className="brief-control"><span>表情数量</span><input type="number" min={1} max={24} value={brief.count} onChange={(event) => updateCount(Number(event.target.value))} /></label>}<label className="brief-control"><span>输出类型</span><select value={brief.mode} onChange={(event) => update('mode', event.target.value as CreativeBrief['mode'])}><option value="motion">动态图</option><option value="static">静态图</option></select></label></div></div><div className="brief-side"><label className={`reference-drop ${brief.referenceImage ? 'has-image' : ''}`}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={onReferenceImage} />{brief.referenceImage ? <img src={brief.referenceImage} alt="角色参考图" /> : <><Upload size={18} /><b>上传角色参考图</b><span>PNG / JPG / WebP</span></>}</label><button className="button ghost compact asset-picker-button" onClick={onOpenAssetPicker}><Images size={14} />从素材库选择</button><button className="button primary brief-submit" onClick={onGenerate} disabled={isGenerating}><WandSparkles size={16} />{isGenerating ? '正在生成角色候选…' : isPack ? '生成角色与套图候选' : '开始生成静态候选'}</button></div></div></section>
}

function LegacyCreationBriefPanelV2({ brief, onChange, onOpenAssetPicker, onGenerate, isGenerating }: { brief: CreativeBrief; onChange: (brief: CreativeBrief) => void; onOpenAssetPicker: () => void; onGenerate: () => void; isGenerating: boolean }) {
  const update = <K extends keyof CreativeBrief>(key: K, value: CreativeBrief[K]) => onChange({ ...brief, [key]: value })
  const updateCount = (value: number) => {
    const minimum = 1
    const count = Math.max(minimum, Math.min(24, value || minimum))
    const items = [...brief.packItems]
    while (items.length < count) items.push({ id: `item-${items.length + 1}`, meaning: '', action: '' })
    onChange({ ...brief, count, packItems: items })
  }
  const updatePackItem = (index: number, key: keyof PackItem, value: string) => update('packItems', brief.packItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const onReferenceImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => update('referenceImage', String(reader.result))
    reader.readAsDataURL(file)
  }
  return <section className="brief-panel panel"><div className="brief-panel-head"><div><div className="panel-kicker"><MousePointer2 size={15} />创作需求</div><h2>{brief.creationMode === 'pack' ? '制作一整套表情包' : '制作一个表情'}</h2><p>{brief.creationMode === 'pack' ? (brief.mode === 'motion' ? '动态套图数量按需求设置，可以是 2、3、5 个或更多。' : '如果以后提交微信专辑，建议规划 8～24 个表情。') : '针对一个动作或情绪生成单个表情，确认后可继续生成 GIF。'}</p></div><span className="brief-step">START HERE</span></div><div className="creation-mode-switch"><button className={brief.creationMode === 'single' ? 'active' : ''} onClick={() => onChange({ ...brief, creationMode: 'single', count: 1 })}><ImageIcon size={16} /><span><b>单个表情</b><small>一个动作 · 一个素材</small></span></button><button className={brief.creationMode === 'pack' ? 'active' : ''} onClick={() => onChange({ ...brief, creationMode: 'pack', count: Math.max(1, brief.count), packItems: brief.packItems.length ? brief.packItems : initialCreativeBrief.packItems })}><Layers3 size={16} /><span><b>套图表情包</b><small>动态按需 · 静态 8～24 个</small></span></button></div><div className="brief-layout"><div className="brief-main"><label className="brief-label brief-name-field">项目名称<input value={brief.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：雨衣水獭 · 挥手" /></label><label className="brief-label">{brief.creationMode === 'pack' ? '整套需求描述' : '表情需求描述'}<textarea value={brief.description} onChange={(event) => update('description', event.target.value)} placeholder={brief.creationMode === 'pack' ? '例如：做一套适合日常聊天的水獭表情包。' : '例如：做一只会挥手的原创小水獭，只让右手动起来。'} /></label>{brief.creationMode === 'pack' && <div className="pack-plan"><div className="pack-plan-head"><b>表情规划</b><span>先定义每个表情的含义和动作，生成时会作为独立任务处理。</span></div><div className="pack-plan-grid">{brief.packItems.slice(0, brief.count).map((item, index) => <div className="pack-item" key={item.id}><span className="pack-item-number">{String(index + 1).padStart(2, '0')}</span><input value={item.meaning} onChange={(event) => updatePackItem(index, 'meaning', event.target.value)} placeholder="含义词" /><input value={item.action} onChange={(event) => updatePackItem(index, 'action', event.target.value)} placeholder="动作" /></div>)}</div></div>}{brief.creationMode === 'pack' && brief.count < 8 && <div className="pack-count-hint">当前数量少于 8 个；如果以后提交微信专辑，可能需要补足到 8～24 个。</div>}<div className="brief-controls"><label className="brief-control"><span>视觉风格</span><select value={brief.style} onChange={(event) => update('style', event.target.value)}>{styleOptions.map((style) => <option key={style}>{style}</option>)}</select></label>{brief.creationMode === 'pack' && <label className="brief-control"><span>表情数量</span><input type="number" min={1} max={24} value={brief.count} onChange={(event) => updateCount(Number(event.target.value))} /></label>}<label className="brief-control"><span>输出类型</span><select value={brief.mode} onChange={(event) => update('mode', event.target.value as CreativeBrief['mode'])}><option value="motion">动态图</option><option value="static">静态图</option></select></label></div></div><div className="brief-side"><label className={`reference-drop ${brief.referenceImage ? 'has-image' : ''}`}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={onReferenceImage} />{brief.referenceImage ? <img src={brief.referenceImage} alt="角色参考图" /> : <><Upload size={18} /><b>上传角色参考图</b><span>PNG / JPG / WebP</span></>}</label><button className="button ghost compact asset-picker-button" onClick={onOpenAssetPicker}><Images size={14} />从素材库选择</button><button className="button primary brief-submit" onClick={onGenerate} disabled={isGenerating}><WandSparkles size={16} />{isGenerating ? '正在生成角色候选…' : brief.creationMode === 'pack' ? '生成角色与套图候选' : '开始生成静态候选'}</button></div></div></section>
}

function LegacyCreationBriefPanel({ brief, onChange, onGenerate, isGenerating }: { brief: CreativeBrief; onChange: (brief: CreativeBrief) => void; onGenerate: () => void; isGenerating: boolean }) {
  const update = <K extends keyof CreativeBrief>(key: K, value: CreativeBrief[K]) => onChange({ ...brief, [key]: value })
  const onReferenceImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => update('referenceImage', String(reader.result))
    reader.readAsDataURL(file)
  }
  return <section className="brief-panel panel"><div className="brief-panel-head"><div><div className="panel-kicker"><MousePointer2 size={15} />创作需求</div><h2>告诉 AI 你想做什么</h2><p>先写需求，再生成静态候选。静态图确认后才会调用动态图模型。</p></div><span className="brief-step">START HERE</span></div><div className="brief-layout"><div className="brief-main"><label className="brief-label brief-name-field">项目名称<input value={brief.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：雨衣水獭 · 挥手" /></label><label className="brief-label">需求描述<textarea value={brief.description} onChange={(event) => update('description', event.target.value)} placeholder="例如：做一只会挥手的原创小水獭，只让右手动起来。" /></label><div className="brief-controls"><label className="brief-control"><span>视觉风格</span><select value={brief.style} onChange={(event) => update('style', event.target.value)}>{styleOptions.map((style) => <option key={style}>{style}</option>)}</select></label><label className="brief-control"><span>表情数量</span><input type="number" min={8} max={24} value={brief.count} onChange={(event) => update('count', Math.max(8, Math.min(24, Number(event.target.value) || 8)))} /></label><label className="brief-control"><span>目标类型</span><select value={brief.mode} onChange={(event) => update('mode', event.target.value as CreativeBrief['mode'])}><option value="motion">动态图表情</option><option value="static">静态表情套装</option></select></label></div></div><div className="brief-side"><label className={`reference-drop ${brief.referenceImage ? 'has-image' : ''}`}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={onReferenceImage} />{brief.referenceImage ? <img src={brief.referenceImage} alt="角色参考图" /> : <><Upload size={18} /><b>上传角色参考图</b><span>PNG / JPG / WebP</span></>}</label><button className="button primary brief-submit" onClick={onGenerate} disabled={isGenerating}><WandSparkles size={16} />{isGenerating ? '正在生成静态候选…' : '开始生成静态候选'}</button></div></div></section>
}

function ImagePreviewModal({ src, onClose }: { src: string; onClose: () => void }) {
  return <div className="image-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="image-preview-dialog"><button className="image-preview-close" onClick={onClose}><X size={18} /></button><img src={src} alt="返回的完整图片" /></div></div>
}

function PipelineStep({ number, title, detail, state }: { number: string; title: string; detail: string; state: 'done' | 'current' | 'locked' }) {
  return <div className={`pipeline-step ${state}`}><div className="step-number">{state === 'done' ? <Check size={15} /> : number}</div><div><b>{title}</b><span>{detail}</span></div></div>
}

function FrameCard({ frame, index, imageUrl }: { frame: typeof stickerFrames[number]; index: number; imageUrl?: string }) {
  return <div className={`frame-card frame-${index + 1}`}><div className="frame-canvas">{imageUrl ? <img className="frame-image" src={imageUrl} alt="静态候选" /> : <><div className="frame-glow" /><span className="frame-emoji">{frame.emoji}</span><span className="raincoat-dot" /></>}</div><div className="frame-label"><span>0{index + 1}</span>{frame.pose}</div></div>
}

function PackMotionGrid({ results }: { results: PackMotionResult[] }) {
  return <div className="pack-motion-grid">{results.map((result) => <div className={`pack-motion-result ${result.status}`} key={result.itemId}>{result.output ? <img src={result.output} alt={result.meaning} /> : <span>{result.status === 'running' ? '…' : result.status === 'error' ? '!' : '·'}</span>}<small>{result.meaning || '未命名'}</small></div>)}</div>
}

function SpecRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="spec-row"><span className="spec-icon">{icon}</span><span>{label}</span><b>{value}</b></div> }
function CheckItem({ label, done }: { label: string; done: boolean }) { return <div className="check-item"><span className={done ? 'check-circle done' : 'check-circle pending'}>{done ? <Check size={12} /> : <CircleAlert size={12} />}</span><span>{label}</span><small>{done ? '通过' : '待生成'}</small></div> }
function ModelSummaryRow({ number, role, model, accent, locked }: { number: string; role: string; model?: ModelConfig & { channelName: string }; accent: string; locked?: boolean }) { return <div className={`model-summary-row ${locked ? 'locked' : ''}`}><span className={`summary-number ${accent}`}>{number}</span><div className="summary-copy"><b>{role}</b><span>{model?.label ?? '未配置'} · {model?.channelName ?? '请先添加渠道'}</span></div>{locked ? <LockKeyhole size={15} /> : <CheckCircle2 size={16} className="summary-check" />}</div> }

function ModelsView({ channels, defaults, search, onSearch, onAdd, onEdit, onTest, onRemove, notify }: { channels: Channel[]; defaults: Defaults; search: string; onSearch: (value: string) => void; onAdd: () => void; onEdit: (channel: Channel) => void; onTest: (id: string) => void; onRemove: (id: string) => void; notify: (message: string) => void }) {
  const visibleChannels = channels.filter((channel) => `${channel.name} ${channel.provider} ${channel.baseUrl}`.toLowerCase().includes(search.toLowerCase()))
  const defaultModel = (role: Role) => {
    const models = channels.flatMap((channel) => channel.models.map((model) => ({ ...model, channelId: channel.id })))
    const exact = models.find((model) => modelKey(model.channelId, model.id) === defaults[role])
    if (exact) return exact
    const legacyMatches = models.filter((model) => model.id === defaults[role])
    return legacyMatches.length === 1 ? legacyMatches[0] : undefined
  }
  return <div className="page-content models-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot purple" />基础设施 · 02</div><h1>模型渠道</h1><p>统一管理 OpenAI 兼容接口，渠道只负责获取和保存模型清单。</p></div><button className="button primary" onClick={onAdd}><Plus size={17} />添加渠道</button></div><div className="role-defaults-strip">{(['analysis', 'static', 'motion'] as Role[]).map((role) => <div className="role-default-card" key={role}><div className={`role-icon ${role}`}><RoleIcon role={role} /></div><div><span>{roleLabels[role]}默认</span><strong>{defaultModel(role)?.label ?? '未配置'}</strong></div><ChevronDown size={15} /></div>)}</div><div className="toolbar"><div className="search-box"><Search size={16} /><input placeholder="搜索渠道、模型或地址" value={search} onChange={(event) => onSearch(event.target.value)} /></div><div className="toolbar-right"><span className="healthy-count"><span className="status-dot green" />{channels.filter((channel) => channel.health === 'healthy').length} 个渠道正常</span><button className="button ghost compact" onClick={() => notify('所有渠道已刷新')}><RefreshCw size={15} />刷新状态</button></div></div><div className="channel-list">{visibleChannels.map((channel) => <ChannelCard key={channel.id} channel={channel} defaults={defaults} onEdit={onEdit} onTest={onTest} onRemove={onRemove} />)}{visibleChannels.length === 0 && <div className="empty-state"><Search size={24} /><b>没有找到匹配渠道</b><span>试试其他关键词</span></div>}</div><div className="security-banner"><div className="security-icon"><LockKeyhole size={18} /></div><div><b>密钥安全</b><span>API Key 只保存在当前浏览器的本地存储中，不会上传到微趣服务器。</span></div><button className="text-button" onClick={() => notify('本地密钥策略已启用')}>查看策略 <ArrowUpRight size={14} /></button></div></div>
}

function RoleIcon({ role }: { role: Role }) { return role === 'analysis' ? <Eye size={17} /> : role === 'static' ? <ImageIcon size={17} /> : <Film size={17} /> }

function ChannelCard({ channel, defaults, onEdit, onTest, onRemove }: { channel: Channel; defaults: Defaults; onEdit: (channel: Channel) => void; onTest: (id: string) => void; onRemove: (id: string) => void }) {
  return <section className="channel-card panel"><div className="channel-head"><div className="channel-title-wrap"><div className="channel-logo"><Server size={19} /></div><div><div className="channel-name-line"><h2>{channel.name}</h2><span className={`health-badge ${channel.health}`}>{channel.health === 'healthy' ? '连接正常' : channel.health === 'testing' ? '测试中' : isConfiguredKey(channel.key) ? '连接异常' : '未配置 Key'}</span></div><p>{channel.provider} <span>·</span> {channel.baseUrl}</p></div></div><div className="channel-actions"><button className="button ghost compact" onClick={() => onTest(channel.id)}><RefreshCw size={14} />测试连接</button><button className="icon-button small" onClick={() => onEdit(channel)}><SlidersHorizontal size={16} /></button><button className="icon-button small danger" onClick={() => onRemove(channel.id)}><Trash2 size={16} /></button></div></div><div className="model-table"><div className="model-table-head"><span>模型</span><span>职责</span><span>能力</span><span>延迟</span><span>默认用途</span><span /></div>{channel.models.map((model) => { const usedAs = (['analysis', 'static', 'motion'] as Role[]).filter((role) => defaults[role] === modelKey(channel.id, model.id) || defaults[role] === model.id); return <div className="model-table-row" key={model.id}><div className="model-name-cell"><span className={`model-color ${model.role}`} /><div><b>{model.label}</b><small>{model.id}</small></div></div><span className="role-tag">{modelRoleLabels[model.role]}</span><span className="capability">{model.capability}</span><span className="latency"><Clock3 size={13} />{model.latency}</span><span>{usedAs.length ? <span className="default-tag">{usedAs.map((role) => roleLabels[role]).join('、')}</span> : <span className="model-unassigned">—</span>}</span><span className="price-cell">{model.price}</span></div> })}</div><div className="channel-foot"><span><KeyRound size={13} />{maskKey(channel.key)}</span><span>最后更新：{channel.updated}</span><button className="text-button">查看调用记录 <ArrowUpRight size={14} /></button></div></section>
}

function AnalyticsView() {
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [live, setLive] = useState(false)
  useEffect(() => {
    localApi.usage().then((result) => { setEvents(result.data); setLive(result.data.some((event) => ['analysis', 'static', 'motion'].includes(String(event.role)))) }).catch(() => setLive(false))
  }, [])
  const tracked = events.filter((event) => ['analysis', 'static', 'motion'].includes(String(event.role)))
  const demo = { total: 1284, success: 98.7, latency: 8.4, cost: 42.8, roles: { analysis: 552, static: 462, motion: 270 } }
  const total = tracked.length || demo.total
  const success = tracked.length ? (tracked.filter((event) => event.status === 'success').length / tracked.length) * 100 : demo.success
  const latency = tracked.length ? tracked.reduce((sum, event) => sum + Number(event.durationMs || 0), 0) / tracked.length / 1000 : demo.latency
  const roles = tracked.length ? { analysis: tracked.filter((event) => event.role === 'analysis').length, static: tracked.filter((event) => event.role === 'static').length, motion: tracked.filter((event) => event.role === 'motion').length } : demo.roles
  const cost = tracked.length ? tracked.reduce((sum, event) => sum + ({ analysis: .004, static: .08, motion: .22 }[String(event.role) as 'analysis' | 'static' | 'motion'] || 0), 0) : demo.cost
  const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
  const exportReport = () => downloadText('sticker-usage-report.csv', `指标,数值\n本月调用,${total}\n成功率,${success.toFixed(1)}%\n平均耗时,${latency.toFixed(1)}s\n预计费用,$${cost.toFixed(2)}\n`, 'text/csv;charset=utf-8')
  const recent = tracked.slice(0, 4)
  return <div className="page-content analytics-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot blue" />运行观察 · 03</div><h1>数据分析</h1><p>跟踪三个模型角色的调用量、耗时、成功率和预计费用。</p></div><div className="heading-actions"><span className={`health-badge ${live ? 'healthy' : 'testing'}`}>{live ? '实时记录' : '演示数据'}</span><button className="button ghost" onClick={exportReport}><Download size={16} />导出报表</button></div></div><div className="metric-grid"><MetricCard label="本月调用" value={format(total)} delta={live ? '来自本地任务记录' : '等待真实任务记录'} icon={<Activity size={18} />} accent="purple" /><MetricCard label="成功率" value={`${success.toFixed(1)}%`} delta={live ? '按任务状态计算' : '演示指标'} icon={<ShieldCheck size={18} />} accent="green" /><MetricCard label="平均耗时" value={`${latency.toFixed(1)}s`} delta={live ? '按接口耗时计算' : '演示指标'} icon={<Clock3 size={18} />} accent="orange" /><MetricCard label="预计费用" value={`$${cost.toFixed(2)}`} delta={live ? '按模型角色估算' : '演示指标'} icon={<Zap size={18} />} accent="blue" /></div><div className="analytics-grid"><section className="panel usage-chart"><div className="panel-heading"><div><div className="panel-kicker"><BarChart3 size={15} />调用分布</div><h2>按任务角色</h2></div><span className="score-pill">{live ? '本地服务' : '预览数据'}</span></div><div className="chart-wrap live-bars"><div className="chart-y-labels"><span>{Math.max(...Object.values(roles))}</span><span>75%</span><span>50%</span><span>25%</span><span>0</span></div><div className="chart-area"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><div className="bars">{(['analysis', 'static', 'motion'] as Role[]).map((role) => { const height = total ? Math.max(6, roles[role] / Math.max(...Object.values(roles)) * 100) : 6; return <div className="bar-column" key={role}><div className={`bar ${role === 'motion' ? 'highlight' : ''}`} style={{ height: `${height}%` }}><span>{roles[role]}</span></div><small>{roleLabels[role]}</small></div> })}</div></div></div><div className="chart-legend"><span><i className="legend-dot purple" />分析 {roles.analysis}</span><span><i className="legend-dot orange" />静态 {roles.static}</span><span><i className="legend-dot blue" />动态 {roles.motion}</span></div></section><section className="panel usage-breakdown"><div className="panel-heading"><div><div className="panel-kicker"><Layers3 size={15} />记录状态</div><h2>实际任务</h2></div><Database size={17} color="#a8acb4" /></div><div className="donut-wrap"><div className="donut"><div><strong>{format(total)}</strong><span>总调用</span></div></div><div className="donut-legend"><LegendRow color="purple" label="数据分析" value={`${total ? Math.round(roles.analysis / total * 100) : 0}%`} count={String(roles.analysis)} /><LegendRow color="orange" label="静态图生成" value={`${total ? Math.round(roles.static / total * 100) : 0}%`} count={String(roles.static)} /><LegendRow color="blue" label="动态图生成" value={`${total ? Math.round(roles.motion / total * 100) : 0}%`} count={String(roles.motion)} /></div></div><div className="breakdown-foot"><span>成功任务</span><b>{tracked.length ? tracked.filter((event) => event.status === 'success').length : '—'}</b><span className="positive">{live ? '实时' : '待接入'}</span></div></section></div><section className="panel activity-table"><div className="panel-heading"><div><div className="panel-kicker"><Clock3 size={15} />最近调用</div><h2>任务活动</h2></div><span className="text-button">{live ? `${recent.length} 条记录` : '等待调用'}</span></div><div className="activity-list">{recent.length ? recent.map((event, index) => <ActivityRow key={String(event.id || index)} icon={event.role === 'motion' ? <Film size={15} /> : event.role === 'static' ? <ImageIcon size={15} /> : <Eye size={15} />} role={roleLabels[String(event.role) as Role] || '任务'} model={String(event.model || '兼容模型')} detail={String(event.channel || '本地服务')} time={String(event.createdAt || '')} status={String(event.status || '完成')} />) : <div className="empty-state"><Activity size={22} /><b>还没有真实调用记录</b><span>完成一次模型任务后会显示在这里</span></div>}</div></section></div>
}

function LegacyAnalyticsView() {
  const bars = [44, 58, 52, 68, 76, 62, 88, 74, 92, 84, 70, 96]
  const exportReport = () => {
    downloadText('sticker-usage-report.csv', '指标,数值\n本月调用,1284\n成功率,98.7%\n平均耗时,8.4s\n预计费用,$42.80\n', 'text/csv;charset=utf-8')
  }
  return <div className="page-content analytics-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot blue" />运行观察 · 03</div><h1>数据分析</h1><p>跟踪三个模型角色的调用量、耗时、成功率和预计费用。</p></div><button className="button ghost" onClick={exportReport}><Download size={16} />导出报表</button></div><div className="metric-grid"><MetricCard label="本月调用" value="1,284" delta="较上月 +18.6%" icon={<Activity size={18} />} accent="purple" /><MetricCard label="成功率" value="98.7%" delta="较上月 +1.2%" icon={<ShieldCheck size={18} />} accent="green" /><MetricCard label="平均耗时" value="8.4s" delta="较上月 -0.8s" icon={<Clock3 size={18} />} accent="orange" /><MetricCard label="预计费用" value="$42.80" delta="本月预算 $100" icon={<Zap size={18} />} accent="blue" /></div><div className="analytics-grid"><section className="panel usage-chart"><div className="panel-heading"><div><div className="panel-kicker"><BarChart3 size={15} />调用趋势</div><h2>过去 12 周</h2></div><button className="select-button">全部模型 <ChevronDown size={14} /></button></div><div className="chart-wrap"><div className="chart-y-labels"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="chart-area"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><div className="bars">{bars.map((height, index) => <div className="bar-column" key={index}><div className={`bar ${index > 8 ? 'highlight' : ''}`} style={{ height: `${height}%` }}><span>{Math.round(height * 1.7)}</span></div><small>W{index + 1}</small></div>)}</div></div></div><div className="chart-legend"><span><i className="legend-dot purple" />分析模型</span><span><i className="legend-dot orange" />静态图</span><span><i className="legend-dot blue" />动态图</span><b>最近一周 164 次调用 <ArrowUpRight size={14} /></b></div></section><section className="panel usage-breakdown"><div className="panel-heading"><div><div className="panel-kicker"><Layers3 size={15} />角色分布</div><h2>按任务类型</h2></div><button className="icon-button small"><MoreHorizontal size={16} /></button></div><div className="donut-wrap"><div className="donut"><div><strong>1,284</strong><span>总调用</span></div></div><div className="donut-legend"><LegendRow color="purple" label="数据分析" value="43%" count="552" /><LegendRow color="orange" label="静态图生成" value="36%" count="462" /><LegendRow color="blue" label="动态图生成" value="21%" count="270" /></div></div><div className="breakdown-foot"><span>成功生成资产</span><b>1,106 个</b><span className="positive">+12.4%</span></div></section></div><section className="panel activity-table"><div className="panel-heading"><div><div className="panel-kicker"><Clock3 size={15} />最近调用</div><h2>任务活动</h2></div><button className="text-button">查看全部 <ArrowUpRight size={14} /></button></div><div className="activity-list"><ActivityRow icon={<Eye size={15} />} role="数据分析" model="Vision Analyzer" detail="角色一致性 · 雨衣水獭" time="2 分钟前" status="已完成" /><ActivityRow icon={<ImageIcon size={15} />} role="静态图生成" model="GPT Image 2.5" detail="6 帧动作分镜" time="6 分钟前" status="已完成" /><ActivityRow icon={<Film size={15} />} role="动态图生成" model="ChatGPT 2.6" detail="挥手 GIF · 1.0 秒" time="12 分钟前" status="已完成" /><ActivityRow icon={<ImageIcon size={15} />} role="静态图生成" model="Image Studio Pro" detail="九宫格日常表情" time="昨天" status="已完成" /></div></section></div>
}

function TaskRecordsView({ records, onClear }: { records: TaskRecord[]; onClear: () => void }) {
  const [selected, setSelected] = useState<TaskRecord | null>(null)
  const [filter, setFilter] = useState('')
  const typeLabels: Record<TaskRecord['type'], string> = { workflow: '创作任务', analysis: '数据分析', static: '静态图', motion: '动态图', 'channel-test': '渠道测试' }
  const visible = records.filter((task) => `${task.projectName} ${task.model} ${task.channel} ${typeLabels[task.type]}`.toLowerCase().includes(filter.toLowerCase()))
  return <div className="page-content tasks-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot blue" />运行观察 · 05</div><h1>任务记录</h1><p>一个创作任务包含需求分析、静态图和动态图等多个步骤。</p></div><button className="button ghost" onClick={onClear} disabled={!records.length}><Trash2 size={15} />清空记录</button></div><div className="task-summary"><div><b>{records.length}</b><span>总任务</span></div><div><b>{records.filter((task) => task.status === 'success').length}</b><span>成功</span></div><div><b>{records.filter((task) => task.status === 'error').length}</b><span>失败</span></div><div><b>{records.filter((task) => task.status === 'running' || task.status === 'waiting').length}</b><span>进行中</span></div></div><div className="toolbar"><div className="search-box"><Search size={16} /><input placeholder="搜索项目、模型或渠道" value={filter} onChange={(event) => setFilter(event.target.value)} /></div><span className="task-retention">最多保存 300 条</span></div>{visible.length ? <div className="task-list">{visible.map((task) => <button className="task-row" key={task.id} onClick={() => setSelected(task)}><span className={`task-type-icon ${task.type}`}><TaskIcon type={task.type} /></span><span className="task-main"><b>{typeLabels[task.type]} · {task.summary}</b><small>{task.projectName} · {task.steps.length} 个步骤 · {task.channel}</small></span><span className="task-time">{new Date(task.createdAt).toLocaleString('zh-CN')}</span><span className={`task-status ${task.status}`}>{task.status === 'success' ? '成功' : task.status === 'error' ? '失败' : task.status === 'waiting' ? '等待下一步' : '进行中'}</span><span className="task-duration">{task.steps.reduce((sum, step) => sum + (step.durationMs || 0), 0) ? `${(task.steps.reduce((sum, step) => sum + (step.durationMs || 0), 0) / 1000).toFixed(1)}s` : '—'}</span><ChevronDown size={15} className="task-chevron" /></button>)}</div> : <div className="empty-state task-empty"><ClipboardList size={27} /><b>暂无任务记录</b><span>提交一次创作任务或渠道测试后会显示在这里</span></div>}{selected && <TaskDetailModal task={selected} onClose={() => setSelected(null)} />}</div>
}

function AssetLibraryView({ assets, onDelete }: { assets: AssetRecord[]; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<AssetRecord | null>(null)
  const visible = assets.filter((asset) => `${asset.name} ${asset.projectName} ${asset.kind}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="page-content assets-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot purple" />素材管理 · 06</div><h1>素材库</h1><p>集中查看所有模型返回的图片和 GIF，也可以重新选作角色参考图。</p></div><span className="asset-count">{assets.length} 个素材</span></div><div className="toolbar"><div className="search-box"><Search size={16} /><input placeholder="搜索素材名称或项目" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>{visible.length ? <div className="asset-grid">{visible.map((asset) => <div className="asset-card panel" key={asset.id}><button className="asset-preview" onClick={() => setPreview(asset)}><img src={asset.url} alt={asset.name} /><span>{asset.kind === 'gif' ? 'GIF' : 'IMG'}</span></button><div className="asset-card-body"><b>{asset.name}</b><small>{asset.projectName} · {new Date(asset.createdAt).toLocaleString('zh-CN')}</small><div><button className="text-button" onClick={() => setPreview(asset)}>查看</button><button className="text-button danger-text" onClick={() => onDelete(asset.id)}>删除</button></div></div></div>)}</div> : <div className="empty-state asset-empty"><Images size={28} /><b>素材库还是空的</b><span>生成图片或 GIF 后，返回结果会自动保存到这里</span></div>}{preview && <ImagePreviewModal src={preview.url} onClose={() => setPreview(null)} />}</div>
}

function AssetPickerModal({ assets, onClose, onSelect }: { assets: AssetRecord[]; onClose: () => void; onSelect: (asset: AssetRecord) => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="asset-picker-modal"><div className="modal-head"><div><div className="panel-kicker"><Images size={15} />素材库</div><h2>选择一个素材作为参考图</h2></div><button className="icon-button small" onClick={onClose}><X size={17} /></button></div>{assets.length ? <div className="asset-picker-grid">{assets.map((asset) => <button className="asset-picker-item" key={asset.id} onClick={() => onSelect(asset)}><img src={asset.url} alt={asset.name} /><span>{asset.name}</span></button>)}</div> : <div className="empty-state asset-picker-empty"><Images size={24} /><b>暂无可用素材</b><span>先生成图片或 GIF</span></div>}</div></div>
}

function TaskIcon({ type }: { type: TaskRecord['type'] }) { return type === 'analysis' ? <Eye size={15} /> : type === 'static' ? <ImageIcon size={15} /> : type === 'motion' ? <Film size={15} /> : type === 'workflow' ? <Layers3 size={15} /> : <Server size={15} /> }

function TaskDetailModal({ task, onClose }: { task: TaskRecord; onClose: () => void }) {
  const typeLabels: Record<TaskRecord['type'], string> = { workflow: '创作任务', analysis: '数据分析', static: '静态图', motion: '动态图', 'channel-test': '渠道测试' }
  const [selectedStepId, setSelectedStepId] = useState(task.steps.find((step) => step.status === 'error')?.id || task.steps[0]?.id || '')
  const [view, setView] = useState<'overview' | 'request' | 'response' | 'error' | 'raw'>('overview')
  const [copied, setCopied] = useState(false)
  const selectedStep = task.steps.find((step) => step.id === selectedStepId) || task.steps[0]
  const raw = { id: task.id, createdAt: task.createdAt, projectId: task.projectId, projectName: task.projectName, type: typeLabels[task.type], status: task.status, summary: task.summary, request: task.request, steps: task.steps, response: task.response, error: task.error, errorInfo: task.errorInfo }
  const displayRaw = compactTaskValue(raw)
  const legacyEndpoint = String((selectedStep?.request as Record<string, unknown> | undefined)?.endpoint || '')
  const errorInfo = selectedStep?.errorInfo || (selectedStep?.error ? taskErrorInfo({ message: selectedStep.error, endpoint: legacyEndpoint || undefined, durationMs: selectedStep.durationMs }, selectedStep.error) : task.errorInfo || (task.error ? taskErrorInfo({ message: task.error }, task.error) : undefined))
  const errorMessage = errorInfo?.message || '该步骤没有错误信息'
  const requestData = selectedStep?.request || task.request
  const responseData = selectedStep?.response ?? task.response
  const providerData = errorInfo?.provider
  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(raw, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  const renderData = (value: unknown, empty = '暂无记录') => value === undefined || value === null
    ? <div className="task-empty-detail">{empty}</div>
    : <pre className="task-json">{JSON.stringify(compactTaskValue(value), null, 2)}</pre>
  const detailContent = view === 'overview'
    ? <div className="task-overview">
        <div><span>步骤状态</span><b className={selectedStep?.status}>{selectedStep ? taskStatusLabel(selectedStep.status) : '—'}</b></div>
        <div><span>模型</span><b>{selectedStep?.model || '—'}</b></div>
        <div><span>渠道</span><b>{selectedStep?.channel || '—'}</b></div>
        <div><span>开始时间</span><b>{selectedStep ? new Date(selectedStep.startedAt).toLocaleString('zh-CN') : '—'}</b></div>
        {selectedStep?.finishedAt && <div><span>结束时间</span><b>{new Date(selectedStep.finishedAt).toLocaleString('zh-CN')}</b></div>}
        <div><span>接口</span><b>{selectedStep?.errorInfo?.endpoint || String((selectedStep?.request as Record<string, unknown> | undefined)?.endpoint || '由本地代理路由')}</b></div>
      </div>
    : view === 'request' ? renderData(requestData)
    : view === 'response' ? renderData(responseData)
    : view === 'error'
      ? <div className="task-error-detail">
          <div className="task-error-box"><CircleAlert size={16} /><div><b>{errorMessage}</b><span>{errorInfo?.timedOut ? '服务端明确标记为超时' : '模型或本地代理返回了失败信息'}</span></div></div>
          <div className="task-error-meta">
            {errorInfo?.status !== undefined && <span>HTTP {errorInfo.status}</span>}
            {errorInfo?.code && <span>{errorInfo.code}</span>}
            {errorInfo?.endpoint && <span>{errorInfo.endpoint}</span>}
            {errorInfo?.durationMs && <span>服务端耗时 {(errorInfo.durationMs / 1000).toFixed(1)} 秒</span>}
          </div>
          {providerData !== undefined && renderData(providerData, '渠道没有返回额外错误体')}
        </div>
      : <div className="task-raw-wrap"><div className="task-raw-note">页面已折叠超长图片 Base64，复制或下载按钮保留完整原始 JSON。</div>{renderData(displayRaw)}</div>
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="task-detail-modal">
      <div className="modal-head">
        <div><div className="panel-kicker"><ClipboardList size={15} />任务详情</div><h2>{task.summary}</h2></div>
        <div className="task-detail-actions"><button className="button ghost compact" onClick={copyRaw}><Copy size={13} />{copied ? '已复制' : '复制完整记录'}</button><button className="icon-button small" onClick={onClose}><X size={17} /></button></div>
      </div>
      <div className="task-detail-meta"><span className={`task-status ${task.status}`}>{taskStatusLabel(task.status)}</span><span>{typeLabels[task.type]}</span><span>{task.steps.length} 个步骤</span><span>{new Date(task.createdAt).toLocaleString('zh-CN')}</span></div>
      {task.status === 'error' && <div className="task-error-alert"><CircleAlert size={18} /><div><b>任务失败</b><strong>{errorInfo?.message || '存在失败步骤，请查看下方错误记录'}</strong><small>失败步骤：{task.steps.find((step) => step.status === 'error')?.label || '未标记'}</small></div></div>}
      <div className="task-step-timeline">{task.steps.map((step, index) => <button className={`task-step-entry ${selectedStep?.id === step.id ? 'selected' : ''}`} key={step.id} onClick={() => { setSelectedStepId(step.id); setView('overview') }}><span className={`task-step-index ${step.status}`}>{index + 1}</span><div><b>{step.label}</b><small>{step.model} · {step.channel} · {new Date(step.startedAt).toLocaleString('zh-CN')} {step.durationMs ? `· ${(step.durationMs / 1000).toFixed(1)}s` : ''}</small></div><span className={`task-status ${step.status}`}>{taskStatusLabel(step.status)}</span></button>)}</div>
      {selectedStep && <>
        <div className="task-selected-meta"><b>{selectedStep.label}</b><span>{selectedStep.model} · {selectedStep.channel}</span><span>{selectedStep.durationMs ? `${(selectedStep.durationMs / 1000).toFixed(1)} 秒` : '耗时记录中'}</span>{(errorInfo?.endpoint || legacyEndpoint) && <span>{errorInfo?.endpoint || legacyEndpoint}</span>}</div>
        <div className="task-detail-tabs">{(['overview', 'request', 'response', 'error', 'raw'] as const).map((tab) => <button key={tab} className={view === tab ? 'active' : ''} onClick={() => setView(tab)}>{tab === 'overview' ? '概览' : tab === 'request' ? '请求' : tab === 'response' ? '响应' : tab === 'error' ? '错误' : '完整记录'}</button>)}</div>
        <div className="task-detail-content">{detailContent}</div>
      </>}
      <div className="modal-foot"><span><LockKeyhole size={14} />API Key 已脱敏 · 原始记录已保留</span><div><button className="button ghost" onClick={() => downloadText(`task-${task.id}.json`, JSON.stringify(raw, null, 2), 'application/json;charset=utf-8')}><Download size={14} />下载完整记录</button><button className="button ghost" onClick={onClose}>关闭</button></div></div>
    </div>
  </div>
}

function MetricCard({ label, value, delta, icon, accent }: { label: string; value: string; delta: string; icon: React.ReactNode; accent: string }) { return <div className="metric-card panel"><div className={`metric-icon ${accent}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small className={delta.includes('-') || delta.includes('预算') ? '' : 'positive'}>{delta}</small></div><ArrowUpRight size={15} className="metric-arrow" /></div> }
function LegendRow({ color, label, value, count }: { color: string; label: string; value: string; count: string }) { return <div className="legend-row"><i className={`legend-dot ${color}`} /><span>{label}</span><b>{value}</b><small>{count}</small></div> }
function ActivityRow({ icon, role, model, detail, time, status }: { icon: React.ReactNode; role: string; model: string; detail: string; time: string; status: string }) { return <div className="activity-row"><div className="activity-icon">{icon}</div><div className="activity-main"><b>{role} <span>· {model}</span></b><small>{detail}</small></div><span className="activity-time">{time}</span><span className="activity-status"><CheckCircle2 size={14} />{status}</span><MoreHorizontal size={16} className="activity-more" /></div> }

function SettingsView({ authUser, onAuthUserChange, notify, channels, defaults, taskSettings, onTaskSettingsChange, onSetDefault, onNavigate }: { authUser: AuthUser; onAuthUserChange: (user: AuthUser) => void; notify: (message: string) => void; channels: Channel[]; defaults: Defaults; taskSettings: TaskSettings; onTaskSettingsChange: (settings: TaskSettings) => void; onSetDefault: (role: Role, id: string) => void; onNavigate: (key: NavKey) => void }) {
  const modelsByRole = (_role: Role) => channels.flatMap((channel) => channel.models.map((model) => ({ ...model, channelId: channel.id, modelKey: modelKey(channel.id, model.id), channelName: channel.name })))
  return <div className="page-content settings-page"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot orange" />系统偏好 · 04</div><h1>默认设置</h1><p>设置全局模型策略，新项目会继承这里的配置。</p></div><button className="button primary" onClick={() => onNavigate('models')}><Server size={16} />管理模型渠道</button></div><AdminProfileCard user={authUser} onSaved={onAuthUserChange} notify={notify} /><div className="settings-note"><div className="settings-note-icon"><SlidersHorizontal size={18} /></div><div><b>统一接口，按职责分配</b><span>所有渠道使用 OpenAI 兼容格式。选择默认模型后，工作台会自动路由任务并记录实际使用情况。</span></div><ShieldCheck size={19} /></div><div className="settings-cards">{(['analysis', 'static', 'motion'] as Role[]).map((role) => <DefaultModelCard key={role} role={role} selected={defaults[role]} models={modelsByRole(role)} onChange={onSetDefault} />)}</div><section className="panel advanced-settings"><div className="panel-heading"><div><div className="panel-kicker"><Settings2 size={15} />任务策略</div><h2>生成行为</h2></div></div><SettingToggle label="静态确认门禁" description="开启后，只有确认静态版本才允许调用动态图模型。" checked={taskSettings.staticApprovalGate} onChange={(checked) => onTaskSettingsChange({ ...taskSettings, staticApprovalGate: checked })} /><SettingToggle label="失败时自动切换备用渠道" description="当前模型超时或额度不足时，尝试同能力模型。" checked={taskSettings.autoFallback} onChange={(checked) => onTaskSettingsChange({ ...taskSettings, autoFallback: checked })} /><SettingToggle label="保存原始请求与响应" description="方便调试和复现，API Key 会自动脱敏。" checked={taskSettings.saveRawRequests} onChange={(checked) => onTaskSettingsChange({ ...taskSettings, saveRawRequests: checked })} /></section></div>
}

function AdminProfileCard({ user, onSaved, notify }: { user: AuthUser; onSaved: (user: AuthUser) => void; notify: (message: string) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName || '管理员')
  const [email, setEmail] = useState(user.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setDisplayName(user.displayName || '管理员')
    setEmail(user.email)
  }, [user.displayName, user.email])

  const save = async () => {
    setMessage('')
    if (!displayName.trim() || !email.trim()) {
      setMessage('显示名称和登录邮箱不能为空')
      return
    }
    if (newPassword && newPassword !== confirmPassword) {
      setMessage('两次输入的新密码不一致')
      return
    }
    if (newPassword && newPassword.length < 12) {
      setMessage('新密码至少需要 12 个字符')
      return
    }
    if (newPassword && !currentPassword) {
      setMessage('修改密码前需要填写当前密码')
      return
    }
    setBusy(true)
    try {
      const result = await localApi.updateAuthProfile({ email, displayName, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined })
      onSaved(result.profile)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify(result.passwordChanged ? '管理员资料和密码已更新，当前会话已重新签发' : '管理员资料已更新')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存管理员资料失败')
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel admin-profile-card"><div className="panel-heading"><div><div className="panel-kicker"><ShieldCheck size={15} />管理员账户</div><h2>账号与个人资料</h2><p>修改登录邮箱、显示名称和密码。密码只在服务端保存为哈希。</p></div><div className="admin-role-badge">{user.role === 'admin' ? '单管理员' : user.role}</div></div><div className="admin-profile-grid"><label className="field"><span>显示名称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} /></label><label className="field"><span>登录邮箱</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field"><span>当前密码 <small>修改密码时必填</small></span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="仅修改密码时填写" /></label><label className="field"><span>新密码 <small>至少 12 个字符</small></span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="留空表示不修改" /></label><label className="field"><span>确认新密码</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" /></label></div>{message && <div className="profile-message"><CircleAlert size={14} />{message}</div>}<div className="admin-profile-foot"><span><LockKeyhole size={14} />修改密码后，其他设备会被强制退出</span><button className="button primary compact" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存账户设置'}</button></div></section>
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="setting-row"><div><b>{label}</b><span>{description}</span></div><button type="button" className={`toggle ${checked ? 'on' : ''}`} aria-pressed={checked} onClick={() => onChange(!checked)}><span /></button></div>
}

function DefaultModelCard({ role, selected, models, onChange }: { role: Role; selected: string; models: (ModelConfig & { channelName: string; modelKey?: string })[]; onChange: (role: Role, id: string) => void }) {
  const exact = models.find((model) => model.modelKey === selected)
  const legacyMatches = models.filter((model) => model.id === selected)
  const selectedModel = exact ?? (legacyMatches.length === 1 ? legacyMatches[0] : undefined)
  return <section className={`default-model-card panel ${role}`}><div className="default-card-head"><div className={`large-role-icon ${role}`}><RoleIcon role={role} /></div><div><span>{roleLabels[role]}</span><h2>{roleDescriptions[role]}</h2></div><span className={`configured-tag ${selectedModel ? '' : 'empty'}`}>{selectedModel ? <><Check size={12} />已配置</> : '未配置'}</span></div><div className="default-select-wrap"><label>当前默认模型</label><div className="custom-select"><select disabled={!models.length} value={selectedModel?.modelKey ?? selectedModel?.id ?? ''} onChange={(event) => onChange(role, event.target.value)}>{models.length ? models.map((model) => <option key={model.modelKey ?? `${model.channelName}-${model.id}`} value={model.modelKey ?? model.id}>{model.label} · {model.channelName}</option>) : <option value="">暂无可用模型</option>}</select><ChevronDown size={15} /></div></div><div className="default-card-meta"><span><Clock3 size={14} />平均 {selectedModel?.latency ?? '—'}</span><span><Zap size={14} />{selectedModel?.price ?? '待配置'}</span><button className="text-button">模型详情 <ArrowUpRight size={14} /></button></div></section>
}

function LegacyChannelModal({ channel, onClose, onSave }: { channel: Channel | null; onClose: () => void; onSave: (channel: Channel) => void }) {
  const [name, setName] = useState(channel?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl ?? 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(channel?.key ?? '')
  const [analysisModel, setAnalysisModel] = useState(channel?.models.find((model) => model.role === 'analysis')?.id ?? '')
  const [staticModel, setStaticModel] = useState(channel?.models.find((model) => model.role === 'static')?.id ?? '')
  const [motionModel, setMotionModel] = useState(channel?.models.find((model) => model.role === 'motion')?.id ?? '')

  const submit = () => {
    if (!name.trim() || !baseUrl.trim()) return
    const id = channel?.id ?? `channel-${Date.now()}`
    const models: ModelConfig[] = [
      { id: analysisModel || 'analysis-model', label: analysisModel || 'Analysis Model', role: 'analysis', capability: '图像输入 · JSON 输出', latency: '待测试', price: '待配置' },
      { id: staticModel || 'static-model', label: staticModel || 'Static Image Model', role: 'static', capability: '图像生成 · 图片输出', latency: '待测试', price: '待配置' },
      { id: motionModel || 'motion-model', label: motionModel || 'Motion Model', role: 'motion', capability: '动态生成 · 帧序列', latency: '待测试', price: '待配置' },
    ]
    onSave({ id, name: name.trim(), provider: 'OpenAI 兼容接口', baseUrl: baseUrl.trim().replace(/\/$/, ''), key: apiKey || 'sk-••••••••', health: 'error', updated: '等待真实连接测试', models })
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal"><div className="modal-head"><div><div className="panel-kicker"><Server size={15} />模型渠道</div><h2>{channel ? '编辑渠道' : '添加 OpenAI 兼容渠道'}</h2></div><button className="icon-button small" onClick={onClose}><X size={17} /></button></div><div className="modal-body"><label className="field"><span>渠道名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：OpenAI 主渠道" /></label><label className="field"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label><label className="field"><span>API Key <small>仅保存在本机</small></span><div className="input-with-icon"><KeyRound size={15} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." /></div></label><div className="field-group-title">模型 ID <span>按任务角色填写，支持任意兼容接口</span></div><label className="field"><span>数据分析模型</span><input value={analysisModel} onChange={(event) => setAnalysisModel(event.target.value)} placeholder="vision-analyzer" /></label><label className="field"><span>静态图生成模型</span><input value={staticModel} onChange={(event) => setStaticModel(event.target.value)} placeholder="gptimage-2.5" /></label><label className="field"><span>动态图生成模型</span><input value={motionModel} onChange={(event) => setMotionModel(event.target.value)} placeholder="chatgpt-2.6" /></label></div><div className="modal-foot"><span><LockKeyhole size={14} />密钥会被脱敏保存</span><div><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" onClick={submit}>保存渠道</button></div></div></div></div>
}

function inferRole(modelId: string): Role {
  const id = modelId.toLowerCase()
  if (/video|motion|gif|animate|sora|i2v|wan|kling/.test(id)) return 'motion'
  if (/image|dall|flux|stable|diffusion|sdxl|picture/.test(id)) return 'static'
  return 'analysis'
}

function modelLabel(modelId: string) {
  return modelId.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function ChannelModal({ channel, onClose, onSave }: { channel: Channel | null; onClose: () => void; onSave: (channel: Channel) => void }) {
  const [name, setName] = useState(channel?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl ?? 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(channel?.key ?? '')
  const initialModels = channel?.models.map((model) => model.id) ?? []
  const [discoveredModels, setDiscoveredModels] = useState<string[]>(initialModels)
  const [discovering, setDiscovering] = useState(false)
  const [message, setMessage] = useState('')

  const fetchModels = async () => {
    setMessage('')
    if (!isConfiguredKey(apiKey)) {
      setMessage('请先填写真实 API Key，掩码 Key 不能用于获取模型。')
      return
    }
    setDiscovering(true)
    try {
      const result = await localApi.testChannel({ baseUrl, apiKey, channelName: name })
      const ids = [...new Set((result.data?.data ?? []).map((item) => item.id).filter(Boolean))]
      if (!ids.length) throw new Error('接口返回的模型列表为空')
      setDiscoveredModels(ids)
      setMessage(`已获取 ${ids.length} 个模型，保存后可在“默认设置”中分配任务角色。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '获取模型列表失败')
    } finally {
      setDiscovering(false)
    }
  }

  const submit = () => {
    if (!name.trim() || !baseUrl.trim()) {
      setMessage('请填写渠道名称和 Base URL')
      return
    }
    if (!discoveredModels.length) {
      setMessage('请先点击“获取模型”，从渠道接口读取模型列表')
      return
    }
    const id = channel?.id ?? `channel-${Date.now()}`
    const models: ModelConfig[] = discoveredModels.map((modelId) => ({ id: modelId, label: modelLabel(modelId), role: 'unassigned', capability: '待分配任务角色', latency: '待测试', price: '待配置' }))
    onSave({ id, name: name.trim(), provider: channel?.provider ?? 'OpenAI 兼容接口', baseUrl: baseUrl.trim().replace(/\/$/, ''), key: apiKey || 'sk-••••••••', health: 'error', updated: '等待真实连接测试', models })
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal"><div className="modal-head"><div><div className="panel-kicker"><Server size={15} />模型渠道</div><h2>{channel ? '编辑渠道' : '添加 OpenAI 兼容渠道'}</h2></div><button className="icon-button small" onClick={onClose}><X size={17} /></button></div><div className="modal-body"><label className="field"><span>渠道名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：OpenAI 主渠道" /></label><label className="field"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label><label className="field"><span>API Key <small>仅保存在本机</small></span><div className="input-with-icon"><KeyRound size={15} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." /></div></label><div className="model-discovery"><div><b>自动获取模型</b><span>调用兼容接口的 /models，读取当前渠道可用模型</span></div><button className="button ghost compact" onClick={fetchModels} disabled={discovering}><RefreshCw size={14} className={discovering ? 'spin' : ''} />{discovering ? '获取中…' : '获取模型'}</button></div>{message && <div className="modal-message"><CircleAlert size={14} />{message}</div>}<div className="field-group-title">已获取模型 <span>{discoveredModels.length ? `${discoveredModels.length} 个模型，将全部保存到该渠道` : '先获取模型列表'}</span></div>{discoveredModels.length ? <div className="discovered-model-list">{discoveredModels.map((id) => <span key={id}>{modelLabel(id)}</span>)}</div> : <div className="model-list-empty">获取后会在这里显示该渠道的完整模型清单。</div>}</div><div className="modal-foot"><span><LockKeyhole size={14} />默认模型在“默认设置”中选择</span><div><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" onClick={submit}>保存渠道模型</button></div></div></div></div>
}

export default App
