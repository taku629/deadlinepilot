from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class SourceIn(BaseModel):
    type: str = Field(pattern="^(url|email)$")
    url: str | None = None
    raw_text: str | None = None


class Deadline(BaseModel):
    id: str = ""
    title: str
    deadline_local: str = ""          # as written in the source
    source_tz: str = "UTC"
    deadline_utc: str = ""
    deadline_jst: str = ""
    action_required: str = ""
    url: str | None = None
    source_id: str | None = None
    confidence: float = 0.5
    status: str = "active"            # active | needs_review | passed | conflict
    notes: str = ""
    created_at: str = ""
    updated_at: str = ""


class ExtractionItem(BaseModel):
    title: str
    deadline_local: str = Field(description="Deadline exactly as written in the text (ISO or 'YYYY-MM-DD HH:MM')")
    source_tz: str = Field(description="Timezone token: JST, UTC, AoE, PT, ET, CET, KST etc. 'AoE' for 'Anywhere on Earth'")
    action_required: str = Field(default="", description="What the user must do (register, submit, pay, ...)")
    url: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionResult(BaseModel):
    deadlines: list[ExtractionItem]


class InjectionVerdict(BaseModel):
    is_injection: bool
    reason: str
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)


class Proposal(BaseModel):
    id: str = ""
    kind: str                       # ics_event | reminder | review_flag
    title: str
    detail: str = ""
    deadline_id: str | None = None
    payload: dict = {}
    status: str = "pending"         # pending | approved | rejected
    created_at: str = ""
    decided_at: str = ""


class RunStep(BaseModel):
    seq: int
    kind: str                       # tool_call | tool_result | model | security | info | error
    name: str = ""
    summary: str = ""
    detail: dict = {}
    latency_ms: int = 0
    ts: str = ""


class Run(BaseModel):
    id: str = ""
    user_id: str = ""
    status: str = "running"         # running | success | error
    goal: str = ""
    started_at: str = ""
    ended_at: str = ""
    steps: list[RunStep] = []
    tool_calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    est_cost_usd: float = 0.0
    injection_detections: int = 0
    error: str = ""
