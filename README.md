# 🌊 Hand Fluid — 手势流体交互

> 👉 **[在线体验](https://fittyyh-arch.github.io/hand-fluid/)**

用手掌在摄像头前移动，推动屏幕上的彩色流体。每根手指产生不同颜色的流体轨迹。

https://github.com/user-attachments/assets/demo.gif

## 特性

- 🖐️ **实时手势追踪** — MediaPipe Hands 浏览器端运行，无需后端
- 🎨 **GPU 流体模拟** — 基于 Navier-Stokes 方程的 WebGL 实现
- 🌈 **多指多色** — 每根手指产生不同颜色的流体
- 🖱️ **鼠标/触摸 Fallback** — 没有摄像头也能玩
- 📱 **移动端支持** — 手机浏览器直接打开
- ⚡ **60 FPS** — GPU 加速，流畅运行

## 技术栈

- WebGL (Stable Fluids / Jos Stam 方法)
- MediaPipe Hands (手部关键点检测)
- 纯前端，零依赖，零构建步骤

## 本地运行

```bash
# 任意静态服务器
npx serve .
# 或
python3 -m http.server 8080
```

打开 `http://localhost:8080`，点击"开启摄像头"即可。

## 原理

1. MediaPipe 检测手部 21 个关键点，计算帧间位移
2. 位移向量作为外力注入 WebGL 流体速度场
3. 流体模拟：对流 → 涡度 → 散度 → 压力求解 → 梯度投影
4. 染料随速度场流动，渲染到全屏 Canvas

## License

MIT
