 # UR5 机器人 AR 控制前端开发任务清单

## 📋 项目概述
基于 Vue 3 + Three.js 实现 UR5 机器人的 Web 端可视化，集成 Quest 3 AR 手柄控制，通过局域网与后端 FastAPI+MuJoCo 仿真环境实时通信。

---

## 🎯 核心目标
1. **3D 可视化**：在浏览器中展示 UR5 机器人模型
2. **AR 集成**：Quest 3 手柄在 AR 环境中操作
3. **实时控制**：手柄位姿映射为机械臂关节控制指令
4. **状态同步**：前端显示与 MuJoCo 仿真状态实时同步

---

## 📦 技术栈选择

### 前端框架
- **Vue 3** (Composition API)
- **Vite** (构建工具)
- **TypeScript** (类型安全)

### 3D 渲染
- **Three.js** (WebGL 渲染器)
- **STL Loader** (加载碰撞模型)
- **DAE Loader** (加载视觉模型)

### AR/VR 支持
- **WebXR API** (原生浏览器支持)
- **Oculus Touch Controller** (手柄追踪)

### UI 组件库
- **Element Plus** 或 **PrimeVue** (控制面板)
- **Tailwind CSS** (样式)

### 网络通信
- **Axios** (HTTP 请求)
- **WebSocket** (可选，用于实时状态推送)

---

## ✅ 任务分解

### **阶段 1: 项目初始化与基础设置**

#### Task 1.1: 创建 Vue 3 项目

**技术实现细节**：
1. 使用 Vite 脚手架工具创建 Vue 3 + TypeScript 模板项目
2. 安装核心依赖包：
   - Vue Router：用于页面路由管理
   - Pinia：Vue 3 官方推荐的状态管理库
   - Three.js：WebGL 3D 渲染库
   - Axios：HTTP 请求库，用于与后端 API 通信
3. 安装类型定义文件（@types/three）以确保 TypeScript 类型安全

**注意事项**：
- ⚠️ **Node.js 版本**：建议使用 Node.js 18+ 或 20+ LTS 版本，避免兼容性问题
- ⚠️ **TypeScript 配置**：确保 tsconfig.json 中开启严格模式（strict: true）
- ⚠️ **依赖版本匹配**：Vue 3.4+ 配合 Vite 5.0+ 以获得最佳性能
- ⚠️ **npm 源**：国内建议使用淘宝镜像源加速安装

**推荐命令**：
```bash
cd frontend
npm create vite@latest ur5-control -- --template vue-ts
cd ur5-control
npm install
```

---

#### Task 1.2: 配置项目结构

**技术实现细节**：
1. 建立清晰的目录结构，按功能模块组织代码
2. `public/models/`：存放机器人模型文件（可通过符号链接指向源文件）
3. `src/components/`：存放可复用的 Vue 组件
4. `src/composables/`：存放 Composition API 逻辑复用函数
5. `src/stores/`：存放 Pinia 状态管理
6. `src/utils/`：存放工具函数（3D 场景管理、URDF 解析、WebXR 管理等）
7. `src/views/`：存放页面级视图组件

**注意事项**：
- ⚠️ **模型文件路径**：确保模型文件路径与 URDF 中的引用一致
- ⚠️ **符号链接兼容性**：Windows 下创建符号链接可能需要管理员权限
- ⚠️ **模块命名规范**：统一使用驼峰命名或短横线命名，保持项目一致性
- ⚠️ **导入路径别名**：配置 `@` 别名指向 `src` 目录，简化导入语句

**推荐目录结构**：
```
frontend/ur5-control/
├── public/
│   └── models/          # 机器人模型文件
├── src/
│   ├── assets/         # 静态资源
│   ├── components/     # Vue 组件
│   ├── composables/    # Composition API 复用逻辑
│   ├── stores/         # Pinia 状态管理
│   ├── types/          # TypeScript 类型定义
│   ├── utils/          # 工具函数
│   ├── views/          # 页面视图
│   ├── App.vue         # 根组件
│   └── main.ts         # 入口文件
├── index.html
├── vite.config.ts      # Vite 配置
└── package.json
```

