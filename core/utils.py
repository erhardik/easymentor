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


def safe_int(value):
    value = clean_number(value)
    if not value:
        return None
    try:
        return int(value)
    except Exception:
        return None


def safe_text(value, max_len):
    text = str(value or "").strip()
    if not text or text.lower() == "nan":
        return ""
    return text[:max_len]


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
    skipped = 0

    for _, row in df.iterrows():

        try:
            enrollment = clean_number(row.get(enrollment_col))
            if not enrollment:
                skipped += 1
                continue

            # model-safe values
            name = safe_text(row.get(name_col), 100)
            roll = safe_int(row.get(roll_col))
            mentor_name = safe_text(row.get(mentor_col), 50) or "UNKNOWN"

            father = format_phone(clean_number(row.get(father_col)))[:15]
            mother = format_phone(clean_number(row.get(mother_col)))[:15]
            batch = safe_text(row.get(batch_col), 20)

            mentor, _ = Mentor.objects.get_or_create(name=mentor_name)

            _, created = Student.objects.update_or_create(
                enrollment=enrollment[:20],
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
        except Exception:
            # Skip bad rows instead of failing whole upload
            skipped += 1

    return added, updated, skipped
