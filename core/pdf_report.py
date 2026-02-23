from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import Attendance, CallRecord, OtherCallRecord, ResultCallRecord

IST = ZoneInfo("Asia/Kolkata")


def _to_ist_parts(dt):
    if not dt:
        return "-", "-"
    local_dt = dt.astimezone(IST)
    return local_dt.strftime("%d-%m-%Y"), local_dt.strftime("%I:%M %p")


def _exam_name_for_pdf(test_name):
    if test_name == "T1":
        return "T1"
    if test_name == "T2":
        return "T2 / (T1+T2)"
    if test_name == "T3":
        return "T3 / (T1+T2+T3)"
    if test_name == "T4":
        return "T4 / (T1+T2+T3+T4)"
    if test_name == "REMEDIAL":
        return "REM"
    return str(test_name or "-")


def _header_text_style():
    return ParagraphStyle(
        "header_text",
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9,
        alignment=1,
    )


def _cell_text_style():
    return ParagraphStyle(
        "cell_text",
        fontName="Helvetica",
        fontSize=7.4,
        leading=9,
        alignment=0,
    )


def _p(text, style):
    return Paragraph(str(text or "-"), style)


def _table_style():
    return TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 0.7, colors.HexColor("#1f2d3d")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d8e3f0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (1, -1), "CENTER"),
            ("ALIGN", (2, 1), (3, -1), "CENTER"),
            ("ALIGN", (-1, 0), (-1, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("TOPPADDING", (0, 1), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ]
    )


def _title(style_sheet, text):
    return Paragraph(f"<b>{text}</b>", style_sheet["Title"])


def generate_student_pdf(response, student):
    doc = SimpleDocTemplate(
        response,
        pagesize=landscape(A4),
        leftMargin=18,
        rightMargin=18,
        topMargin=18,
        bottomMargin=16,
    )
    elements = []
    styles = getSampleStyleSheet()
    h_style = _header_text_style()
    c_style = _cell_text_style()
    sem_value = student.batch or "-"

    # ---------------- Attendance Calls ----------------
    elements.append(_title(styles, "Telephonic Interaction with Institute for Less Attendance"))
    elements.append(Spacer(1, 8))

    attendance_headers = [
        "Sr No",
        "Sem",
        "Date",
        "Time & Duration (Round up in Minutes only)",
        "Discussed with Father / Mother / Sister / Brother / Guardian (Relation)",
        "Teaching Week No (As Per Academic Calendar)",
        "% of Attend.",
        "Parents Remarks",
        "Faculty Remarks",
        "Faculty Name & Sign",
    ]
    attendance_data = [[_p(x, h_style) for x in attendance_headers]]
    attendance_calls = CallRecord.objects.filter(student=student, final_status__isnull=False).order_by("week_no", "id")

    sr = 1
    for call in attendance_calls:
        att = Attendance.objects.filter(student=student, week_no=call.week_no).first()
        if not att:
            continue
        call_dt = call.attempt2_time or call.attempt1_time or call.created_at
        date, time = _to_ist_parts(call_dt)
        duration = (call.duration or "").strip()
        discussed = (call.talked_with or "-").title()
        percent = f"W:{round(att.week_percentage, 2)} / O:{round(att.overall_percentage, 2)}"

        attendance_data.append(
            [
                _p(sr, c_style),
                _p(sem_value, c_style),
                _p(date, c_style),
                _p(f"{time} ({duration})" if duration else time, c_style),
                _p(discussed, c_style),
                _p(call.week_no, c_style),
                _p(percent, c_style),
                _p(call.parent_reason or "-", c_style),
                _p("Student will come regularly", c_style),
                _p("", c_style),
            ]
        )
        sr += 1

    attendance_widths = [26, 24, 52, 82, 112, 66, 50, 148, 104, 52]
    attendance_table = Table(attendance_data, colWidths=attendance_widths, repeatRows=1)
    attendance_table.setStyle(_table_style())
    elements.append(attendance_table)

    # ---------------- Poor Result Calls ----------------
    elements.append(PageBreak())
    elements.append(_title(styles, "Telephonic Interaction with Institute for Poor Result"))
    elements.append(Spacer(1, 8))

    result_headers = [
        "Sr No",
        "Sem",
        "Date",
        "Time & Duration (Round up in Minutes only)",
        "Discussed with Father / Mother / Sister / Brother / Guardian (Relation)",
        "Name of Exam (T1/T2/(T1+T2)/T3/(T1+T2+T3)/T4/Total/Improvement/Others)",
        "Subject name in which failed (Secured Marks / Total Marks)",
        "Parents / Faculty Remarks",
        "Faculty Name & Sign",
    ]
    result_data = [[_p(x, h_style) for x in result_headers]]
    result_calls = (
        ResultCallRecord.objects.filter(student=student, final_status__isnull=False)
        .select_related("upload", "upload__subject")
        .order_by("upload__uploaded_at", "id")
    )

    sr = 1
    for call in result_calls:
        call_dt = call.attempt2_time or call.attempt1_time or call.created_at
        date, time = _to_ist_parts(call_dt)
        duration = (call.duration or "").strip()
        discussed = (call.talked_with or "-").title()
        exam = _exam_name_for_pdf(call.upload.test_name if call.upload else "")
        subject_name = call.upload.subject.name if call.upload and call.upload.subject else "-"
        total_mark = call.marks_total if call.marks_total is not None else "-"
        subject_text = f"{subject_name} ({call.marks_current or 0}/{total_mark})"

        result_data.append(
            [
                _p(sr, c_style),
                _p(sem_value, c_style),
                _p(date, c_style),
                _p(f"{time} ({duration})" if duration else time, c_style),
                _p(discussed, c_style),
                _p(exam, c_style),
                _p(subject_text, c_style),
                _p(call.parent_reason or "-", c_style),
                _p("", c_style),
            ]
        )
        sr += 1

    result_widths = [26, 24, 48, 78, 98, 126, 132, 138, 52]
    result_table = Table(result_data, colWidths=result_widths, repeatRows=1)
    result_table.setStyle(_table_style())
    elements.append(result_table)

    # ---------------- Other Calls ----------------
    elements.append(PageBreak())
    elements.append(_title(styles, "Telephonic Interaction with Institute for Any Other Reasons"))
    elements.append(Spacer(1, 8))

    other_headers = [
        "Sr No",
        "Sem",
        "Date",
        "Time & Duration (Round up in Minutes only)",
        "Discussed with Student / Father / Mother",
        "Reason for Phone Call",
        "Parents / Faculty Remarks",
        "Faculty Name & Sign",
    ]
    other_data = [[_p(x, h_style) for x in other_headers]]
    other_calls = OtherCallRecord.objects.filter(student=student, final_status__isnull=False).order_by("updated_at", "id")

    sr = 1
    for call in other_calls:
        call_dt = call.attempt2_time or call.attempt1_time or call.updated_at or call.created_at
        date, time = _to_ist_parts(call_dt)
        duration = (call.duration or "").strip()
        discussed = (call.talked_with or "-").title()
        other_data.append(
            [
                _p(sr, c_style),
                _p(sem_value, c_style),
                _p(date, c_style),
                _p(f"{time} ({duration})" if duration else time, c_style),
                _p(discussed, c_style),
                _p(call.call_done_reason or "-", c_style),
                _p(call.parent_remark or "-", c_style),
                _p("", c_style),
            ]
        )
        sr += 1

    other_widths = [30, 26, 56, 96, 108, 216, 162, 58]
    other_table = Table(other_data, colWidths=other_widths, repeatRows=1)
    other_table.setStyle(_table_style())
    elements.append(other_table)

    doc.build(elements)

