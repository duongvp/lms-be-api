"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = void 0;
const apiResponse_1 = require("../../utils/apiResponse");
const package_course_sheet_service_1 = require("../../integrations/package-course-sheet.service");
const list = async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await (0, package_course_sheet_service_1.listPackageCoursesFromSheet)(req.query.refresh === 'true'));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 503);
    }
};
exports.list = list;
