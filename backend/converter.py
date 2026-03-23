"""
URDF to MJCF Converter using MuJoCo
将 UR5 机器人的 URDF 文件转换为 MuJoCo 的 XML 格式
使用 mujoco Python 库作为核心转换引擎，自动处理运动学树和坐标变换
"""

import os
import mujoco
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
from xml.dom import minidom


def convert_urdf_to_mjcf(urdf_path, output_path):
    """
    将 URDF 文件转换为 MuJoCo MJCF 格式

    核心思路：
    1. 读取 URDF 文件内容
    2. 提取所有 mesh 文件名
    3. 将 mesh 文件复制到临时目录（去掉路径前缀）
    4. 使用 mujoco.MjModel.from_xml_path() 加载处理后的 URDF
    5. MuJoCo 自动解析运动学树和坐标变换
    6. 使用 mujoco.mj_saveLastXML() 保存为 MJCF 格式
    7. 添加 actuator、sensor 和环境配置
    8. 在最终的 MJCF 中手动修正 mesh 文件的路径

    Args:
        urdf_path: URDF 文件路径
        output_path: 输出 XML 文件路径
    """
    # 获取 URDF 文件所在目录
    urdf_dir = os.path.dirname(os.path.abspath(urdf_path))

    # 读取 URDF 文件内容
    print(f"正在读取 URDF 文件：{urdf_path}")
    with open(urdf_path, 'r', encoding='utf-8') as f:
        urdf_content = f.read()

    # 提取所有 mesh 文件名（不带路径）
    visual_meshes = set(re.findall(
        r'visual/([^"/]+\.(?:dae|stl))', urdf_content))
    collision_meshes = set(re.findall(
        r'collision/([^"/]+\.(?:dae|stl))', urdf_content))

    print(f"\n找到 mesh 文件:")
    print(f"  Visual mesh: {sorted(visual_meshes)}")
    print(f"  Collision mesh: {sorted(collision_meshes)}")

    # 替换路径：将所有 mesh 路径改为纯文件名
    urdf_content = re.sub(r'visual/', '', urdf_content)
    urdf_content = re.sub(r'collision/', '', urdf_content)
    urdf_content = urdf_content.replace(
        'package://ur_description/meshes/ur5/', '')

    # 在 robot 标签内添加 mujoco compiler 指令来设置 meshdir
    # 这样 MuJoCo 就知道从 temp_meshes 目录加载文件
    urdf_content = urdf_content.replace(
        '<robot name="ur5_robot">',
        '<robot name="ur5_robot">\n  <mujoco>\n    <compiler meshdir="temp_meshes"/>\n  </mujoco>',
        1
    )

    # 显示处理后的示例
    meshes_after = re.findall(r'<mesh filename="([^"]+)"', urdf_content)[:3]
    print(f"  处理后的 mesh 路径示例：{meshes_after}")

    # 创建临时 mesh 目录
    temp_mesh_dir = os.path.join(urdf_dir, "temp_meshes")
    os.makedirs(temp_mesh_dir, exist_ok=True)

    # 复制所有需要的 mesh 文件到临时目录
    all_meshes = visual_meshes.union(collision_meshes)
    print(f"\n正在复制 {len(all_meshes)} 个 mesh 文件到临时目录...")

    for mesh_file in sorted(all_meshes):
        # 尝试从 visual 或 collision 目录复制
        src_visual = os.path.join(urdf_dir, "visual", mesh_file)
        src_collision = os.path.join(urdf_dir, "collision", mesh_file)
        dst = os.path.join(temp_mesh_dir, mesh_file)

        if os.path.exists(src_visual):
            shutil.copy2(src_visual, dst)
            print(f"  ✓ {mesh_file} (from visual/)")
        elif os.path.exists(src_collision):
            shutil.copy2(src_collision, dst)
            print(f"  ✓ {mesh_file} (from collision/)")

    # 临时修改工作目录以便 MuJoCo 能正确加载 mesh
    original_cwd = os.getcwd()
    try:
        # 切换到 URDF 所在目录
        os.chdir(urdf_dir)

        print(f"\n正在使用 MuJoCo 加载 URDF（meshdir={temp_mesh_dir}）...")

        # 将处理后的 URDF 保存为临时文件
        temp_urdf_fd, temp_urdf_path = tempfile.mkstemp(
            suffix='.urdf', dir=urdf_dir)
        try:
            with os.fdopen(temp_urdf_fd, 'w', encoding='utf-8') as f:
                f.write(urdf_content)

            # 使用 mujoco 从文件加载 URDF
            model = mujoco.MjModel.from_xml_path(temp_urdf_path)
        finally:
            # 清理临时 URDF 文件
            if os.path.exists(temp_urdf_path):
                os.remove(temp_urdf_path)

        print(f"\n✓ URDF 加载成功")
        print(f"  - 自由度 (nv): {model.nv}")
        print(f"  - 关节数 (njnt): {model.njnt}")
        print(f"  - 刚体数 (nbody): {model.nbody}")
        print(f"  - 几何体数 (ngeom): {model.ngeom}")

        # 保存临时 XML
        temp_xml_path = output_path + ".temp"
        mujoco.mj_saveLastXML(temp_xml_path, model)

        # 读取临时 XML
        with open(temp_xml_path, 'r', encoding='utf-8') as f:
            mjcf_content = f.read()

        # 删除临时文件
        os.remove(temp_xml_path)

        # 计算 mesh 目录相对路径
        mesh_dir_rel = os.path.join("..", "frontend", "ur5", "collision")

        # 增强 MJCF（添加执行器、传感器、环境配置）
        print("\n正在增强 MJCF（添加执行器、传感器、环境配置）...")
        enhanced_mjcf = enhance_mjcf(mjcf_content, mesh_dir_rel)

        # 保存最终的 XML
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(enhanced_mjcf)

        print(f"\n✅ 转换成功！")
        print(f"  输入文件：{urdf_path}")
        print(f"  输出文件：{output_path}")
        print(f"  Mesh 目录：{mesh_dir_rel}")

    finally:
        # 恢复原始工作目录
        os.chdir(original_cwd)

        # 清理临时 mesh 目录
        if os.path.exists(temp_mesh_dir):
            shutil.rmtree(temp_mesh_dir)
            print(f"\n✓ 已清理临时 mesh 目录")


