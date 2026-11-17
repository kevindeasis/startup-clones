"""Generate a deliberately messy synthetic medical-record bundle (fictional patient) with reportlab.

Usage:  python scripts/make_sample_records.py [output_dir]
Everything here is invented; no real patient data.
"""
import sys
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ST = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=ST["Heading1"], fontSize=15, spaceAfter=6)
FAC = ParagraphStyle("fac", parent=ST["Normal"], fontSize=11, textColor="#333333", spaceAfter=2)
META = ParagraphStyle("meta", parent=ST["Normal"], fontSize=9.5, spaceAfter=8)
BODY = ParagraphStyle("body", parent=ST["Normal"], fontSize=10.5, leading=14, spaceAfter=9)

PATIENT = "Margaret Ellison"
MRN = "MRN 4471002"

ST_MARY = "St. Mary's Regional Medical Center"
RIVERSIDE = "Riverside Rehabilitation Clinic"
GP = "Oakwood Family Practice"


class Page:
    """A page spec: kind in {'doc','blank','raw'}; doc pages have title, date, provider, paras, cont."""

    def __init__(self, facility, title, paras, date=None, provider=None, cont=0, total=1, blank=False, footer_extra=""):
        self.facility, self.title, self.paras = facility, title, paras
        self.date, self.provider, self.cont, self.total = date, provider, cont, total
        self.blank, self.footer_extra = blank, footer_extra


def render(pages, path):
    c = canvas.Canvas(str(path), pagesize=letter)
    w, h = letter
    for p in pages:
        if p.blank:
            if p.footer_extra:
                c.setFont("Helvetica", 6)
                c.drawString(0.5 * inch, 0.4 * inch, p.footer_extra)
            c.showPage()
            continue
        y = h - 0.8 * inch
        def para(text, style):
            nonlocal y
            pp = Paragraph(text, style)
            _, ph = pp.wrap(w - 1.8 * inch, h)
            y -= ph
            pp.drawOn(c, 0.9 * inch, y)
            y -= style.spaceAfter + 2
        para(p.facility, FAC)
        title = p.title + (" (continued)" if p.cont else "")
        para("<b>%s</b>" % title.upper(), H1)
        meta = []
        if p.date:
            meta.append("Date of service: %s" % p.date)
        if p.provider:
            meta.append("Provider: %s" % p.provider)
        if meta:
            para(" | ".join(meta), META)
        for t in p.paras:
            para(t, BODY)
        c.setFont("Helvetica", 8)
        c.drawString(0.9 * inch, 0.55 * inch, "Patient: %s | %s | Page %d of %d | %s %s" % (
            PATIENT, MRN, max(p.cont, 0) + 1, p.total, p.facility, p.footer_extra))
        c.showPage()
    c.save()


def seq(facility, title, date, provider, chunks, **kw):
    """Make a multi-page document from a list of paragraph-lists."""
    n = len(chunks)
    return [Page(facility, title, ch, date=date if i == 0 else None, provider=provider if i == 0 else None,
                 cont=i, total=n, **kw) for i, ch in enumerate(chunks)]


