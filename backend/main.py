"""
UR5 MuJoCo Simulation Server
基于 FastAPI 的 UR5 机器人仿真服务
"""

import asyncio
import mujoco
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import os
import threading


# ==================== 全局变量 ====================
model: mujoco.MjModel = None
data: mujoco.MjData = None
simulation_running = False
viewer_enabled = False  # 是否启用可视化窗口
viewer_thread = None    # 可视化线程
viewer_handle = None    # launch_passive 返回的 viewer 句柄
simulation_lock = threading.Lock()
simulation_task = None  # 后台仿真任务
ws_clients: set[WebSocket] = set()
ws_clients_lock: asyncio.Lock | None = None
STATE_PUSH_INTERVAL = 0.02  # 50Hz 状态推送
SIMULATION_ERROR_BACKOFF = 0.05
GRIPPER_ANGLE_MIN = 0.0
GRIPPER_ANGLE_MAX = 0.9
GRIPPER_CTRL_MIN = 0.0
GRIPPER_CTRL_MAX = 255.0
UR5_ARM_JOINTS = [
    "shoulder_pan_joint",
    "shoulder_lift_joint",
    "elbow_joint",
    "wrist_1_joint",
    "wrist_2_joint",
    "wrist_3_joint",
]
UR5_ACTUATOR_FORCE_RANGES = {
    "shoulder_pan_joint": (-150.0, 150.0),
    "shoulder_lift_joint": (-150.0, 150.0),
    "elbow_joint": (-150.0, 150.0),
    "wrist_1_joint": (-28.0, 28.0),
    "wrist_2_joint": (-28.0, 28.0),
    "wrist_3_joint": (-28.0, 28.0),
}


def is_viewer_running() -> bool:
    """安全判断 viewer 是否仍在运行。"""
    if viewer_handle is None:
        return False

    checker = getattr(viewer_handle, "is_running", None)
    try:
        if callable(checker):
            return bool(checker())
        if checker is not None:
            return bool(checker)
    except Exception:
        return False
    return False


def safe_viewer_sync_locked(phase: str = ""):
    """
    在已持有 simulation_lock 的前提下安全执行 viewer.sync()。
    若 viewer 同步失败，不中断仿真主循环。
    """
    if not is_viewer_running():
        return
    try:
        viewer_handle.sync()
    except Exception as e:
        tag = f"({phase})" if phase else ""
        print(f"⚠️ viewer 同步失败{tag}: {str(e)}")


def normalize_gripper_target(raw_target: float) -> tuple[float, float]:
    """
    将手抓输入统一为:
    1) gripper 关节角度（rad，0~0.9）
    2) MuJoCo 执行器控制量（0~255）

    兼容旧协议：当输入大于 0.9 时，按 0~255 控制量解释。
    """
    value = float(raw_target)
    if value > GRIPPER_ANGLE_MAX:
        ctrl = float(np.clip(value, GRIPPER_CTRL_MIN, GRIPPER_CTRL_MAX))
        angle = float(np.interp(ctrl, [GRIPPER_CTRL_MIN, GRIPPER_CTRL_MAX], [GRIPPER_ANGLE_MIN, GRIPPER_ANGLE_MAX]))
        return angle, ctrl

    angle = float(np.clip(value, GRIPPER_ANGLE_MIN, GRIPPER_ANGLE_MAX))
    ctrl = float(np.interp(angle, [GRIPPER_ANGLE_MIN, GRIPPER_ANGLE_MAX], [GRIPPER_CTRL_MIN, GRIPPER_CTRL_MAX]))
    return angle, ctrl


def clamp_arm_joint_target(joint_name: str, target: float) -> float:
    """按 MuJoCo 模型中的关节限位夹紧角度目标。"""
    if model is None:
        return float(target)

    joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, joint_name)
    if joint_id < 0:
        return float(target)

    if model.jnt_limited[joint_id]:
        lower, upper = model.jnt_range[joint_id]
        return float(np.clip(target, lower, upper))
    return float(target)


