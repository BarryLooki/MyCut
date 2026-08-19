"""按用户隔离的回归测试（项目 + 文案）。

盯的是这个真实故障：文案一键成片建的项目 user_id 为空，而列表查询把
「user_id IS NULL」当公共数据放行，结果任何账号登录后都能看见别人的成片。
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.models.base import Base
from backend.models.project import Project, ProjectStatus, ProjectType
from backend.schemas.base import PaginationParams
from backend.schemas.project import ProjectCreate
from backend.services.project_service import ProjectService
from backend.services.script_repo import ScriptRepo

USER_A = "user-aaaa"
USER_B = "user-bbbb"


@pytest.fixture
def db():
    """内存 SQLite 会话（真表结构，不 mock）。"""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _new_project(service: ProjectService, name: str, user_id=None) -> Project:
    return service.create_project(
        ProjectCreate(
            name=name,
            description=None,
            project_type=ProjectType.KNOWLEDGE,
            status=ProjectStatus.PENDING,
            source_url=None,
            source_file=None,
            settings={},
        ),
        user_id=user_id,
    )


def _list_names(service: ProjectService, user_id):
    result = service.get_projects_paginated(
        PaginationParams(page=1, size=50), None, user_id=user_id
    )
    return {p.name for p in result.items}


class TestProjectIsolation:
    def test_user_only_sees_own_projects(self, db):
        service = ProjectService(db)
        _new_project(service, "A 的项目", user_id=USER_A)
        _new_project(service, "B 的项目", user_id=USER_B)

        assert _list_names(service, USER_A) == {"A 的项目"}
        assert _list_names(service, USER_B) == {"B 的项目"}

    def test_orphan_project_is_not_public(self, db):
        """无主项目（user_id IS NULL）不能露给任何登录用户——就是本次修的洞。"""
        service = ProjectService(db)
        orphan = _new_project(service, "无主成片", user_id=None)

        assert _list_names(service, USER_A) == set()
        assert service.get_owned(str(orphan.id), USER_A) is None
        # 未开启认证（user_id=None）时不做归属校验，本地单机照常可见
        assert _list_names(service, None) == {"无主成片"}
        assert service.get_owned(str(orphan.id), None) is not None

    def test_cannot_open_or_delete_others_project(self, db):
        service = ProjectService(db)
        p = _new_project(service, "A 的项目", user_id=USER_A)

        assert service.get_owned(str(p.id), USER_B) is None
        assert service.get_project_with_stats(str(p.id), user_id=USER_B) is None
        assert service.delete_project_with_files(str(p.id), user_id=USER_B) is False
        # 本人仍然能拿到
        assert service.get_owned(str(p.id), USER_A) is not None


class TestScriptIsolation:
    def test_user_only_sees_own_scripts(self, db):
        repo = ScriptRepo(db)
        repo.create({"title": "A 的文案"}, user_id=USER_A)
        repo.create({"title": "B 的文案"}, user_id=USER_B)

        assert [s["title"] for s in repo.list(user_id=USER_A)] == ["A 的文案"]
        assert [s["title"] for s in repo.list(user_id=USER_B)] == ["B 的文案"]

    def test_orphan_script_is_not_public(self, db):
        repo = ScriptRepo(db)
        orphan = repo.create({"title": "无主文案"}, user_id=None)

        assert repo.list(user_id=USER_A) == []
        assert repo.get(orphan["id"], user_id=USER_A) is None
        # 不带 user_id（本地模式 / 后台任务内部调用）仍可读
        assert repo.get(orphan["id"]) is not None

    def test_cannot_read_update_delete_others_script(self, db):
        repo = ScriptRepo(db)
        s = repo.create({"title": "A 的文案"}, user_id=USER_A)

        assert repo.get(s["id"], user_id=USER_B) is None
        assert repo.update(s["id"], {"title": "被改了"}, user_id=USER_B) is None
        assert repo.delete(s["id"], user_id=USER_B) is False
        # 内容没被动，且本人能改
        assert repo.get(s["id"], user_id=USER_A)["title"] == "A 的文案"
        assert repo.update(s["id"], {"title": "改好了"}, user_id=USER_A)["title"] == "改好了"
        assert repo.delete(s["id"], user_id=USER_A) is True