---

#### Task 1.3: 配置 Vite 和路径别名

**技术实现细节**：
1. 配置路径别名 `@` 指向 `src` 目录
2. 配置开发服务器：端口 3000，允许局域网访问（host: '0.0.0.0'）
3. 配置 API 代理：将 `/api` 请求代理到后端 `http://localhost:8000`
4. 配置 Tailwind CSS（如使用）

**注意事项**：
- ⚠️ **CORS 跨域**：开发环境使用代理，生产环境需配置 CORS
- ⚠️ **端口占用**：如 3000 端口被占用，改为其他端口（如 5173）
- ⚠️ **局域网 IP**：确保后端服务器的防火墙允许局域网访问
- ⚠️ **路径格式**：Windows 下注意反斜杠转正斜杠问题

**关键配置项**：
- `server.port`: 开发服务器端口
- `server.host`: `'0.0.0.0'` 允许局域网访问
- `server.proxy`: API 代理配置
- `resolve.alias`: 路径别名

---

#### Task 1.4: 复制 UR5 模型文件

**技术实现细节**：
1. 将 `frontend/ur5/collision/` 和 `frontend/ur5/visual/` 复制到 `public/models/`
2. 复制 `ur5.urdf` 到 `public/models/`
3. 或使用符号链接避免重复复制

**注意事项**：
- ⚠️ **文件完整性**：确认所有 STL 和 DAE 文件都已复制（共 14 个文件）
- ⚠️ **路径引用**：URDF 中的 mesh 文件名路径需与实际目录结构匹配
- ⚠️ **符号链接权限**：Windows 下使用 `mklink /D` 需要管理员权限
- ⚠️ **Git 忽略**：在 `.gitignore` 中忽略 `public/models/` 避免提交大文件

---

### **阶段 2: 3D 机器人可视化**

#### Task 2.1: 创建 Three.js 场景管理器

**技术实现细节**：
1. **场景创建**：初始化 THREE.Scene，设置背景色
2. **相机配置**：使用 PerspectiveCamera，FOV 75°，近裁剪面 0.1，远裁剪面 1000
3. **渲染器配置**：WebGLRenderer，开启抗锯齿（antialias: true）和阴影（shadowMap）
4. **光源设置**：
   - 环境光（AmbientLight）：强度 0.5，提供基础照明
   - 平行光（DirectionalLight）：强度 1，产生阴影，模拟主光源
5. **辅助工具**：添加坐标轴助手（AxesHelper）帮助定位
6. **渲染循环**：使用 requestAnimationFrame 实现动画循环

**注意事项**：
- ⚠️ **相机初始位置**：建议设置为 (3, 2, 3)，俯视机器人
- ⚠️ **渲染器尺寸**：需根据容器大小动态调整（响应式设计）
- ⚠️ **内存泄漏**：组件卸载时调用 `renderer.dispose()` 清理资源
- ⚠️ **性能优化**：如场景复杂，考虑使用 HDR 光照和烘焙纹理

**关键技术点**：
- 场景图（Scene Graph）管理
- 相机轨道控制（OrbitControls）
- 阴影映射（Shadow Mapping）
- 渲染循环与帧率控制

---

#### Task 2.2: 实现 URDF 解析器

**技术实现细节**：
1. **XML 解析**：使用 DOMParser 解析 URDF 文件
2. **Link 提取**：遍历所有 `<link>` 标签，提取名称和几何信息
3. **Joint 提取**：遍历所有 `<joint>` 标签，提取关节类型和限位
4. **几何加载**：
   - Visual 几何：加载 DAE 文件（ColladaLoader），保留材质和纹理
   - Collision 几何：加载 STL 文件（STLLoader），使用简化材质
