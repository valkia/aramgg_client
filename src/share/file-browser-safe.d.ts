/**
 * 文件浏览器安全模块的类型声明
 */

export interface LcuTokenInfo {
  port: string;
  password: string;
}

/**
 * 获取 LCU 令牌
 * @param lolDir - 游戏目录
 * @returns LCU 令牌信息或 null
 */
export function getLcuToken(lolDir: string): Promise<LcuTokenInfo | null>;

export {};
