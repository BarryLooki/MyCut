"""自动成片 Celery 任务（Remotion 合成路线，旁路模块）。

镜像 backend/tasks/processing.py::process_video_pipeline 的任务体结构：
建 Task 行 → 渲染 → 成功/失败分别置 Task + Project 状态。
桌面模式下 DesktopAwareTask 自动在后台线程执行 .delay()，无需 Redis。
"""

import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from backend.core.celery_app import celery_app
from backend.core.database import SessionLocal
from backend.core.path_utils import get_project_output_directory, get_temp_directory
from backend.models.clip import Clip, ClipStatus
from backend.models.project import Project, ProjectStatus
from backend.models.task import Task, TaskStatus, TaskType
from backend.services import compose_service
from backend.services.compose_service import ComposeCancelled
from backend.services.script_repo import ScriptRepo
from backend.services.simple_progress import emit_progress
from backend.utils.tts import _probe_duration

logger = logging.getLogger(__name__)

# 同一项目同一时间只允许一次成片（防桌面模式并发重复派发撞库）
_active_compose_projects: set = set()
_active_compose_lock = threading.Lock()
_last_simple_progress: Dict[str, tuple[int, str]] = {}
_simple_progress_lock = threading.Lock()


def _emit_compose_progress(project_id: str, percent: int, message: str) -> None:
    """把自动成片的连续进度映射到首页共用的固定阶段进度。"""
    value = max(0, min(100, int(percent)))
    signature = (value, message)
    with _simple_progress_lock:
        if _last_simple_progress.get(project_id) == signature:
            return
        _last_simple_progress[project_id] = signature

    ranges = (
        ("INGEST", 0, 10),
        ("SUBTITLE", 10, 25),
        ("ANALYZE", 25, 45),
        ("HIGHLIGHT", 45, 70),
        ("EXPORT", 70, 100),
    )

    if value >= 100:
        emit_progress(project_id, "DONE", message)
        return

    for stage, start, end in ranges:
        if value < end:
            subpercent = ((value - start) / max(1, end - start)) * 100
            emit_progress(project_id, stage, message, subpercent=subpercent)
            return


@celery_app.task(bind=True, name='backend.tasks.compose.render_script_video')
def render_script_video(
    self, project_id: str, script_id: str,
    with_scene: bool = True, caption_style: str = "classic",
) -> Dict[str, Any]:
    """
    根据保存的文案渲染一条成片，产物落项目 output/compose.mp4，并把项目置为完成。

    Args:
        project_id: 承载成片产物的项目 ID（调用方已创建）
        script_id: 文案 ID
        with_scene: 是否为每句生成信息动画（关掉则纯字幕）
        caption_style: 字幕样式（classic / karaoke；非法值 compose_service 内部回落 classic）
    """
    task_id = self.request.id
    logger.info(f"开始自动成片: project={project_id} script={script_id} task={task_id}")

    with _active_compose_lock:
        if project_id in _active_compose_projects:
            logger.warning(f"项目 {project_id} 已有成片任务在跑，跳过重复 {task_id}")
            return {"success": False, "skipped": True, "project_id": project_id}
        _active_compose_projects.add(project_id)

    db = SessionLocal()
    task = Task(
        name="自动成片",
        description=f"文案 {script_id} → 配音 + 逐句字幕成片",
        task_type=TaskType.EXPORT,
        project_id=project_id,
        celery_task_id=task_id,
        status=TaskStatus.RUNNING,
        progress=0,
        current_step="初始化",
        total_steps=1,
    )
    try:
        db.add(task)
        db.commit()

        # 读文案
        script = ScriptRepo(db).get(script_id)
        if not script:
            raise ValueError(f"文案不存在: {script_id}")

        # 进度回调 → 写 Task 行（前端轮询 project/task 状态）
        def progress_cb(percent: int, message: str) -> None:
            try:
                task.progress = float(percent)
                task.current_step = message
                db.commit()
                _emit_compose_progress(project_id, percent, message)
            except Exception:  # noqa: BLE001
                db.rollback()

        # 工作目录（props.json 落临时区）与产物路径（落项目 output/）
        workdir = get_temp_directory() / f"compose-{project_id}"
        workdir.mkdir(parents=True, exist_ok=True)
        out_path = get_project_output_directory(project_id) / "compose.mp4"

        progress_cb(5, "准备中…")
        # with_video=None → compose 内部默认走实拍 + Remotion（用户点「生成视频」即得实拍成片，
        # 零额外操作）；MiniMax 不可用或某句不适合实拍时自动回退信息动画，不中断。
        compose_service.compose(
            script, workdir, out_path, job_id=project_id,
            progress_cb=progress_cb, with_scene=with_scene, with_video=None,
            caption_style=caption_style,
        )

        # 成片时长（用于 Clip 记录）
        total_seconds = int(round(_probe_duration(out_path))) or 1

        # 把成片登记为一个 Clip，复用现有详情页 ClipCard 播放/下载
        clip = Clip(
            title=(script.get("title") or "成片").strip(),
            description="由文案自动成片（配音 + 逐句字幕）",
            status=ClipStatus.COMPLETED,
            start_time=0,
            end_time=total_seconds,
            duration=total_seconds,
            score=1.0,
            video_path=str(out_path),
            processing_step=6,
            project_id=project_id,
        )
        db.add(clip)

        # 成功：置 Task + Project 完成，登记 video_path
        task.status = TaskStatus.COMPLETED
        task.progress = 100
        task.current_step = "成片完成"
        task.result_data = {"video_path": str(out_path)}

        project = db.query(Project).filter(Project.id == project_id).first()
        if project:
            project.status = ProjectStatus.COMPLETED
            project.video_path = str(out_path)
            project.completed_at = datetime.utcnow()
            project.updated_at = datetime.utcnow()
        db.commit()
        _emit_compose_progress(project_id, 100, "成片已生成，可以预览和下载")

        logger.info(f"自动成片完成: {out_path}")
        return {"success": True, "project_id": project_id, "video_path": str(out_path)}

    except ComposeCancelled:
        # 用户删除了正在生成的项目 → 主动取消。安静收尾：项目通常紧接着被删掉，
        # 若还在（比如取消但没删），置为 FAILED 以免永远卡在处理中。
        logger.info(f"自动成片已取消: project={project_id}")
        try:
            task.status = TaskStatus.FAILED
            task.error_message = "已取消"
            project = db.query(Project).filter(Project.id == project_id).first()
            if project and project.status not in (ProjectStatus.COMPLETED,):
                project.status = ProjectStatus.FAILED
                project.updated_at = datetime.utcnow()
            db.commit()
            _emit_compose_progress(project_id, int(task.progress or 0), "生成已取消")
        except Exception:  # noqa: BLE001
            db.rollback()
        return {"success": False, "project_id": project_id, "cancelled": True}

    except Exception as e:  # noqa: BLE001
        error_msg = f"自动成片失败: {e}"
        logger.error(error_msg, exc_info=True)
        try:
            task.status = TaskStatus.FAILED
            task.error_message = str(e)
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                project.status = ProjectStatus.FAILED
                project.updated_at = datetime.utcnow()
            db.commit()
            _emit_compose_progress(project_id, int(task.progress or 0), f"生成失败：{e}")
        except Exception:  # noqa: BLE001
            db.rollback()
        return {"success": False, "project_id": project_id, "error": str(e)}

    finally:
        db.close()
        with _active_compose_lock:
            _active_compose_projects.discard(project_id)
        with _simple_progress_lock:
            _last_simple_progress.pop(project_id, None)