5. **坐标变换**：解析 `<origin>` 标签中的位移和旋转信息
6. **运动学链构建**：根据 joint 的 parent-child 关系构建树状结构

**注意事项**：
- ⚠️ **异步加载**：Mesh 文件加载是异步的，需使用 Promise 或 async/await
- ⚠️ **错误处理**：捕获文件加载失败并给出友好提示
- ⚠️ **坐标系差异**：URDF（右手系）与 Three.js（右手系）基本一致，但需注意 Z 轴方向
- ⚠️ **单位转换**：URDF 通常使用米，确保与 Three.js 单位一致

**UR5 关节顺序**：
1. shoulder_pan_joint（基座旋转）
2. shoulder_lift_joint（肩部俯仰）
3. elbow_joint（肘部俯仰）
4. wrist_1_joint（腕部旋转 1）
5. wrist_2_joint（腕部旋转 2）
6. wrist_3_joint（腕部旋转 3）

---

#### Task 2.3: 创建 RobotViewer 组件

**技术实现细节**：
1. 封装 Three.js 场景到 Vue 组件
2. 在 `onMounted` 生命周期初始化场景和加载模型
3. 在 `onUnmounted` 生命周期清理资源
4. 暴露 `updateJoints` 方法供外部调用更新关节角度
5. 实现正向运动学（FK）计算关节变换矩阵

**注意事项**：
- ⚠️ **组件通信**：使用 `defineExpose` 暴露方法给父组件
- ⚠️ **响应式容器**：确保 container ref 正确绑定到 DOM 元素
- ⚠️ **窗口缩放**：监听 window.resize 事件更新相机和渲染器尺寸
- ⚠️ **加载进度**：显示模型加载进度条提升用户体验

---

### **阶段 3: API 集成与状态管理**

#### Task 3.1: 创建 API 服务

**技术实现细节**：
1. 使用 Axios 创建 HTTP 客户端实例
2. 配置 baseURL、timeout、headers 等默认参数
3. 封装机器人相关 API 方法：
   - getState()：获取完整机器人状态
   - control()：发送关节目标角度
   - reset()：重置仿真
   - getJointState()：获取单个关节状态
4. 定义 TypeScript 接口（JointState、RobotState、ControlInput）

**注意事项**：
- ⚠️ **环境变量**：使用 `import.meta.env.VITE_API_URL` 配置 API 地址
- ⚠️ **超时设置**：建议设置为 5000ms，避免长时间等待
- ⚠️ **错误拦截**：添加 Axios 拦截器统一处理错误
- ⚠️ **请求重试**：对于网络波动可实现自动重试机制

---

#### Task 3.2: 创建 Pinia Store

**技术实现细节**：
1. 定义机器人状态 Store（isConnected、currentState、targetAngles 等）
2. 实现 Actions：
   - connect()：连接后端并获取初始状态
   - fetchState()：轮询获取最新状态
   - sendCommand()：发送控制指令
   - reset()：重置仿真
3. 使用 Computed 属性派生状态（jointStates、currentPositions）

**注意事项**：
- ⚠️ **状态持久化**：考虑是否需要持久化连接状态
- ⚠️ **并发控制**：防止重复发送控制指令
- ⚠️ **错误处理**：Action 中使用 try-catch 捕获异常
- ⚠️ **Loading 状态**：异步操作时更新 loading 标志

---

#### Task 3.3: 创建 useRobot Composable

**技术实现细节**：
1. 封装 Pinia Store 到 Composable 函数
2. 实现状态轮询机制（定时调用 fetchState）
3. 监听连接状态自动启停轮询
4. 可配置轮询间隔（默认 100ms）

**注意事项**：
- ⚠️ **定时器清理**：组件卸载时清除定时器避免内存泄漏
- ⚠️ **轮询频率**：100ms 较合适，过快增加服务器压力
- ⚠️ **连接检测**：网络断开时停止轮询并重试
- ⚠️ **性能影响**：轮询会持续消耗网络带宽，考虑 WebSocket 替代方案