def enhance_mjcf(xml_content, mesh_dir):
    """
    增强 MJCF 内容，添加 actuator、sensor 和环境配置

    Args:
        xml_content: MuJoCo 生成的原始 XML 内容
        mesh_dir: mesh 目录相对路径

    Returns:
        增强后的 XML 内容
    """
    # 解析 XML
    root = ET.fromstring(xml_content)

    # ==================== 1. 更新 Compiler 配置 ====================
    compiler = root.find("compiler")
    if compiler is None:
        compiler = ET.SubElement(root, "compiler")

    compiler.set("angle", "radian")
    compiler.set("meshdir", mesh_dir)

    # ==================== 2. 添加 Option 配置 ====================
    option = root.find("option")
    if option is None:
        option = ET.SubElement(root, "option")

    option.set("gravity", "0 0 -9.81")
    option.set("timestep", "0.002")
    option.set("integrator", "RK4")

    # ==================== 3. 添加 Size 配置 ====================
    size = root.find("size")
    if size is None:
        size = ET.SubElement(root, "size")

    size.set("njmax", "500")
    size.set("nconmax", "100")

    # ==================== 4. 增强 Visual 配置 ====================
    visual = root.find("visual")
    if visual is None:
        visual = ET.SubElement(root, "visual")

    # 天空盒配置
    headlight = visual.find("headlight")
    if headlight is None:
        headlight = ET.SubElement(visual, "headlight")
    headlight.set("ambient", "0.3 0.3 0.3")
    headlight.set("diffuse", "0.6 0.6 0.6")
    headlight.set("specular", "0 0 0")

    # 全局视觉设置
    global_vis = visual.find("global")
    if global_vis is None:
        global_vis = ET.SubElement(visual, "global")
    global_vis.set("offwidth", "1920")
    global_vis.set("offheight", "1080")

    # ==================== 5. 增强 Asset 配置 ====================
    asset = root.find("asset")
    if asset is None:
        asset = ET.SubElement(root, "asset")

    # 添加天空盒纹理
    skybox_texture = ET.SubElement(asset, "texture")
    skybox_texture.set("type", "skybox")
    skybox_texture.set("builtin", "gradient")
    skybox_texture.set("rgb1", "0.3 0.5 0.7")
    skybox_texture.set("rgb2", "0 0 0")
    skybox_texture.set("width", "512")
    skybox_texture.set("height", "3072")

    # 添加地板纹理
    floor_texture = ET.SubElement(asset, "texture")
    floor_texture.set("name", "texplane")
    floor_texture.set("type", "2d")
    floor_texture.set("builtin", "checker")
    floor_texture.set("rgb1", "0.2 0.3 0.4")
    floor_texture.set("rgb2", "0.1 0.2 0.3")
    floor_texture.set("width", "512")
    floor_texture.set("height", "512")

    # 添加地板材质
    floor_material = ET.SubElement(asset, "material")
    floor_material.set("name", "MatPlane")
    floor_material.set("texture", "texplane")
    floor_material.set("texrepeat", "3 3")
    floor_material.set("texuniform", "true")
    floor_material.set("reflectance", "0.3")

    # ==================== 6. 增强 Worldbody 配置 ====================
    worldbody = root.find("worldbody")
    if worldbody is None:
        worldbody = ET.SubElement(root, "worldbody")

    # 添加灯光
    light = ET.SubElement(worldbody, "light")
    light.set("pos", "0 0 3")
    light.set("dir", "0 0 -1")
    light.set("directional", "true")
    light.set("diffuse", "1 1 1")
    light.set("specular", "0.3 0.3 0.3")
    light.set("castshadow", "false")

    # 添加地板
    floor_geom = ET.SubElement(worldbody, "geom")
    floor_geom.set("name", "floor")
    floor_geom.set("type", "plane")
    floor_geom.set("size", "0 0 1")
    floor_geom.set("material", "MatPlane")
    floor_geom.set("condim", "3")

    # ==================== 7. 添加 Actuator 配置 ====================
    actuator = root.find("actuator")
    if actuator is None:
        actuator = ET.SubElement(root, "actuator")

    # UR5 的 6 个主要关节
    ur5_joints = [
        "shoulder_pan_joint",
        "shoulder_lift_joint",
        "elbow_joint",
        "wrist_1_joint",
        "wrist_2_joint",
        "wrist_3_joint"
    ]

    # 查找所有 joint 元素
    joints_found = []

    def find_joints(element):
        if element.tag == "joint" and element.get("name") in ur5_joints:
            joints_found.append(element.get("name"))
        for child in element:
            find_joints(child)

    find_joints(worldbody)

    actuator_force_ranges = {
        "shoulder_pan_joint": "-150 150",
        "shoulder_lift_joint": "-150 150",
        "elbow_joint": "-150 150",
        "wrist_1_joint": "-28 28",
        "wrist_2_joint": "-28 28",
        "wrist_3_joint": "-28 28",
    }

    # 为找到的关节添加执行器
    added_actuators = []
    for joint_name in joints_found:
        # 检查是否已存在该执行器
        existing_motor = None
        for motor in actuator.findall("position"):
            if motor.get("joint") == joint_name:
                existing_motor = motor
                break

        if existing_motor is None:
            motor = ET.SubElement(actuator, "position")
            motor.set("name", joint_name)
            motor.set("joint", joint_name)
            motor.set("kp", "100")
            motor.set("kv", "10")
            motor.set("forcelimited", "true")
            motor.set("forcerange", actuator_force_ranges[joint_name])
            added_actuators.append(joint_name)
        else:
            existing_motor.set("name", joint_name)
            existing_motor.set("joint", joint_name)
            existing_motor.set("kp", "100")
            existing_motor.set("kv", "10")
            existing_motor.set("forcelimited", "true")
            existing_motor.set("forcerange", actuator_force_ranges[joint_name])
            added_actuators.append(joint_name)

    # ==================== 8. 添加 Sensor 配置 ====================
    sensor = root.find("sensor")
    if sensor is None:
        sensor = ET.SubElement(root, "sensor")

    # 为 UR5 关节添加位置传感器
    for joint_name in added_actuators:
        joint_pos_sensor = ET.SubElement(sensor, "jointpos")
        joint_pos_sensor.set("name", f"sense_{joint_name}")
        joint_pos_sensor.set("joint", joint_name)

    # ==================== 格式化并返回 XML ====================
    xml_str = ET.tostring(root, encoding="unicode")

    # 美化 XML 格式
    dom = minidom.parseString(xml_str)
    pretty_xml = dom.toprettyxml(indent="  ")

    # 移除多余的空白行
    lines = pretty_xml.split("\n")
    cleaned_lines = [line for line in lines if line.strip(
    ) and line.strip() != '<?xml version="1.0" ?>']
    final_xml = "\n".join(cleaned_lines)

    # 添加 MuJoCo XML 声明
    header = '<?xml version="1.0" encoding="utf-8"?>\n'
    final_xml = header + final_xml

    return final_xml


