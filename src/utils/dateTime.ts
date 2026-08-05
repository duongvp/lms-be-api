const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Database của LMS lưu giờ nghiệp vụ Việt Nam dưới dạng wall-clock.
 * Prisma serialize Date theo các thành phần UTC, vì vậy dịch instant thêm
 * UTC+7 trước khi ghi để 10:00 Việt Nam được lưu thành 10:00 trong DB.
 */
export const getVietnamWallClockDate = (value = new Date()) =>
    new Date(value.getTime() + VIETNAM_UTC_OFFSET_MS);
