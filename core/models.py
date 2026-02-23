from django.db import models
from django.utils import timezone


class AcademicModule(models.Model):
    YEAR_CHOICES = [
        ("FY", "FY"),
        ("SY", "SY"),
        ("TY", "TY"),
        ("LY", "LY"),
    ]
    VARIANT_CHOICES = [
        ("FY1", "FY1"),
        ("FY2-CE", "FY2-CE"),
        ("FY2-Non CE", "FY2-Non CE"),
        ("FY3", "FY3"),
        ("FY4", "FY4"),
        ("FY5", "FY5"),
        ("SY1", "SY1"),
        ("SY2", "SY2"),
        ("TY1", "TY1"),
        ("TY2", "TY2"),
        ("LY1", "LY1"),
        ("LY2", "LY2"),
    ]
    SEM_CHOICES = [
        ("Sem-1", "Sem-1"),
        ("Sem-2", "Sem-2"),
    ]

    name = models.CharField(max_length=120, unique=True)
    academic_batch = models.CharField(max_length=20)
    year_level = models.CharField(max_length=10, choices=YEAR_CHOICES, default="FY")
    variant = models.CharField(max_length=20, choices=VARIANT_CHOICES, default="FY2-CE")
    semester = models.CharField(max_length=10, choices=SEM_CHOICES, default="Sem-1")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.name


# ------------------ MENTOR ------------------
class Mentor(models.Model):
    name = models.CharField(max_length=50, unique=True)
    full_name = models.CharField(max_length=100, blank=True, db_index=True)

    def __str__(self):
        return self.name


# ------------------ STUDENT MASTER ------------------
class Student(models.Model):
    module = models.ForeignKey(AcademicModule, on_delete=models.CASCADE, related_name="students")
    enrollment = models.CharField(max_length=20)
    roll_no = models.IntegerField(null=True, blank=True)
    name = models.CharField(max_length=100)
    batch = models.CharField(max_length=20, blank=True)
    mentor = models.ForeignKey(Mentor, on_delete=models.CASCADE)
    student_mobile = models.CharField(max_length=15, blank=True)
    father_mobile = models.CharField(max_length=15, blank=True)
    mother_mobile = models.CharField(max_length=15, blank=True)
    student_mobile_updated_by_mentor = models.BooleanField(default=False)
    father_mobile_updated_by_mentor = models.BooleanField(default=False)

    class Meta:
        unique_together = ("module", "enrollment")

    def __str__(self):
        return f"{self.name} - {self.enrollment}"


# ------------------ WEEKLY ATTENDANCE ------------------
class Attendance(models.Model):
    week_no = models.IntegerField()
    student = models.ForeignKey(Student, on_delete=models.CASCADE)

    week_percentage = models.FloatField()
    overall_percentage = models.FloatField()

    call_required = models.BooleanField(default=False)

    class Meta:
        unique_together = ('week_no', 'student')

    def __str__(self):
        return f"{self.student.name} - Week {self.week_no}"



# ------------------ CALL RECORD ------------------
class CallRecord(models.Model):

    STATUS_CHOICES = [
        ('received', 'Received'),
        ('not_received', 'Not Received'),
    ]

    TALKED_CHOICES = [
        ('father', 'Father'),
        ('mother', 'Mother'),
        ('guardian', 'Guardian'),
    ]

    student = models.ForeignKey(Student, on_delete=models.CASCADE)
    week_no = models.IntegerField()

    attempt1_time = models.DateTimeField(null=True, blank=True)
    attempt2_time = models.DateTimeField(null=True, blank=True)

    final_status = models.CharField(max_length=20, choices=STATUS_CHOICES, null=True, blank=True)
    talked_with = models.CharField(max_length=20, choices=TALKED_CHOICES, null=True, blank=True)

    duration = models.CharField(max_length=10, blank=True)
    parent_reason = models.TextField(blank=True)

    message_sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('student', 'week_no')

    def __str__(self):
        return f"{self.student.name} - Week {self.week_no}"

# ------------------ LOCK WEEK ------------------

class WeekLock(models.Model):
    module = models.ForeignKey(AcademicModule, on_delete=models.CASCADE, related_name="week_locks")
    week_no = models.IntegerField()
    locked = models.BooleanField(default=False)

    class Meta:
        unique_together = ("module", "week_no")

    def __str__(self):
        return f"Week {self.week_no} Locked={self.locked}"


class MentorAuthToken(models.Model):
    mentor = models.ForeignKey(Mentor, on_delete=models.CASCADE, related_name="auth_tokens")
    token = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [
            models.Index(fields=["token"]),
            models.Index(fields=["mentor", "is_active"]),
        ]

    def __str__(self):
        return f"{self.mentor.name} token"

    def is_valid(self):
        return self.is_active and self.expires_at > timezone.now()


TEST_CHOICES = [
    ("T1", "T1"),
    ("T2", "T2"),
    ("T3", "T3"),
    ("T4", "T4"),
    ("REMEDIAL", "REMEDIAL"),
]


