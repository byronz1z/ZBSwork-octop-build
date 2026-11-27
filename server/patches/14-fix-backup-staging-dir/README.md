# 14 · 备份与恢复临时暂存目录可配置化（消除 `/tmp` 峰值，可上游提交）

| 项 | 内容 |
|---|---|
| 层级 | L3 核心补丁（共 5 个文件：官方源码 4 个 + 新增单测 1 个） |
| 状态 | enabled |
| 实测 | v1.0.2：`pytest tests/unit/backup/test_staging_dir.py` 5/5 通过；`check_ownership.py`、`brand_check.py --self`、`prepare.py --check-only`、`prepare_lf.py` 全部退出码 0 |
| 上游 PR | 是——官方标准可配置设计（零硬编码宿主机路径），可向官方上游提交；上游合入对应修复后可退役 |
| 依据 | 指挥部任务 ZT-040（PR 5：`task/ZT-040-auth-backup-fix`） |

## 为什么要这个模块

官方 `auto.py`、`routers/backup.py`、`system_archive.py` 均使用无参 `tempfile.TemporaryDirectory()` / `tempfile.mkstemp()`，默认写入容器 `/tmp`（往往位于小容量根分区 SSD，实测打包峰值可达 25.8GB），既存在撑爆系统盘风险，又在跨文件系统落盘到 `backups_dir` 时触发整包 `shutil.copy2` 翻倍写放大而无法 `rename` 原子移动。

## 改动清单

- `src/octop/infra/backup/store.py`：
  - 新增 `BACKUP_STAGING_DIR_ENV = "OCTOP_BACKUP_STAGING_DIR"` 与 `backup_staging_dir(paths: PathLayout | None = None) -> Path | None`；
  - 优先级：① 环境变量 `OCTOP_BACKUP_STAGING_DIR`（非空时，展开 `~`）；② `paths.backups_dir / ".staging"`（自动创建并 `0o700` 授权，与目标归档同盘支持原子移动，且 `list_backup_files()` 天然跳过子目录）；③ 两者皆无时返回 `None` 保持系统默认 temp 目录；零硬编码宿主机路径。
- `src/octop/infra/backup/auto.py`：`create_and_store_auto_backup` 的 `TemporaryDirectory` 改用 `dir=backup_staging_dir(paths)`。
- `src/octop/api/routers/backup.py`：`_create_and_store_manual_backup` 的 `TemporaryDirectory` 与 `_create_ephemeral_backup` 的 `mkstemp` 均改用 `dir=backup_staging_dir(paths)`。
- `src/octop/infra/backup/system_archive.py`：`create_system_backup` 与 `restore_system_backup` 的 `TemporaryDirectory` 均改用 `dir=backup_staging_dir(paths)`。
- `tests/unit/backup/test_staging_dir.py`：覆盖 `OCTOP_BACKUP_STAGING_DIR` 覆盖优先级、默认 `.staging` 派生与 `0o700` 权限、两者皆无返回 `None`、以及 auto/manual/export/create/restore 全路径不写系统 `/tmp`。

## 退役条件

上游官方合入可配置备份暂存目录（`OCTOP_BACKUP_STAGING_DIR` / `backups_dir/.staging`）后，经验证等价即可退役（编号 14 不再复用）。
