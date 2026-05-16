import log from '@/native/logger.js';
/**
 * 游戏流程监控服务
 * 监听游戏阶段变化，在关键时刻触发相应操作
 *
 * 使用示例：
 * ```javascript
 * import GameFlowMonitor from './game-flow-monitor'
 *
 * const monitor = new GameFlowMonitor(lcuService)
 *
 * monitor.on('phase-change', (phase) => {
 *   log.info('游戏阶段:', phase)
 * })
 *
 * monitor.on('game-started', () => {
 *   log.info('游戏开始了！启动截图服务')
 * })
 *
 * monitor.on('augment-ready', () => {
 *   log.info('可能进入海克斯选择阶段')
 * })
 *
 * // 启动监控
 * monitor.start()
 *
 * // 停止监控
 * monitor.stop()
 * ```
 */

export default class GameFlowMonitor {
  constructor(lcuService, options = {}) {
    this.lcuService = lcuService;
    this.options = {
      pollInterval: 1000, // 轮询间隔（毫秒）
      ...options,
    };

    this.currentPhase = null;
    this.pollTimer = null;
    this.callbacks = {};
    this.isRunning = false;

    // 游戏阶段的中文名称映射
    this.phaseNames = {
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
  }

  /**
   * 注册事件回调
   */
  on(event, callback) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  }

  /**
   * 触发事件
   */
  emit(event, ...args) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach((cb) => cb(...args));
    }
  }

  /**
   * 获取阶段的中文名称
   */
  getPhaseName(phase) {
    return this.phaseNames[phase] || phase;
  }

  /**
   * 启动游戏流程监控
   */
  async start() {
    if (this.isRunning) {
      log.info('⚠️ 游戏流程监控已在运行');
      return;
    }

    log.info('🚀 启动游戏流程监控');
    this.isRunning = true;

    // 首先获取初始阶段
    try {
      const initialPhase = await this.lcuService.getGameflowPhase();
      if (initialPhase) {
        this.currentPhase = initialPhase;
        log.info(`📍 当前游戏阶段: ${this.getPhaseName(initialPhase)}`);
      }
    } catch (error) {
      log.warn('无法获取初始阶段:', error.message);
    }

    // 启动定时轮询
    this.pollTimer = await this.lcuService.pollGameflowPhase(
      (phase) => this.handlePhaseChange(phase),
      this.options.pollInterval
    );
  }

  /**
   * 处理阶段变化
   */
  handlePhaseChange(phase) {
    const prevPhase = this.currentPhase;
    this.currentPhase = phase;

    log.info(
      `📍 阶段变化: ${this.getPhaseName(prevPhase)} → ${this.getPhaseName(phase)}`
    );

    // 触发通用的阶段变化事件
    this.emit('phase-change', phase, prevPhase);

    // 针对特定阶段的处理
    switch (phase) {
      case 'ChampSelect':
        log.info('🎯 进入选人阶段');
        this.emit('champ-select-start');
        break;

      case 'GameStart':
        log.info('🎮 游戏开始加载');
        this.emit('game-started');
        // 在这里触发自动截图启动
        break;

      case 'InProgress':
        log.info('⚔️ 游戏进行中 - 海克斯选择可能即将开始');
        this.emit('game-in-progress');
        // 在这里启动高频率截图来检测海克斯选择界面
        this.emit('augment-ready');
        break;

      case 'WaitingForStats':
        log.info('📊 游戏已结束，等待结果');
        this.emit('game-ended');
        // 停止截图和分析
        break;

      case 'EndOfGame':
        log.info('🏁 游戏结束');
        this.emit('end-of-game');
        break;

      default:
        log.info(`其他阶段: ${this.getPhaseName(phase)}`);
    }
  }

  /**
   * 停止游戏流程监控
   */
  stop() {
    if (!this.isRunning) {
      log.info('⚠️ 游戏流程监控未运行');
      return;
    }

    log.info('⏹️ 停止游戏流程监控');
    this.isRunning = false;

    if (this.pollTimer) {
      this.lcuService.stopPollGameflowPhase(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 获取当前阶段
   */
  getCurrentPhase() {
    return this.currentPhase;
  }

  /**
   * 检查是否在特定阶段
   */
  isInPhase(phase) {
    return this.currentPhase === phase;
  }

  /**
   * 检查是否已开始游戏
   */
  isGameStarted() {
    return ['GameStart', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(
      this.currentPhase
    );
  }

  /**
   * 检查是否在选人阶段
   */
  isInChampSelect() {
    return this.currentPhase === 'ChampSelect';
  }

  /**
   * 检查是否在游戏进行中（包括海克斯选择）
   */
  isGameInProgress() {
    return this.currentPhase === 'InProgress';
  }
}
