"""
自动成片服务（Remotion 合成路线，旁路模块，不碰 step1~6 切片）。

流程：保存的文案 segments → 每句 TTS 配音（edge-tts）→ 用 ffprobe 测时长排布字幕
→ 组 Remotion inputProps → 调 `npx remotion render` 渲染出 MP4。

设为可选：remotion/node_modules 未安装时抛 ComposeNotReady，不影响主系统。
"""

import json
import logging
import os
import re
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from ..core.path_utils import get_project_root
from ..utils.ffmpeg_utils import get_npx_path
from ..utils import tts
from .scene_service import get_scene_service
from .theme_service import get_theme_service, DEFAULT_THEME
from . import minimax_service
from .video_prompt_service import get_video_prompt_service

logger = logging.getLogger(__name__)

FPS = 30
TITLE_SECONDS = 2.5
OUTRO_SECONDS = 2.0
# 单句无配音时的兜底停留（秒），保证纯字幕也能看清
FALLBACK_SECONDS_PER_SENTENCE = 3.0
# 渲染超时（秒）——避免 Node 卡死 wedge 后台线程
RENDER_TIMEOUT = 900
# 实拍素材并发生成数：多句同时调 MiniMax，把串行的 N×(1~3min) 压成并行。
# 可用环境变量 MINIMAX_CONCURRENCY 调整（默认 4，别太高以免撞服务端限流）。
VIDEO_CONCURRENCY = max(1, int(os.environ.get("MINIMAX_CONCURRENCY", "4") or "4"))

# 画面主题不再写死：由 theme_service 按每条视频内容调性生成（见 build_props）。
# 默认主题（LLM 失败时回退）在 theme_service.DEFAULT_THEME。

# 中文分句：在句末标点后切分，保留标点
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？；!?;])")

ProgressCb = Optional[Callable[[int, str], None]]


class ComposeNotReady(RuntimeError):
    """Remotion 工程未安装依赖（可选模块未就绪）。"""


class ComposeCancelled(RuntimeError):
    """成片任务被用户主动取消（删除项目时触发）。"""


# —— 成片取消注册表 ——
# 成片是长任务（TTS / MiniMax 生成 / Remotion 渲染，可达数分钟），跑在后台线程。
# 用户删除「正在生成」的项目时，需要能真正中止它：置取消事件 + kill 当前子进程。
# 以 job_id（= project_id）为键。线程安全。
class _CancelHandle:
    def __init__(self) -> None:
        self.event = threading.Event()          # 置位表示「请取消」
        self.proc: Optional[subprocess.Popen] = None  # 当前正在跑的子进程（如 Remotion render）


_cancel_registry: Dict[str, _CancelHandle] = {}
_cancel_lock = threading.Lock()


def _register_job(job_id: str) -> _CancelHandle:
    """任务开始时登记一个取消句柄（若已存在则复用，兼容重复派发）。"""
    with _cancel_lock:
        h = _cancel_registry.get(job_id)
        if h is None:
            h = _CancelHandle()
            _cancel_registry[job_id] = h
        return h


def _unregister_job(job_id: str) -> None:
    """任务结束（成功/失败/取消）时清理句柄。"""
    with _cancel_lock:
        _cancel_registry.pop(job_id, None)


def _set_current_proc(job_id: str, proc: Optional[subprocess.Popen]) -> None:
    """记录/清除某任务当前正在跑的子进程，供取消时 kill。"""
    with _cancel_lock:
        h = _cancel_registry.get(job_id)
        if h is not None:
            h.proc = proc


def is_cancelled(job_id: str) -> bool:
    """该任务是否已被请求取消。"""
    with _cancel_lock:
        h = _cancel_registry.get(job_id)
        return bool(h and h.event.is_set())


def _raise_if_cancelled(job_id: str) -> None:
    """检查点：已被取消则抛 ComposeCancelled，让 compose 尽快中断退出。"""
    if is_cancelled(job_id):
        raise ComposeCancelled(f"成片任务已被取消: {job_id}")


def request_cancel(job_id: str) -> bool:
    """
    请求取消某成片任务：置取消事件 + kill 其当前子进程（若有）。
    返回 True 表示该任务确实在跑（登记过）；False 表示没有在跑的任务。
    幂等：重复调用安全。
    """
    with _cancel_lock:
        h = _cancel_registry.get(job_id)
        if h is None:
            return False
        h.event.set()
        proc = h.proc
    # kill 放到锁外，避免持锁期间阻塞
    if proc is not None and proc.poll() is None:
        try:
            proc.kill()
            logger.info("已 kill 成片子进程 job=%s pid=%s", job_id, proc.pid)
        except Exception as e:  # noqa: BLE001
            logger.warning("kill 成片子进程失败 job=%s: %s", job_id, e)
    return True


