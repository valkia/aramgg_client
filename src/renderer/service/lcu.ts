import http from './http';
import { getLcuToken } from '../share/file-browser-safe';

/** LCU Token 返回类型 */
interface LcuTokenResult {
  port: string;
  password: string;
}

/** LCU URLs 映射 */
interface LcuUrls {
  authToken: string;
  curSession: string;
  curPerk: string;
  perks: string;
  position1: string;
  position2: string;
  gameflowPhase: string;
  gameflowSession: string;
}

/** Auth 配置类型 */
interface AuthConfig {
  auth: {
    username: string;
    password: string | null;
  };
}

/**
 * LCU (League Client Update) 服务
 * 提供与英雄联盟客户端的通信接口
 */
export default class LCUService {
  public active: boolean = false;
  public url: string | null = null;
  public token: string | null = null;
  public port: string | null = null;
  public urls: LcuUrls | Record<string, never> = {};
  public auth: AuthConfig = {
    auth: {
      username: 'riot',
      password: null,
    },
  };

  constructor(_source?: string) {
  }

  /**
   * 设置 LCU 变量（内部方法）
   */
  private setVars = (token: string | null, port: string | null, url: string | null): void => {
    this.active = !!token;

    this.url = url;
    this.token = token;
    this.port = port;

    if (url) {
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
    }

    this.auth = {
      auth: {
        username: 'riot',
        password: token,
      },
    };
  };

  /**
   * 获取并设置 LCU 认证令牌
   */
  public getAuthToken = async (): Promise<{ token: string; port: string; url: string } | null> => {
    const result = await getLcuToken();

    if (!result) {
      console.warn('无法获取 LCU Token，游戏客户端可能未运行');
      this.setVars(null, null, null);
      return null;
    }

    const { port, password } = result as LcuTokenResult;
    const url = `https://127.0.0.1:${port}`;
    this.setVars(password, port, url);
    return { token: password, port, url };
  };

  /**
   * 获取 LCU 连接状态
   */
  public getLcuStatus = async (): Promise<boolean> => {
    const { urls, auth } = this;

    try {
      const res = await http.get(urls.authToken, auth);
      return !!res;
    } catch (error) {
      console.warn('获取 LCU 状态失败:', error);
      return false;
    }
  };

  /**
   * 获取当前选人会话
   */
  public getCurrentSession = async (): Promise<any> => {
    console.log(this.urls.curSession);
    console.log(this.auth);
    const res = await http.get(this.urls.curSession, {
      ...this.auth,
      validateStatus: (status: number) => status < 500,
    });
    console.log(res);
    return res;
  };

  /**
   * 获取当前符文页
   */
  public getCurPerk = async (): Promise<any> => {
    const res = await http.get(this.urls.curPerk, this.auth);
    console.log(res);
    return res;
  };

  /**
   * 获取所有符文页列表
   */
  public getPerkList = async (): Promise<any[]> => {
    const res = await http.get(this.urls.perks, this.auth);
    return res;
  };

  /**
   * 删除指定符文页
   */
  public deletePerk = async (id: number): Promise<any> => {
    const res = await http.delete(`${this.urls.perks}/${id}`, this.auth);
    return res;
  };

  /**
   * 创建新符文页
   */
  public createPerk = async (data: any): Promise<any> => {
    const res = await http.post(this.urls.perks, data);
    return res;
  };

  /**
   * 应用符文页
   */
  public applyPerk = async (data: any): Promise<boolean> => {
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
  public getGameflowPhase = async (): Promise<string | null> => {
    try {
      const res = await http.get(this.urls.gameflowPhase, {
        ...this.auth,
        validateStatus: (status: number) => status < 500,
      });
      console.log('🎮 当前游戏阶段:', res);
      return res as string;
    } catch (error) {
      console.error('获取游戏阶段失败:', error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  /**
   * 获取游戏会话信息
   * 包含游戏 ID、地区、队伍信息等
   */
  public getGameflowSession = async (): Promise<any> => {
    try {
      const res = await http.get(this.urls.gameflowSession, {
        ...this.auth,
        validateStatus: (status: number) => status < 500,
      });
      console.log('📋 游戏会话信息:', res);
      return res;
    } catch (error) {
      console.error('获取游戏会话失败:', error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  /**
   * 轮询游戏阶段（用于监听阶段变化）
   * @param callback 阶段变化时的回调函数
   * @param interval 轮询间隔（毫秒），默认1000ms
   * @returns 定时器ID，可用于后续停止轮询
   */
  public pollGameflowPhase = async (
    callback: (phase: string) => void,
    interval: number = 1000
  ): Promise<NodeJS.Timeout> => {
    let lastPhase: string | null = null;

    const timer = setInterval(async () => {
      try {
        const phase = await this.getGameflowPhase();
        if (phase && phase !== lastPhase) {
          console.log(`📍 游戏阶段变化: ${lastPhase} → ${phase}`);
          lastPhase = phase;
          if (callback) {
            callback(phase);
          }
        }
      } catch (error) {
        console.warn('轮询游戏阶段出错:', error instanceof Error ? error.message : String(error));
      }
    }, interval);

    return timer;
  };

  /**
   * 停止轮询游戏阶段
   * @param timerId 由 pollGameflowPhase 返回的定时器ID
   */
  public stopPollGameflowPhase = (timerId: NodeJS.Timeout | null): void => {
    if (timerId) {
      clearInterval(timerId);
      console.log('⏹️ 停止游戏阶段轮询');
    }
  };
}