def configure_arm_actuators_from_joint_limits():
    """
    启动时强制对齐执行器控制范围与力矩范围，避免控制面板旋钮范围异常。
    """
    if model is None:
        return

    for joint_name in UR5_ARM_JOINTS:
        actuator_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, joint_name)
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, joint_name)
        if actuator_id < 0 or joint_id < 0:
            continue

        if model.jnt_limited[joint_id]:
            lower, upper = model.jnt_range[joint_id]
        else:
            lower, upper = -2 * np.pi, 2 * np.pi

        model.actuator_ctrllimited[actuator_id] = 1
        model.actuator_ctrlrange[actuator_id][0] = float(lower)
        model.actuator_ctrlrange[actuator_id][1] = float(upper)

        force_lower, force_upper = UR5_ACTUATOR_FORCE_RANGES[joint_name]
        model.actuator_forcelimited[actuator_id] = 1
        model.actuator_forcerange[actuator_id][0] = force_lower
        model.actuator_forcerange[actuator_id][1] = force_upper


def set_joint_position_locked(joint_name: str, target: float):
    """直接同步关节位置，确保前端控制与 MuJoCo 状态一一对应。"""
    joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, joint_name)
    if joint_id < 0:
        return

    qpos_idx = model.jnt_qposadr[joint_id]
    qvel_idx = model.jnt_dofadr[joint_id]
    if qpos_idx >= 0:
        data.qpos[qpos_idx] = target
    if qvel_idx >= 0:
        data.qvel[qvel_idx] = 0.0


def sync_robot_pose_from_ctrl_locked():
    """
    将执行器控制量直接映射到关节位置，确保:
    1) MuJoCo 控制面板拖动 ctrl 时，机器人立即同步
    2) 前端/后端角度一一对应，不受执行器追踪动态延迟影响
    """
    for joint_name in UR5_ARM_JOINTS:
        actuator_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, joint_name)
        if actuator_id < 0:
            continue
        target = clamp_arm_joint_target(joint_name, float(data.ctrl[actuator_id]))
        data.ctrl[actuator_id] = target
        set_joint_position_locked(joint_name, target)

    fingers_actuator_id = mujoco.mj_name2id(
        model,
        mujoco.mjtObj.mjOBJ_ACTUATOR,
        "fingers_actuator"
    )
    if fingers_actuator_id >= 0:
        gripper_ctrl = float(np.clip(data.ctrl[fingers_actuator_id], GRIPPER_CTRL_MIN, GRIPPER_CTRL_MAX))
        data.ctrl[fingers_actuator_id] = gripper_ctrl
        gripper_angle = float(np.interp(
            gripper_ctrl,
            [GRIPPER_CTRL_MIN, GRIPPER_CTRL_MAX],
            [GRIPPER_ANGLE_MIN, GRIPPER_ANGLE_MAX]
        ))
        set_joint_position_locked("left_driver_joint", gripper_angle)
        set_joint_position_locked("right_driver_joint", gripper_angle)


def build_robot_state_payload_locked() -> dict:
    """在已持有 simulation_lock 的前提下，构建机器人状态载荷。"""
    states = []
    qpos_list = []
    qvel_list = []

    for joint_name in UR5_ARM_JOINTS:
        joint_id = mujoco.mj_name2id(
            model,
            mujoco.mjtObj.mjOBJ_JOINT,
            joint_name
        )
        if joint_id < 0:
            continue

        qpos_idx = model.jnt_qposadr[joint_id]
        qvel_idx = model.jnt_dofadr[joint_id]

        position = float(data.qpos[qpos_idx]) if qpos_idx >= 0 else 0.0
        velocity = float(data.qvel[qvel_idx]) if qvel_idx >= 0 else 0.0

        states.append({
            "joint_name": joint_name,
            "position": position,
            "velocity": velocity
        })
        qpos_list.append(position)
        qvel_list.append(velocity)

    gripper_position = None
    gripper_joint_id = mujoco.mj_name2id(
        model,
        mujoco.mjtObj.mjOBJ_JOINT,
        "left_driver_joint"
    )
    if gripper_joint_id >= 0:
        gripper_qpos_idx = model.jnt_qposadr[gripper_joint_id]
        if gripper_qpos_idx >= 0:
            gripper_position = float(data.qpos[gripper_qpos_idx])

    return {
        "joints": states,
        "qpos": qpos_list,
        "qvel": qvel_list,
        "gripper_position": gripper_position
    }