def get_remotion_dir() -> Path:
    """remotion/ 工程目录（工程根下）。"""
    return get_project_root() / "remotion"


def get_public_job_dir(job_id: str) -> Path:
    """
    某次成片的音频存放目录。Remotion 的 <Audio> 只能加载 http(s) 或 public/ 下的
    staticFile 资源（不能用 file://），所以配音必须落在 remotion/public/ 里，
    组件侧用 staticFile('compose/<job_id>/xxx.mp3') 引用。
    （信息动画走结构化 scene，不落文件，无需 public 目录。）
    """
    return get_remotion_dir() / "public" / "compose" / job_id


def cleanup_public_job_dir(job_id: str) -> None:
    """渲染结束后清理 public 下该次成片的音频（避免堆积）。"""
    d = get_public_job_dir(job_id)
    try:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"清理 compose public 目录失败 {d}: {e}")


def is_ready() -> bool:
    """Remotion 依赖是否已安装（node_modules 存在）。"""
    return (get_remotion_dir() / "node_modules").exists()


def split_sentences(narration: str) -> List[str]:
    """把一段口播按中文句末标点拆成句子列表。"""
    text = (narration or "").strip()
    if not text:
        return []
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text)]
    return [p for p in parts if p]


def _seconds_to_frames(seconds: float) -> int:
    return max(1, round(seconds * FPS))


# 字幕呈现样式白名单（与 remotion/src/CaptionedVideo.tsx 的 CaptionStyle 对齐）。
# 'classic' 经典白字（默认，历史产物）；'karaoke' 逐字点亮。
CAPTION_STYLES = ("classic", "karaoke")
DEFAULT_CAPTION_STYLE = "classic"


def _normalize_caption_style(value: Optional[str]) -> str:
    """把外部传入的字幕样式收敛到白名单，非法/缺省一律回落 classic（防脏值进 Remotion）。"""
    v = (value or "").strip().lower()
    return v if v in CAPTION_STYLES else DEFAULT_CAPTION_STYLE


