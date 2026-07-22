import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper: Tạo key (sessionId) tự động theo quy tắc
const generateKey = (systemType: string, startTime: Date, code: string, lessonCount: number): string => {
  const sysCode = systemType === 'topclass' ? 'tc' : (systemType === 'topuni' ? 'tu' : systemType);

  const startYear = startTime.getFullYear();
  const month = startTime.getMonth() + 1;

  let schoolYear;
  if (month >= 6) {
    schoolYear = `${startYear.toString().slice(-2)}${(startYear + 1).toString().slice(-2)}`;
  } else {
    schoolYear = `${(startYear - 1).toString().slice(-2)}${startYear.toString().slice(-2)}`;
  }

  const sessionNum = (lessonCount || 0) + 1;
  return `${sysCode}_${schoolYear}_${code}_b${sessionNum}`;
};

// 1.3 & 5 Kiểm tra trùng lặp
const checkConflict = async ({ teacher, start_time, end_time, id }: { teacher?: string, start_time: Date, end_time: Date, id?: number }) => {
  if (teacher) {
    const conflictTeacher = await prisma.calendar.findFirst({
      where: {
        teacher,
        start_time: { lt: end_time },
        end_time: { gt: start_time },
        id: id ? { not: id } : undefined
      }
    });
    if (conflictTeacher) throw new Error("Trùng lịch giáo viên");
  }
};




// 1.1. Thêm từng lịch
export const createSingle = async (data: any) => {
  data.start_time = new Date(data.start_time);
  data.end_time = new Date(data.end_time);

  await checkConflict({
    teacher: data.teacher,
    start_time: data.start_time,
    end_time: data.end_time
  });

  data.key = generateKey(data.system_type || 'topclass', data.start_time, data.code, data.lesson_count || 0);
  return await prisma.calendar.create({ data });
};

// 1.2. Thêm nhiều lịch
export const createBulk = async (config: any) => {
  // We assume frontend sends fully constructed objects in an array "calendars"
  const { calendars } = config;
  if (!calendars || !Array.isArray(calendars)) {
    throw new Error("Missing calendars array for bulk insert");
  }

  const calendarsToCreate: any[] = [];

  for (const cal of calendars) {
    cal.start_time = new Date(cal.start_time);
    cal.end_time = new Date(cal.end_time);
    await checkConflict({
      teacher: cal.teacher,
      start_time: cal.start_time,
      end_time: cal.end_time
    });
    cal.key = generateKey(cal.system_type || 'topclass', cal.start_time, cal.code, cal.lesson_count || 0);
    calendarsToCreate.push(cal);
  }

  return await prisma.calendar.createMany({ data: calendarsToCreate });
};

