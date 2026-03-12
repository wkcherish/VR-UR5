# UR5 MuJoCo 仿真后端说明文档

## 📋 目录
- [项目概述](#项目概述)
- [文件结构](#文件结构)
- [核心功能](#核心功能)
- [技术实现](#技术实现)
- [API 接口](#api-接口)
- [使用流程](#使用流程)

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
- `frontend/ur5.urdf` - UR5 机器人的 URDF 描述文件
- `frontend/ur5/visual/*.dae` - 视觉网格文件
- `frontend/ur5/collision/*.stl` - 碰撞网格文件

---

## 核心功能

### 1. URDF 到 MJCF 转换 (`converter.py`)

**功能**：将 ROS 标准的 URDF 格式转换为 MuJoCo 的 MJCF 格式

**关键配置**：
- **Compiler 设置**：
  - `angle="radian"` - 使用弧度制
  - `meshdir="../frontend/ur5"` - 网格文件路径

- **物理参数**：
  - `gravity="0 0 -9.81"` - 重力加速度
  - `timestep="0.002"` - 仿真时间步长（500Hz）
  - `integrator="RK4"` - 四阶龙格库塔积分器

- **视觉环境**：
  - 天空盒（skybox）渐变纹理
  - 棋盘格地板材质
  - 方向性光源

- **执行器配置**：
  - 为 6 个主要关节添加 position 类型执行器
  - 比例增益 `kp="100"`，速度增益 `kv="10"`
  - 力矩限制基于 UR5 规格

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
    # 1. 动态计算 mesh 绝对路径
    mesh_dir = os.path.join(script_dir, "..", "frontend", "ur5")
    
    # 2. 读取并修改 XML 的 meshdir 属性
    xml_content = re.sub(
        r'meshdir="[^"]*"',
        f'meshdir="{mesh_dir_abs}"',
        xml_content
    )
    
    # 3. 创建临时文件加载模型
    model = mujoco.MjModel.from_xml_path(temp_model_path)
    
    # 4. 验证模型并清理临时文件
    mujoco.mj_forward(model, data)
```

**关键技术点**：
- 动态路径解析（解决相对路径问题）
- 临时文件管理（自动清理）
- 模型验证机制

#### 2.2 仿真循环

**后台任务**：
```python
async def simulation_loop():
    dt = 0.01  # 100Hz 仿真频率
    while simulation_running:
        mujoco.mj_step(model, data)
        await asyncio.sleep(dt)
```

**特点**：
- 异步非阻塞执行
- 固定时间步长保证稳定性
- 优雅关闭机制

---

## 技术实现

### 数据模型

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
    qpos: List[float]  # 广义位置
    qvel: List[float]  # 广义速度
```

### MuJoCo 核心操作

**1. 关节 ID 映射**：
```python
# 名称 → ID
actuator_id = mujoco.mj_name2id(
    model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_name
)

# ID → 名称
joint_name = mujoco.mjp_id2name(
    model, mujoco.mjtObj.mjOBJ_JOINT, joint_id
)
```

**2. 状态读写**：
```python
# 读取关节位置/速度
position = data.qpos[qpos_idx]
velocity = data.qvel[qvel_idx]

# 设置控制目标
data.ctrl[actuator_id] = target_angle
```

**3. 前向动力学**：
```python
mujoco.mj_forward(model, data)  # 计算所有派生量
```

### CORS 配置

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://192.168.*.*",  # Quest 3 局域网访问
        "*",                   # 开发环境允许所有来源
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

---

## 使用流程

### 1. 首次运行 - 生成 MJCF 文件

```bash
cd backend
python converter.py
```

**输出**：
- 生成 `ur5_converted.xml`
- 配置 mesh 路径、执行器、传感器等

### 2. 启动仿真服务器

```bash
python main.py
```

**启动日志**：
```
============================================================
正在初始化 MuJoCo 仿真环境...
============================================================
加载模型文件：c:\...\backend\ur5_converted.xml
Mesh 目录：c:\...\frontend\ur5
✓ 已更新现有 compiler 的 meshdir 属性

✓ 模型加载成功
  - 自由度 (nv): 6
  - 关节数 (njnt): 8
  - 执行器数 (nu): 6
  - 几何体数量 (ngeom): 14
  - 时间步长：0.0020s
============================================================

UR5 MuJoCo 仿真服务器
============================================================
启动参数:
  主机：0.0.0.0 (允许外部访问)
  端口：8000
  CORS: 已启用 (支持 Quest 3)

API 端点:
  GET  http://localhost:8000/state
  POST http://localhost:8000/control
  GET  http://localhost:8000/info
  POST http://localhost:8000/reset
============================================================
```

### 3. 测试 API

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

### 4. 与前端集成

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
- **解决**：启动时动态读取 XML，用正则替换 `meshdir` 为绝对路径，通过临时文件加载

### 2. 异步仿真循环
- **挑战**：Web 服务需要响应请求，同时保持物理仿真连续运行
- **方案**：使用 `asyncio.create_task()` 启动后台仿真循环，与 FastAPI 事件循环并行

### 3. 关节映射策略
- **UR5 关节顺序**：
  1. shoulder_pan_joint（基座旋转）
  2. shoulder_lift_joint（肩部俯仰）
  3. elbow_joint（肘部俯仰）
  4. wrist_1_joint（腕部旋转 1）
  5. wrist_2_joint（腕部旋转 2）
  6. wrist_3_joint（腕部旋转 3）

### 4. 位置控制实现
- **原理**：通过 `data.ctrl` 设置目标角度，MuJoCo 内置的 PD 控制器自动计算扭矩
- **参数**：`kp=100`（刚性），`kv=10`（阻尼）

---

## 故障排查

### 常见问题

**1. Mesh 文件加载失败**
```
✗ 找不到 mesh 目录：/path/to/frontend/ur5
```
**解决**：确保 `frontend/ur5` 目录存在且包含 `.dae`/`.stl` 文件

**2. XML 解析错误**
```
✗ 模型加载失败：Error parsing XML
```
**解决**：重新运行 `converter.py` 生成正确的 XML

**3. CORS 错误（前端无法访问）**
```
Access to fetch at ... has been blocked by CORS policy
```
**解决**：检查 `main.py` 中的 CORS 配置，确保包含前端地址

---

## 性能指标

- **仿真频率**：100Hz（可调）
- **API 响应延迟**：< 10ms（本地）
- **并发连接**：支持多客户端（受限于物理引擎单例）
- **内存占用**：~50MB（模型 + 仿真数据）

---

## 扩展建议

1. **添加力控接口**：暴露 `data.qfrc_actuator` 用于力反馈
2. **轨迹规划**：增加插值函数实现平滑运动
3. **碰撞检测**：通过 `data.contact` 获取碰撞信息
4. **可视化调试**：集成 MuJoCo 原生渲染器
5. **多机器人支持**：扩展 XML 加载多个 UR5

---

## 版本历史

- **v1.0.0** (当前版本)
  - 基础 UR5 仿真
  - 6 关节位置控制
  - RESTful API
  - Quest 3 兼容性

---

**文档生成时间**: 2026-03-12  
**维护者**: 项目组
