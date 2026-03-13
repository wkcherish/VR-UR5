# UR5 MuJoCo 仿真后端说明文档

## 📋 目录
- [项目概述](#项目概述)
- [文件结构](#文件结构)
- [核心功能](#核心功能)
- [技术实现](#技术实现)
- [API 接口](#api-接口)
- [使用流程](#使用流程)
- [启动参数](#启动参数)

---

## 项目概述

本项目是一个基于 **MuJoCo** 物理引擎的 UR5 机器人仿真后端服务，通过 **FastAPI** 提供 RESTful API 接口，支持 Web 前端（包括 Quest 3 VR 浏览器）对 UR5 机器人进行实时控制和状态获取。

### 主要特性
- ✅ 基于 MuJoCo 的高精度物理仿真
- ✅ FastAPI 高性能异步 Web 服务
- ✅ CORS 跨域支持（兼容 Quest 3）
- ✅ RESTful API 设计
- ✅ 实时关节状态反馈
- ✅ 位置控制模式
- ✅ 可选可视化窗口（MuJoCo Viewer）

---

## 文件结构

```
backend/
├── converter.py          # URDF 到 MJCF 的转换器
├── main.py              # FastAPI 主服务器
├── ur5_converted.xml    # 生成的 MuJoCo 模型文件（由 converter.py 生成）
└── doc/                 # 说明文档目录
    ├── README.md        # 本文档
    └── architecture.md  # 架构说明（可选扩展）
```

### 依赖关系
- `frontend/ur5/ur5.urdf` - UR5 机器人的 URDF 描述文件
- `frontend/ur5/visual/*.dae` - 视觉网格文件
- `frontend/ur5/collision/*.stl` - 碰撞网格文件

---

## 核心功能

### 1. URDF 到 MJCF 转换 (`converter.py`)

**功能**：将 ROS 标准的 URDF 格式转换为 MuJoCo 的 MJCF 格式

**关键配置**：
- **Compiler 设置**：
  - `angle="radian"` - 使用弧度制
  - `meshdir="../frontend/ur5/collision"` - 碰撞网格文件路径（使用 .stl 文件）

- **物理参数**：
  - `gravity="0 0 -9.81"` - 重力加速度
  - `timestep="0.002"` - 仿真时间步长（500Hz）
  - `integrator="RK4"` - 四阶龙格库塔积分器

- **视觉环境**：
  - 天空盒（skybox）渐变纹理（rgb1: 0.3 0.5 0.7 → rgb2: 0 0 0）
  - 棋盘格地板材质（MatPlane）
  - 方向性光源（位置：0 0 3，方向：0 0 -1）
  - Headlight 环境光（ambient: 0.3 0.3 0.3）

- **执行器配置**：
  - 为 6 个主要关节添加 position 类型执行器
  - 比例增益 `kp="100"`，速度增益 `kv="10"`
  - 力矩限制：基座和肩部 150Nm，腕部 28Nm
  - 力矩范围动态设置（forcelimited="true"）

- **传感器配置**：
  - 为每个关节添加 jointpos 位置传感器
  - 用于实时反馈关节角度

**转换结果**：
- 完整的机器人运动学链
- 所有 link 的质量和惯性参数
- visual 和 collision 几何体映射
- 关节限位和动力学参数

### 2. FastAPI 仿真服务器 (`main.py`)

#### 2.1 初始化流程

**Lifespan 管理器**：
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 动态计算 mesh 绝对路径（collision 子目录）
    mesh_dir = os.path.join(script_dir, "..", "frontend", "ur5", "collision")
    
    # 2. 读取并修改 XML 的 meshdir 属性（使用正则替换）
    xml_content = re.sub(
        r'meshdir="[^"]*"',
        f'meshdir="{mesh_dir_abs}"',
        xml_content
    )
    
    # 3. 创建临时文件保存修改后的 XML
    with tempfile.NamedTemporaryFile(mode='w', suffix='.xml', delete=False) as temp_file:
        temp_file.write(xml_content)
        temp_model_path = temp_file.name
    
    # 4. 从临时文件加载模型
    model = mujoco.MjModel.from_xml_path(temp_model_path)
    
    # 5. 验证模型并清理临时文件
    mujoco.mj_forward(model, data)
    os.remove(temp_model_path)
```

**关键技术点**：
- 动态路径解析（解决相对路径问题）
- 临时文件管理（自动清理）
- 模型验证机制
- 路径格式统一（反斜杠转正斜杠）

#### 2.2 仿真循环

**后台任务**：
```python
async def simulation_loop():
    dt = 0.01  # 100Hz 仿真频率
    while simulation_running:
        try:
            if model is not None and data is not None:
                mujoco.mj_step(model, data)
            await asyncio.sleep(dt)
        except Exception as e:
            print(f"仿真错误：{str(e)}")
            break
```

**特点**：
- 异步非阻塞执行
- 固定时间步长保证稳定性
- 优雅关闭机制
- 异常处理机制

---

## 技术实现

### 数据模型

**Pydantic 模型**：
```python
# 控制输入（6 个关节目标角度）
class ControlInput(BaseModel):
    target_angles: List[float]

# 单个关节状态
class JointState(BaseModel):
    joint_name: str
    position: float
    velocity: float

# 完整机器人状态
class RobotState(BaseModel):
    joints: List[JointState]
    qpos: List[float]  # 广义位置（所有关节角度）
    qvel: List[float]  # 广义速度（所有关节角速度）
```

**全局变量**：
```python
model: mujoco.MjModel = None      # MuJoCo 模型
data: mujoco.MjData = None        # MuJoCo 数据
simulation_running = False        # 仿真运行标志
viewer_enabled = False            # 可视化窗口开关
viewer_thread = None              # 可视化线程
```

### MuJoCo 核心操作

**1. 关节 ID 映射**：
```python
# 名称 → ID
actuator_id = mujoco.mj_name2id(
    model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_name
)

# ID → 名称
joint_name = mujoco.mj_id2name(
    model, mujoco.mjtObj.mjOBJ_JOINT, joint_id
)
```

**2. 状态读写**：
```python
# 读取关节位置/速度（通过 jnt_qposadr 和 jnt_dofadr 索引）
qpos_idx = model.jnt_qposadr[joint_id]
qvel_idx = model.jnt_dofadr[joint_id]
position = float(data.qpos[qpos_idx]) if qpos_idx >= 0 else 0.0
velocity = float(data.qvel[qvel_idx]) if qvel_idx >= 0 else 0.0

# 设置控制目标
data.ctrl[actuator_id] = target_angle
```

**3. 前向动力学**：
```python
mujoco.mj_forward(model, data)  # 计算所有派生量（位置、速度、加速度等）
```

**4. 仿真步进**：
```python
mujoco.mj_step(model, data)  # 执行一步物理仿真
```

### CORS 配置

**多来源支持**：
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",      # 本地开发
        "http://127.0.0.1:3000",       # 本地开发
        "http://localhost:8080",       # 备用端口
        "http://192.168.*.*",          # 局域网设备（Quest 3）
        "*",                           # 允许所有来源（开发环境）
    ],
    allow_credentials=True,
    allow_methods=["*"],              # 允许所有 HTTP 方法
    allow_headers=["*"],              # 允许所有请求头
)
```

---

## API 接口

### 基础信息

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 健康检查 |
| `/info` | GET | 获取模型详细信息 |

### 状态获取

| 端点 | 方法 | 描述 |
|------|------|------|
| `/state` | GET | 获取完整机器人状态 |
| `/joint/{joint_name}` | GET | 获取单个关节状态 |

### 控制接口

| 端点 | 方法 | 描述 |
|------|------|------|
| `/control` | POST | 发送关节目标角度 |
| `/reset` | POST | 重置仿真到初始状态 |

### 请求示例

**POST /control**
```json
{
  "target_angles": [0.5, -0.3, 0.8, 0.2, -0.1, 0.4]
}
```

**响应示例**
```json
{
  "status": "success",
  "message": "已更新 6 个关节目标角度",
  "target_angles": [0.5, -0.3, 0.8, 0.2, -0.1, 0.4],
  "current_ctrl": [0.5, -0.3, 0.8, 0.2, -0.1, 0.4]
}
```

### 可视化窗口

**启动方式**：
- 通过 `--viewer` 参数或交互式提示启用
- MuJoCo Viewer 在独立线程中运行
- 不阻塞 Web 服务

**功能**：
- 实时显示机器人运动状态
- 支持鼠标拖拽、缩放视角
- 支持键盘快捷键（F1 查看帮助）

**注意**：
- 可视化窗口需要图形界面环境
- 在无头服务器上使用 `--no-viewer` 模式

---

## 启动参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--viewer` | flag | False | 启动 MuJoCo 可视化窗口 |
| `--host` | string | "0.0.0.0" | 服务器监听地址 |
| `--port` | int | 8000 | 服务器端口 |

**示例**：
```bash
# 仅启动 Web 服务（无头模式）
python main.py

# 启用可视化窗口
python main.py --viewer

# 指定端口
python main.py --port 8080
```

---

## 使用流程

#### Step 1: 生成 MJCF 文件

```bash
cd backend
python converter.py
```

**转换流程**：
1. 读取 `frontend/ur5/ur5.urdf` 文件
2. 提取所有 visual 和 collision mesh 文件名
3. 复制 mesh 文件到临时目录（去掉路径前缀）
4. 使用 `mujoco.MjModel.from_xml_path()` 加载 URDF
5. 自动解析运动学树和坐标变换
6. 保存为 MJCF 格式
7. 添加 actuator、sensor 和环境配置
8. 设置 meshdir 为 `../frontend/ur5/collision`

**输出**：
- 生成 `ur5_converted.xml`
- 配置 mesh 路径、执行器、传感器、环境等

#### Step 2: 启动仿真服务器

#### Step 2: 启动仿真服务器

```bash
python main.py
```

**交互式启动选项**：
- 运行后会提示：`是否启动 MuJoCo 可视化窗口？(yes/no):`
- 输入 `yes` 或 `y` 启动可视化窗口
- 输入 `no` 或 `n` 以无头模式运行

**或使用命令行参数**：
```bash
# 启用可视化窗口
python main.py --viewer

# 无头模式（默认）
python main.py
```

#### Step 3: 测试 API

**获取状态**：
```bash
curl http://localhost:8000/state
```

**发送控制指令**：
```bash
curl -X POST http://localhost:8000/control \
  -H "Content-Type: application/json" \
  -d '{"target_angles": [0.5, -0.3, 0.8, 0.2, -0.1, 0.4]}'
```

#### Step 4: 与前端集成

**Web 端调用示例**：
```javascript
// 获取机器人状态
const state = await fetch('http://localhost:8000/state')
  .then(res => res.json());

// 发送控制指令
await fetch('http://localhost:8000/control', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    target_angles: [0.5, -0.3, 0.8, 0.2, -0.1, 0.4]
  })
});
```

---

## 关键技术点总结

### 1. 路径处理机制
- **问题**：MuJoCo 的 `meshdir` 使用相对路径，但运行时工作目录不确定
- **解决**：
  - 启动时动态读取 XML
  - 使用正则表达式替换 `meshdir` 为绝对路径
  - 路径格式统一（反斜杠转正斜杠）
  - 通过临时文件加载，自动清理

### 2. 异步仿真循环
- **挑战**：Web 服务需要响应请求，同时保持物理仿真连续运行
- **方案**：
  - 使用 `asyncio.create_task()` 启动后台仿真循环
  - 与 FastAPI 事件循环并行
  - 固定时间步长（dt=0.01s，100Hz）
  - 异常处理机制

### 3. 关节映射策略
- **UR5 关节顺序**：
  1. shoulder_pan_joint（基座旋转）
  2. shoulder_lift_joint（肩部俯仰）
  3. elbow_joint（肘部俯仰）
  4. wrist_1_joint（腕部旋转 1）
  5. wrist_2_joint（腕部旋转 2）
  6. wrist_3_joint（腕部旋转 3）

- **ID 映射方法**：
  ```python
  # 名称 → ID
  actuator_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, "shoulder_pan_joint")
  
  # ID → 名称
  joint_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_id)
  ```

### 4. 位置控制实现
- **原理**：通过 `data.ctrl` 设置目标角度，MuJoCo 内置的 PD 控制器自动计算扭矩
- **参数**：
  - `kp=100`（比例增益，决定刚性）
  - `kv=10`（速度增益，决定阻尼）
  - `forcelimited=true`（力矩限制）
  - `forcerange="0 150"`（基座和肩部最大 150Nm）
  - `forcerange="0 28"`（腕部最大 28Nm）

### 5. 可视化窗口管理
- **线程模型**：在独立线程中运行 MuJoCo Viewer
- **启动方式**：
  - 交互式提示（yes/no）
  - 命令行参数（`--viewer`）
- **非阻塞设计**：Viewer 不阻塞 Web 服务

---

## 故障排查

### 常见问题

**1. Mesh 文件加载失败**
```
✗ 找不到 mesh 目录：/path/to/frontend/ur5/collision
```
**原因**：collision 目录不存在或路径配置错误  
**解决**：
- 确保 `frontend/ur5/collision` 目录存在
- 确认包含所有 `.stl` 文件（base.stl, shoulder.stl 等）
- 检查 `ur5_converted.xml` 中的 `meshdir` 属性

**2. XML 解析错误**
```
✗ 模型加载失败：Error parsing XML
```
**原因**：URDF 转换过程中出现错误  
**解决**：
- 重新运行 `converter.py` 生成正确的 XML
- 检查 URDF 文件语法是否正确
- 确认所有 mesh 文件存在

**3. CORS 错误（前端无法访问）**
```
Access to fetch at ... has been blocked by CORS policy
```
**原因**：CORS 配置未包含前端地址  
**解决**：
- 检查 `main.py` 中的 CORS 配置
- 确保 `allow_origins` 包含前端地址
- Quest 3 需要允许局域网访问（`http://192.168.*.*`）

**4. 端口被占用**
```
Address already in use: port 8000
```
**原因**：端口 8000 已被其他进程使用  
**解决**：
```bash
# Windows：查找占用端口的进程
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# 或使用不同端口启动
python main.py --port 8080
```

**5. 可视化窗口无法启动**
```
✗ 可视化启动失败：GLFW initialization failed
```
**原因**：缺少图形界面或 OpenGL 驱动  
**解决**：
- 在无头模式下运行（不启用 viewer）
- 安装 OpenGL 驱动
- 确保系统支持图形界面

---

## 性能指标

- **仿真频率**：100Hz（dt=0.01s，可通过修改 `simulation_loop` 调整）
- **API 响应延迟**：< 10ms（本地访问）
- **并发连接**：支持多客户端（受限于物理引擎单例）
- **内存占用**：~50MB（模型 + 仿真数据）
- **启动时间**：~1-2 秒（包括模型加载和验证）

---

## 版本历史

### v1.1.0 (当前版本)
- ✅ 添加可视化窗口支持（`--viewer` 参数）
- ✅ 增强故障排查文档
- ✅ 优化路径处理机制
- ✅ 改进异常处理
- ✅ 完善传感器配置

### v1.0.0
- ✅ 基础 UR5 仿真
- ✅ 6 关节位置控制
- ✅ RESTful API
- ✅ Quest 3 兼容性

---

**文档生成时间**: 2026-03-13  
**最后更新**: 2026-03-13（v1.1.0）  
**维护者**: 项目组
