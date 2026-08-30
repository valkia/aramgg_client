# 客户端反馈

主窗口右下角提供原生反馈组件，交互沿用 ARAMGG 主站切换 MakeThisBetter 前的 morph 动效：按钮展开时同步改变宽高与圆角，按钮和表单交叉淡入；系统启用“减少动态效果”时禁用过渡。

## 提交内容

- 用户主动填写的反馈类型、正文和可选联系方式；
- 用户主动选择的可选截图，renderer 在本地压缩为不超过 2 MB 的 WebP；
- 提交当日与前一日的 `app-YYYY-MM-DD*.log`，由 Electron 主进程读取、脱敏并合并为不超过 6 MB 的 Gzip 附件。

日志收集只匹配日志目录内的受控文件名，不接受 renderer 提供路径。上传前会遮蔽常见 Authorization、Cookie、Token、密码、LCU 命令行凭据以及 PUUID 等身份字段。renderer 始终保持 sandbox，不能直接读取日志或发起反馈网络请求。

## 数据流与发布顺序

1. Vue 表单通过 typed preload IPC 把用户输入和压缩截图交给主进程。
2. 主进程收集近两天日志，经 `https://aramgg.com/api/feedback` 一次性提交全部内容。
3. Cloudflare Function 先把截图和日志写入私有 R2，再把元数据写入独立反馈 D1；D1 失败时删除本次全部 R2 附件。
4. 生产发布必须先应用主站 `migrations/feedback/0002_feedback_logs.sql` 并部署新 Function，再发布包含该入口的 Electron client。

反馈附件不提供公开读取 URL，只用于反馈跟进和客户端排障。
