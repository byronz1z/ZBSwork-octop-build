## 关联任务
Closes #

## 改了什么（模块 id）
- 

## 模块隔离自查（总体方案 §5，必填）
- [ ] 只改了本 PR 所属模块的目录（`patches/<模块>/` 或 `brand/`），没有顺手改别的模块
- [ ] 没有修改上游源码副本以外的生产配置、密钥、证书（密钥一律 `[REDACTED]`）
- [ ] 如需与其他模块共改同一上游文件：已在 `modules.yaml` 的 `shared_files` 登记主人（owner）与理由
- [ ] `tools/check_ownership.py` 通过（CI 同款）
- [ ] 没有引用已退役模块（20 / 50 / 51 / brand/legacy）或归档 tag 中的代码

## 证据（必填，没有证据不验收）
- [ ] `tools/prepare.py` 在锁定 tag 上通过（贴最后 3 行输出或 CI 链接）
- [ ] `brand/check.py` CLEAN
- [ ] 相关验收脚本输出：
- [ ] `modules.yaml` 已更新（状态 / verified / 说明）

## 未做 / 风险
- 