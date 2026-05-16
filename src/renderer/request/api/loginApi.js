/**
 * article模块接口列表
 */

import base from './base'; // 导入接口域名列表
import axios from '../http'; // 导入http中创建的axios实例
//import qs from 'qs'; // 根据需求是否导入qs模块

const loginApi = {
    // 例子：post提交    参数 qs.stringify(params) 是form格式，params 是json格式
    login(params) {
        return axios.post(`${base.baseUrl}/login/checkPassword`, params);
    },


}

export default loginApi;