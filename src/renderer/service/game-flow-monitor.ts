import LCUService from './lcu';

/** 游戏阶段类型 */
type GamePhase =
  | 'Lobby'
  | 'Matchmaking'
  | 'CheckedIntoGame'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'InProgress'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'
  | string;

/** 事件回调函数类型 */
type EventCallback = (...args: any[]) => void;

/** 阶段名称映射 */
interface PhaseNames {
  [key: string]: string;
}

/**
 * 游戏流程监控服务
 * 监听游戏阶段变化，在关键时刻触发相应操作
 *
 * @example
 * ```javascript
 * import GameFlowMonitor from './game-flow-monitor'
 *
 * const monitor = new GameFlowMonitor(lcuService)
 *
 * monitor.on('phase-change', (phase) => {
 *   console.log('游戏阶段:', phase)
 * })
 *
 * monitor.on('game-started', () => {
 *   console.log('游戏开始了！启动截图服务')
 * })
 *
 * monitor.start()
 * monitor.stop()
 * ```
 */
export default class GameFlowMonitor {
  private lcuService: LCUService;
  private options: { pollInterval: number };
  private currentPhase: GamePhase | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private callbacks: Map<string, EventCallback[]> = new Map();
  private isRunning: boolean = false;

  /** 游戏阶段的中文名称映射 */
  private phaseNames: PhaseNames = {
    'Lobby': '大厅',
    'Matchmaking': '匹配中',
    'CheckedIntoGame': '已进入游戏',
    'ReadyCheck': '准备确认',
    'ChampSelect': '选人阶段',
    'GameStart': '游戏加载',
    'InProgress': '游戏进行中',
    'WaitingForStats': '等待结果',
    'PreEndOfGame': '游戏结束（统计）',
    'EndOfGame': '游戏结束',
  };

  constructor(lcuService: LCUService, options: { pollInterval?: number } = {}) {
    this.lcuService = lcuService;
    this.options = {
      pollInterval: options.pollInterval || 1000,
    };
  }

  /**
   * 注册事件回调
   */
  public on(event: string, callback: EventCallback): void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      callbacks.push(callback);
    }
  }

  /**
   * 触发事件
   */
  private emit(event: string, ...args: any[]): void {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(...args));
    }
  }

  /**
   * 获取阶段的中文名称
   */
  public getPhaseName(phase: GamePhase): string {
    return this.phaseNames[phase] || phase;
  }

  /**
   * 启动游戏流程监控
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ 游戏流程监控已在运行');
      return;
    }

    console.log('🚀 启动游戏流程监控');
    this.isRunning = true;

    // 首先获取初始阶段
    try {
      const initialPhase = await this.lcuService.getGameflowPhase();
      if (initialPhase) {
        this.currentPhase = initialPhase as GamePhase;
        console.log(`📍 当前游戏阶段: ${this.getPhaseName(initialPhase as GamePhase)}`);
      }
    } catch (error) {
      console.warn('无法获取初始阶段:', error instanceof Error ? error.message : String(error));
    }

    // 启动定时轮询
    this.pollTimer = await this.lcuService.pollGameflowPhase(
      (phase: string) => this.handlePhaseChange(phase as GamePhase),
      this.options.pollInterval
    );
  }

  /**
   * 处理阶段变化
   */
  private handlePhaseChange(phase: GamePhase): void {
    const prevPhase = this.currentPhase;
    this.currentPhase = phase;

    console.log(
      `📍 阶段变化: ${this.getPhaseName(prevPhase || '')} → ${this.getPhaseName(phase)}`
    );

    // 触发通用的阶段变化事件
    this.emit('phase-change', phase, prevPhase);

    // 针对特定阶段的处理
    switch (phase) {
      case 'ChampSelect':
        console.log('🎯 进入选人阶段');
        this.emit('champ-select-start');
        break;

      case 'GameStart':
        console.log('🎮 游戏开始加载');
        this.emit('game-started');
        break;

      case 'InProgress':
        console.log('⚔️ 游戏进行中 - 海克斯选择可能即将开始');
        this.emit('game-in-progress');
        this.emit('augment-ready');
        break;

      case 'WaitingForStats':
        console.log('📊 游戏已结束，等待结果');
        this.emit('game-ended');
        break;

      case 'EndOfGame':
        console.log('🏁 游戏结束');
        this.emit('end-of-game');
        break;

      default:
        console.log(`其他阶段: ${this.getPhaseName(phase)}`);
    }
  }

  /**
   * 停止游戏流程监控
   */
  public stop(): void {
    if (!this.isRunning) {
      console.log('⚠️ 游戏流程监控未运行');
      return;
    }

    console.log('⏹️ 停止游戏流程监控');
    this.isRunning = false;

    if (this.pollTimer) {
      this.lcuService.stopPollGameflowPhase(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 获取当前阶段
   */
  public getCurrentPhase(): GamePhase | null {
    return this.currentPhase;
  }

  /**
   * 检查是否在特定阶段
   */
  public isInPhase(phase: GamePhase): boolean {
    return this.currentPhase === phase;
  }

  /**
   * 检查是否已开始游戏
   */
  public isGameStarted(): boolean {
    return ['GameStart', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(
      this.currentPhase || ''
    );
  }

  /**
   * 检查是否在选人阶段
   */
  public isInChampSelect(): boolean {
    return this.currentPhase === 'ChampSelect';
  }

  /**
   * 检查是否在游戏进行中（包括海克斯选择）
   */
  public isGameInProgress(): boolean {
    return this.currentPhase === 'InProgress';
  }
}
