export type AppointmentLike = {
  title?: string | null;
  location?: string | null;
  kind?: string | null;
};

export type MedicalTaskLike = {
  title?: string | null;
  area?: string | null;
  project?: string | null;
  classification?: string | null;
  tags?: string[] | null;
};

const DOCTOR_TITLE_PATTERN = /\bdr\b/i;
const MEDICAL_APPOINTMENT_PATTERN =
  /\b(doctor|dentist|dental|orthodont\w*|pediatri\w*|pulmonolog\w*|cardiolog\w*|dermatolog\w*|endocrinolog\w*|neurolog\w*|allerg\w*|specialist|medical|therapy|therapist|physical|optometr\w*|vision|eye exam|check[ -]?up|well child|wellness|urgent care|clinic)\b/i;

export function isMedicalAppointment(item: AppointmentLike) {
  if ((item.kind || "").toLowerCase() === "appointment") return true;
  return (
    DOCTOR_TITLE_PATTERN.test(item.title || "") ||
    MEDICAL_APPOINTMENT_PATTERN.test(
      `${item.title || ""} ${item.location || ""}`,
    )
  );
}

export function isMedicalCareTask(item: MedicalTaskLike) {
  const context = `${item.title || ""} ${item.project || ""} ${
    item.classification || ""
  } ${(item.tags || []).join(" ")}`;
  const area = (item.area || "").toLowerCase();
  return (
    ["health", "kids"].includes(area) &&
    (DOCTOR_TITLE_PATTERN.test(item.title || "") ||
      MEDICAL_APPOINTMENT_PATTERN.test(context))
  );
}
