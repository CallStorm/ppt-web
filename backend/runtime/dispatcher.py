"""Job dispatcher and async run/resume entrypoints."""
from __future__ import annotations

import asyncio
import logging
import threading

from backend.api.schemas.job_options import parse_job_options
from backend.config import get_runtime_config
from backend.db.session import SessionLocal, init_db
from backend.models import Job as DbJob
from backend.models import User
from backend.paths import project_root_for
from backend.runner.docker import check_docker_runner_ready
from backend.runner.errors import humanize_error
from backend.runtime import state
from backend.runtime.events import _enqueue_event, _event_to_db_payload
from backend.runtime.init import init_runtime
from backend.runtime.jobs import _collect_upload_paths, notify_dispatcher
from backend.runtime.queue import active_count, queue_count
from backend.runner.sync import resume_sync, run_sync

log = logging.getLogger("backend.runtime.dispatcher")

def start_dispatcher() -> None:
    init_runtime()
    if state._dispatcher_task is not None and not state._dispatcher_task.done():
        return
    state._dispatcher_task = asyncio.create_task(_dispatcher_loop())
    log.info(
        "dispatcher started (MAX_CONCURRENT_JOBS=%d)",
        get_runtime_config().max_concurrent_jobs,
    )


async def stop_dispatcher() -> None:
    if state._dispatcher_task is None:
        return
    if not state._dispatcher_task.done():
        state._dispatcher_task.cancel()
        try:
            await state._dispatcher_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.warning("dispatcher stop: %s", e)
    state._dispatcher_task = None
    log.info("dispatcher stopped")


