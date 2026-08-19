"""文案持久化 CRUD（阶段: 文案保存）。

按用户隔离：所有方法都收一个可选的 user_id。
- user_id 为 None：不做归属校验（未开启认证的本地模式、或后台任务内部调用）。
- user_id 有值：只能看到/改到自己的文案；归属为空的老文案也看不到
  （跑 `python -m backend.migrate_user_isolation --owner <user_id>` 认领）。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..models.script import Script


def _to_dict(s: Script) -> Dict[str, Any]:
    return {
        "id": s.id,
        "title": s.title,
        "domain": s.domain,
        "angle": s.angle,
        "target_audience": s.target_audience,
        "keywords": s.keywords or [],
        "outline": s.outline or {"hook": "", "sections": [], "cta": ""},
        "segments": s.segments or [],
        "style": s.style,
        "est_duration": s.est_duration,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


class ScriptRepo:
    def __init__(self, db: Session):
        self.db = db

    def create(self, data: Dict[str, Any], user_id: Optional[str] = None) -> Dict[str, Any]:
        s = Script(
            user_id=user_id,
            title=data.get("title", "未命名文案"),
            domain=data.get("domain"),
            angle=data.get("angle"),
            target_audience=data.get("target_audience"),
            keywords=data.get("keywords") or [],
            outline=data.get("outline") or {},
            segments=data.get("segments") or [],
            style=data.get("style"),
            est_duration=data.get("est_duration"),
        )
        self.db.add(s)
        self.db.commit()
        self.db.refresh(s)
        return _to_dict(s)

    def list(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = self.db.query(Script)
        if user_id is not None:
            query = query.filter(Script.user_id == user_id)
        rows = query.order_by(Script.updated_at.desc()).all()
        return [_to_dict(s) for s in rows]

    def _get_owned(self, script_id: str, user_id: Optional[str]) -> Optional[Script]:
        """按归属取 ORM 对象；不属于该用户时返回 None（对外等价 404）。"""
        s = self.db.query(Script).filter(Script.id == script_id).first()
        if not s:
            return None
        if user_id is not None and s.user_id != user_id:
            return None
        return s

    def get(self, script_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        s = self._get_owned(script_id, user_id)
        return _to_dict(s) if s else None

    def update(
        self,
        script_id: str,
        data: Dict[str, Any],
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        s = self._get_owned(script_id, user_id)
        if not s:
            return None
        for field in ("title", "domain", "angle", "target_audience", "keywords",
                      "outline", "segments", "style", "est_duration"):
            if field in data and data[field] is not None:
                setattr(s, field, data[field])
        self.db.commit()
        self.db.refresh(s)
        return _to_dict(s)

    def delete(self, script_id: str, user_id: Optional[str] = None) -> bool:
        s = self._get_owned(script_id, user_id)
        if not s:
            return False
        self.db.delete(s)
        self.db.commit()
        return True
