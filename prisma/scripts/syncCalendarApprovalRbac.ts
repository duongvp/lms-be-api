import 'dotenv/config';
import prisma from '../../src/lib/prisma';
import {syncCalendarApprovalRbac} from './calendarApprovalRbac';
void syncCalendarApprovalRbac(prisma).then(result=>console.log('Đã đồng bộ vai trò Người duyệt lịch và chuyển quyền cũ:',result))
 .catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
