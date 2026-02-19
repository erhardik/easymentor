from django.db import models
from django.utils import timezone


# ------------------ MENTOR ------------------
class Mentor(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name


# ------------------ STUDENT MASTER ------------------
class Student(models.Model):
    enrollment = models.CharField(max_length=20, unique=True)
    roll_no = models.IntegerField(null=True, blank=True)
    name = models.CharField(max_length=100)
    batch = models.CharField(max_length=20, blank=True)
    mentor = models.ForeignKey(Mentor, on_delete=models.CASCADE)
    father_mobile = models.CharField(max_length=15, blank=True)
    mother_mobile = models.CharField(max_length=15, blank=True)

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
    week_no = models.IntegerField(unique=True)
    locked = models.BooleanField(default=False)

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
