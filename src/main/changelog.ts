export type ChangelogEntry = {
  version: string
  date: string
  title: string
  summary: string
  changes: string[]
}

const ENTRY_LIMIT = 8
const CHANGE_LIMIT = 8
const SHORT_TEXT_LIMIT = 120
const SUMMARY_TEXT_LIMIT = 220

export const LOCAL_CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: '0.2.11',
    date: '2026-08-09',
    title: '海克斯胜率回归与日志优化',
    summary: '恢复海克斯胜率与梯队展示，重新使用胜率数据生成推荐，并显著减少生产环境的重复诊断日志。',
    changes: [
      '英雄详情海克斯列表恢复胜率展示，并将 T1、T2 等梯队标记移至海克斯名称右侧。',
      '海克斯浮窗恢复选取率与胜率，并重新结合推荐分和胜率生成优先推荐。',
      '降低 LCU 连接、性能采样、窗口状态和海克斯识别等高频诊断日志的输出频率。',
      '日志达到约 5 MB 后自动轮转，每天最多保留 3 个文件，并自动清理 7 天前的日志。',
    ],
  },
  {
    version: '0.2.8',
    date: '2026-08-02',
    title: '修复英雄装备配置',
    summary: '适配当前腾讯单路线出装数据，修复手动配置装备失败，并补全完整出装和技能加点展示。',
    changes: [
      '修复点击“重新配置当前英雄装备”时提示 An object could not be cloned 的问题。',
      '兼容腾讯出装只有单条综合路线、场次为空但提供选取率与胜率的数据格式。',
      '英雄详情新增完整出装展示，游戏商店推荐同步写入出门装、核心装、完整出装和备选装。',
      '支持 15 至 18 级技能加点顺序，保留当前数据中的有效技能推荐。',
    ],
  },
  {
    version: '0.2.6',
    date: '2026-07-31',
    title: '海克斯官方排名展示',
    summary: '英雄详情和海克斯浮窗不再展示已下线的胜率，改为直接展示 T1、T2 等官方排名。',
    changes: [
      '英雄详情海克斯列表将原胜率位置改为官方排名。',
      '海克斯浮窗保留选取率，并将原胜率位置改为官方排名。',
      '简体中文、英文和繁体中文统一使用排名文案，无有效排名时显示 --。',
    ],
  },
  {
    version: '0.2.5',
    date: '2026-07-31',
    title: '官方排名推荐兼容',
    summary: '适配 16.15 客户端数据：英雄海克斯推荐改用官方排名排序，并在胜率不再提供时保持稳定推荐。',
    changes: [
      '英雄详情海克斯列表优先按 API 提供的 rank 官方排名排序。',
      '海克斯浮窗的优先推荐标记与英雄详情使用同一套官方排名规则。',
      '兼容 16.15 起不再提供海克斯胜率的数据格式，避免排序继续依赖失效的胜率字段。',
      '旧缓存缺少 rank 时，继续按原推荐分、梯队和选取率生成兼容顺序。',
    ],
  },
  {
    version: '0.2.4',
    date: '2026-07-28',
    title: '兼容 16.15 版本',
    summary: '更新客户端发布版本，兼容 16.15 数据。',
    changes: [
      '兼容 16.15 版本的客户端数据。',
      '重新发布 Windows 完整安装包、差分更新文件和 latest.yml 自动更新元数据。',
    ],
  },
  {
    version: '0.2.3',
    date: '2026-07-28',
    title: '英雄详情推荐增强',
    summary: '接入召唤师技能与技能加点数据，改善 ARAM 选人阶段的浏览体验，并降低海克斯浮窗显示开销。',
    changes: [
      '英雄详情出装页新增召唤师技能组合，展示选取率、胜率和样本场次。',
      '英雄详情出装页新增 18 级技能加点顺序，并展示 Q、W、E 技能优先级。',
      '支持客户端数据 16.14.3 中的召唤师技能与技能加点推荐字段。',
      '优化英雄详情顶部席位列表，支持左右按钮、鼠标滚轮、触控板和键盘横向浏览。',
      '降低海克斯浮窗显示开销：移除高成本背景模糊与持续阴影动画，恢复后台节流，并避免数据刷新时重复提升窗口。',
    ],
  },
  {
    version: '0.2.2',
    date: '2026-07-19',
    title: '窗口与赛后体验优化',
    summary: '优化对局结束后的窗口行为和赛后海报控制，记住英雄胜率窗口位置，并完善语言切换统计。',
    changes: [
      '主窗口隐藏到托盘或最小化后，对局结束时不再自动跳出。',
      '英雄胜率窗口会记住拖动后的位置，下一局和重启客户端后继续沿用。',
      '窗口偏好新增“自动展示赛后海报”开关，关闭后仍可在主页面手动生成和查看。',
      '完善语言切换统计，记录切换结果、目标语言和数据版本，便于定位切换异常。',
      '游戏目录入口新增管理员运行提示，自动检测失败时可按提示排查。',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-07-17',
    title: '修复客户端数据热更新',
    summary: '修复运行时数据文件保存方式不一致导致新数据版本无法通过完整性校验的问题。',
    changes: [
      '运行时更新现在会原样保存服务端 JSON 文本，与打包数据下载保持一致，避免文件末尾换行丢失。',
      '修复完整数据已下载但客户端仍回退到旧数据版本的问题。',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-12',
    title: '多语言与客户端体验升级',
    summary: '新增三语界面与对应数据切换，并系统性提升本地数据、窗口状态和客户端安全稳定性。',
    changes: [
      '新增简体中文、英文和繁体中文界面，并提供对应语言的英雄、海克斯与推荐数据。',
      '语言入口移至状态栏，界面与数据会在目标语言准备完成后统一切换，失败时保留当前语言。',
      '英雄详情、海克斯浮窗和推荐列表继续采用本地优先加载，并按语言隔离缓存与版本。',
      '海克斯识别会跟随游戏客户端语言，并在后台准备其他支持语言的识别数据。',
      '优化语言切换响应速度，切换期间不再因后台版本检查阻塞主界面。',
      '加固应用更新、窗口管理、游戏阶段检测与进程间通信，提升异常场景下的稳定性和安全性。',
    ],
  },
  {
    version: '0.1.19',
    date: '2026-07-04',
    title: '赛后分享与安装稳定性',
    summary: '修正赛后分享海报内容，并改善更新提示、安装包和内置数据的可靠性。',
    changes: [
      '赛后分享海报仅展示当前玩家实际获得的海克斯，避免混入其他玩家或识别阶段的数据。',
      '精简主界面的应用更新状态，减少重复信息干扰。',
      'Windows 版本改用完整离线安装包，减少安装过程对在线下载的依赖。',
      '增强内置客户端数据的重试、续传和完整性校验，提升发布打包稳定性。',
    ],
  },
  {
    version: '0.1.18',
    date: '2026-06-30',
    title: '赛后分享与本地数据体验',
    summary: '新增对局结束后的分享海报，并优化前台数据的本地优先加载体验。',
    changes: [
      '新增赛后战绩分享海报，支持在对局结束后生成分享图。',
      '英雄详情、海克斯弹窗和推荐列表优先使用完整本地数据，减少等待远端检查时的空白。',
    ],
  },
  {
    version: '0.1.17',
    date: '2026-06-29',
    title: '自动更新支持',
    summary: '新增客户端自动更新能力，为后续版本升级做准备。',
    changes: [
      '支持自动更新功能。',
    ],
  },
  {
    version: '0.1.16',
    date: '2026-06-29',
    title: '数据版本更新',
    summary: '更新客户端可用数据版本。',
    changes: [
      '支持 0.16.13 版本数据。',
    ],
  },
  {
    version: '0.1.15',
    date: '2026-06-25',
    title: '稳定推荐与快捷键',
    summary: '减少误触入口，继续打磨海克斯推荐浮窗的稳定性。',
    changes: [
      '移除隐藏的 F1 截图快捷键，避免游戏内误触。',
      '稳定海克斯推荐浮窗在推荐刷新和显示切换时的表现。',
    ],
  },
  {
    version: '0.1.14',
    date: '2026-06-22',
    title: '海克斯识别与托盘控制',
    summary: '增强部分海克斯选择场景，并补齐 Windows 托盘控制。',
    changes: [
      '支持显示部分识别到的海克斯选择结果。',
      '新增 Windows 托盘入口，便于显示、隐藏和退出应用。',
    ],
  },
  {
    version: '0.1.13',
    date: '2026-06-16',
    title: '选人推荐增强',
    summary: 'ARAM 席位推荐开始纳入队友选择信息，并修复侧边栏交互。',
    changes: [
      '席位推荐会参考队友已选英雄。',
      '修复海克斯侧边栏标签页点击区域。',
      '优化诊断日志，便于排查 LCU 与数据问题。',
    ],
  },
  {
    version: '0.1.12',
    date: '2026-06-13',
    title: '英雄详情增强',
    summary: '英雄详情窗口支持多套出装路线，推荐信息更完整。',
    changes: [
      '新增多套英雄出装洞察。',
      '英雄详情窗口继续保持 ARAM 选人推荐展示入口。',
    ],
  },
  {
    version: '0.1.11',
    date: '2026-06-11',
    title: '连接兜底与浮窗偏好',
    summary: '改善 LCU 自动发现失败时的兜底能力，并加入浮窗偏好设置。',
    changes: [
      '新增英雄联盟目录手动兜底配置。',
      '新增海克斯浮窗偏好开关。',
      '压缩海克斯列表展示，减少主界面占用。',
    ],
  },
]

function cleanText(value: unknown, maxLength = SHORT_TEXT_LIMIT): string {
  if (value === null || value === undefined) {
    return ''
  }

  const text = String(value).replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}

function stripListMarker(value: string): string {
  return value.replace(/^[-*•]\s*/, '').trim()
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of items) {
    const text = cleanText(stripListMarker(item))
    if (!text || seen.has(text)) {
      continue
    }

    seen.add(text)
    result.push(text)

    if (result.length >= CHANGE_LIMIT) {
      break
    }
  }

  return result
}

