"""Phase 2 路径工具。

所有 per-user 数据的根：`<PROJECT_ROOT>/data/users/<user_id>/`
  - uploads/<job_id>/<filename>  原始上传
  - projects/<job_id>/           该 job 的 project_root（agent init --dir 指向这里）
    - <name>_<format>_<date>/    ← 实际产物目录（直接建在 project_root 下）
    - projects/<name>_.../      ← 部分环境可能多一层 projects/，resolve 两处都查
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

# 项目的根（ppt-web/）
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
USERS_DIR = DATA_DIR / "users"

# 上传/项目根：保留扩展名，unicode 归一化为 ASCII（解决 macOS NFD vs NFC）。
# 安全字符集：ASCII 字母数字 + . _ -
_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]")


def _safe_token(s: str, max_len: int = 80) -> str:
    """把任意字符串归一化为安全的文件系统 token。

    - NFD 分解后丢变音符（NFC 测试用例：café.png → cafe.png）
    - 非 [A-Za-z0-9._-] 替换为 _
    - 收尾的点/下划线剥掉
    - 限长 max_len（避免 PATH_MAX 溢出）
    - 空字符串兜底 "file"
    """
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = _SAFE_RE.sub("_", s)
    s = s.strip("._-") or "file"
    return s[:max_len]


def user_dir(user_id: str) -> Path:
    return USERS_DIR / user_id


def uploads_dir_for(user_id: str, job_id: str) -> Path:
    return user_dir(user_id) / "uploads" / job_id


def project_root_for(user_id: str, job_id: str) -> Path:
    """per-user project root。agent 用 `init <name> --dir <这里>`。

    产物目录通常为 `<root>/<name>_<format>_<date>/`（见 resolve_project_dir）。
    """
    return user_dir(user_id) / "projects" / job_id


def ensure_data_dirs(user_id: str, job_id: str) -> None:
    """建好 uploads/<job_id> 与 projects/<job_id>。"""
    uploads_dir_for(user_id, job_id).mkdir(parents=True, exist_ok=True)
    project_root_for(user_id, job_id).mkdir(parents=True, exist_ok=True)


def safe_stage_name(filename: str) -> str:
    """给上传文件生成安全的 staged 文件名：保扩展名 + 限长。

    例：'My Report (final).PDF' → 'My_Report__final_.PDF'
    """
    p = Path(filename)
    stem = _safe_token(p.stem, max_len=60)
    ext = _safe_token(p.suffix.lstrip("."), max_len=10)
    return f"{stem}.{ext}" if ext else stem


def is_under(child: Path, parent: Path) -> bool:
    """child 路径是否在 parent 之下（已 resolve 防 symlink 越界）。"""
    try:
        child_r = child.resolve()
        parent_r = parent.resolve()
    except (OSError, ValueError):
        return False
    try:
        child_r.relative_to(parent_r)
        return True
    except ValueError:
        return False