async def _dispatcher_loop() -> None:
    """dispatcher 主循环：有空位 + 有 queued job → 拉起下一个。

    唤醒源：
      - notify_dispatcher() 立刻触发
      - 内部 wait_for(event, 2s) 兜底（应对漏 signal / 跨重启场景）
    """
    assert state._dispatcher_event is not None
    log.info("dispatcher loop running")
    while True:
        try:
            await _dispatch_one()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("dispatcher error: %s", e)
        try:
            await asyncio.wait_for(state._dispatcher_event.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
        state._dispatcher_event.clear()


async def _dispatch_one() -> None:
    """有空位就从队列里拉一个 job 启动。

    优先级：
      1. resume job（pending_confirm IS NOT NULL）—— 用户已确认，优先顶上避免长时间等待
      2. 否则 FIFO（按 created_at 升序）

    SQLite 没 NULLS LAST：用 `(pending_confirm IS NULL)` —— False (=NOT NULL) 排在前。
    """
    if active_count() >= get_runtime_config().max_concurrent_jobs:
        return
    with SessionLocal() as s:
        # 优先 resume（pending_confirm 非空），再按 FIFO（同 created_at 用 id 排，保证稳定）。
        # SQLAlchemy 里 (pending_confirm.is_(None)) 编译成 SQLite/MySQL 通用的 IS NULL 表达式，
        # 取反后 pending_confirm 非空 = False 排在前面。
        j = (
            s.query(DbJob)
            .filter(DbJob.status == "queued")
            .order_by(
                DbJob.pending_confirm.is_(None).asc(),
                DbJob.created_at.asc(),
                DbJob.id.asc(),
            )
            .first()
        )
        if not j:
            return
        # 二次确认（防 cancel 抢先、或并发 modify）
        fresh = s.get(DbJob, j.id)
        if not fresh or fresh.status != "queued":
            return
        job_id = fresh.id
        user_id = fresh.user_id
        prompt = fresh.prompt
        project_name = fresh.project_name
        confirm = fresh.pending_confirm  # None 表示新 run；非 None 是 resume
        # 取出后立刻清掉 pending_confirm——避免 dispatch 失败时无限重试同一个 confirm
        if confirm is not None:
            fresh.pending_confirm = None
            s.commit()

    upload_paths = _collect_upload_paths(user_id, job_id)

    if confirm is not None:
        log.info("dispatcher: resume job %s (queue_len=%d, active=%d)",
                 job_id, queue_count(), active_count())
        asyncio.create_task(resume_job(job_id, confirm))
    else:
        log.info("dispatcher: start job %s (queue_len=%d, active=%d)",
                 job_id, queue_count(), active_count())
        asyncio.create_task(run_job(job_id, prompt, project_name, upload_paths=upload_paths))



async def run_job(job_id: str, prompt: str, project_name: str, upload_paths: list[str] | None = None) -> None:
    """后台任务入口：跑一次 ppt-master 生成。

    由 dispatcher 拉起（dispatcher 已经确保 active_count() < MAX_CONCURRENT_JOBS），
    本函数不再 acquire semaphore / 不再排队——信任 dispatcher。

    Phase 2 行为：
      - 从 Job 行读 user_id（run_job 不接受 user_id 参数；HTTP 层已设进 DB）
      - 算 per-user project_root = data/users/<uid>/projects/<job_id>/
      - mkdir -p project_root
      - 把 upload_paths（绝对路径列表）塞进 prompt，让 agent 跑 import-sources --copy
      - 改 status=running（带二次确认防 cancel 抢先）
      - 启动 worker 线程跑 run_sync
      - 完成后写 job 表 + fanout + 通知 dispatcher（让队列下一个顶上）
      - 任何异常 finally 标 failed 并清状态
    """
    init_runtime()

    # 读 Job 拿 user_id → 算 project_root
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j:
            _enqueue_event(job_id, "error", {"message": f"job {job_id} not found"})
            return
        user_id = j.user_id
        job_options = parse_job_options(j.options_json)
        if not user_id:
            _enqueue_event(job_id, "error", {"message": "job has no user_id (legacy?)"})
            return
        project_root = project_root_for(user_id, job_id)

    project_root.mkdir(parents=True, exist_ok=True)

    docker_err = check_docker_runner_ready()
    if docker_err:
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = "failed"
                log.warning("job %s docker not ready raw: %s", job_id, docker_err)
                j.error_message = humanize_error(docker_err)
                if j.user_id:
                    u = s.get(User, j.user_id)
                    if u:
                        u.quota_credits += 1
                s.commit()
        _enqueue_event(job_id, "status", {"status": "failed"})
        _enqueue_event(job_id, "error", {"message": docker_err})
        notify_dispatcher()
        return

    # 二次确认：dispatcher 选出来到真的开跑中间可能被用户取消
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j or j.status == "cancelled":
            return
        if j.status not in ("queued", "running"):
            return
        j.status = "running"
        s.commit()

    state._active_job_ids.add(job_id)
    state._active_proc_holders[job_id] = []
    state._active_cancel_events[job_id] = threading.Event()
    _enqueue_event(job_id, "status", {"status": "running"})

    def on_event(ev: dict) -> None:
        # 同步回调，跑在 worker 线程里。事件入 DB + fanout。
        t = _event_to_db_payload(ev)
        if t is None:
            return
        type_, payload = t
        _enqueue_event(job_id, type_, payload)

    try:
        # 在线程池跑 run_sync
        final = await asyncio.to_thread(
            run_sync, prompt, project_name, project_root, on_event,
            upload_paths=upload_paths,
            cancel_event=state._active_cancel_events[job_id],
            proc_holder=state._active_proc_holders[job_id],
            require_confirm=False,  # 八点确认已禁用，永远不要求确认
            job_id=job_id,
            options=job_options,
        )
        # 写 job 表
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = final["status"]
                j.session_id = final["session_id"]
                j.project_dir = final["project_dir"]
                j.pptx_path = final["pptx_path"]
                j.cost_usd = final["cost_usd"]
                j.error_message = final.get("error_message")
                # 进展检测 bail：refund credit（agent 撒谎 / 空转不是用户的问题）
                if final.get("refund") and j.user_id:
                    u = s.get(User, j.user_id)
                    if u:
                        u.quota_credits += 1
                        log.info("refund 1 credit to user %s (auto-resume bail for job %s)",
                                 j.user_id, job_id)
                s.commit()
        if final.get("pptx_path"):
            _enqueue_event(job_id, "pptx", {"url": f"/api/jobs/{job_id}/pptx"})
    except Exception as e:
        logging.exception("run_job failed")
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = "failed"
                log.warning("job %s runner exception raw: %s", job_id, e)
                j.error_message = humanize_error(f"runner exception: {e}")
                s.commit()
            # runner 异常 refund 1 credit（pre-decrement 的对冲）。
            # 正常 run_sync 返回的 status="failed"（claude 跑完但没出 pptx）不 refund。
            if j and j.user_id:
                u = s.get(User, j.user_id)
                if u:
                    u.quota_credits += 1
        _enqueue_event(job_id, "error", {"message": f"runner exception: {e}"})
    finally:
        state._active_job_ids.discard(job_id)
        state._active_proc_holders.pop(job_id, None)
        state._active_cancel_events.pop(job_id, None)
        # 槽位释放：唤醒 dispatcher 让下一个 queued job 顶上
        notify_dispatcher()


async def resume_job(job_id: str, confirm: str) -> None:
    """后台任务入口：注入确认继续 `--resume <session_id>`。

    由 dispatcher 拉起（dispatcher 已经确保有空位），不再 acquire semaphore。
    接受 job.status in ('paused', 'queued')：dispatcher 路径里 endpoint 已经把
    status 改成 queued；直接调路径里 status 还是 paused。
    """
    init_runtime()

    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j:
            _enqueue_event(job_id, "error", {"message": f"job {job_id} not found"})
            return
        if j.status not in ("paused", "queued"):
            _enqueue_event(job_id, "error", {"message": f"job status is {j.status}, cannot resume"})
            return
        if not j.session_id:
            _enqueue_event(job_id, "error", {"message": "no session_id to resume"})
            return
        if not j.user_id:
            _enqueue_event(job_id, "error", {"message": "job has no user_id"})
            return
        session_id = j.session_id
        project_name = j.project_name
        project_root = project_root_for(j.user_id, job_id)
        j.status = "running"
        s.commit()

    docker_err = check_docker_runner_ready()
    if docker_err:
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = "failed"
                log.warning("job %s docker not ready raw: %s", job_id, docker_err)
                j.error_message = humanize_error(docker_err)
                s.commit()
        _enqueue_event(job_id, "status", {"status": "failed"})
        _enqueue_event(job_id, "error", {"message": docker_err})
        notify_dispatcher()
        return

    state._active_job_ids.add(job_id)
    state._active_proc_holders[job_id] = []
    state._active_cancel_events[job_id] = threading.Event()

    def on_event(ev: dict) -> None:
        t = _event_to_db_payload(ev)
        if t is None:
            return
        type_, payload = t
        _enqueue_event(job_id, type_, payload)

    try:
        final = await asyncio.to_thread(
            resume_sync, session_id, confirm, project_root, project_name, on_event,
            cancel_event=state._active_cancel_events[job_id],
            proc_holder=state._active_proc_holders[job_id],
            job_id=job_id,
        )
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                # cost 累加
                prev_cost = j.cost_usd or 0
                j.status = final["status"]
                j.session_id = final["session_id"] or session_id
                j.project_dir = final["project_dir"] or j.project_dir
                j.pptx_path = final["pptx_path"] or j.pptx_path
                j.cost_usd = prev_cost + (final["cost_usd"] or 0)
                j.error_message = final.get("error_message")
                s.commit()
        if final.get("pptx_path"):
            _enqueue_event(job_id, "pptx", {"url": f"/api/jobs/{job_id}/pptx"})
    except Exception as e:
        logging.exception("resume_job failed")
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = "failed"
                log.warning("job %s resume exception raw: %s", job_id, e)
                j.error_message = humanize_error(f"resume exception: {e}")
                s.commit()
        _enqueue_event(job_id, "error", {"message": f"resume exception: {e}"})
    finally:
        state._active_job_ids.discard(job_id)
        state._active_proc_holders.pop(job_id, None)
        state._active_cancel_events.pop(job_id, None)
        # 槽位释放：唤醒 dispatcher 让下一个顶上
        notify_dispatcher()


