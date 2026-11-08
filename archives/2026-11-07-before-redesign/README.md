# 2026-11-07 前端改版前留档

`source.zip` 是改版开始前的可运行项目源码快照，包含当时尚未提交的前端修改。未包含 `.env`、`node_modules`、`.git` 和无关的薪金证明文档。

- 基础提交见 `base-commit.txt`。
- 原有未提交修改另存为 `uncommitted.patch`。
- ZIP SHA-256：`631BBF76E9B98D5C9656A66E7F20D95AA19E471FF1CF58337D249955A427B237`。

## 查看旧版

将 `source.zip` 解压到一个新目录，按 `.env.example` 配置已有地图密钥，执行 `npm ci` 和 `npm run dev -- --port 5175`。不要直接覆盖当前项目。

当时的首页采用白底、蓝紫色宋体标题、左右分栏和深色动态地图。地图包含四段故事、暂停、重播和真实地铁＋步行等时圈。