def main():
    """主函数"""
    # 获取脚本所在目录
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # URDF 文件路径（相对于 backend 目录）
    # 注意：URDF 文件位于 frontend/ur5/ur5.urdf
    urdf_path = os.path.join(script_dir, "..", "frontend", "ur5", "ur5.urdf")

    # 输出文件路径
    output_path = os.path.join(script_dir, "ur5_converted.xml")

    print("=" * 60)
    print("URDF to MJCF Converter (MuJoCo)")
    print("=" * 60)

    # 检查 URDF 文件是否存在
    if not os.path.exists(urdf_path):
        print(f"\n✗ 错误：找不到 URDF 文件：{urdf_path}")
        return

    print(f"\n📄 源文件：{urdf_path}")
    print(f"💾 目标文件：{output_path}\n")

    try:
        # 执行转换
        convert_urdf_to_mjcf(urdf_path, output_path)

        print("\n" + "=" * 60)
        print("✅ 转换完成！生成的 XML 包含:")
        print("  ✓ 地板（plane）")
        print("  ✓ 天空盒（skybox）")
        print("  ✓ 环境灯光")
        print("  ✓ 6 个关节的 position 执行器")
        print("  ✓ 关节位置传感器")
        print("  ✓ 完整的 mesh 映射（自动坐标变换）")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ 转换失败：{str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
