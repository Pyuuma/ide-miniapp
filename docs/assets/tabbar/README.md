# 底部导航图标（设计源文件）

这里的 SVG 是底部导航图标的矢量源文件（24×24 画布），配色：未选中 `#8a8f99`，选中 `#1a1a1a`。

小程序当前**没有使用这些图片**：原生 tabBar 的 `iconPath` 不支持 SVG，而把 SVG 转 PNG 时必须保留透明背景（macOS 上用 `qlmanage -t` 渲染出来是不透明白底，不能用于 tabBar）。因此底部导航改为在 `miniprogram/custom-tab-bar/index.scss` 里用 **CSS 绘制**同样的形状，颜色直接改 SCSS 变量即可。

如果以后想换回原生 tabBar，可以用支持透明通道的工具（`rsvg-convert`、Inkscape、`sharp` 等）把这两套 SVG 导出成 81×81 的 PNG，再配置 `app.json` 的 `iconPath` / `selectedIconPath`。
