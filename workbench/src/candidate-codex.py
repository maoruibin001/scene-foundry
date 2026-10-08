#!/usr/bin/env python3
"""统一候选的本地 Codex 启动入口。新验收额度须在用户确认后明确配置，旧批次账本保持原样。"""
import fcntl
import json
import os
from pathlib import Path
import shutil
import sys
import time

CONTROL = Path(os.environ.get('PIPELINE_ACCEPTANCE_CONTROL_FILE', Path(__file__).resolve().parents[1] / 'acceptance-control.json'))

def reserve(path=CONTROL, metadata=None):
    if not path.exists():
        raise RuntimeError('ACCEPTANCE_CONFIRMATION_REQUIRED：尚未配置本候选的统一验收')
    with path.open('r+') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        state = json.load(f)
        limit = state.get('maxCalls')
        unlimited = state.get('unlimited') is True and limit is None
        finite = isinstance(limit, int) and not isinstance(limit, bool) and limit > 0 and state.get('unlimited') is not True
        if state.get('enabled') is not True or not (unlimited or finite):
            raise RuntimeError('ACCEPTANCE_CONFIRMATION_REQUIRED：等待用户确认验收及调用上限')
        attempts = state.get('attempts')
        if not isinstance(attempts, list):
            raise RuntimeError('验收账本损坏，不能重置')
        if not unlimited and len(attempts) >= limit:
            raise RuntimeError('MODEL_BUDGET_EXHAUSTED：达到本次确认的统一验收调用上限')
        attempts.append({'index': len(attempts) + 1, 'pid': os.getpid(), 'startedAt': time.time(), 'cwd': os.getcwd(), **(metadata or {})})
        f.seek(0)
        f.truncate()
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())

def command(args):
    if not args or args[0] not in ['exec', 'app-server', 'login']:
        raise RuntimeError('入口只支持管线执行、读取配置与登录状态')
    requested = os.environ.get('PIPELINE_VALIDATION_CODEX_BIN', 'codex')
    executable = shutil.which(requested)
    if not executable:
        raise RuntimeError('未找到配置的本地 Codex CLI：' + requested)
    return [executable, '--no-daemon', *args]

def main():
    args = sys.argv[1:]
    argv = command(args)
    if args[0] == 'exec':
        reserve()
    os.execv(argv[0], argv)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