// 2.1 & 2.2 Sửa lịch
export const updateSchedule = async (id: number, data: any, updateMode: string) => {
  const current = await prisma.calendar.findUnique({ where: { id } });
  if (!current) throw new Error("Not found");

  if (data.start_time) data.start_time = new Date(data.start_time);
  if (data.end_time) data.end_time = new Date(data.end_time);

  if (updateMode === 'current' || !updateMode) {
    return await prisma.calendar.update({ where: { id }, data });
  } else if (updateMode === 'following') {
    try {
      console.log(data);
      // SỬ DỤNG TRANSACTION KHI DỜI ĐỀ CƯƠNG HÀNG LOẠT (Trường hợp nghỉ học và dời)
      return await prisma.$transaction(async (tx) => {
        // 1. Lấy tất cả các buổi sau
        const followings = await tx.calendar.findMany({
          where: {
            code: current.code,
            learn_number: current.learn_number,
            start_time: { gt: current.start_time }
          },
          orderBy: { start_time: 'asc' }
        });

        const syllabusFields = [
          'lesson_name', 'lesson_document', 'lesson_baitap',
          'lesson_tomtat', 'lesson_phuongphap', 'lesson_luuy', 'lesson_ketqua'
        ];
        const allSessions = [current, ...followings];

        // 2. Sửa buổi hiện tại: Chuyển trạng thái (ví dụ nghỉ học data.lesson_status = 1) và xoá đề cương
        const currentDataToUpdate = { ...data };
        delete currentDataToUpdate.new_session; // Loại bỏ thông tin tạo buổi mới ra khỏi data update của buổi hiện tại
        delete currentDataToUpdate.key; // Không đè key

        // Xoá thông tin đề cương của buổi bị nghỉ
        syllabusFields.forEach(field => {
          currentDataToUpdate[field] = null;
        });
        // Mặc định nếu là nghỉ dời lịch thì set lesson_status = 1 nếu data chưa truyền
        if (currentDataToUpdate.lesson_status === undefined) {
          currentDataToUpdate.lesson_status = 1;
        }

        const updatedCurrent = await tx.calendar.update({ where: { id }, data: currentDataToUpdate });

        // 3. Dời đề cương xuống các buổi sau (Giữ nguyên KEY của buổi)
        for (let i = 0; i < followings.length; i++) {
          const targetSession = followings[i];
          const sourceSyllabus = allSessions[i]; // Đề cương từ buổi liền trước

          const updateData: any = {};
          syllabusFields.forEach(field => {
            updateData[field] = (sourceSyllabus as any)[field];
          });

          // Tuyệt đối không thay đổi KEY của các buổi có sẵn
          await tx.calendar.update({
            where: { id: targetSession.id },
            data: updateData
          });
        }

        // 4. Tạo thêm 1 buổi mới ở cuối để chứa đề cương của buổi cuối cùng cũ
        if (data.new_session) {
          const lastSyllabus = allSessions[allSessions.length - 1];

          const newSessionData: any = {
            ...data.new_session,
            code: current.code,
            learn_number: current.learn_number,
            system_type: current.system_type,
            lesson_status: 0, // Buổi mới tạo là lịch học bình thường
            lesson_count: (lastSyllabus.lesson_count || 0) + 1 // Tăng session index
          };

          // Gắn đề cương của buổi cuối cùng vào buổi mới
          syllabusFields.forEach(field => {
            newSessionData[field] = (lastSyllabus as any)[field];
          });

          newSessionData.start_time = new Date(newSessionData.start_time);
          newSessionData.end_time = new Date(newSessionData.end_time);

          // Check conflict cho buổi mới tạo (Giáo viên)
          if (newSessionData.teacher) {
            const conflictTeacher = await tx.calendar.findFirst({
              where: {
                teacher: newSessionData.teacher,
                start_time: { lt: newSessionData.end_time },
                end_time: { gt: newSessionData.start_time }
              }
            });
            if (conflictTeacher) throw new Error("Trùng lịch giáo viên ở buổi học bổ sung");
          }

          // Sinh KEY cho buổi mới
          newSessionData.key = generateKey(
            newSessionData.system_type || 'topclass',
            newSessionData.start_time,
            newSessionData.code,
            newSessionData.lesson_count || 0
          );

          await tx.calendar.create({ data: newSessionData });
        } else {
          throw new Error("Vui lòng cung cấp data.new_session (start_time, end_time, teacher...) để tạo buổi học bù");
        }

        return updatedCurrent;
      });
    } catch (error: any) {
      console.log(error.message);
    }
  }
};

// 2.3 Nghỉ không dời
export const cancelSession = async (id: number) => {
  return await prisma.calendar.update({
    where: { id },
    data: { lesson_status: 1 } // 1 là nghỉ học, 0 là tham gia học
  });
};

// 3. Lấy danh sách lịch
export const getCalendar = async (query: any) => {
  const { page = 1, limit = 10, teacher, code, start_time, end_time } = query;
  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const where: any = {};
  if (teacher) where.teacher = teacher;
  if (code) where.code = code;
  if (start_time) where.start_time = { gte: new Date(start_time as string) };
  if (end_time) {
    where.end_time = where.end_time || {};
    where.end_time.lte = new Date(end_time as string);
  }

  const [total, data] = await Promise.all([
    prisma.calendar.count({ where }),
    prisma.calendar.findMany({
      where,
      skip,
      take,
      orderBy: { start_time: 'asc' },
    }),
  ]);

  return { total, page: Number(page), limit: Number(limit), data };
};


