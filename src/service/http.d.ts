/**
 * HTTP 请求模块的类型声明
 */

export interface HttpResponse<T = any> {
  data?: T;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  [key: string]: any;
}

export interface HttpRequestConfig {
  auth?: {
    username?: string;
    password?: string | null;
  };
  validateStatus?: (status: number) => boolean;
  [key: string]: any;
}

declare const http: {
  get<T = any>(url: string, config?: HttpRequestConfig): Promise<T>;
  post<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<T>;
  delete<T = any>(url: string, config?: HttpRequestConfig): Promise<T>;
  put<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<T>;
  [key: string]: any;
};

export default http;