---

### **阶段 4: AR 手柄集成与 VR 交互**

#### Task 4.1: WebXR 与 VR 模式基础

**技术实现细节**：
1. **WebXR 初始化**：
   - 检查 `navigator.xr.isSessionSupported('immersive-vr')` 确认设备支持
   - 配置 Three.js 渲染器启用 XR：`renderer.xr.enabled = true`
   - 添加"进入 VR 模式" / "退出 VR 模式" 按钮，绑定 session 请求逻辑
2. **控制器与手部追踪设置**：
   - 初始化控制器：`renderer.xr.getController(0)` (左) 和 `renderer.xr.getController(1)` (右)
   - 初始化手柄模型：`renderer.xr.getControllerGrip(0/1)` 加载 Quest 3 手柄模型
   - (可选) 初始化手部追踪：使用 `THREE.HandInput` 支持裸手操作
3. **VR 场景优化**：
   - 设置 VR 模式下的相机偏移（确保视角高度正确）
   - 添加地面网格和环境参照物

**注意事项**：
- ⚠️ **HTTPS 要求**：WebXR 必须在 HTTPS 或 localhost 环境下运行
- ⚠️ **Quest 3 浏览器**：需使用 Meta Quest Browser 进行测试
- ⚠️ **交互对齐**：确保虚拟手柄位置与真实手柄位置对齐

---

#### Task 4.2: VR 界面与交互模式切换

**技术实现细节**：
1. **VR 内 UI 面板**：
   - 创建随视线或手柄移动的 3D UI 面板 (使用 HTMLMesh 或 CanvasTexture)
   - 显示当前控制模式、连接状态、关节角度数值
2. **手/手柄切换逻辑**：
   - 实现"手柄模式"与"手势模式"的切换开关
   - 监听输入源变化 (`inputsourceschange`) 自动识别当前激活的输入设备
   - 在 UI 中提供手动切换按钮，根据选择隐藏/显示手柄模型或手部模型
3. **视觉反馈**：
   - 当按下左手柄特定按键时，高亮显示对应的机械臂关节
   - 摇杆操作时显示方向指示箭头

**注意事项**：
- ⚠️ **UI 可读性**：VR 中文字需足够大，避免过于密集的排版
- ⚠️ **防晕动设计**：UI 面板运动需平滑，避免剧烈抖动

---

#### Task 4.3: 实现基于 Quest 3 手柄的关节与抓手控制映射

**核心逻辑**：
采用 **左手柄选择关节组 + 右手柄摇杆执行 + 右手柄 Trigger 直接控制抓手** 的组合方案。这样既保留了双手分工，也让最常用的“抓取”动作落在主流 VR 应用最常见的 **右手 Trigger** 上，整体更符合 Quest 系列和大多数 VR 手柄交互习惯。

**推荐交互分组**：
- **左手 X**：控制大臂组（Shoulder Pan / Shoulder Lift）
- **左手 Y**：控制前臂组（Elbow / Wrist 1）
- **左手 Grip（侧键）**：控制手腕组（Wrist 2 / Wrist 3）
- **左手 Trigger（扳机）**：进入精细模式，降低速度，便于微调
- **右手 Trigger（扳机）**：直接控制抓手开合
- **右手摇杆**：负责连续输入，不再承担抓手开合功能

**技术实现细节**：
1. **输入轮询循环**：
   - 在 `renderer.setAnimationLoop` 中每一帧获取 Gamepad 数据
   - 获取左手柄按键状态 (Buttons)、右手柄摇杆数据 (Axes) 与右手柄 Trigger 模拟量