def build_pages():
    # ---------- ED triage (03/14/2024) ----------
    ed = seq(ST_MARY, "Emergency Department Triage Note", "03/14/2024", "J. Alvarez, RN", [
        ["03/14/2024 18:42 - Patient arrived by ambulance after a fall at home on the kitchen stairs. Reports severe right hip pain and inability to bear weight.",
         "03/14/2024 18:50 - Vitals on arrival: BP 148/86, HR 98, RR 18, SpO2 96% on room air, temperature 36.9 C. Pain rated 9/10.",
         "Allergies: NKDA (no known drug allergies) per patient report at triage.",
         "03/14/2024 19:05 - Right leg shortened and externally rotated. Neurovascular status intact distally. Triage category ESI 2."],
        ["03/14/2024 19:20 - IV access established, morphine 4 mg IV given for pain. Patient kept nil by mouth pending orthopaedic review.",
         "03/14/2024 19:40 - Handover to ED physician Dr. P. Nakamura. Family (daughter) at bedside."],
    ])
    xray = seq(ST_MARY, "Radiology Report - Right Hip X-ray", "March 14, 2024", "Dr. L. Brandt, Radiologist", [
        ["March 14, 2024 20:10 - AP pelvis and cross-table lateral right hip obtained. Findings: displaced subcapital fracture of the right femoral neck. No dislocation.",
         "Impression: Displaced right femoral neck fracture (Garden IV). Mild generalized osteopenia. Recommend orthopaedic surgical consultation.",
         "Comparison: none available."],
    ])
    hp = seq(ST_MARY, "Admission History and Physical", "March 14, 2024", "Dr. R. Okafor, Orthopaedics", [
        ["March 14, 2024 21:30 - 66-year-old woman admitted under orthopaedics with a displaced right femoral neck fracture after a mechanical fall. Past history: hypertension, type 2 diabetes, osteoporosis.",
         "Allergies: penicillin (anaphylaxis in childhood). Patient and daughter both confirm this allergy.",
         "Medications on admission: lisinopril 10 mg daily, metformin 500 mg twice daily, alendronate 70 mg weekly."],
        ["March 14, 2024 22:00 - Examination: right leg shortened and externally rotated, tender over the groin. Pulses palpable. Cardiorespiratory examination unremarkable.",
         "Assessment: displaced intracapsular femoral neck fracture. Plan: hemiarthroplasty on the next available list, preoperative bloods, ECG, group and save."],
        ["March 14, 2024 22:30 - Consent discussion held with patient regarding risks of surgery including infection, dislocation, thromboembolism and anaesthetic risk. Patient agrees to proceed.",
         "March 14, 2024 22:45 - Venous thromboembolism prophylaxis ordered: enoxaparin 40 mg subcutaneously daily, starting post-operatively."],
    ])
    labs = seq(ST_MARY, "Laboratory Results", "2024-03-15", "Pathology Dept, St. Mary's", [
        ["2024-03-15 06:15 - Preoperative bloods: hemoglobin 11.2 g/dL (low), WBC 9.8, platelets 245, creatinine 0.9 mg/dL, glucose 9.4 mmol/L (high).",
         "2024-03-15 06:15 - INR 1.0. Group and screen completed; two units cross-matched."],
        ["2024-03-15 07:00 - ECG: sinus rhythm, rate 84, no acute ischaemic changes.",
         "2024-03-17 06:10 - Post-operative bloods: hemoglobin 9.1 g/dL (low), WBC 12.4 (mildly elevated), CRP 88 mg/L."],
    ])
    # ---------- Operative report (2024-03-16) ----------
    op = seq(ST_MARY, "Operative Report", "2024-03-16", "Dr. R. Okafor, Orthopaedics", [
        ["2024-03-16 08:05 - Right hip hemiarthroplasty was performed on 2024-03-16 under spinal anaesthesia for a displaced right femoral neck fracture. Cemented bipolar prosthesis used.",
         "Preoperative diagnosis: displaced right femoral neck fracture. Postoperative diagnosis: same. Surgeon: Dr. R. Okafor. Anaesthetist: Dr. S. Mehta."],
        ["Procedure details: posterolateral approach. Femoral head excised and sized at 46 mm. Stem cemented in neutral alignment. Hip stable through full range of motion at trial.",
         "Estimated blood loss 350 mL. No intraoperative complications. Antibiotic prophylaxis given: vancomycin 1 g IV (penicillin allergy noted)."],
        ["2024-03-16 10:20 - Transferred to recovery in stable condition. Post-operative orders: weight bearing as tolerated, hip precautions, enoxaparin from 6 hours post-op, physiotherapy day 1."],
    ])
    # ---------- Post-op X-ray (2024-03-16) ----------
    xray2 = seq(ST_MARY, "Radiology Report - Post-operative Right Hip", "2024-03-16", "Dr. L. Brandt, Radiologist", [
        ["2024-03-16 12:40 - Portable AP pelvis. Right hip bipolar hemiarthroplasty in satisfactory position with no evidence of dislocation or periprosthetic fracture."],
    ])
    # ---------- Nursing notes ----------
    nurse = seq(ST_MARY, "Nursing Progress Notes", "16 Mar 2024", "Ward 4B nursing team", [
        ["16 Mar 2024 14:00 - Patient returned to ward alert and oriented. Pain 4/10 at rest. Dressing clean and dry. Neurovascular observations stable.",
         "16 Mar 2024 20:00 - Pain 5/10, analgesia given. Patient reminded of hip precautions. Urinary catheter in situ, draining well."],
        ["17 Mar 2024 08:00 - Mobilised to chair with physiotherapy and two staff. Mild nausea settled with ondansetron 4 mg.",
         "17 Mar 2024 14:30 - Wound inspected, no signs of infection. Temperature 37.6 C. Oral intake improving."],
        ["18 Mar 2024 09:10 - Fell back to bed after standing alone; no injury sustained. Falls risk reassessed as high and bed alarm applied. Doctor informed.",
         "19 Mar 2024 10:00 - Walking 10 metres with frame and one assistant. Catheter removed. Passed urine without difficulty."],
    ])
    # ---------- Pharmacy MAR ----------
    mar = seq(ST_MARY, "Pharmacy Medication Administration Record", "16 Mar 2024", "Pharmacy, St. Mary's", [
        ["16 Mar 2024 - Allergy status on MAR: penicillin (anaphylaxis). Antibiotic prophylaxis vancomycin 1 g IV given at 07:50 prior to incision.",
         "16 Mar 2024 22:00 - Enoxaparin 40 mg subcutaneously administered. Paracetamol 1 g oral four times daily, oxycodone 5 mg as needed."],
        ["17 Mar 2024 22:00 - Enoxaparin 40 mg given. Oxycodone 5 mg given x2 during the day. Ondansetron 4 mg given at 08:15.",
         "19 Mar 2024 22:00 - Enoxaparin 40 mg given. Oxycodone reduced to 2.5 mg as needed. Metformin and lisinopril resumed."],
    ])
    # ---------- Discharge summary ----------
    dis = seq(ST_MARY, "Discharge Summary", "March 22, 2024", "Dr. R. Okafor, Orthopaedics", [
        ["March 22, 2024 11:00 - Ms Ellison is discharged to inpatient rehabilitation after right hip hemiarthroplasty on 16 March 2024 for a displaced femoral neck fracture sustained in a fall on 14 March 2024.",
         "Allergies: penicillin (anaphylaxis). Hospital course: uncomplicated apart from postoperative anaemia (hemoglobin nadir 9.1 g/dL) managed without transfusion, and one in-ward fall on 18 March 2024 without injury."],
        ["Discharge medications: enoxaparin 40 mg daily for 28 days, paracetamol, oxycodone 2.5 mg as needed, lisinopril, metformin, alendronate. Follow-up: orthopaedic clinic in 6 weeks with repeat radiographs.",
         "March 22, 2024 11:30 - Wound clean with staples in situ; to be removed at 14 days. Weight bearing as tolerated with walking frame."],
    ])
    # ---------- Physio / rehab ----------
    physio = seq(RIVERSIDE, "Physiotherapy Initial Assessment", "02 Apr 2024".replace("02 Apr", "2 Apr"), "K. Tran, PT", [
        ["2 Apr 2024 09:30 - Initial rehabilitation assessment 11 days after discharge. Patient walking 25 metres with frame, supervision required. Hip flexion limited to 80 degrees by precautions.",
         "2 Apr 2024 09:45 - Pain 3/10. Timed Up and Go 32 seconds (high falls risk). Goals: independent transfers and walking with a stick within 4 weeks."],
        ["2 Apr 2024 10:15 - Treatment plan: gait re-education, abductor strengthening, stair practice, falls prevention education. Frequency three sessions per week.",
         "Staples removed by clinic nurse on 2 Apr 2024; wound healed with no signs of infection."],
    ])
    # ---------- GP letter (contains the conflicting surgery date + allergy NKDA) ----------
    gp = seq(GP, "General Practitioner Letter", "2024-04-10", "Dr. H. Patel, GP", [
        ["2024-04-10 14:00 - Letter to orthopaedic clinic: I reviewed Mrs Ellison today. She underwent right hip hemiarthroplasty on 17 March 2024 and is progressing well with a walking stick.",
         "Allergies: NKDA on our practice record; please confirm with the hospital as the practice record may be out of date."],
        ["2024-04-10 14:20 - Blood pressure 138/82, wound healed. Mood good. I have continued lisinopril and metformin and asked her to complete the course of enoxaparin.",
         "Plan: review in 4 weeks, bone health review with DEXA scan, continue alendronate."],
    ])
    return dict(ed=ed, xray=xray, hp=hp, labs=labs, op=op, xray2=xray2, nurse=nurse, mar=mar, dis=dis, physio=physio, gp=gp)


