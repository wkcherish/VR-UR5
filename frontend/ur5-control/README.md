# UR5 机器人 AR 控制前端

基于 Vue 3 + Three.js + WebXR 的 UR5 机器人可视化与控制系统。

## 技术栈

- **框架**: Vue 3 (Composition API + TypeScript)
- **构建工具**: Vite 5.0+
- **3D 渲染**: Three.js
- **状态管理**: Pinia
- **路由**: Vue Router
- **HTTP 客户端**: Axios
- **AR 支持**: WebXR API

## 项目结构

```
ur5-control/
├── public/models/          # 机器人模型文件 (URDF, STL, DAE)
├── src/
│   ├── assets/             # 静态资源
│   ├── components/         # Vue 组件
│   ├── composables/        # Composition API 复用逻辑
│   ├── stores/             # Pinia 状态管理
│   ├── types/              # TypeScript 类型定义
│   ├── utils/              # 工具函数
│   ├── views/              # 页面视图
│   ├── App.vue             # 根组件
│   └── main.ts             # 入口文件
├── .env.development        # 开发环境配置
├── .env.production         # 生产环境配置
├── vite.config.ts          # Vite 配置
└── package.json
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

启动开发服务器（自动热重载）：

```bash
npm run dev
```

访问 `http://localhost:3000`

### 生产构建

```bash
npm run build
```

构建产物在 `dist/` 目录

### 预览构建结果

```bash
npm run preview
```

## 环境要求

- Node.js 18+ 或 20+ LTS
- 后端服务运行在 `http://localhost:8000`

## 功能特性

- ✅ UR5 机器人 3D 可视化
- ✅ 实时关节状态显示
- ✅ 手动控制面板
- ✅ AR 模式支持（Quest 3）
- ✅ 手柄追踪与映射
- ✅ 实时物理仿真同步

## 注意事项

1. 确保后端服务已启动（端口 8000）
2. Quest 3 需要使用 Meta Quest Browser
3. AR 功能需要 HTTPS 环境（生产环境）
4. 建议使用 5GHz WiFi 以获得更低延迟

## License

MIT
