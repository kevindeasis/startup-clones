"""Analytics for the last 30 days."""
from datetime import timedelta

from . import config


def compute(conn) -> dict:
    since = (config.now() - timedelta(days=30)).isoformat(timespec="seconds")
    q = lambda sql, p=(): conn.execute(sql, p).fetchone()[0]
    return {
        "window_days": 30,
        "calls_handled": q("SELECT COUNT(*) FROM conversations WHERE channel='inbound' AND started_at >= ?", (since,)),
        "ai_bookings": q("SELECT COUNT(*) FROM appointments WHERE source IN ('ai_inbound','ai_recall') AND created_at >= ?", (since,)),
        "reschedules": q("SELECT COUNT(*) FROM conversations WHERE outcome='rescheduled' AND started_at >= ?", (since,)),
        "cancellations": q("SELECT COUNT(*) FROM conversations WHERE outcome='cancelled' AND started_at >= ?", (since,)),
        "insurance_verifications": q("SELECT COUNT(*) FROM insurance_checks WHERE created_at >= ?", (since,)),
        "messages_taken": q("SELECT COUNT(*) FROM messages_taken WHERE created_at >= ?", (since,)),
        "recall_sent": q("SELECT COUNT(*) FROM recall_outreach WHERE sent_at >= ?", (since,)),
        "recall_booked": q("SELECT COUNT(*) FROM recall_outreach WHERE status='booked' AND sent_at >= ?", (since,)),
    }