def apply_control_input_locked(control_input: "ControlInput") -> dict:
    """
    在已持有 simulation_lock 的前提下应用控制输入。
    返回与 REST 接口兼容的响应数据。
    """
    arm_targets = control_input.target_angles[:6]
    gripper_target = control_input.gripper_position
    if gripper_target is None and len(control_input.target_angles) == 7:
        gripper_target = control_input.target_angles[6]

    applied_arm_targets = []
    for i, actuator_name in enumerate(UR5_ARM_JOINTS):
        actuator_id = mujoco.mj_name2id(
            model,
            mujoco.mjtObj.mjOBJ_ACTUATOR,
            actuator_name
        )
        target = clamp_arm_joint_target(actuator_name, arm_targets[i])
        applied_arm_targets.append(target)

        if actuator_id >= 0:
            data.ctrl[actuator_id] = target
        # 直接同步到关节位置，避免执行器缓慢追目标导致前后端不同步。
        set_joint_position_locked(actuator_name, target)

    gripper_angle = None
    if gripper_target is not None:
        gripper_angle, gripper_ctrl = normalize_gripper_target(gripper_target)
        gripper_actuator_id = mujoco.mj_name2id(
            model,
            mujoco.mjtObj.mjOBJ_ACTUATOR,
            "fingers_actuator"
        )
        if gripper_actuator_id >= 0:
            data.ctrl[gripper_actuator_id] = gripper_ctrl
        set_joint_position_locked("left_driver_joint", gripper_angle)
        set_joint_position_locked("right_driver_joint", gripper_angle)

    mujoco.mj_forward(model, data)
    safe_viewer_sync_locked("apply_control")

    return {
        "status": "success",
        "message": "已更新机械臂目标角度" + ("与 gripper 开合" if gripper_target is not None else ""),
        "target_angles": applied_arm_targets,
        "gripper_position": gripper_angle,
        "current_ctrl": data.ctrl.tolist()
    }


async def register_ws_client(websocket: WebSocket):
    global ws_clients_lock
    if ws_clients_lock is None:
        ws_clients_lock = asyncio.Lock()
    async with ws_clients_lock:
        ws_clients.add(websocket)


async def unregister_ws_client(websocket: WebSocket):
    if ws_clients_lock is None:
        return
    async with ws_clients_lock:
        ws_clients.discard(websocket)


async def broadcast_state(payload: dict):
    if ws_clients_lock is None:
        return
    async with ws_clients_lock:
        clients = list(ws_clients)

    if not clients:
        return

    results = await asyncio.gather(
        *(client.send_json({"type": "state", "state": payload}) for client in clients),
        return_exceptions=True
    )
    stale_clients = [client for client, result in zip(clients, results) if isinstance(result, Exception)]
    if not stale_clients:
        return

    async with ws_clients_lock:
        for client in stale_clients:
            ws_clients.discard(client)


# ==================== Pydantic 模型 ====================
class ControlInput(BaseModel):
    """控制输入模型 - 6 个机械臂关节 + 可选 gripper 开合量"""
    target_angles: List[float]
    gripper_position: float | None = None


class JointState(BaseModel):
    """关节状态模型"""
    joint_name: str
    position: float
    velocity: float


class RobotState(BaseModel):
    """机器人完整状态模型"""
    joints: List[JointState]
    qpos: List[float]
    qvel: List[float]
    gripper_position: float | None = None