2. **运动执行逻辑**：
   - 读取右手柄摇杆数据：`stickX = gamepad.axes[2]` (左右), `stickY = gamepad.axes[3]` (上下)
   - **死区处理**：忽略绝对值小于 0.1 的输入，并建议对超出死区后的输入做线性重映射，避免刚越过死区时突然跳变
   - **抓手输入**：读取右手柄 Trigger 值 `gripperValue = rightPad.buttons[0].value`
   - **映射规则**：
     - **底座控制 (Shoulder Pan)**: 按住左手柄 **X键** + 右手柄摇杆 **上下**
     - **肩部控制 (Shoulder Lift)**: 按住左手柄 **X键** + 右手柄摇杆 **左右**
     - **肘部控制 (Elbow)**: 按住左手柄 **Y键** + 右手柄摇杆 **上下**
     - **腕部关节1 (Wrist 1)**: 按住左手柄 **Y键** + 右手柄摇杆 **左右**
     - **腕部关节2 (Wrist 2)**: 按住左手柄 **Grip键 (侧键)** + 右手柄摇杆 **上下**
     - **手腕旋转 (Wrist 3)**: 按住左手柄 **Grip键 (侧键)** + 右手柄摇杆 **左右**
     - **抓手开合 (Gripper)**: 右手柄 **Trigger键 (扳机)** 直接映射到 `gripper_position`

3. **操作手感优化**：
   - **抓取动作独立**：抓手不再占用左手模式键，避免“想抓取时还要切模式”
   - **按关节组分层**：`X = 大臂`、`Y = 前臂`、`Grip = 手腕`，记忆成本更低
   - **精细模式**：按住左手 Trigger 时，将角速度缩放到常规速度的 `0.3 ~ 0.5`

4. **指令发送**：
   - 将计算出的角度增量应用到当前目标角度
   - 将右手 Trigger 的模拟量同步映射为 `gripper_position`
   - 在同一条控制消息中同时发送 `target_angles` 与 `gripper_position`

**注意事项**：
- ⚠️ **模式优先级**：左手模式键建议按 `Grip > Y > X` 处理，左手 Trigger 作为精细模式可与任一模式叠加
- ⚠️ **抓手方向校准**：建议定义为“扳机按得越深，抓手闭合越多”；若模型方向相反，只在输入适配层做一次反向映射
- ⚠️ **安全限位**：在前端严格限制目标角度在 UR5 物理限位内，`gripper_position` 也应限制在后端约定范围内
- ⚠️ **平滑处理**：对摇杆输入进行低通滤波，避免机械臂抖动；抓手输入可单独使用更缓的插值

**关键代码参考**：
```typescript
// 伪代码示例：基于 WebXR Gamepad API
const leftPad = leftController.gamepad;   // 左手柄
const rightPad = rightController.gamepad; // 右手柄

const stickX = applyDeadzone(rightPad.axes[2], 0.1); // 右手摇杆左右
const stickY = applyDeadzone(rightPad.axes[3], 0.1); // 右手摇杆上下
const precisionMode = leftPad.buttons[0].value > 0.1; // 左 Trigger
const speed = baseSpeed * (precisionMode ? 0.4 : 1.0);

// 右 Trigger 直接控制抓手开合
const triggerValue = rightPad.buttons[0].value;
targetJoints.gripper_position = mapTriggerToGripper(triggerValue);

// 左手模式优先级：Grip > Y > X
if (leftPad.buttons[1].pressed) { // Grip (侧键)
    targetJoints.wrist2 += stickY * speed;
    targetJoints.wrist3 += stickX * speed;
}
else if (leftPad.buttons[5].pressed) { // Y Button
    targetJoints.elbow += stickY * speed;
    targetJoints.wrist1 += stickX * speed;
}
else if (leftPad.buttons[4].pressed) { // X Button
    targetJoints.shoulderPan += stickY * speed;
    targetJoints.shoulderLift += stickX * speed;
}

sendControl({
    target_angles: [
        targetJoints.shoulderPan,
        targetJoints.shoulderLift,
        targetJoints.elbow,
        targetJoints.wrist1,
        targetJoints.wrist2,
        targetJoints.wrist3,
    ],
    gripper_position: targetJoints.gripper_position,
});
```