function normalizeChangeItem(item: unknown): string {
  if (item === null || item === undefined) {
    return ''
  }

  if (typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>
    return cleanText(
      record.text ??
      record.title ??
      record.summary ??
      record.description ??
      record.message ??
      record.change
    )
  }

  return cleanText(item)
}

function normalizeChangeItems(value: unknown): string[] {
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    return uniqueItems(value.map(normalizeChangeItem))
  }

  if (typeof value === 'string') {
    return uniqueItems(value.split(/\r?\n/).map((line) => line.trim()))
  }

  return uniqueItems([normalizeChangeItem(value)])
}

function getEntryChanges(record: Record<string, unknown>): string[] {
  return uniqueItems([
    ...normalizeChangeItems(record.changes),
    ...normalizeChangeItems(record.items),
    ...normalizeChangeItems(record.highlights),
    ...normalizeChangeItems(record.features),
    ...normalizeChangeItems(record.fixes),
  ])
}

function normalizeEntry(value: unknown, fallbackVersion = ''): ChangelogEntry | null {
  if (Array.isArray(value)) {
    const changes = normalizeChangeItems(value)
    return changes.length
      ? {
          version: cleanText(fallbackVersion, 40),
          date: '',
          title: '',
          summary: '',
          changes,
        }
      : null
  }

  if (typeof value === 'string') {
    const changes = normalizeChangeItems(value)
    return changes.length
      ? {
          version: cleanText(fallbackVersion, 40),
          date: '',
          title: '',
          summary: '',
          changes,
        }
      : null
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const entry: ChangelogEntry = {
    version: cleanText(record.version ?? record.tag ?? fallbackVersion, 40).replace(/^v(?=\d)/i, ''),
    date: cleanText(
      record.date ??
      record.publishedAt ??
      record.releasedAt ??
      record.generatedAt,
      40
    ),
    title: cleanText(record.title ?? record.name, 80),
    summary: cleanText(record.summary ?? record.description ?? record.body, SUMMARY_TEXT_LIMIT),
    changes: getEntryChanges(record),
  }

  if (!entry.version && !entry.date && !entry.title && !entry.summary && entry.changes.length === 0) {
    return null
  }

  return entry
}

function looksLikeEntryRecord(record: Record<string, unknown>): boolean {
  return [
    'version',
    'tag',
    'date',
    'publishedAt',
    'releasedAt',
    'generatedAt',
    'title',
    'summary',
    'description',
    'body',
    'changes',
    'items',
    'highlights',
    'features',
    'fixes',
  ].some((key) => key in record)
}

function normalizeObjectEntries(source: Record<string, unknown>): ChangelogEntry[] {
  if (Array.isArray(source.entries)) {
    return normalizeChangelogEntries(source.entries)
  }

  if (Array.isArray(source.releases)) {
    return normalizeChangelogEntries(source.releases)
  }

  if (looksLikeEntryRecord(source)) {
    const entry = normalizeEntry(source)
    return entry ? [entry] : []
  }

  return Object.entries(source)
    .map(([version, value]) => normalizeEntry(value, version))
    .filter((entry): entry is ChangelogEntry => Boolean(entry))
    .slice(0, ENTRY_LIMIT)
}

export function normalizeChangelogEntries(source: unknown): ChangelogEntry[] {
  if (Array.isArray(source)) {
    return source
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is ChangelogEntry => Boolean(entry))
      .slice(0, ENTRY_LIMIT)
  }

  if (typeof source === 'string') {
    const entry = normalizeEntry(source)
    return entry ? [entry] : []
  }

  if (source && typeof source === 'object') {
    return normalizeObjectEntries(source as Record<string, unknown>).slice(0, ENTRY_LIMIT)
  }

  return []
}

export function getChangelogEntries(config: Record<string, any> = {}, clientConfig: Record<string, any> = {}): ChangelogEntry[] {
  const candidates = [
    clientConfig.changelog,
    clientConfig.releaseNotes,
    clientConfig.changes,
    config.client?.changelog,
    config.client?.releaseNotes,
    config.electron?.changelog,
    config.electron?.releaseNotes,
    config.changelog,
    config.releaseNotes,
    config.changes,
  ]

  for (const candidate of candidates) {
    const entries = normalizeChangelogEntries(candidate)
    if (entries.length > 0) {
      return entries
    }
  }

  return LOCAL_CHANGELOG_ENTRIES
}
