from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet

from .models import CallRecord, Attendance


def generate_student_pdf(response, student):

    doc = SimpleDocTemplate(response, pagesize=landscape(A4))
    elements = []
    style = getSampleStyleSheet()

    elements.append(Paragraph(f"<b>Telephonic Interaction with Institute for Less Attendance</b>", style['Title']))
    elements.append(Spacer(1, 12))

    # table header
    data = [[
        "Sr No","Sem","Date","Time & Duration",
        "Called To","Week","Attendance %",
        "Parents Remarks","Faculty Remarks","Sign"
    ]]

    calls = CallRecord.objects.filter(student=student, final_status__isnull=False).order_by("week_no")

    sr = 1
    for call in calls:

        att = Attendance.objects.filter(student=student, week_no=call.week_no).first()

        if not att:
            continue

        call_dt = call.attempt2_time or call.attempt1_time or call.created_at
        date = call_dt.strftime("%d-%m-%Y")
        time = call_dt.strftime("%I:%M %p")

        duration = call.duration or ""
        talked = call.talked_with or ""
        parent = call.parent_reason or ""

        faculty = "Student will come regularly"

        percent = f"W:{round(att.week_percentage,2)}  O:{round(att.overall_percentage,2)}"

        data.append([
            sr,"1",date,f"{time} ({duration})",
            talked,call.week_no,percent,parent,faculty,""
        ])

        sr+=1

    table = Table(data, repeatRows=1)

    table.setStyle(TableStyle([
        ('GRID',(0,0),(-1,-1),0.5,colors.black),
        ('BACKGROUND',(0,0),(-1,0),colors.lightgrey),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('FONTSIZE',(0,0),(-1,-1),8)
    ]))

    elements.append(table)
    doc.build(elements)
