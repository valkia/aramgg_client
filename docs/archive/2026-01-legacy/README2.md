墙的问题需要设置淘宝镜像 

npm install -g cnpm --registry=https://registry.npm.taobao.org

npm config set registry https://registry.npm.taobao.org

npm config set electron_mirror=http://npm.taobao.org/mirrors/electron/

1.npm cache clean --force 清除npm的缓存 (可能会报错但是没关系)

2.npm config set registry https://registry.npm.taobao.org

3.cnpm install

4.如果npm run serve不能启动，需要npm install -g @vue/cli

5.npm run pack 如果很慢超时，可以多试几次因为需要下载到文件比较小。

解决chrome跨域问题
右键chrome图标，在目标：最后加上 --disable-web-security --user-data-dir   （最前面有空格）


```
目录说明
  |-- build            electron打包文件
    |-- win-unpacked   electron应用安装后文件
        |-- xxx.exe    electron应用打开入口
    |-- xxx.exe        electron安装包
  |-- dist             web前端打包后文件
  |-- node_modules     前端node依赖
  |-- public           前端静态资源
  |-- src              前端开发文件目录
    |-- xxx
  |-- babel.config.js  babel配置文件
  |-- main.js          electron打包入口
  |-- preload.js       electron加载前运行文件
  |-- vue.config.js    vue-cli webpack配置
```