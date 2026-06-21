"""Shared runner constants."""
from __future__ import annotations

import os

from backend.paths import PROJECT_ROOT

PPTMASTER = PROJECT_ROOT / "ppt-master"
DATA_DIR = PROJECT_ROOT / "data"
SKIP_EIGHT_CONFIRM_MAX: int = int(os.getenv("SKIP_EIGHT_CONFIRM_MAX", "3"))
AUTO_CONFIRM_TEXT: str = "确认，按你的推荐方案继续生成。"