def build_props(
    script: Dict[str, Any],
    workdir: Path,
    job_id: str,
    progress_cb: ProgressCb = None,
    with_scene: bool = True,
    with_video: Optional[bool] = None,
    caption_style: str = DEFAULT_CAPTION_STYLE,
) -> Dict[str, Any]:
    """
    从文案 dict 构建 Remotion inputProps。
    每句 narration →
      1) edge-tts 配音（落 remotion/public/compose/<job_id>/），拿到真实时长
         —— MINIMAX_AUDIO_MODE=only 时跳过这步，声音全交给 H3 空镜的原生音轨，
            每句时长按 MINIMAX_DURATION 排（见 minimax_service.audio_mode）
      2) 上区画面来源，按优先级：
         a) with_video 且这句适合实拍 → MiniMax H3 生成空镜视频（visualType='video'）
         b) 否则 with_scene → 信息动画 scene（visualType='scene'：关键词/图标/步骤/箭头/对比）
         c) 都关 → 纯字幕（上区留底色）

    Args:
        script: ScriptRepo.get() 返回的 dict（含 title / segments / style）
        workdir: 本次成片的工作目录（props.json 落这里）
        job_id: 本次成片标识（用作 public 子目录名，通常是 project_id）
        progress_cb: 可选进度回调 (percent:int, message:str)
        with_scene: 是否为每句生成信息动画 scene（关掉则上区留暖底，纯字幕）
        with_video: 是否用 MiniMax H3 生成实拍空镜（None=默认开，除非 MINIMAX_DISABLE=1）。
                    生成失败/该句不适合实拍时，自动回退到 scene。

    Returns:
        Remotion inputProps dict（audioSrc/visualSrc 为 staticFile 相对路径）
    """
    # 旁白是否还要合成：MINIMAX_AUDIO_MODE=only 时整条声音交给 H3 的原生音轨，不跑 TTS
    # （此时 edge-tts 装没装都无所谓，不能因此拦住成片）。
    narration_on = minimax_service.narration_enabled()
    if narration_on and not tts.is_available():
        raise ComposeNotReady("edge-tts 未安装，无法生成配音。请 pip install edge-tts。")

    # 把 progress_cb 包一层：每次汇报进度前先检查取消。阶段 A（配音）/B（实拍）/C（信息动画）
    # 都在循环里频繁 progress_cb，故这层等于给整个耗时过程铺满了取消检查点，一删就尽快停。
    _user_cb = progress_cb

    def progress_cb(percent: int, message: str) -> None:  # type: ignore[misc]
        _raise_if_cancelled(job_id)
        if _user_cb:
            _user_cb(percent, message)

    # 音频必须落在 remotion/public/ 下（Remotion 只认 http(s) 或 staticFile）
    public_dir = get_public_job_dir(job_id)
    public_dir.mkdir(parents=True, exist_ok=True)

    title = (script.get("title") or "未命名").strip()
    style = (script.get("style") or "").strip()
    segments = script.get("segments") or []

    # 展平成 (句子, 角色) 列表，同时记录总句数用于进度
    sentence_items: List[tuple] = []
    for seg in segments:
        role = seg.get("role", "body")
        for sentence in split_sentences(seg.get("narration", "")):
            sentence_items.append((sentence, role))
    total_sentences = len(sentence_items)
    if total_sentences == 0:
        raise ValueError("文案没有可用的口播内容（narration 为空）。")

    # 整条视频挑一套贴内容调性的主题配色（只调一次 LLM；失败回退 DESIGN 默认主题）。
    # 取开头一句做 sample，帮 LLM 感受调性。
    if progress_cb:
        progress_cb(8, "为视频定调色…")
    try:
        theme = get_theme_service().build_theme(
            title=title,
            domain=(script.get("domain") or "").strip(),
            style=style,
            sample=sentence_items[0][0] if sentence_items else "",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"主题生成异常，回退默认: {e}")
        theme = dict(DEFAULT_THEME)

    scene_service = get_scene_service() if with_scene else None

    # 实拍素材路线：这是默认成片形态（用户点「生成视频」即走实拍 + Remotion，零额外操作）。
    # with_video 缺省(None)=默认开启；可用环境变量 MINIMAX_DISABLE=1 全局强制关闭（调试/省钱）。
    # 仅当开启且已配 API Key 时才真正生效——否则整条自动回退信息动画，绝不中断成片。
    if with_video is None:
        with_video = not minimax_service.disabled()
    video_on = bool(with_video) and minimax_service.is_available()
    if with_video and not video_on:
        logger.warning("实拍素材已启用，但 MiniMax 不可用（未配 MINIMAX_API_KEY），整条回退信息动画。")
    video_prompt_service = get_video_prompt_service() if video_on else None
    max_credits = minimax_service.max_cost() if video_on else None
    spent_credits = 0.0  # 累计已估成本，超上限后停止再生

    # —— 阶段 A：逐句配音（快，串行）——先拿到每句真实时长，供后续 scene/视频落界。
    # 每句先占好一个 segment 位置（画面来源阶段 B/C 再填），保证顺序稳定。
    # narration_on=False（only 模式）时整段跳过 TTS：每句时长改用空镜秒数排，
    # 比空镜实际长度略短一点（H3 出片会比请求秒数多零点几秒），不会拖出定格尾帧。
    out_segments: List[Dict[str, Any]] = []
    for idx, (sentence, role) in enumerate(sentence_items):
        audio_name = f"{idx:03d}.mp3"
        audio_path = public_dir / audio_name
        seconds = 0.0
        if narration_on:
            try:
                seconds = tts.synthesize(sentence, audio_path)
            except tts.TTSNotAvailable:
                raise
            except Exception as e:  # noqa: BLE001
                logger.warning(f"第 {idx} 句 TTS 失败，改用无配音兜底: {e}")
        has_audio = narration_on and seconds > 0 and audio_path.exists()
        if not has_audio:
            seconds = float(minimax_service.clip_seconds()) if not narration_on \
                else FALLBACK_SECONDS_PER_SENTENCE

        out_segments.append({
            "text": sentence,
            "audioSrc": f"compose/{job_id}/{audio_name}" if has_audio else None,
            "visualType": "scene",  # 缺省先占位为 scene，阶段 B 命中实拍再改
            "visualSrc": None,
            "scene": None,
            "durationInFrames": _seconds_to_frames(seconds),
            "role": role,
            "_seconds": seconds,  # 内部用，写盘前删掉
        })
        if progress_cb:
            stage = "配音" if narration_on else "排轨"
            progress_cb(10 + int((idx + 1) / total_sentences * 20), f"{stage} {idx + 1}/{total_sentences}")

    # —— 阶段 B：实拍素材（慢，并发）——先为每句判是否配实拍并估价（LLM，串行且快），
    # 再把要生成的句子丢线程池并发调 MiniMax，把 N×(1~3min) 压成并行。
    if video_prompt_service is not None:
        if progress_cb:
            progress_cb(30, "设计画面中…")
        # B1) 逐句出视频 prompt + 估价，按额度上限筛出真正要生成的句子（串行，保证额度累加确定）
        to_generate: List[tuple] = []  # (idx, prompt)
        for idx, (sentence, role) in enumerate(sentence_items):
            vp = video_prompt_service.build(sentence, role=role, context_title=title, style=style)
            if not (vp.get("visual") and vp.get("prompt")):
                continue
            cost = minimax_service.estimate_cost(vp["prompt"]) or 0.0
            if max_credits is not None and (spent_credits + cost) > max_credits:
                logger.warning(
                    "实拍素材达成本上限 %.1f（已排 %.1f），第 %d 句起回退信息动画。",
                    max_credits, spent_credits, idx,
                )
                break  # 后续句子不再排（额度累加是顺序性的）
            spent_credits += cost
            to_generate.append((idx, vp["prompt"]))

        # B2) 并发生成。generate_clip 内部含缓存/下载/降级，失败返回 None（该句自然回退 scene）。
        done = 0
        total_gen = len(to_generate)
        logger.info("实拍并发生成：%d 句待生成，并发数 %d", total_gen, VIDEO_CONCURRENCY)
        if total_gen:
            def _gen(idx: int, prompt: str):
                src = minimax_service.generate_clip(
                    prompt, public_dir, rel_prefix=f"compose/{job_id}",
                    cache_key=sentence_items[idx][0],  # 句子原文做缓存键，同句复用
                )
                return idx, src

            with ThreadPoolExecutor(max_workers=VIDEO_CONCURRENCY) as pool:
                futures = [pool.submit(_gen, idx, prompt) for idx, prompt in to_generate]
                for fut in as_completed(futures):
                    try:
                        idx, src = fut.result()
                    except Exception as e:  # noqa: BLE001
                        logger.warning("实拍生成线程异常，跳过: %s", e)
                        continue
                    if src:
                        out_segments[idx]["visualType"] = "video"
                        out_segments[idx]["visualSrc"] = src
                    done += 1
                    if progress_cb:
                        progress_cb(30 + int(done / total_gen * 25), f"生成实拍 {done}/{total_gen}")

    # —— 阶段 C：每句都生成 scene（信息动画视觉脚本）；实拍句额外算一套呼应画面色调的组件 theme ——
    # 实拍句：scene 作为组件叠在视频上（前端 SceneStage overlay 模式）；组件 accent 取自视频主色，
    #         让组件配色和实拍画面同色系。overlayTheme 存到 segment，前端优先用它。
    # 回退句：scene 作为完整信息动画（用整条统一 theme）。
    theme_svc = get_theme_service()
    if scene_service is not None:
        for idx, seg in enumerate(out_segments):
            sentence, role = sentence_items[idx]
            seg["scene"] = scene_service.build_scene(
                sentence, seg["_seconds"], role=role, context_title=title
            )
            # 实拍句：抽视频主色 → 生成呼应画面的组件 theme
            if seg["visualType"] == "video" and seg.get("visualSrc"):
                try:
                    from .theme_service import probe_video_color
                    video_file = public_dir / Path(seg["visualSrc"]).name
                    vcolor = probe_video_color(video_file)
                    seg["overlayTheme"] = theme_svc.theme_for_overlay(theme, vcolor)
                except Exception as e:  # noqa: BLE001
                    logger.warning("生成组件呼应色失败，用统一 theme: %s", e)
            if progress_cb:
                progress_cb(55 + int((idx + 1) / total_sentences * 5), f"画面 {idx + 1}/{total_sentences}")

    # 清理内部字段
    for seg in out_segments:
        seg.pop("_seconds", None)

    props = {
        "title": title,
        "style": style or None,
        "theme": theme,
        "captionStyle": _normalize_caption_style(caption_style),
        # 实拍素材自带音轨的音量：H3 出片带与画面同步的原生环境音。
        # mix（默认）压低垫在旁白下；only 全量且没有旁白；off 静音（历史行为）。
        "videoVolume": minimax_service.clip_volume(),
        "titleDurationInFrames": _seconds_to_frames(TITLE_SECONDS),
        "outroDurationInFrames": _seconds_to_frames(OUTRO_SECONDS),
        "segments": out_segments,
    }

    props_path = workdir / "props.json"
    with open(props_path, "w", encoding="utf-8") as f:
        json.dump(props, f, ensure_ascii=False, indent=2)
    logger.info(
        f"已写 Remotion props: {props_path}（{len(out_segments)} 句, 信息动画={with_scene}, "
        f"声音={minimax_service.audio_mode()}/旁白={narration_on}）"
    )

    return props


