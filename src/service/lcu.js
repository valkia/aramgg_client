import log from '@/native/logger.js';
import http from './http';
import { getLcuToken } from '../share/file-browser-safe';

export default class LCUService {
  constructor(lolDir) {
    this.lolDir = lolDir;
    this.active = false;
  }

  setVars = (token, port, url) => {
    this.active = !!token;
    // if (!token) {
    //   log.info(`League client not active!`)
    // }

    this.url = url;
    this.token = token;
    this.port = port;
    this.urls = {
      authToken: `${url}/riotclient/auth-token`,
      curSession: `${url}/lol-champ-select/v1/session`,
      curPerk: `${url}/lol-perks/v1/currentpage`,
      perks: `${url}/lol-perks/v1/pages`,
      position1: `${url}/lol-lobby-team-builder/v1/position-preferences`,
      position2: `${url}/lol-lobby-team-builder/v2/position-preferences`,
      gameflowPhase: `${url}/lol-gameflow/v1/gameflow-phase`,
      gameflowSession: `${url}/lol-gameflow/v1/session`,
    };


    this.auth = {
      auth: {
        username: `riot`,
        password: token,
      },
    };
  };

  getAuthToken = async () => {
    const result = await getLcuToken(this.lolDir);

    // getLcuToken 可能返回 null 或 { port, password } 对象
    if (!result) {
      log.warn('无法获取 LCU Token，游戏客户端可能未运行')
      this.setVars(null, null, null);
      return null;
    }

    const { port, password } = result;
    const url = `https://127.0.0.1:${port}`;
    this.setVars(password, port, url);
    return { token: password, port, url };
  };

  getLcuStatus = async () => {
    const { urls, auth } = this;

    try {
      const res = await http.get(urls.authToken, auth);
      if (res) {
        return true;
      }
    } finally {
      //return false;
    }
  };

  getCurrentSession = async () => {
    log.info(this.urls.curSession);
    log.info(this.auth);
    const res = await http.get(this.urls.curSession, {
      ...this.auth,
      validateStatus: (status) => status < 500,
    });
    log.info(res);
    return res;
  };

  getCurPerk = async () => {
    const res = await http.get(this.urls.curPerk, this.auth);
    log.info(res);
  };

  getPerkList = async () => {
    const res = await http.get(this.urls.perks, this.auth);
    return res;
  };

  deletePerk = async (id) => {
    const res = await http.delete(`${this.urls.perks}/${id}`, this.auth);
    return res;
  };

  createPerk = async (data) => {
    const res = await http.post(this.urls.perks, data);
    return res;
  };

  applyPerk = async (data) => {
    const list = await this.getPerkList();
    const current = list.find((i) => i.current && i.isDeletable);

    if (current) {
      await this.deletePerk(current.id);
      await this.createPerk(data);
      return true;
    }

    await this.createPerk(data);
    return true;
  };

  /**
   * 获取当前游戏阶段
   * 返回值例如: "ChampSelect", "GameStart", "InProgress", "EndOfGame" 等
   */
  getGameflowPhase = async () => {
    try {
      const res = await http.get(this.urls.gameflowPhase, {
        ...this.auth,
        validateStatus: (status) => status < 500,
      });
      log.info('🎮 当前游戏阶段:', res);
      return res;
    } catch (error) {
      log.error('获取游戏阶段失败:', error.message);
      return null;
    }
  };

  /**
   * 获取游戏会话信息
   * 包含游戏 ID、地区、队伍信息等
   */
  getGameflowSession = async () => {
    try {
      const res = await http.get(this.urls.gameflowSession, {
        ...this.auth,
        validateStatus: (status) => status < 500,
      });
      log.info('📋 游戏会话信息:', res);
      return res;
    } catch (error) {
      log.error('获取游戏会话失败:', error.message);
      return null;
    }
  };

  /**
   * 轮询游戏阶段（用于监听阶段变化）
   * @param {Function} callback - 阶段变化时的回调函数
   * @param {number} interval - 轮询间隔（毫秒），默认1000ms
   * @returns {number} 定时器ID，可用于后续停止轮询
   */
  pollGameflowPhase = async (callback, interval = 1000) => {
    let lastPhase = null;

    const timer = setInterval(async () => {
      try {
        const phase = await this.getGameflowPhase();
        if (phase && phase !== lastPhase) {
          log.info(`📍 游戏阶段变化: ${lastPhase} → ${phase}`);
          lastPhase = phase;
          if (callback) {
            callback(phase);
          }
        }
      } catch (error) {
        log.warn('轮询游戏阶段出错:', error.message);
      }
    }, interval);

    return timer;
  };

  /**
   * 停止轮询游戏阶段
   * @param {number} timerId - 由 pollGameflowPhase 返回的定时器ID
   */
  stopPollGameflowPhase = (timerId) => {
    if (timerId) {
      clearInterval(timerId);
      log.info('⏹️ 停止游戏阶段轮询');
    }
  };
}
