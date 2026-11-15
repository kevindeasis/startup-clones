"""Mock insurance verification against the fictional payer_directory (the 'clearinghouse')."""
import json

from . import config

LOW_MAX = 200


def _norm(s: str) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def verify(conn, payer: str, member_id: str, dob: str, patient_id: int | None = None, source: str = "ai") -> dict:
    now = config.now().isoformat(timespec="seconds")
    row = None
    for r in conn.execute("SELECT * FROM payer_directory"):
        if _norm(r["payer"]) == _norm(payer) and _norm(r["member_id"]) == _norm(member_id) and r["dob"] == dob:
            row = r
            break
    if row is None:
        result = {
            "eligible": False, "found": False, "payer": payer, "member_id": member_id, "plan_name": None,
            "in_network": None, "annual_max": None, "remaining_max": None, "coverage": None, "copay_notes": None,
            "flags": ["member_not_found"],
        }
    else:
        cov = json.loads(row["coverage_json"] or "{}")
        flags = []
        eligible = row["status"] == "active"
        if not eligible:
            flags.append("inactive_member")
        if not row["in_network"]:
            flags.append("out_of_network")
        if eligible and row["remaining_max"] is not None and row["remaining_max"] < LOW_MAX:
            flags.append("low_remaining_max")
        if cov.get("waiting_period"):
            flags.append("waiting_period")
        result = {
            "eligible": eligible, "found": True, "payer": row["payer"], "member_id": row["member_id"],
            "plan_name": row["plan_name"], "in_network": bool(row["in_network"]),
            "annual_max": row["annual_max"], "remaining_max": row["remaining_max"],
            "coverage": {k: cov.get(k) for k in ("preventive", "basic", "major")},
            "copay_notes": cov.get("copay_notes"), "waiting_period": cov.get("waiting_period"), "flags": flags,
            "status": row["status"],
        }
    conn.execute(
        "INSERT INTO insurance_checks(patient_id,payer,member_id,eligible,source,created_at) VALUES (?,?,?,?,?,?)",
        (patient_id, payer, member_id, int(result["eligible"]), source, now),
    )
    if patient_id is not None and row is not None:
        plan = conn.execute("SELECT id FROM insurance_plans WHERE patient_id=? AND lower(payer)=lower(?)", (patient_id, row["payer"])).fetchone()
        vals = (row["status"], row["plan_name"], row["in_network"], row["annual_max"], row["remaining_max"],
                row["coverage_json"], json.dumps(result["flags"]), now)
        if plan:
            conn.execute(
                """UPDATE insurance_plans SET member_id=?, status=?, plan_name=?, in_network=?, annual_max=?, remaining_max=?,
                   coverage_json=?, flags_json=?, verified_at=? WHERE id=?""",
                (row["member_id"],) + vals + (plan["id"],))
        else:
            conn.execute(
                """INSERT INTO insurance_plans(patient_id,payer,member_id,status,plan_name,in_network,annual_max,remaining_max,
                   coverage_json,flags_json,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (patient_id, row["payer"], row["member_id"]) + vals)
    conn.commit()
    result["verified_at"] = now
    return result