def rescan(page):
    """A near-duplicate: same page re-scanned (small OCR-like differences + scan stamp)."""
    paras = [p.replace("clean and dry", "clean and dry.").replace("10 metres", "10 meters") for p in page.paras]
    return Page(page.facility, page.title, paras, date=page.date, provider=page.provider, cont=page.cont,
                total=page.total, footer_extra="(rescan)")


def build_bundle(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    d = build_pages()
    blank = Page(None, None, [], blank=True)
    fax = Page(None, None, [], blank=True, footer_extra="fax")

    # File 1: hospital ED / admission packet, loosely ordered (H&P before triage), exact duplicate of triage p1 and labs p1.
    f1 = d["hp"] + d["ed"] + [blank] + d["xray"] + d["labs"] + [d["ed"][0], d["labs"][0]]
    # File 2: inpatient packet - discharge summary first (out of order), operative, nursing (near-dup of nursing p1), MAR.
    f2 = d["dis"] + d["op"] + [fax] + d["xray2"] + d["nurse"] + [rescan(d["nurse"][0])] + d["mar"]
    # File 3: rehab clinic
    f3 = d["physio"]
    # File 4: GP
    f4 = d["gp"] + [blank]
    files = {
        "01_stmarys_admission_packet.pdf": f1,
        "02_stmarys_inpatient_chart.pdf": f2,
        "03_riverside_rehab.pdf": f3,
        "04_oakwood_gp_letter.pdf": f4,
    }
    paths = []
    for name, pages in files.items():
        render(pages, out / name)
        paths.append(out / name)
    return paths


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "data/sample"
    for p in build_bundle(target):
        print(p)