---

### **阶段 5: UI 组件开发**

#### Task 5.1: 创建控制面板组件

**技术实现细节**：
1. **连接状态显示**：用颜色指示器显示连接状态（绿/红）
2. **关节滑块控制**：6 个滑块对应 6 个关节，范围 ±π（±180°）
3. **预设位置按钮**：
   - 归零：所有关节回到 0 位置
   - 准备位置：抬起机械臂到安全姿态
4. **操作按钮**：发送指令、重置仿真
5. **错误信息显示**：红色警告框显示错误信息

**注意事项**：
- ⚠️ **禁用状态**：未连接时禁用所有控制元素
- ⚠️ **实时反馈**：滑块拖动时显示当前角度值（度或弧度）
- ⚠️ **布局响应式**：适配不同屏幕尺寸
- ⚠️ **防抖处理**：滑块拖动时添加防抖避免频繁请求

---

#### Task 5.2: 创建状态显示组件

**技术实现细节**：
1. **关节状态列表**：显示每个关节的名称、位置（度）、速度（rad/s）
2. **全局状态**：显示最后更新时间
3. **数据刷新**：跟随 Pinia Store 实时更新

**注意事项**：
- ⚠️ **数值格式化**：位置和速度保留合适的小数位数
- ⚠️ **单位显示**：明确标注单位（° 或 rad）
- ⚠️ **性能考虑**：避免频繁 DOM 更新导致卡顿
- ⚠️ **颜色编码**：可用颜色区分不同关节

---

### **阶段 6: 主页面集成**

#### Task 6.1: 创建主页面

**技术实现细节**：
1. **布局设计**：
   - 顶部 Header：标题 + AR 控制按钮
   - 左侧 Viewer 区域：3D 机器人查看器（占主要空间）
   - 右侧 Sidebar：控制面板 + 状态显示
2. **组件事件处理**：
   - AR 手柄位姿更新 → 转换为关节角度 → 发送控制指令
   - 更新 3D 视图显示最新姿态
3. **响应式设计**：小屏幕下 Sidebar 折叠或移到底部

**注意事项**：
- ⚠️ **组件引用**：使用 ref 获取 RobotViewer 实例调用其方法
- ⚠️ **错误边界**：捕获 AR 控制异常避免整个应用崩溃
- ⚠️ **性能优化**：大量计算放在 Web Worker 中执行
- ⚠️ **用户体验**：添加加载动画和过渡效果

---

#### Task 6.2: 配置路由

**技术实现细节**：
1. 使用 Vue Router 管理页面路由
2. 配置至少两个路由：
   - `/`：主页面（HomeView）
   - `/ar`：AR 模式页面（可选，也可在主页面集成）
3. 配置路由模式和 base 路径

**注意事项**：
- ⚠️ **路由模式**：使用 History 模式需服务器配合
- ⚠️ **导航守卫**：必要时添加路由守卫检查连接状态
- ⚠️ **懒加载**：大型组件使用路由懒加载

---

### **阶段 7: 环境配置与部署**

#### Task 7.1: 环境变量配置

**技术实现细节**：
1. 创建 `.env.development`（开发环境）
2. 创建 `.env.production`（生产环境）
3. 配置变量：
   - VITE_API_URL：后端 API 地址
   - VITE_APP_TITLE：应用标题

**注意事项**：
- ⚠️ **变量前缀**：必须以 `VITE_` 开头才能被 Vite 识别
- ⚠️ **敏感信息**：不要将密钥等敏感信息提交到 Git
- ⚠️ **IP 地址**：生产环境填写服务器真实 IP 地址

---

#### Task 7.2: 配置构建脚本

