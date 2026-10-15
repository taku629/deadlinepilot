import os


def _split_csv(v: str) -> list[str]:
    return [s.strip() for s in v.split(",") if s.strip()]


class Settings:
    # GCP
    gcp_project: str = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    gcp_location: str = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    use_vertexai: bool = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "true").lower() == "true"
    # Local-dev fallback only: an AI Studio API key can exercise the same
    # models without Vertex AI (production always uses Vertex).
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
    use_firestore: bool = os.environ.get("USE_FIRESTORE", "true").lower() == "true"

    # Models
    planner_model: str = os.environ.get("PLANNER_MODEL", "gemini-2.5-flash")
    extractor_model: str = os.environ.get("EXTRACTOR_MODEL", "gemini-2.5-flash")
    classifier_model: str = os.environ.get("CLASSIFIER_MODEL", "gemini-2.5-flash-lite")

    # Agent governance limits
    max_tool_calls: int = int(os.environ.get("MAX_TOOL_CALLS", "20"))
    max_total_tokens: int = int(os.environ.get("MAX_TOTAL_TOKENS", "200000"))
    run_timeout_seconds: int = int(os.environ.get("RUN_TIMEOUT_SECONDS", "240"))
    max_untrusted_chars: int = int(os.environ.get("MAX_UNTRUSTED_CHARS", "24000"))
    max_fetch_chars: int = int(os.environ.get("MAX_FETCH_CHARS", "16000"))

    # Security
    session_secret: str = os.environ.get("SESSION_SECRET", "dev-insecure-secret-change-me")
    allowed_domains: list[str] = None  # type: ignore
    frontend_origin: str = os.environ.get("FRONTEND_ORIGIN", "*")
    # The API's own public URL. Its host is allowlisted so the watcher can
    # crawl the built-in demo "organizer page" (/demo/notice/...).
    public_base_url: str = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    # Shared secret Cloud Scheduler sends to POST /api/cron/watch.
    cron_token: str = os.environ.get("CRON_TOKEN", "")
    watch_interval_label: str = os.environ.get("WATCH_INTERVAL_LABEL", "6時間ごと")

    # Approximate USD prices per 1M tokens (input, output) for cost display
    price_table: dict = None  # type: ignore

    def __init__(self):
        self.allowed_domains = _split_csv(os.environ.get(
            "ALLOWED_DOMAINS",
            "kaggle.com,www.kaggle.com,atcoder.jp,zenn.dev,connpass.com,devpost.com,"
            "topcoder.com,signate.jp,eval.ai,aicrowd.com,numer.ai,gihyo.jp,cloud.google.com,"
            "developers.googleblog.com,hackzine.jp,localhost,127.0.0.1",
        ))
        # Approximate public prices (USD / 1M tokens). Used only for the cost
        # estimate shown in the trace UI; not for billing.
        self.price_table = {
            "gemini-2.5-flash": (0.30, 2.50),
            "gemini-2.5-flash-lite": (0.10, 0.40),
        }


settings = Settings()
