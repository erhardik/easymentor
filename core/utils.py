import pandas as pd
from .models import Mentor, Student


# ---------------- PHONE FORMAT ----------------
def format_phone(num):
    """
    Convert any phone format into WhatsApp usable format:
    9876543210 -> 919876543210
    +91 98765-43210 -> 919876543210
    """

    if num is None:
        return ""

    num = str(num).strip()

    if num.lower() == "nan":
        return ""

    # remove decimals
    if num.endswith(".0"):
        num = num[:-2]

    # remove symbols
    for ch in [" ", "-", "+", "(", ")", "."]:
        num = num.replace(ch, "")

    # remove country code if already exists
    if num.startswith("91") and len(num) > 10:
        num = num[-10:]

    # add country code
    if len(num) == 10:
        num = "91" + num

    return num


# ---------------- CLEAN NUMBER ----------------
def clean_number(value):
    """Convert excel numeric to clean string (remove .0, nan, scientific notation)"""

    if pd.isna(value):
        return ""

    value = str(value).strip()

    if value.lower() == "nan":
        return ""

    # remove .0
    if value.endswith(".0"):
        value = value[:-2]

    # scientific notation
    if "e+" in value.lower():
        try:
            value = "{:.0f}".format(float(value))
        except:
            pass

    return value


# ---------------- NORMALIZE TEXT ----------------
def normalize(text):
    return str(text).lower().replace("\n", " ").strip()


# ---------------- DETECT HEADER ----------------
def detect_header_row(df):
    """Find row containing enrolment + mentor keywords"""

    for i in range(len(df)):
        row_text = " ".join([normalize(x) for x in df.iloc[i].values])

        if ("enrol" in row_text or "enrollment" in row_text) and ("mentor" in row_text):
            return i

    return 0


# ---------------- FIND COLUMN ----------------
def find_col(columns, keywords):

    for col in columns:
        col_norm = normalize(col)

        for key in keywords:
            if key in col_norm:
                return col

    return None


# ---------------- IMPORT STUDENTS ----------------
def import_students_from_excel(file):

    # read raw first
    raw = pd.read_excel(file, header=None)

    # detect header row dynamically
    header_row = detect_header_row(raw)

    # reload with header
    df = pd.read_excel(file, header=header_row)

    # normalize headers
    df.columns = [normalize(c) for c in df.columns]

    # detect columns
    enrollment_col = find_col(df.columns, ['enrol'])
    name_col = find_col(df.columns, ['name of student', 'student name', 'the name must be'])
    roll_col = find_col(df.columns, ['roll'])
    mentor_col = find_col(df.columns, ['short name of mentor', 'mentor'])
    father_col = find_col(df.columns, ['parent no', 'father'])
    mother_col = find_col(df.columns, ['student no', 'mother'])
    batch_col = find_col(df.columns, ['branch', 'batch'])

    added = 0
    updated = 0

    for _, row in df.iterrows():

        enrollment = clean_number(row.get(enrollment_col))
        if not enrollment:
            continue

        name = str(row.get(name_col) or "").strip()
        roll = clean_number(row.get(roll_col))
        mentor_name = str(row.get(mentor_col) or "").strip()

        father = format_phone(clean_number(row.get(father_col)))
        mother = format_phone(clean_number(row.get(mother_col)))
        batch = str(row.get(batch_col) or "").strip()

        # avoid empty mentor
        if not mentor_name:
            mentor_name = "UNKNOWN"

        mentor, _ = Mentor.objects.get_or_create(name=mentor_name)

        student, created = Student.objects.update_or_create(
            enrollment=enrollment,
            defaults={
                'name': name,
                'roll_no': roll,
                'mentor': mentor,
                'father_mobile': father,
                'mother_mobile': mother,
                'batch': batch
            }
        )

        if created:
            added += 1
        else:
            updated += 1

    return added, updated
