"""
视频画面提示词服务（自动成片空镜素材路线，旁路模块）。

把一句中文口播 → **英文画面提示词** + 该句是否值得配画面 + **这句该用哪种画面风格**。
复用现有 DeepSeek(LLMClient)。异常或不合法时返回 visual=False（该句回退到信息动画/静图，
不浪费生成额度、不中断成片）。

风格（visual_style）两种，由 LLM 在**同一次调用**里判（不额外花钱）：
    live     实拍空镜——这句指向真实世界拍得到的场景/物体/动作 → MiniMax H3 文生视频
    collage  半调纸拼贴——这句讲抽象关系（对比/流程/机制/数量）→ collage_service 组装动画
判定规则与两种写法都在 prompt/视频提示词.txt 里；这里只做校验与兜底。

VIDEO_PROVIDER=mixed 时 compose_service 按这个字段逐句分流；配成单一 provider 时该字段被忽略
（整条都用那个 provider），所以这里永远给出 visual_style，不管当前配的是哪种模式。

产物交给 video_provider.generate_clip 去生成视频。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from ..utils.llm_client import LLMClient

logger = logging.getLogger(__name__)

_PROMPT_DIR = Path(__file__).parent.parent.parent / "prompt"
_VIDEO_PROMPT = _PROMPT_DIR / "视频提示词.txt"

# 无论 LLM 怎么写，都强制并上这些负向约束。允许人以背影/剪影/局部出现（隐喻镜头需要），
# 但禁清晰人脸和文字/水印（人脸易崩、文字与后期字幕冲突）。
# ⚠ 只对 live 生效：拼贴的负向约束由 collage_service._still_prompt 的 Avoid 行给，
#   而且拼贴**允许**黑白半调人物剪影（skill 的骨架就是它），并上 no faces 会把画面废掉。
_REQUIRED_NEG = "no faces, no text, no watermark, no subtitles"

# 画面风格白名单。LLM 给别的值/没给 → 按 live 处理（默认行为与加这个字段前一致）。
_STYLE_LIVE = "live"
_STYLE_COLLAGE = "collage"
_STYLES = {_STYLE_LIVE, _STYLE_COLLAGE}
_MOTIONS = {
    "slow push in", "slow pull back", "aerial drone",
    "slow pan left", "slow pan right", "static locked-off", "handheld drift",
}


def _read_prompt(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        logger.error("加载视频提示词模板失败(%s): %s", path, e)
        return fallback


class VideoPromptService:
    def __init__(self) -> None:
        self.llm = LLMClient()
        self._prompt = _read_prompt(
            _VIDEO_PROMPT,
            "把这句中文口播转成一段英文实拍空镜提示词，输出 JSON："
            '{"visual":true,"visual_style":"live","prompt":"...","motion":"slow push in"}。'
            "画面必须 no people, no faces, no text, no watermark。",
        )

    def build(self, sentence: str, role: str = "body", context_title: str = "", style: str = "") -> Dict[str, Any]:
        """
        一句口播 → {visual: bool, visual_style: 'live'|'collage', prompt: str, motion: str}。
        任何异常都降级为 visual=False（该句不配空镜素材，不抛）。
        """
        sentence = (sentence or "").strip()
        if not sentence:
            return {"visual": False, "visual_style": _STYLE_LIVE, "prompt": "",
                    "motion": "static locked-off"}
        try:
            input_data = {
                "sentence": sentence,
                "role": role,
                "context_title": context_title,
                "style": style,
            }
            response = self.llm.call_with_retry(self._prompt, input_data)
            parsed = self.llm.parse_json_response(response)
            result = self._normalize(parsed)
            # 目标是「尽量每句都实拍」：LLM 若判了 false 或没给出 prompt，只要句子有实质内容
            # （不是纯语气/连接词），就用通用氛围空镜兜底，不轻易放弃。
            if not result["visual"] and self._worth_visual(sentence):
                return self._fallback_visual(sentence, context_title)
            return result
        except Exception as e:  # noqa: BLE001
            logger.warning("视频提示词生成异常，用氛围空镜兜底(%s): %s", sentence[:30], e)
            return self._fallback_visual(sentence, context_title)

    # 纯语气/连接/过场词——这些提不出意象，才真正不配实拍
    _SKIP_WORDS = {
        "那么", "接下来", "然后", "好", "好的", "其次", "另外", "所以", "因此",
        "首先", "最后", "总之", "对吧", "是吧", "没错", "对", "嗯",
    }

    def _worth_visual(self, sentence: str) -> bool:
        """句子是否值得配画面：去掉标点后有一定长度、且不是纯语气/连接词。"""
        core = sentence.strip().rstrip("。！？；，、,.!?; ")
        if len(core) < 4:
            return False
        return core not in self._SKIP_WORDS

    def _fallback_visual(self, sentence: str, context_title: str) -> Dict[str, Any]:
        """通用氛围空镜兜底：不针对具体语义，但保证这句有一个电影级实拍画面可用。

        兜底一律走 live：这段文字是写死的摄影描述，喂给拼贴模板会出一张"照片风"的怪图。
        """
        prompt = (
            "Cinematic atmospheric establishing shot with soft cinematic lighting and gentle "
            "drifting particles of light, moody documentary tone, shallow depth of field, "
            "film grain, " + _REQUIRED_NEG
        )
        return {"visual": True, "visual_style": _STYLE_LIVE, "prompt": prompt,
                "motion": "slow push in"}

    def _normalize(self, parsed: Any) -> Dict[str, Any]:
        """校验并规整 LLM 输出：visual/visual_style/prompt/motion，live 句强制并上负向约束。"""
        if isinstance(parsed, list):
            parsed = parsed[0] if parsed and isinstance(parsed[0], dict) else {}
        if not isinstance(parsed, dict):
            return {"visual": False, "visual_style": _STYLE_LIVE, "prompt": "",
                    "motion": "static locked-off"}

        visual = bool(parsed.get("visual", False))
        prompt = str(parsed.get("prompt") or "").strip()
        motion = str(parsed.get("motion") or "").strip().lower()
        if motion not in _MOTIONS:
            motion = "slow push in"
        # 认不出的风格值按 live 处理：加这个字段之前整条都是实拍，保持那个默认最安全
        visual_style = str(parsed.get("visual_style") or "").strip().lower()
        if visual_style not in _STYLES:
            visual_style = _STYLE_LIVE

        if not visual or not prompt:
            return {"visual": False, "visual_style": visual_style, "prompt": "", "motion": motion}

        # 强制补齐负向约束（LLM 漏写时兜底），避免画面出现人脸/文字/水印。
        # 拼贴句跳过：它的提示词是"视觉命题 + 物件清单"，负向约束由拼贴模板统一给。
        if visual_style == _STYLE_LIVE:
            lower = prompt.lower()
            missing = [w for w in _REQUIRED_NEG.split(", ") if w not in lower]
            if missing:
                prompt = prompt.rstrip(" .,") + ", " + ", ".join(missing)

        return {"visual": True, "visual_style": visual_style, "prompt": prompt, "motion": motion}


_service: VideoPromptService | None = None


def get_video_prompt_service() -> VideoPromptService:
    global _service
    if _service is None:
        _service = VideoPromptService()
    return _service