class Subject(models.Model):
    FORMAT_FULL = "FULL"
    FORMAT_T4_ONLY = "T4_ONLY"
    FORMAT_CHOICES = [
        (FORMAT_FULL, "T1/T2/T3/T4"),
        (FORMAT_T4_ONLY, "Only T4"),
    ]

    module = models.ForeignKey(AcademicModule, on_delete=models.CASCADE, related_name="subjects")
    name = models.CharField(max_length=100)
    result_format = models.CharField(max_length=20, choices=FORMAT_CHOICES, default=FORMAT_FULL)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("module", "name")
        ordering = ["name"]

    def __str__(self):
        return self.name


class ResultUpload(models.Model):
    module = models.ForeignKey(AcademicModule, on_delete=models.CASCADE, related_name="result_uploads")
    test_name = models.CharField(max_length=20, choices=TEST_CHOICES)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="uploads")
    uploaded_by = models.CharField(max_length=100, blank=True)
    uploaded_at = models.DateTimeField(auto_now=True)
    rows_total = models.IntegerField(default=0)
    rows_matched = models.IntegerField(default=0)
    rows_failed = models.IntegerField(default=0)

    class Meta:
        unique_together = ("module", "test_name", "subject")
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.test_name} - {self.subject.name}"


class StudentResult(models.Model):
    upload = models.ForeignKey(ResultUpload, on_delete=models.CASCADE, related_name="results")
    student = models.ForeignKey(Student, on_delete=models.CASCADE)
    enrollment = models.CharField(max_length=20)

    marks_current = models.FloatField(null=True, blank=True)
    marks_t1 = models.FloatField(null=True, blank=True)
    marks_t2 = models.FloatField(null=True, blank=True)
    marks_t3 = models.FloatField(null=True, blank=True)
    marks_t4 = models.FloatField(null=True, blank=True)
    marks_total = models.FloatField(null=True, blank=True)

    is_absent = models.BooleanField(default=False)
    fail_flag = models.BooleanField(default=False)
    fail_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        unique_together = ("upload", "student")

    def __str__(self):
        return f"{self.upload} - {self.student.enrollment}"


class ResultCallRecord(models.Model):
    STATUS_CHOICES = [
        ("received", "Received"),
        ("not_received", "Not Received"),
    ]

    TALKED_CHOICES = [
        ("father", "Father"),
        ("mother", "Mother"),
        ("guardian", "Guardian"),
    ]

    upload = models.ForeignKey(ResultUpload, on_delete=models.CASCADE, related_name="calls")
    student = models.ForeignKey(Student, on_delete=models.CASCADE)

    attempt1_time = models.DateTimeField(null=True, blank=True)
    attempt2_time = models.DateTimeField(null=True, blank=True)

    final_status = models.CharField(max_length=20, choices=STATUS_CHOICES, null=True, blank=True)
    talked_with = models.CharField(max_length=20, choices=TALKED_CHOICES, null=True, blank=True)

    duration = models.CharField(max_length=10, blank=True)
    parent_reason = models.TextField(blank=True)
    message_sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    fail_reason = models.CharField(max_length=255, blank=True)
    marks_current = models.FloatField(default=0)
    marks_total = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = ("upload", "student")
        ordering = ["student__roll_no", "student__name"]

    def __str__(self):
        return f"{self.upload} - {self.student.enrollment}"


class OtherCallRecord(models.Model):
    STATUS_CHOICES = [
        ("received", "Received"),
        ("not_received", "Not Received"),
    ]

    TALKED_CHOICES = [
        ("father", "Father"),
        ("mother", "Mother"),
        ("guardian", "Guardian"),
        ("student", "Student"),
    ]

    TARGET_CHOICES = [
        ("student", "Student"),
        ("father", "Father"),
    ]
    CATEGORY_CHOICES = [
        ("less_attendance", "Less Attendance"),
        ("poor_result", "Poor Result"),
        ("other", "Other"),
    ]

    student = models.OneToOneField(Student, on_delete=models.CASCADE, related_name="other_call")
    mentor = models.ForeignKey(Mentor, on_delete=models.CASCADE, related_name="other_calls")

    last_called_target = models.CharField(max_length=20, choices=TARGET_CHOICES, blank=True)
    attempt1_time = models.DateTimeField(null=True, blank=True)
    attempt2_time = models.DateTimeField(null=True, blank=True)

    final_status = models.CharField(max_length=20, choices=STATUS_CHOICES, null=True, blank=True)
    talked_with = models.CharField(max_length=20, choices=TALKED_CHOICES, null=True, blank=True)
    call_category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="other")
    duration = models.CharField(max_length=10, blank=True)
    parent_remark = models.TextField(blank=True)
    call_done_reason = models.TextField(blank=True)
    exam_name = models.CharField(max_length=50, blank=True)
    subject_name = models.CharField(max_length=120, blank=True)
    marks_obtained = models.FloatField(null=True, blank=True)
    marks_out_of = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["student__roll_no", "student__name"]

    def __str__(self):
        return f"Other Call - {self.student.enrollment}"