**技术实现细节**：
1. 在 package.json 中配置 scripts：
   - dev：启动开发服务器
   - build：生产环境构建
   - preview：预览构建结果
   - type-check：TypeScript 类型检查

**注意事项**：
- ⚠️ **类型检查**：构建前运行 `vue-tsc` 检查类型错误
- ⚠️ **Source Map**：生产环境可选择关闭 source map 减小体积

---

#### Task 7.3: 构建和部署

**技术实现细节**：
1. **开发环境运行**：
   ```bash
   npm run dev -- --host
   ```
   `--host` 参数允许局域网访问

2. **生产环境构建**：
   ```bash
   npm run build
   ```
   生成 `dist/` 目录

3. **部署选项**：
   - **本地服务器**：直接用开发服务器（不推荐生产环境）
   - **Nginx**：将 dist/ 部署到 Nginx 静态站点
   - **Docker**：容器化部署（需编写 Dockerfile）

**注意事项**：
- ⚠️ **跨域问题**：生产环境确保后端配置 CORS
- ⚠️ **路径问题**：如部署到子目录，需配置 `base` 选项
- ⚠️ **Gzip 压缩**：Nginx 开启 gzip 提升加载速度
- ⚠️ **缓存策略**：静态资源配置合理的 Cache-Control

---

### **阶段 8: 测试与优化**

#### Task 8.1: 功能测试清单

**测试项目**：
- [ ] 3D 模型正确加载和显示（无缺失部件）
- [ ] 关节运动符合预期（限位内运动）
- [ ] API 连接稳定（无频繁断连）
- [ ] 状态实时更新（延迟 < 200ms）
- [ ] AR 模式正常启动（Quest 3 识别）
- [ ] 手柄追踪准确（无明显漂移）
- [ ] 手柄到关节映射合理（运动直观）
- [ ] 延迟在可接受范围内（总延迟 < 300ms）

**注意事项**：
- ⚠️ **真机测试**：必须在 Quest 3 上实际测试 AR 功能
- ⚠️ **网络测试**：测试不同网络质量下的表现
- ⚠️ **边界测试**：测试关节限位、网络超时等边界情况

---

#### Task 8.2: 性能优化

**优化方向**：
1. **网络层**：
   - 使用 WebSocket 替代 HTTP 轮询（需后端支持）
   - 降低轮询频率（从 100ms 调整到 200-500ms）
2. **渲染层**：
   - Three.js 渲染优化（减少面数、使用 LOD）
   - 使用 Draco 压缩模型
   - 实现视锥体剔除
3. **代码层**：
   - 使用虚拟滚动优化长列表
   - 防抖节流减少不必要计算

**注意事项**：
- ⚠️ **性能监控**：使用 Chrome DevTools Performance 面板分析
- ⚠️ **权衡取舍**：画质与性能的平衡
- ⚠️ **渐进优化**：先保证功能正常，再逐步优化

---

#### Task 8.3: 错误处理增强

**技术实现细节**：
1. 配置 Vue 全局错误处理器（app.config.errorHandler）
2. 网络错误重试机制（指数退避）
3. 用户友好的错误提示信息
4. 错误日志上报（可选）

**注意事项**：
- ⚠️ **错误分类**：区分网络错误、用户操作错误、系统错误
- ⚠️ **恢复机制**：提供明确的恢复指引（如"点击重试"）
- ⚠️ **日志记录**：记录关键错误便于排查问题

---

## 🎯 关键里程碑

### M1: 基础可视化完成 (阶段 1-2)
- ✅ Vue 项目搭建完成
- ✅ UR5 模型加载显示
- ✅ 基本 3D 场景搭建
- ✅ 手动旋转视角查看

**预计时间**：1-2 天

---

### M2: 控制功能完成 (阶段 3, 5)
- ✅ API 集成完成
- ✅ 手动控制面板可用
- ✅ 状态实时显示
- ✅ 滑块控制关节运动