def render(workdir: Path, out_path: Path, progress_cb: ProgressCb = None, job_id: Optional[str] = None) -> None:
    """
    调 Remotion CLI 渲染 workdir/props.json → out_path（MP4）。
    流式读子进程输出、推进度；带超时避免卡死。
    job_id：给了则把子进程登记到取消注册表，删除项目时可 kill 掉正在跑的渲染。
    """
    if not is_ready():
        raise ComposeNotReady(
            "Remotion 未安装依赖。请在 remotion/ 目录执行 npm install 后重试。"
        )

    remotion_dir = get_remotion_dir()
    props_path = workdir / "props.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        get_npx_path(), "remotion", "render",
        "src/index.ts", "CaptionedVideo",
        str(out_path.resolve()),
        f"--props={props_path.resolve()}",
        # headless Chromium 冷启动 / 加载字体等资源常超过默认 30s，放宽到 120s，避免误判超时
        "--timeout=120000",
    ]
    # 限制渲染并发：Remotion 默认按 CPU 核数自动放大，每个并发是一个 headless
    # Chromium 实例（1080p 下每个吃 0.3~0.7G 内存）。小内存服务器（如 2核4G）上
    # 不限制会被撑爆 OOM。默认压到 2，可用 REMOTION_CONCURRENCY 覆盖（大机器放开）。
    concurrency = os.environ.get("REMOTION_CONCURRENCY", "2").strip()
    if concurrency:
        cmd.append(f"--concurrency={concurrency}")
    logger.info(f"开始 Remotion 渲染: {' '.join(cmd)} (cwd={remotion_dir})")

    # 起进程前先看一眼是否已被取消（用户可能在准备阶段就删了项目）
    if job_id:
        _raise_if_cancelled(job_id)

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(remotion_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as e:
        raise ComposeNotReady(f"找不到 npx（Node 环境）: {e}") from e

    # 登记子进程，取消时 request_cancel 会 kill 它
    if job_id:
        _set_current_proc(job_id, proc)

    lines: List[str] = []
    render_re = re.compile(r"Rendered\s+(\d+)/(\d+)")
    try:
        assert proc.stdout is not None
        for line in iter(proc.stdout.readline, ""):
            # 被取消：request_cancel 已 kill 子进程，这里读到 EOF 前也主动兜底
            if job_id and is_cancelled(job_id):
                if proc.poll() is None:
                    proc.kill()
                raise ComposeCancelled(f"成片任务已被取消: {job_id}")
            line = line.rstrip()
            if not line:
                continue
            lines.append(line)
            lines[:] = lines[-40:]
            # 渲染阶段占 60~99%
            m = render_re.search(line)
            if m and progress_cb:
                done, tot = int(m.group(1)), max(1, int(m.group(2)))
                pct = 60 + int(done / tot * 39)
                progress_cb(min(99, pct), "渲染画面中…")
        proc.wait(timeout=RENDER_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise RuntimeError(f"Remotion 渲染超时（>{RENDER_TIMEOUT}s），已终止。")
    finally:
        if job_id:
            _set_current_proc(job_id, None)

    # 被 kill（取消）时 returncode 非 0，但那是取消不是失败 —— 先判取消
    if job_id and is_cancelled(job_id):
        raise ComposeCancelled(f"成片任务已被取消: {job_id}")

    if proc.returncode != 0:
        tail = "\n".join(lines[-12:])
        raise RuntimeError(f"Remotion 渲染失败（退出码 {proc.returncode}）:\n{tail}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError("Remotion 渲染完成但未产出有效 MP4。")

    logger.info(f"Remotion 渲染完成: {out_path}")


def compose(
    script: Dict[str, Any],
    workdir: Path,
    out_path: Path,
    job_id: str,
    progress_cb: ProgressCb = None,
    with_scene: bool = True,
    with_video: Optional[bool] = None,
    caption_style: str = DEFAULT_CAPTION_STYLE,
) -> Path:
    """一步到位：文案 → 配音 + 画面（实拍空镜/信息动画）→ 渲染 MP4。返回产物路径。渲染后清理 public 素材。

    可取消：任务登记到取消注册表；删除项目时 request_cancel(job_id) 会置事件 + kill 子进程，
    本函数在各阶段检查点抛 ComposeCancelled 提前退出。
    """
    _register_job(job_id)
    try:
        _raise_if_cancelled(job_id)
        build_props(
            script, workdir, job_id, progress_cb,
            with_scene=with_scene, with_video=with_video, caption_style=caption_style,
        )
        _raise_if_cancelled(job_id)
        render(workdir, out_path, progress_cb, job_id=job_id)
        return out_path
    finally:
        _unregister_job(job_id)
        cleanup_public_job_dir(job_id)
