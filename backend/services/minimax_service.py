"""
MiniMax H3 文生视频服务（自动成片实拍素材路线，旁路模块）。

把「一句英文画面提示词」→ 调 MiniMax 开放平台文生视频 API 生成一段实拍级空镜（mp4）→
下载到 remotion/public/ 下 → 返回 staticFile 相对路径，供 compose_service 填进
segment.visualSrc（visualType='video'），Remotion 端全屏铺底合成。

与 scene_service（信息动画）并列的另一种上区画面来源；素材驱动的解说混剪走这条。

**接口走 v2**（2026-08-16 实测）：H3 不在老的 /v1/video_generation 上，
用 v1 提交会被明确拒绝（"该模型请使用 /v2/video_generation 接口"）。v2 与 v1 的差别很大：
  1) POST {base}/v2/video_generation
       body: {model, content:[{type:"text",text:...}], resolution, ratio, duration}
       ← 提示词在 content 数组里（不是 prompt 字段）；比例字段叫 ratio（不是 aspect_ratio）
       → {"task_id":"431417369903608"}
  2) GET  {base}/v2/query/video_generation?task_id=...
       → {"items":[{id,status,content:{url},usage:{output_seconds,total_tokens},...}],"total":1}
       status: running → succeeded / failed
  3) 成品地址直接在 items[0].content.url（签名 OSS 链接，约 24h 过期）。
       **不需要** v1 那套 file_id → /v1/files/retrieve 两跳。
错误信封也变了：HTTP 400 + {"type":"error","error":{"message":...}}，不再是 200 + base_resp。

H3 实测能力（用 key 探出来的，官方文档站是前端渲染、抓不到）：
  - duration：4~15 的整数秒
  - resolution：仅 768P（实际 1344×768）与 2K
  - ratio：16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9（文生视频必填，不能用 adaptive）
  - 产物自带 AAC 原生音轨 —— Remotion 侧 VisualStage 已 muted，不会和 TTS 旁白打架

设计约束：
- **可选/可降级**：未配密钥 / 生成失败 / 超时，一律返回 None，绝不中断成片
  （上层回退到 scene 或静图）。
- **省钱**：同一句话的产物按内容 hash 持久缓存，命中不重生；可设累计成本上限。
- **配置走环境变量**（密钥也可写进 data/settings.json 的 minimax_api_key）：
    MINIMAX_API_KEY           必填。开放平台 → 账户管理 → 接口密钥
    MINIMAX_MODEL             模型 id（默认 MiniMax-H3）
    MINIMAX_REGION            cn（默认，api.minimaxi.com）/ global（api.minimax.io）
                              注意：两个站的密钥不通用，国内 key 在国际站报 invalid api key
    MINIMAX_BASE_URL          直接指定 API 根地址（走中转/代理时用，优先于 REGION）
    MINIMAX_RESOLUTION        768P（默认）/ 2K
    MINIMAX_DURATION          单段秒数，4~15（默认 5）
    MINIMAX_DISABLE           1/true 时全局停用实拍（调试或省钱）
    MINIMAX_PRICE_PER_SECOND  估价单价（每输出秒），默认 0 = 不估价
    MINIMAX_MAX_COST          单条成片累计成本上限（单位同上，需先设单价才生效）
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from ..core.path_utils import get_project_root, get_settings_file_path
from . import overlay_safe_zone

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "MiniMax-H3"
DEFAULT_DURATION = 5      # 秒；单段空镜时长
DEFAULT_ASPECT = "16:9"
DEFAULT_RESOLUTION = "768P"

# H3 实测约束
DURATION_RANGE = (4, 15)
RESOLUTIONS = {"768P", "2K"}
RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}

# 原生音轨用法（见 audio_mode()）
AUDIO_MODES = {"mix", "only", "off"}
DEFAULT_AUDIO_MODE = "mix"
DEFAULT_AUDIO_VOLUME = 0.18   # mix 模式下垫底音量，压到不抢旁白

# 区域 → API 根地址
_HOSTS = {
    "cn": "https://api.minimaxi.com",
    "global": "https://api.minimax.io",
}

REQUEST_TIMEOUT = 60        # 单次 HTTP 请求超时
POLL_INTERVAL = 8           # 轮询间隔（秒）
POLL_TIMEOUT = 900          # 单段视频最长等待（秒）

# 任务终态（实测：running → succeeded；失败态按前缀宽松匹配，避免拼写差异卡死轮询）
_DONE_OK = {"succeeded", "success", "completed"}
_DONE_BAD = {"failed", "fail", "error", "canceled", "cancelled"}


class MinimaxNotReady(RuntimeError):
    """MiniMax 未就绪（没配 API Key）。"""


# —— 配置读取 ——

def _api_key() -> str:
    """
    密钥读取顺序：环境变量 MINIMAX_API_KEY → data/settings.json 的 minimax_api_key。
    后者与 LLM 密钥同一个文件，方便以后在设置页里填。
    """
    key = (os.environ.get("MINIMAX_API_KEY") or "").strip()
    if key:
        return key
    try:
        path = get_settings_file_path()
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return str(data.get("minimax_api_key") or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.debug("读取 settings.json 里的 minimax_api_key 失败: %s", e)
    return ""


def _base_url() -> str:
    explicit = (os.environ.get("MINIMAX_BASE_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    region = (os.environ.get("MINIMAX_REGION") or "cn").strip().lower()
    return _HOSTS.get(region, _HOSTS["cn"])


def _model() -> str:
    return (os.environ.get("MINIMAX_MODEL") or DEFAULT_MODEL).strip()


def _resolution() -> str:
    """分辨率；H3 只认 768P / 2K，配错就退回默认（别把整条成片赔在一个笔误上）。"""
    val = (os.environ.get("MINIMAX_RESOLUTION") or DEFAULT_RESOLUTION).strip()
    if val.upper() in RESOLUTIONS:
        return val.upper()
    if val not in RESOLUTIONS:
        logger.warning("MINIMAX_RESOLUTION=%s 不被 %s 支持（仅 768P/2K），回退 %s",
                       val, _model(), DEFAULT_RESOLUTION)
    return DEFAULT_RESOLUTION


def _duration() -> int:
    """默认单段秒数；H3 只接受 4~15 的整数秒，越界就夹回去。"""
    raw = (os.environ.get("MINIMAX_DURATION") or "").strip()
    try:
        val = int(raw) if raw else DEFAULT_DURATION
    except ValueError:
        val = DEFAULT_DURATION
    return max(DURATION_RANGE[0], min(DURATION_RANGE[1], val))


def _ratio(aspect: str) -> str:
    """画面比例；不在 H3 支持集合里就回退 16:9（文生视频此字段必填）。"""
    val = (aspect or "").strip()
    if val in RATIOS:
        return val
    if val:
        logger.warning("ratio=%s 不被支持（%s），回退 %s", val, "/".join(sorted(RATIOS)), DEFAULT_ASPECT)
    return DEFAULT_ASPECT


def clip_seconds() -> int:
    """单段空镜的秒数（对外）。only 模式下每句时长就按它排，见 compose_service 阶段 A。"""
    return _duration()


def audio_mode() -> str:
    """
    H3 出片自带一条与画面同步的原生立体声音轨（实测 AAC 32kHz，mean −12dB，是有内容的
    环境音/音效，不是把中文稿念出来）。怎么用它由 MINIMAX_AUDIO_MODE 决定：

      mix (默认) TTS 旁白 + 原生音轨压低垫底 —— 有解说也有现场感，最稳
      only       不做 TTS，只用原生音轨（全量音量）；成片没有人声解说，
                 每句时长改用 MINIMAX_DURATION（不再由配音时长决定）
      off        原生音轨静音，只留旁白（换模型前的历史行为）

    非法值回落 mix。
    """
    val = (os.environ.get("MINIMAX_AUDIO_MODE") or DEFAULT_AUDIO_MODE).strip().lower()
    if val in AUDIO_MODES:
        return val
    logger.warning("MINIMAX_AUDIO_MODE=%s 无效（仅 %s），回退 %s",
                   val, "/".join(sorted(AUDIO_MODES)), DEFAULT_AUDIO_MODE)
    return DEFAULT_AUDIO_MODE


def narration_enabled() -> bool:
    """是否还需要 TTS 旁白。only 模式完全交给 H3 的原生音轨，不再合成配音。"""
    return audio_mode() != "only"


def clip_volume() -> float:
    """
    传给 Remotion 的 videoVolume（0~1）：素材自带音轨在成片里的音量。
    off→0（静音）；only→全量；mix→压低垫在旁白下面（可用 MINIMAX_AUDIO_VOLUME 调）。
    """
    mode = audio_mode()
    if mode == "off":
        return 0.0
    default = 1.0 if mode == "only" else DEFAULT_AUDIO_VOLUME
    raw = (os.environ.get("MINIMAX_AUDIO_VOLUME") or "").strip()
    if not raw:
        return default
    try:
        return max(0.0, min(1.0, float(raw)))
    except ValueError:
        logger.warning("MINIMAX_AUDIO_VOLUME=%s 不是数字，回退 %s", raw, default)
        return default


def _price_per_second() -> float:
    """估价单价（每输出秒）。默认 0 = 不估价，也就不做成本上限保护。"""
    raw = (os.environ.get("MINIMAX_PRICE_PER_SECOND") or "").strip()
    try:
        return float(raw) if raw else 0.0
    except ValueError:
        return 0.0


def max_cost() -> Optional[float]:
    """
    单条成片的累计成本上限（单位与 MINIMAX_PRICE_PER_SECOND 一致）。
    没设单价时返回 None——没有单价就估不出成本，上限无从判断。
    """
    raw = (os.environ.get("MINIMAX_MAX_COST") or "").strip()
    if not raw or _price_per_second() <= 0:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def enabled() -> bool:
    """是否启用实拍素材路线。默认开启（实拍是默认成片形态）；仅 MINIMAX_DISABLE 强制关。"""
    return not disabled()


def disabled() -> bool:
    """是否被显式关闭（MINIMAX_DISABLE=1/true 时全局停用实拍，用于调试或省钱）。"""
    return os.environ.get("MINIMAX_DISABLE", "").strip().lower() in {"1", "true", "yes", "on"}


def is_available() -> bool:
    """
    配了密钥就算可用。这里刻意不发探活请求：开放平台没有免费的 ping 接口，
    真正的可用性由 generate_clip 失败降级来兜（失败即回退信息动画，不中断成片）。
    """
    if not _api_key():
        logger.info("MiniMax 不可用：未配置 MINIMAX_API_KEY（或 settings.json 的 minimax_api_key）。")
        return False
    return True


def estimate_cost(prompt: str, duration: Optional[int] = None, aspect: str = DEFAULT_ASPECT) -> Optional[float]:
    """
    估算生成一段视频的成本（不发请求、不花钱）。开放平台没有估价接口，
    这里按「单价 × 秒数」线性估，单价由 MINIMAX_PRICE_PER_SECOND 给。
    未配单价返回 None（上层视为 0，不做上限保护）。
    """
    price = _price_per_second()
    if price <= 0:
        return None
    return price * (duration or _duration())


# —— HTTP 细节 ——

def _headers() -> Dict[str, str]:
    key = _api_key()
    if not key:
        raise MinimaxNotReady("未配置 MINIMAX_API_KEY")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _parse(resp: requests.Response) -> Dict[str, Any]:
    """
    解析 v2 响应。v2 用 HTTP 4xx + {"type":"error","error":{"message":...}} 报错，
    但也见过 200 里带 base_resp 的老式错法——两种都识别，非 0 一律抛（由上层降级），
    并把服务端原文带上：模型名错、分辨率不支持、密钥不对，全靠这句话一眼定位。
    """
    try:
        payload = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise RuntimeError(f"MiniMax 返回非 JSON（HTTP {resp.status_code}）: {resp.text[:200]}")

    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            raise RuntimeError(f"MiniMax 接口报错（HTTP {resp.status_code}）: {err.get('message') or err}")
        base = payload.get("base_resp") or {}
        code = base.get("status_code", 0)
        if code not in (0, None):
            raise RuntimeError(f"MiniMax 接口报错 status_code={code}: {base.get('status_msg') or ''}")
    resp.raise_for_status()
    return payload if isinstance(payload, dict) else {"data": payload}


def _submit(prompt: str, duration: int, aspect: str) -> str:
    """提交生成任务，返回 task_id。"""
    body: Dict[str, Any] = {
        "model": _model(),
        # v2 把提示词放在 content 数组里（多模态上下文：文本/图/视频/音频都是 item）
        "content": [{"type": "text", "text": prompt}],
        "resolution": _resolution(),
        "ratio": _ratio(aspect),
        "duration": duration,
    }
    resp = requests.post(
        f"{_base_url()}/v2/video_generation",
        headers=_headers(),
        json=body,
        timeout=REQUEST_TIMEOUT,
    )
    data = _parse(resp)
    task_id = str(data.get("task_id") or data.get("id") or "").strip()
    if not task_id:
        raise RuntimeError(f"MiniMax 未返回 task_id: {str(data)[:200]}")
    return task_id


def _query(task_id: str) -> Dict[str, Any]:
    """
    查一次任务状态，返回**这个 task_id 对应**的那条（查不到返回空 dict → 上层继续等）。

    ⚠ 别改回 items[0]。这个接口**根本不按 task_id 过滤**：不管传谁，它都回账号下
    近期全部任务（带 total 字段），且按提交时间倒序。串行生成时我们刚提交的那条恰好排第一，
    取 items[0] 侥幸一直是对的；**两段视频并发在飞时，两个轮询都会拿到"后提交那条"的 URL，
    于是两句话下到同一段视频**（2026-08-18 混排首测：实拍句的缓存文件里装着拼贴动画）。
    所以必须自己按 id 对号入座。
    """
    resp = requests.get(
        f"{_base_url()}/v2/query/video_generation",
        headers=_headers(),
        params={"task_id": task_id},
        timeout=REQUEST_TIMEOUT,
    )
    data = _parse(resp)
    items = data.get("items") or []
    want = str(task_id).strip()
    for it in items:
        if not isinstance(it, dict):
            continue
        if str(it.get("task_id") or it.get("id") or "").strip() == want:
            return it
    return {}


def _wait_for_url(task_id: str) -> str:
    """轮询任务直到成功，返回成品 mp4 的下载地址。失败/超时抛异常。"""
    deadline = time.time() + POLL_TIMEOUT
    seen = False  # 是否在任务列表里见过它（没见过 ≠ 没生成，见 _query 注释）
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        item = _query(task_id)
        seen = seen or bool(item)
        status = str(item.get("status") or "").strip().lower()
        if status in _DONE_OK:
            url = str((item.get("content") or {}).get("url") or "").strip()
            if not url:
                raise RuntimeError(f"任务 {task_id} 已完成但没给 content.url: {str(item)[:200]}")
            usage = item.get("usage") or {}
            logger.info("MiniMax 任务 %s 完成（输出 %ss，计费 tokens %s）",
                        task_id, usage.get("output_seconds"), usage.get("total_tokens"))
            return url
        if status in _DONE_BAD:
            raise RuntimeError(f"任务 {task_id} 生成失败: {str(item)[:300]}")
        # running / queueing / preparing / 空（任务刚建还查不到）→ 继续等
    raise RuntimeError(
        f"任务 {task_id} 等待超时（{POLL_TIMEOUT}s）"
        + ("" if seen else "：整个轮询期间它都没出现在任务列表里，可能被接口分页截掉了")
    )


# —— 缓存与下载 ——

def _cache_name(cache_key: str, duration: int, aspect: str, overlay_side: str = "") -> str:
    """
    按 (model, resolution, cache_key, duration, ratio, 留白侧) 内容 hash 命名，供缓存复用。

    cache_key 应传**稳定的句子原文**，而非 LLM 生成的英文 prompt——后者每次生成都有
    细微差别，hash 每次都变，缓存永不命中、重复扣费。用句子原文才能让「同一句话复用
    同一段视频」。
    overlay_side 进 hash：主体在左还是在右是两种不同构图，同一句换了侧别必须重生，
    否则叠加组件会压住主体（见 overlay_safe_zone）。
    """
    key = (f"{_model()}|{_resolution()}|{cache_key}|{duration}|{_ratio(aspect)}"
           f"|{overlay_safe_zone.normalize(overlay_side)}").encode("utf-8")
    return "mm_" + hashlib.sha1(key).hexdigest()[:16] + ".mp4"


def _download(url: str, dest: Path, timeout: int = 180) -> bool:
    """
    下载生成结果到 dest（content.url 是带签名的 OSS 链接，约 24h 过期，拿到就得下）。

    优先用系统 curl：macOS 自带 Python 的 urllib 常因找不到 CA 根证书而
    SSL: CERTIFICATE_VERIFY_FAILED（曾导致视频已生成扣费、却下载不下来）。
    curl 用系统证书链，稳。curl 不可用时再退回 requests。
    """
    import shutil as _shutil

    dest.parent.mkdir(parents=True, exist_ok=True)

    curl = _shutil.which("curl")
    if curl:
        try:
            proc = subprocess.run(
                [curl, "-fsSL", "-o", str(dest), url],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout,
            )
            if proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
                return True
            logger.warning("curl 下载失败（退出码 %s）: %s", proc.returncode, (proc.stderr or "").strip()[-200:])
        except Exception as e:  # noqa: BLE001
            logger.warning("curl 下载异常，改试 requests: %s", e)

    try:
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    if chunk:
                        f.write(chunk)
        return dest.exists() and dest.stat().st_size > 0
    except Exception as e:  # noqa: BLE001
        logger.warning("下载生成视频失败 %s: %s", url, e)
        return False


def get_cache_dir() -> Path:
    """
    持久素材缓存目录（remotion/public/mm_cache/）。

    与 job 目录分离：job 目录（compose/<job_id>/）渲染后会被 cleanup 清理，缓存不能放那，
    否则每次重跑都缓存不到、重复扣费。缓存放这里长期留存，命中时复制一份到 job 目录供渲染。
    """
    return get_project_root() / "remotion" / "public" / "mm_cache"


def generate_clip(
    prompt: str,
    dest_dir: Path,
    duration: Optional[int] = None,
    aspect: str = DEFAULT_ASPECT,
    rel_prefix: str = "",
    cache_key: str = "",
    overlay_side: str = "",
) -> Optional[str]:
    """
    生成一段实拍空镜并落到 dest_dir，返回相对 remotion/public/ 的 staticFile 路径。
    任何失败返回 None（上层回退）。命中持久缓存不重生（省钱）。

    Args:
        prompt: 英文画面提示词（video_prompt_service 产出，每次可能有细微差别）
        dest_dir: 本次成片的落地目录（在 remotion/public/ 下，如 compose/<job_id>/，渲染后会被清理）
        duration: 片段秒数（缺省用 MINIMAX_DURATION，默认 5；H3 限 4~15）
        aspect: 画面比例（对应 v2 的 ratio 字段）
        rel_prefix: 返回相对路径的前缀（如 'compose/<job_id>'），拼到文件名前
        cache_key: 缓存键，应传**稳定的句子原文**（缺省回退用 prompt）。同 key 复用同一段视频。
        overlay_side: 'left'/'right' —— 这一侧留空给 Remotion 组件，主体推到另一侧
                      （见 overlay_safe_zone）。缺省/非法 = 不加构图约束。

    Returns:
        staticFile 相对路径（如 'compose/<job_id>/mm_xxx.mp4'）；失败 None
    """
    import shutil as _shutil

    prompt = (prompt or "").strip()
    if not prompt:
        return None
    seconds = max(DURATION_RANGE[0], min(DURATION_RANGE[1], duration)) if duration else _duration()

    # 构图约束追加在提示词末尾：把主体推到留白侧的对面，别让叠加组件挡住它
    side = overlay_safe_zone.normalize(overlay_side)
    hint = overlay_safe_zone.live_hint(side)
    if hint:
        prompt = prompt.rstrip(" .,") + ". " + hint

    # 缓存键用句子原文（稳定）；没传则退回 prompt（不稳定，仅兜底）
    key = (cache_key or "").strip() or prompt
    fname = _cache_name(key, seconds, aspect, side)
    dest = dest_dir / fname
    rel = f"{rel_prefix}/{fname}" if rel_prefix else fname

    cache_dir = get_cache_dir()
    cached = cache_dir / fname

    # 1) 本 job 目录已有（同条视频内重复句）：直接复用
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("MiniMax job 内命中，跳过生成: %s", fname)
        return rel

    # 2) 持久缓存命中（跨视频/重跑同一句）：复制到 job 目录，不生成、不扣费
    if cached.exists() and cached.stat().st_size > 0:
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            _shutil.copy(cached, dest)
            logger.info("MiniMax 持久缓存命中，跳过生成（省钱）: %s", fname)
            return rel
        except Exception as e:  # noqa: BLE001
            logger.warning("缓存复制失败，改为重新生成: %s", e)

    # 3) 未命中：真正生成
    try:
        task_id = _submit(prompt, seconds, aspect)
        logger.info("MiniMax 任务已提交（model=%s, %ss, %s, %s, 留白=%s）: %s",
                    _model(), seconds, _resolution(), _ratio(aspect), side or "无", task_id)
        url = _wait_for_url(task_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("MiniMax 生成失败，回退: %s", e)
        return None

    if not _download(url, dest):
        return None

    # 存一份到持久缓存，供以后同一句复用（不随 job 清理消失）
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        if not cached.exists():
            _shutil.copy(dest, cached)
    except Exception as e:  # noqa: BLE001
        logger.warning("写入持久缓存失败（不影响本次）: %s", e)

    logger.info("MiniMax 生成完成: %s", fname)
    return rel


if __name__ == "__main__":
    # 冒烟自测：python -m backend.services.minimax_service
    # 真会调接口、真会扣费（一段 4 秒 768P，最便宜档位）。
    import sys

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if not is_available():
        print("✗ 未配置 MINIMAX_API_KEY，先 export MINIMAX_API_KEY=...")
        sys.exit(1)
    out_dir = get_project_root() / "remotion" / "public" / "mm_smoke"
    test_prompt = (
        "Cinematic aerial drone shot over vast desert dunes at golden hour, "
        "soft warm light, film grain, no faces, no text, no watermark"
    )
    print(f"→ base={_base_url()} model={_model()} resolution={_resolution()} duration=4s")
    result = generate_clip(test_prompt, out_dir, duration=4, rel_prefix="mm_smoke", cache_key="smoke-test")
    print(f"✓ 成功: {out_dir / Path(result).name}" if result else "✗ 失败，看上面日志（服务端原文已打出来）")
