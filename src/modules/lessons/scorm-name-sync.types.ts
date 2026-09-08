export type LessonSystem = 'TOPCLASS' | 'TOPUNI';

export interface SheetInfo { title: string; sheetId?: number; }
export interface TeacherInfo { name: string; title: string; }
export interface LessonUpdatePayload { course_id: number; lesson_id: number; lesson_name: string; }
export interface LessonPreview {
  sheetName: string; rowNumber: number; type: LessonSystem; courseId: number; lessonId: number;
  teacherName: string; oldName: string; newName: string;
}
export interface SyncWarning { sheetName: string; rowNumber?: number; message: string; }
export interface ScormNamePreviewResult {
  sheetsProcessed: number; rowsRead: number; validLessons: number; skippedLessons: number;
  updates: LessonPreview[]; warnings: SyncWarning[];
}