// Sửa nhiều lịch (Bulk Update)
export const updateBulk = async (config: any) => {
  const { ids, config_mode, update_data } = config;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error("Missing or invalid ids array for bulk update");
  }

  // 1. CẤU HÌNH CHUNG: Tất cả các lịch chọn được cập nhật bằng 1 data chung
  if (config_mode === 'common') {
    if (!update_data) throw new Error("Missing update_data for common bulk update");

    const dataToUpdate: any = {};
    if (update_data.teacher) dataToUpdate.teacher = update_data.teacher;
    if (update_data.room) dataToUpdate.room = update_data.room;

    // LƯU Ý QUAN TRỌNG: 
    // Nếu đổi thời gian chung (ví dụ từ 19:00 -> 21:00) cho nhiều ngày khác nhau, 
    // ta KHÔNG THỂ dùng prisma.calendar.updateMany được, vì mỗi dòng có start_time/end_time thuộc ngày khác nhau.
    // Nếu có đổi thời gian, bắt buộc phải duyệt qua từng record để giữ ngày cũ và chỉ đắp giờ mới vào.
    if (update_data.start_time || update_data.end_time) {
      return await prisma.$transaction(async (tx) => {
        const results = [];
        for (const idStr of ids) {
          const id = Number(idStr);
          const current = await tx.calendar.findUnique({ where: { id } });
          if (!current) continue;

          let newStart = current.start_time;
          let newEnd = current.end_time;

          // Thay thế giờ/phút, giữ nguyên ngày/tháng/năm
          if (update_data.start_time) {
            const [hours, minutes] = update_data.start_time.split(':');
            newStart = new Date(current.start_time);
            newStart.setHours(Number(hours), Number(minutes), 0, 0);
          }

          if (update_data.end_time) {
            const [hours, minutes] = update_data.end_time.split(':');
            newEnd = new Date(current.end_time);
            newEnd.setHours(Number(hours), Number(minutes), 0, 0);
          }

          // Check conflict
          await checkConflict({
            teacher: dataToUpdate.teacher || current.teacher,
            start_time: newStart,
            end_time: newEnd,
            id
          });

          const updated = await tx.calendar.update({
            where: { id },
            data: {
              ...dataToUpdate,
              start_time: newStart,
              end_time: newEnd,
            }
          });
          results.push(updated);
        }
        return results;
      });
    }

    // Nếu không đổi thời gian (chỉ đổi giáo viên, phòng) thì dùng updateMany cho nhanh
    return await prisma.calendar.updateMany({
      where: { id: { in: ids.map((id: string | number) => Number(id)) } },
      data: dataToUpdate
    });
  }


  // 2. CẤU HÌNH RIÊNG: Mỗi bài học có data cập nhật riêng
  if (config_mode === 'separate') {
    if (!update_data || !Array.isArray(update_data)) {
      throw new Error("Missing or invalid update_data array for separate bulk update");
    }

    return await prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of update_data) {
        const id = Number(item.id);
        const current = await tx.calendar.findUnique({ where: { id } });
        if (!current) continue;

        const dataToUpdate: any = {};
        if (item.teacher) dataToUpdate.teacher = item.teacher;
        if (item.room) dataToUpdate.room = item.room;

        let newStart = current.start_time;
        let newEnd = current.end_time;

        if (item.start_time) {
          const [hours, minutes] = item.start_time.split(':');
          newStart = new Date(current.start_time);
          newStart.setHours(Number(hours), Number(minutes), 0, 0);
        }

        if (item.end_time) {
          const [hours, minutes] = item.end_time.split(':');
          newEnd = new Date(current.end_time);
          newEnd.setHours(Number(hours), Number(minutes), 0, 0);
        }

        if (item.start_time || item.end_time) {
          dataToUpdate.start_time = newStart;
          dataToUpdate.end_time = newEnd;
        }

        // Check conflict
        await checkConflict({
          teacher: dataToUpdate.teacher || current.teacher,
          start_time: newStart,
          end_time: newEnd,
          id
        });

        const updated = await tx.calendar.update({
          where: { id },
          data: dataToUpdate
        });
        results.push(updated);
      }
      return results;
    });
  }

  throw new Error("Invalid config_mode");
};