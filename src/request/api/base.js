/**
 * 接口域名的管理
 */

import log from '@/native/logger.js';

// eslint-disable-next-line no-unused-vars
let baseUrl = "";   //这里是一个默认的url，可以没有
//window.location.href
log.info(process.env.NODE_ENV);

//主机地址 http://localhost:8090
let host = window.location.origin;
//项目名 /lol_tips_client
var pathName = window.location.pathname;
var projectName = pathName.substring(0,pathName.substr(1).indexOf('/')+1);

switch (process.env.NODE_ENV) {
    case 'development':
        baseUrl = "http://localhost:8065"; //这里是本地的请求url
        break;
    case 'alpha':   // 注意这里的名字要和步骤二中设置的环境名字对应起来
        baseUrl = host + projectName; //这里是测试环境中的url
        break;
    case 'test':   // 注意这里的名字要和步骤二中设置的环境名字对应起来
        baseUrl = host + projectName; //这里是测试环境中的url
        break;
    case 'production':
        baseUrl = host + projectName; //生产环境url
        break;
    default:
        baseUrl = host + projectName;
}
//日后可能要拓展，所以返回一个对象
const base = {
    baseUrl: baseUrl
}

export default base;