**预计时间**：2-3 天

---

### M3: AR 集成完成 (阶段 4, 6)
- ✅ WebXR 支持完成
- ✅ 手柄追踪正常
- ✅ 手势映射合理
- ✅ AR 模式实际控制机械臂

**预计时间**：3-4 天

---

### M4: 部署上线 (阶段 7-8)
- ✅ 局域网访问正常
- ✅ 性能优化完成
- ✅ 完整测试通过
- ✅ 文档完善

**预计时间**：1-2 天

---

## 📝 注意事项

### 安全要求
1. **急停机制**：前端必须添加急停按钮，一键停止所有运动
2. **限位检查**：发送指令前验证关节限位，防止超限
3. **超时断开**：检测到网络超时（>3 秒）自动停止控制
4. **速度限制**：限制最大关节速度，避免危险运动

### 用户体验
1. **加载反馈**：模型加载时显示进度条
2. **连接提示**：明确显示连接状态（已连接/未连接/重连中）
3. **错误恢复**：提供清晰的错误信息和恢复指引
4. **操作引导**：首次使用时显示简要操作说明

### Quest 3 兼容性
1. **浏览器要求**：需使用 Meta Quest Browser（基于 Chromium）
2. **HTTPS 要求**：部分 WebXR 特性需要 HTTPS 环境
3. **权限申请**：首次使用需用户授权访问 XR 设备
4. **手柄配对**：确保 Quest 3 手柄已正确配对

### 网络要求
1. **局域网稳定性**：确保 WiFi 信号稳定，推荐使用 5GHz 频段
2. **延迟控制**：端到端延迟控制在 300ms 以内
3. **带宽需求**：不高（主要是 JSON 数据），普通 WiFi 即可
4. **IP 配置**：服务器需使用固定 IP 或 DHCP 保留

---

## 🔗 相关资源

### 文档链接
- [Vue 3 官方文档](https://vuejs.org/)
- [Three.js 官方文档](https://threejs.org/docs/)
- [WebXR API 规范](https://www.w3.org/TR/webxr/)
- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [MuJoCo 文档](https://mujoco.readthedocs.io/)

### 示例代码
- [Three.js Examples](https://threejs.org/examples/)
- [WebXR Samples](https://mdn.github.io/dom-examples/webxr/)
- [A-Frame Examples](https://aframe.io/examples/)

### 参考项目
- GitHub: `three-vr-controller`
- GitHub: `webxr-samples`
- GitHub: `ur5-robot-description` (URDF 参考)

---

## 📞 常见问题

### Q1: 模型加载失败怎么办？
**检查清单**：
1. 确认模型文件路径正确
2. 检查 URDF 中 mesh 文件名与实际文件一致
3. 查看浏览器控制台错误信息
4. 确认 MIME type 配置正确（Nginx 需配置 .stl 和 .dae 的 MIME type）

### Q2: AR 模式无法启动？
**检查清单**：
1. 确认使用 Meta Quest Browser
2. 检查 WebXR 支持性（访问 https://immersiveweb.dev/webxr-support/）
3. 确保 HTTPS 环境（或使用 localhost）
4. 重启 Quest 3 浏览器清除缓存

### Q3: 手柄控制延迟高？
**优化建议**：
1. 降低轮询频率（如从 100ms 改为 200ms）
2. 使用 5GHz WiFi 频段
3. 靠近路由器减少信号衰减
4. 考虑使用 WebSocket 替代 HTTP 轮询

### Q4: 关节运动不 smooth？
**优化建议**：
1. 添加低通滤波器平滑手柄输入
2. 使用插值算法平滑关节运动
3. 调整 PD 控制器参数（后端）
4. 提高仿真频率（后端 dt 从 0.01 改为 0.005）

---

**创建时间**: 2026-03-13  
**版本**: v1.1.0  
**状态**: 待执行  
**总预计时间**: 7-11 天