# ==================== Lifespan 管理 ====================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan 管理器
    在应用启动时加载模型，关闭时清理资源
    动态设置 mesh 路径以确保正确加载
    """
    global model, data, viewer_handle, simulation_task, simulation_running

    print("=" * 60)
    print("正在初始化 MuJoCo 仿真环境...")
    print("=" * 60)

    # 获取脚本所在目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, "ur5_converted.xml")

    # 计算 mesh 根目录的绝对路径（包含 visual/collision/robotiq_2f85_v4 等子目录）
    mesh_dir = os.path.join(script_dir, "..", "frontend", "ur5")
    mesh_dir_abs = os.path.abspath(mesh_dir)

    # 检查模型文件是否存在
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"找不到模型文件：{model_path}\n"
            "请先运行 converter.py 生成 ur5_converted.xml"
        )

    # 检查 mesh 目录是否存在
    if not os.path.exists(mesh_dir_abs):
        raise FileNotFoundError(
            f"找不到 mesh 目录：{mesh_dir_abs}\n"
            "请确保 frontend/ur5 目录存在且包含 .dae/.stl 文件"
        )

    try:
        # 读取 XML 内容并动态修改 meshdir
        print(f"加载模型文件：{model_path}")
        print(f"Mesh 目录：{mesh_dir_abs}")

        with open(model_path, 'r', encoding='utf-8') as f:
            xml_content = f.read()

        # 动态更新 compiler 标签中的 meshdir 属性
        import re

        # 将路径转换为统一格式（MuJoCo 偏好正斜杠）
        mesh_dir_normalized = mesh_dir_abs.replace('\\', '/')

        # 转义路径中的反斜杠（避免被正则解析为特殊字符）
        mesh_dir_escaped = mesh_dir_normalized.replace('\\', '\\\\')

        # 方法 1: 如果 XML 中已有 compiler 标签，更新 meshdir
        if '<compiler' in xml_content:
            # 使用正则表达式替换 meshdir 属性
            xml_content = re.sub(
                r'meshdir="[^"]*"',
                f'meshdir="{mesh_dir_escaped}"',
                xml_content
            )
            print(f"✓ 已更新现有 compiler 的 meshdir 属性：{mesh_dir_normalized}")
        else:
            # 方法 2: 如果没有 compiler 标签，在 mujoco 根元素后添加
            xml_content = xml_content.replace(
                '<mujoco',
                f'<mujoco>\n  <compiler meshdir="{mesh_dir_normalized}" angle="radian"/>'
            )
            print(f"✓ 已添加 compiler 标签：{mesh_dir_normalized}")

        # 创建临时文件保存修改后的 XML
        import tempfile
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.xml',
            delete=False,
            encoding='utf-8'
        ) as temp_file:
            temp_file.write(xml_content)
            temp_model_path = temp_file.name

        try:
            # 从修改后的 XML 加载模型
            print(f"从临时文件加载：{temp_model_path}")
            with simulation_lock:
                model = mujoco.MjModel.from_xml_path(temp_model_path)
                data = mujoco.MjData(model)
                configure_arm_actuators_from_joint_limits()

                # 验证模型
                mujoco.mj_forward(model, data)

            print(f"\n✓ 模型加载成功")
            print(f"  - 自由度 (nv): {model.nv}")
            print(f"  - 关节数 (njnt): {model.njnt}")
            print(f"  - 执行器数 (nu): {model.nu}")
            print(f"  - 几何体数量 (ngeom): {model.ngeom}")
            print(f"  - 时间步长：{model.opt.timestep:.4f}s")
            print(f"  - Mesh 路径：{mesh_dir_abs}")
            print("=" * 60)

            # 如果启用了可视化，启动 passive viewer 进行状态同步显示
            if viewer_enabled:
                print("\n🎬 正在启动 MuJoCo 可视化窗口...")
                viewer_handle = run_viewer()
                if viewer_handle is not None:
                    viewer_handle.sync()

            simulation_task = asyncio.create_task(simulation_loop())
            yield

        finally:
            # 清理临时文件
            if os.path.exists(temp_model_path):
                os.remove(temp_model_path)
                print("✓ 临时文件已清理")

    except FileNotFoundError as e:
        print(f"\n✗ 文件未找到：{str(e)}")
        raise
    except Exception as e:
        print(f"\n✗ 模型加载失败：{str(e)}")
        import traceback
        traceback.print_exc()
        raise

    finally:
        # 清理资源
        print("\n正在关闭仿真服务器...")
        simulation_running = False
        if simulation_task is not None:
            await simulation_task
            simulation_task = None
        if viewer_handle is not None:
            viewer_handle.close()
            viewer_handle = None
        model = None
        data = None
        print("✓ 资源已释放")


# ==================== FastAPI 应用 ====================
app = FastAPI(
    title="UR5 MuJoCo Simulation API",
    description="UR5 机器人物理仿真 REST API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 配置 - 允许 Quest 3 浏览器访问
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


# ==================== 仿真循环 ====================
async def simulation_loop():
    """
    后台仿真循环
    以固定频率运行物理步进
    """
    global simulation_running

    simulation_running = True
    wall_dt = 0.01  # 100Hz 主循环
    last_state_push_at = 0.0

    print("🚀 仿真循环已启动")

    while simulation_running:
        try:
            cycle_start = asyncio.get_running_loop().time()
            state_payload = None
            if model is not None and data is not None:
                with simulation_lock:
                    # 先同步 viewer 输入，确保 MuJoCo 面板拖动 ctrl 能在本周期生效。
                    safe_viewer_sync_locked("pre_step")

                    # 按 MuJoCo timestep 批量推进，避免仿真时间明显慢于真实时间。
                    step_count = max(1, round(wall_dt / model.opt.timestep))
                    for _ in range(step_count):
                        sync_robot_pose_from_ctrl_locked()
                        mujoco.mj_step(model, data)
                    sync_robot_pose_from_ctrl_locked()
                    mujoco.mj_forward(model, data)
                    safe_viewer_sync_locked("post_step")
                    now = asyncio.get_running_loop().time()
                    if now - last_state_push_at >= STATE_PUSH_INTERVAL:
                        state_payload = build_robot_state_payload_locked()
                        last_state_push_at = now

            if state_payload is not None:
                await broadcast_state(state_payload)

            elapsed = asyncio.get_running_loop().time() - cycle_start
            await asyncio.sleep(max(0.0, wall_dt - elapsed))

        except Exception as e:
            print(f"仿真错误：{str(e)}")
            await asyncio.sleep(SIMULATION_ERROR_BACKOFF)
            continue

    print("⏹️ 仿真循环已停止")


# ==================== 可视化函数 ====================
def run_viewer():
    """
    启动 MuJoCo passive viewer
    由服务端仿真循环统一执行 mj_step，viewer 只负责显示同步
    """
    if model is None or data is None:
        print("✗ 模型未加载，无法启动可视化")
        return

    print("🎬 正在启动 MuJoCo 可视化窗口...")
    try:
        import mujoco.viewer
        return mujoco.viewer.launch_passive(model, data)
    except Exception as e:
        print(f"✗ 可视化启动失败：{str(e)}")
        return None

# ==================== API 接口 ====================
@app.get("/")
async def root():
    """根路径 - 健康检查"""
    return {
        "status": "running",
        "message": "UR5 MuJoCo Simulation Server",
        "endpoints": [
            "GET /state - 获取机器人状态",
            "POST /control - 发送控制指令（支持 gripper_position）",
            "WS  /ws/robot - 实时双向状态/控制通道"
        ]
    }


@app.get("/state", response_model=RobotState)
async def get_robot_state():
    """
    获取当前机器人状态
    返回 6 个机械臂关节的角度和速度，以及手抓开合角
    """
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    try:
        with simulation_lock:
            payload = build_robot_state_payload_locked()

        return RobotState(**payload)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取状态失败：{str(e)}")


@app.post("/control")
async def set_robot_control(control_input: ControlInput):
    """
    设置机器人控制指令
    接收 6 个机械臂目标角度，并可选控制 gripper 开合（角度 0~0.9 rad）
    """
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    # 验证输入
    if len(control_input.target_angles) not in (6, 7):
        raise HTTPException(
            status_code=400,
            detail=f"需要 6 个机械臂目标角度，或 6 个角度加 1 个 gripper 值，收到 {len(control_input.target_angles)} 个"
        )

    try:
        with simulation_lock:
            response = apply_control_input_locked(control_input)

        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"控制指令执行失败：{str(e)}")


@app.websocket("/ws/robot")
async def robot_realtime_ws(websocket: WebSocket):
    """
    实时双向通道：
    - 服务端主动推送 state（仿真循环中 50Hz）
    - 客户端可发送 control 指令（与 REST /control 语义一致）
    """
    await websocket.accept()
    await register_ws_client(websocket)

    try:
        if model is not None and data is not None:
            with simulation_lock:
                initial_state = build_robot_state_payload_locked()
            await websocket.send_json({"type": "state", "state": initial_state})

        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "control":
                request_id = message.get("request_id")
                try:
                    control_input = ControlInput(
                        target_angles=message.get("target_angles", []),
                        gripper_position=message.get("gripper_position"),
                    )
                except Exception as control_error:
                    await websocket.send_json({
                        "type": "error",
                        "request_id": request_id,
                        "message": f"控制参数无效：{str(control_error)}"
                    })
                    continue

                if len(control_input.target_angles) not in (6, 7):
                    await websocket.send_json({
                        "type": "error",
                        "request_id": request_id,
                        "message": f"需要 6 个机械臂目标角度，或 6 个角度加 1 个 gripper 值，收到 {len(control_input.target_angles)} 个"
                    })
                    continue

                with simulation_lock:
                    response = apply_control_input_locked(control_input)
                    state_payload = build_robot_state_payload_locked()
                await websocket.send_json({"type": "control_ack", "request_id": request_id, "data": response})
                await websocket.send_json({"type": "state", "state": state_payload})
                continue

            await websocket.send_json({
                "type": "error",
                "message": f"未知消息类型：{msg_type}"
            })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": f"WebSocket 异常：{str(e)}"})
        except Exception:
            pass
    finally:
        await unregister_ws_client(websocket)


@app.get("/joint/{joint_name}")
async def get_single_joint_state(joint_name: str):
    """获取单个关节的状态"""
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    try:
        with simulation_lock:
            joint_id = mujoco.mj_name2id(
                model,
                mujoco.mjtObj.mjOBJ_JOINT,
                joint_name
            )

            if joint_id < 0:
                raise HTTPException(
                    status_code=404, detail=f"关节 '{joint_name}' 不存在")

            qpos_idx = model.jnt_qposadr[joint_id]
            qvel_idx = model.jnt_dofadr[joint_id]

            position = float(data.qpos[qpos_idx]) if qpos_idx >= 0 else 0.0
            velocity = float(data.qvel[qvel_idx]) if qvel_idx >= 0 else 0.0

        return JointState(
            joint_name=joint_name,
            position=position,
            velocity=velocity
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取关节状态失败：{str(e)}")


@app.get("/info")
async def get_model_info():
    """获取模型详细信息"""
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    info = {
        "model_name": "UR5 Robot",
        "nq": model.nq,  # 广义坐标数量
        "nv": model.nv,  # 广义速度数量
        "nu": model.nu,  # 执行器数量
        "njnt": model.njnt,  # 关节数量
        "nbody": model.nbody,  # 刚体数量
        "timestep": model.opt.timestep,
        "gravity": model.opt.gravity.tolist(),
    }

    return info


@app.post("/reset")
async def reset_simulation():
    """重置仿真状态"""
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    try:
        with simulation_lock:
            # 重置到初始状态
            mujoco.mj_resetData(model, data)
            mujoco.mj_forward(model, data)
            safe_viewer_sync_locked("reset")

        return {
            "status": "success",
            "message": "仿真已重置"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"重置失败：{str(e)}")


# ==================== 主程序入口 ====================
if __name__ == "__main__":
    import sys
    import argparse
    import threading

    # 解析命令行参数
    parser = argparse.ArgumentParser(description='UR5 MuJoCo 仿真服务器')
    parser.add_argument('--viewer', action='store_true',
                        help='启动 MuJoCo 可视化窗口')
    args = parser.parse_args()

    # 如果没有使用 --viewer 参数，则提示用户选择
    if not args.viewer:
        print("\n" + "=" * 60)
        print("UR5 MuJoCo 仿真服务器")
        print("=" * 60)
        response = input("\n是否启动 MuJoCo 可视化窗口？(yes/no): ").strip().lower()
        viewer_enabled = response in ['yes', 'y']
    else:
        viewer_enabled = True

    print("\n" + "=" * 60)
    print("UR5 MuJoCo 仿真服务器")
    print("=" * 60)
    print("\n启动参数:")
    print("  主机：0.0.0.0 (允许外部访问)")
    print("  端口：8000")
    print("  CORS: 已启用 (支持 Quest 3)")
    print(f"  可视化：{'✓ 已启用' if viewer_enabled else '✗ 未启用'}")
    print("\nAPI 端点:")
    print("  GET  http://localhost:8000/state")
    print("  POST http://localhost:8000/control")
    print("  GET  http://localhost:8000/info")
    print("  POST http://localhost:8000/reset")
    print("=" * 60 + "\n")

    # 如果启用了可视化，在独立线程中启动
    if viewer_enabled:
        print("🎬 准备启动可视化窗口...\n")
        # 注意：MuJoCo viewer 需要在主线程运行，所以我们先启动 viewer
        # 但这会阻塞，所以我们采用另一种策略：等待模型加载后再启动

    # 启动服务器（这会阻塞）
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
