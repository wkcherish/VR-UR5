"""
UR5 MuJoCo Simulation Server
基于 FastAPI 的 UR5 机器人仿真服务
"""

import asyncio
import mujoco
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
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


# ==================== Pydantic 模型 ====================
class ControlInput(BaseModel):
    """控制输入模型 - 6 个关节的目标角度"""
    target_angles: List[float]


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

    # 计算 mesh 目录的绝对路径（collision 子目录，使用.stl 文件）
    mesh_dir = os.path.join(script_dir, "..", "frontend", "ur5", "collision")
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

    print("🚀 仿真循环已启动")

    while simulation_running:
        try:
            cycle_start = asyncio.get_running_loop().time()
            if model is not None and data is not None:
                with simulation_lock:
                    # 按 MuJoCo timestep 批量推进，避免仿真时间明显慢于真实时间。
                    step_count = max(1, round(wall_dt / model.opt.timestep))
                    for _ in range(step_count):
                        mujoco.mj_step(model, data)
                    if viewer_handle is not None and viewer_handle.is_running():
                        viewer_handle.sync()

            elapsed = asyncio.get_running_loop().time() - cycle_start
            await asyncio.sleep(max(0.0, wall_dt - elapsed))

        except Exception as e:
            print(f"仿真错误：{str(e)}")
            break

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
            "POST /control - 发送控制指令"
        ]
    }


@app.get("/state", response_model=RobotState)
async def get_robot_state():
    """
    获取当前机器人状态
    返回 6 个关节的角度和速度
    """
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    try:
        with simulation_lock:
            # 提取 UR5 的 6 个主要关节
            ur5_joints = [
                "shoulder_pan_joint",
                "shoulder_lift_joint",
                "elbow_joint",
                "wrist_1_joint",
                "wrist_2_joint",
                "wrist_3_joint"
            ]

            states = []
            qpos_list = []
            qvel_list = []

            # 遍历所有关节，提取状态
            for i in range(model.njnt):
                joint_name = mujoco.mj_id2name(
                    model, mujoco.mjtObj.mjOBJ_JOINT, i)

                # 只返回 UR5 的主要关节
                if joint_name in ur5_joints:
                    # 获取关节位置索引
                    qpos_idx = model.jnt_qposadr[i]
                    qvel_idx = model.jnt_dofadr[i]

                    # 读取位置和速度
                    position = float(data.qpos[qpos_idx]) if qpos_idx >= 0 else 0.0
                    velocity = float(data.qvel[qvel_idx]) if qvel_idx >= 0 else 0.0

                    states.append(JointState(
                        joint_name=joint_name,
                        position=position,
                        velocity=velocity
                    ))

                    qpos_list.append(position)
                    qvel_list.append(velocity)

        return RobotState(
            joints=states,
            qpos=qpos_list,
            qvel=qvel_list
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取状态失败：{str(e)}")


@app.post("/control")
async def set_robot_control(control_input: ControlInput):
    """
    设置机器人控制指令
    接收 6 个目标角度并更新 data.ctrl
    """
    if model is None or data is None:
        raise HTTPException(status_code=503, detail="仿真未初始化")

    # 验证输入
    if len(control_input.target_angles) != 6:
        raise HTTPException(
            status_code=400,
            detail=f"需要 6 个目标角度，收到 {len(control_input.target_angles)} 个"
        )

    try:
        with simulation_lock:
            # 获取执行器 ID 映射
            ur5_joints = [
                "shoulder_pan_joint",
                "shoulder_lift_joint",
                "elbow_joint",
                "wrist_1_joint",
                "wrist_2_joint",
                "wrist_3_joint"
            ]

            # 更新每个执行器的控制信号
            for i, actuator_name in enumerate(ur5_joints):
                actuator_id = mujoco.mj_name2id(
                    model,
                    mujoco.mjtObj.mjOBJ_ACTUATOR,
                    actuator_name
                )

                if actuator_id >= 0:
                    # 设置目标位置到 ctrl 数组
                    data.ctrl[actuator_id] = control_input.target_angles[i]

            # 前向动力学计算并同步 viewer
            mujoco.mj_forward(model, data)
            if viewer_handle is not None and viewer_handle.is_running():
                viewer_handle.sync()

            current_ctrl = data.ctrl[:6].tolist() if len(data.ctrl) >= 6 else data.ctrl.tolist()

        return {
            "status": "success",
            "message": f"已更新 6 个关节目标角度",
            "target_angles": control_input.target_angles,
            "current_ctrl": current_ctrl
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"控制指令执行失败：{str(e)}")


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
            if viewer_handle is not None and viewer_handle.is_running():
                viewer_handle.sync()

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
