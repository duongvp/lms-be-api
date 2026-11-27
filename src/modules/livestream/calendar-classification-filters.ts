import {Prisma} from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';

export async function getCalendarClassificationOptions(allowedPrograms:string[]|null){
 if(allowedPrograms?.length===0)return [];
 return prisma.$queryRaw<Array<{code:string;subject_name:string;grade:number|null}>>(Prisma.sql`
  SELECT DISTINCT subject_code AS code, TRIM(subject_name) AS subject_name, grade
  FROM lessons WHERE status <> 0 AND TRIM(subject_code) <> '' AND TRIM(subject_name) <> ''
  ${allowedPrograms===null?Prisma.empty:Prisma.sql`AND subject_code IN (${Prisma.join(allowedPrograms)})`}
  ORDER BY subject_name, grade, code
 `);
}

// Exact curriculum classification; do not infer grades from calendar names/codes.
// Calendar IDs are intersected with the existing permission/source/date filters.
export async function calendarClassificationCondition(query:any,programs:string[]|null=null):Promise<Prisma.calendarWhereInput|null>{
 const subject=String(query.subject_name??'').trim();
 const hasGrade=query.grade!==undefined&&query.grade!==null&&query.grade!=='';
 const grade=hasGrade?Number(query.grade):undefined;
 if(subject.length>100)throw new ApiError('Môn học không hợp lệ',400);
 if(hasGrade&&(!Number.isInteger(grade)||(grade??0)<1||(grade??0)>12))throw new ApiError('Khối phải là số nguyên từ 1 đến 12',400);
 if(!subject&&!hasGrade)return null;
 if(programs?.length===0)return {id:{in:[]}};
 const rows=await prisma.$queryRaw<Array<{id:number}>>(Prisma.sql`
  SELECT DISTINCT c.id FROM calendar c
  LEFT JOIN lessons linked ON linked.id=c.session_id AND linked.status<>0
  LEFT JOIN lessons legacy ON c.session_id IS NULL AND legacy.subject_code=c.code
    AND legacy.learn_number=c.learn_number AND legacy.status<>0
  WHERE 1=1
  ${programs===null?Prisma.empty:Prisma.sql`AND COALESCE(linked.subject_code,legacy.subject_code,c.code) IN (${Prisma.join(programs)})`}
  ${subject?Prisma.sql`AND TRIM(COALESCE(linked.subject_name,legacy.subject_name,c.subject))=${subject}`:Prisma.empty}
  ${hasGrade?Prisma.sql`AND COALESCE(linked.grade,legacy.grade)=${grade}`:Prisma.empty}
 `);
 return {id:{in:rows.map(row=>Number(row.id))}};
}
