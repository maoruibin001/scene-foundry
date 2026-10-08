#!/usr/bin/env python3
"""Explicit subscription route; validation rounds and every attempted execution retain their audit trail."""
import fcntl
import json
import os
from pathlib import Path
import runpy
import shutil
import sys
import time


def reserve_subscription(args, env=os.environ):
    control = env.get('PIPELINE_VALIDATION_CONTROL_FILE')
    if not control:
        raise RuntimeError('VALIDATION_BOUNDARY_REQUIRED：订阅执行需要明确授权的验收边界')
    state = json.loads(Path(control).read_text())
    if state.get('enabled') is not True or not isinstance(state.get('rounds'), list):
        raise RuntimeError('VALIDATION_BOUNDARY_INVALID：验收边界无效，不能重置')
    model = args[args.index('--model') + 1] if '--model' in args else None
    if not model or model != state.get('model') or state.get('provider') != 'openai':
        raise RuntimeError('VALIDATION_ROUTE_MISMATCH：订阅模型必须与授权路由一致')
    job_id = env.get('PIPELINE_VALIDATION_JOB_ID')
    preflight = not job_id and env.get('PIPELINE_VALIDATION_PREFLIGHT') == '1'
    row = next((r for r in state['rounds'] if r['jobId'] == job_id), None)
    if not preflight and (not row or row['index'] > state['maxRounds']):
        raise RuntimeError('VALIDATION_ROUND_REQUIRED：执行任务没有已登记的授权轮次')
    ledger = Path(control).with_suffix('.calls.json')
    with ledger.open('a+') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        data = f.read()
        audit = json.loads(data) if data else {'batchId': state['id'], 'attempts': []}
        if audit.get('batchId') != state['id'] or not isinstance(audit.get('attempts'), list):
            raise RuntimeError('VALIDATION_CALL_LEDGER_INVALID：调用账本损坏，不能重置')
        if preflight and sum(a.get('kind') == 'route-preflight' for a in audit['attempts']) >= state.get('maxPreflightCalls', 0):
            raise RuntimeError('VALIDATION_PREFLIGHT_LIMIT：已达到本批最小路由验证上限')
        entry = {'index': len(audit['attempts']) + 1, 'pid': os.getpid(), 'startedAt': time.time(), 'cwd': os.getcwd(), 'batchId': state['id'], 'kind': 'route-preflight' if preflight else 'validation', 'jobId': job_id or None, 'round': row['index'] if row else None, 'role': env.get('PIPELINE_VALIDATION_ROLE'), 'model': model, 'provider': 'openai', 'authentication': 'chatgpt-subscription'}
        # Global history is authoritative and append-only; local failures never erase it.
        global_reserve = runpy.run_path(str(Path(__file__).with_name('candidate-codex.py')))['reserve']
        global_reserve(metadata={k: entry[k] for k in ('batchId', 'kind', 'jobId', 'round', 'role', 'model', 'provider', 'authentication')})
        audit['attempts'].append(entry)
        f.seek(0); f.truncate(); json.dump(audit, f, ensure_ascii=False, indent=2); f.flush(); os.fsync(f.fileno())
        return entry


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('exec', 'app-server', 'login'):
        raise RuntimeError('入口只支持管线执行、读取配置与登录状态')
    executable = shutil.which('codex')
    if not executable:
        raise RuntimeError('未找到当前订阅 Codex CLI')
    if args[0] == 'exec':
        reserve_subscription(args)
    os.execv(executable, [executable, '--no-daemon', '-c', 'model_provider="openai"', *args])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
