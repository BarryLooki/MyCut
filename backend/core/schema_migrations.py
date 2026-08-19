"""轻量列迁移（幂等，启动时自动跑）。

`Base.metadata.create_all` 只建「缺失的表」，不会给已存在的表加新列。
所以给老表加列（如 projects.user_id / scripts.user_id）必须显式 ALTER，
否则线上库一查新列就 `no such column`。

这里只做「加列 + 建索引」这类绝对安全的操作，不改任何数据。
需要动数据的迁移（如认领无主数据）放在 `backend/migrate_user_isolation.py`，手动执行。
"""

import logging
from typing import List

from sqlalchemy import inspect, text

from .database import engine

logger = logging.getLogger(__name__)

# 需要按用户隔离的表：都要有一个 nullable 的 user_id 列
OWNED_TABLES = ("projects", "scripts")


def table_exists(table: str) -> bool:
    return table in inspect(engine).get_table_names()


def column_exists(table: str, column: str) -> bool:
    if not table_exists(table):
        return False
    return any(col["name"] == column for col in inspect(engine).get_columns(table))


def ensure_user_id_column(table: str) -> bool:
    """给表补 user_id 列 + 索引。已存在则什么都不做，返回是否真的加了列。"""
    if not table_exists(table) or column_exists(table, "user_id"):
        return False

    logger.info("正在给 %s 表添加 user_id 列 ...", table)
    with engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR(64)"))
        conn.execute(
            text(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table} (user_id)")
        )
    logger.info("%s.user_id 已添加。", table)
    return True


def ensure_owner_columns() -> List[str]:
    """确保所有需要隔离的表都有 user_id 列，返回本次实际加了列的表名。"""
    return [t for t in OWNED_TABLES if ensure_user_id_column(t)]
