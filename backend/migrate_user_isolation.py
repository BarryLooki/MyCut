"""
轻量迁移：补齐 scripts.user_id，并处理「无主数据」（user_id IS NULL）。

背景：
1. `scripts` 表加了 user_id 列（文案库按用户隔离），但 SQLAlchemy 的
   `create_all` 只建缺失的表、不给已存在的表加列，已有库要手动补。
2. 早期 `/api/v1/compose/from-script` 建项目时没带 user_id，这些成片项目
   user_id 为空；而项目列表曾把「user_id IS NULL」当公共数据放行，
   导致任何账号登录后都能看见彼此的成片。放行已去掉，但库里的无主数据
   需要一次性归属，否则谁都看不到（数据还在，只是不再露给别人）。

用法（在项目根目录）：
    source venv/bin/activate
    export PYTHONPATH="${PWD}:${PYTHONPATH}"

    # 先看看有多少无主数据、都有哪些用户
    python -m backend.migrate_user_isolation --dry-run

    # 把无主数据认领给某个用户（user_id 可在 /admin 后台用户列表里看到）
    python -m backend.migrate_user_isolation --owner <supabase-user-id>

    # 不指定 --owner 时归属到 LOCAL_USER_ID（本地单机用户），
    # 效果是「保留数据，但任何线上账号都看不到」
    python -m backend.migrate_user_isolation

幂等：列已存在时跳过建列；没有无主数据时什么都不做。
"""

import argparse
import logging

from sqlalchemy import text

from backend.core.auth import LOCAL_USER_ID
from backend.core.database import engine
from backend.core.schema_migrations import (
    OWNED_TABLES,
    column_exists,
    ensure_user_id_column,
    table_exists,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("migrate_user_isolation")


def report(table: str) -> int:
    """打印该表的归属分布，返回无主行数。"""
    if not column_exists(table, "user_id"):
        return 0
    with engine.connect() as conn:
        orphans = conn.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE user_id IS NULL")
        ).scalar_one()
        rows = conn.execute(
            text(
                f"SELECT user_id, COUNT(*) AS n FROM {table} "
                "WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY n DESC"
            )
        ).all()
    logger.info("%s：无主(user_id IS NULL) %d 行", table, orphans)
    for user_id, n in rows:
        logger.info("  %s → %d 行", user_id, n)
    return orphans


def claim(table: str, owner: str) -> int:
    """把无主行归属给 owner，返回受影响行数。"""
    if not column_exists(table, "user_id"):
        return 0
    with engine.begin() as conn:
        result = conn.execute(
            text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"),
            {"uid": owner},
        )
    return result.rowcount or 0


def main() -> None:
    parser = argparse.ArgumentParser(description="补齐 scripts.user_id 并认领无主数据")
    parser.add_argument(
        "--owner",
        default=LOCAL_USER_ID,
        help=f"无主数据归属到哪个 user_id（默认 {LOCAL_USER_ID}，即线上账号都看不到）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只报告现状，不改数据（仍然会补列，因为补列是安全的）",
    )
    args = parser.parse_args()

    for table in OWNED_TABLES:
        if not table_exists(table):
            logger.info("表 %s 不存在（还没建库？），跳过。", table)
        elif ensure_user_id_column(table):
            logger.info("%s.user_id 已补上。", table)
        else:
            logger.info("%s.user_id 已存在，无需建列。", table)

    logger.info("--- 归属现状 ---")
    orphans = {table: report(table) for table in OWNED_TABLES}
    total = sum(orphans.values())

    if total == 0:
        logger.info("没有无主数据，无需认领。")
        return

    if args.dry_run:
        logger.info(
            "dry-run：共 %d 行无主数据。加 --owner <user_id> 再跑一次即可认领。", total
        )
        return

    logger.info("--- 认领无主数据 → %s ---", args.owner)
    for table in OWNED_TABLES:
        if orphans[table]:
            n = claim(table, args.owner)
            logger.info("%s：%d 行已归属到 %s。", table, n, args.owner)
    logger.info("迁移完成。")


if __name__ == "__main__":
    main()
