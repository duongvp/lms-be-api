const MOCK_MODULES = [
    {
        code: 'schedule_summary',
        name: 'Tổng quan lịch học',
        fields: [
            { fieldCode: 'date', fieldLabel: 'Ngày học' },
            { fieldCode: 'time', fieldLabel: 'Giờ học' },
            { fieldCode: 'class_name', fieldLabel: 'Tên lớp' },
            { fieldCode: 'room', fieldLabel: 'Phòng học' }
        ]
    },
    {
        code: 'schedule_detail',
        name: 'Chi tiết lịch học',
        fields: [
            { fieldCode: 'date', fieldLabel: 'Ngày học' },
            { fieldCode: 'time', fieldLabel: 'Giờ học' },
            { fieldCode: 'class_name', fieldLabel: 'Tên lớp' },
            { fieldCode: 'room', fieldLabel: 'Phòng học' },
            { fieldCode: 'subject', fieldLabel: 'Môn học' }
        ]
    },
    {
        code: 'class_list',
        name: 'Danh sách lớp',
        fields: [
            { fieldCode: 'class_name', fieldLabel: 'Tên lớp' },
            { fieldCode: 'grade', fieldLabel: 'Khối' },
            { fieldCode: 'room', fieldLabel: 'Phòng học' }
        ]
    },
    {
        code: 'student_list',
        name: 'Danh sách học viên',
        fields: [
            { fieldCode: 'student_code', fieldLabel: 'Mã học viên' },
            { fieldCode: 'full_name', fieldLabel: 'Họ và tên' },
            { fieldCode: 'class_name', fieldLabel: 'Tên lớp' }
        ]
    }
];

// Cấu trúc permission chi tiết với các action có sẵn cho từng mục
const permissionsStructure = {
    "Hệ thống": {
        "Người dùng": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá"],
            keys: ["user_view", "user_create", "user_edit", "user_delete"]
        },
        "Chi nhánh": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá"],
            keys: ["branch_view", "branch_create", "branch_edit", "branch_delete"]
        },
        "Tổng quan": {
            actions: ["Xem DS"],
            keys: ["dashboard_view"]
        },
        "Báo cáo": {
            actions: ["Xem DS"],
            keys: ["report_view"]
        }
    },
    "Hàng hóa": {
        "Sản phẩm": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá", "Import excel", "Xuất excel"],
            keys: ["product_view", "product_create", "product_edit", "product_delete", "product_import", "product_export"]
        },
        "Nhóm hàng": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá"],
            keys: ["category_view", "category_create", "category_edit", "category_delete"]
        },
        "Kiểm kho": {
            actions: ["Xem DS", "Điều chỉnh", "Huỷ", "Cập nhật", "Xuất excel"],
            keys: ["stock_check_view", "stock_check_create", "stock_check_edit", "stock_check_delete", "stock_check_export"]
        }
    },
    "Giao dịch": {
        "Hóa đơn": {
            actions: ["Xem DS", "Tạo mới", "Hủy", "Cập nhật", "Import excel", "Xuất excel", "In hóa đơn"],
            keys: ["invoice_view", "invoice_create", "invoice_edit", "invoice_void", "invoice_import", "invoice_export", "invoice_print"]
        },
        "Trả hàng": {
            actions: ["Xem DS", "Xử lý", "Hủy", "Cập nhật", "Xuất excel", "In trả hàng"],
            keys: ["return_view", "return_process", "return_void", "return_edit", "return_export", "return_print"]
        },
        "Nhập hàng": {
            actions: ["Xem DS", "Tạo mới", "Hủy", "Cập nhật", "Import excel", "Xuất excel", "In phiếu nhập"],
            keys: ["import_view", "import_create", "import_void", "import_edit", "import_import", "import_export", "import_print"]
        },
        "Voucher": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá"],
            keys: ["voucher_view", "voucher_create", "voucher_edit", "voucher_delete"]
        }
    },
    "Đối tác": {
        "Khách hàng": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá", "Import excel", "Xuất excel"],
            keys: ["customer_view", "customer_create", "customer_edit", "customer_delete", "customer_import", "customer_export"]
        },
        "Nhà cung cấp": {
            actions: ["Xem DS", "Thêm mới", "Cập nhật", "Xoá", "Import excel", "Xuất excel"],
            keys: ["supplier_view", "supplier_create", "supplier_edit", "supplier_delete", "supplier_import", "supplier_export"]
        }
    },
    "Golf": {
        "Golf Simulator": {
            actions: ["Xem DS", "Quản lý", "Checkout", "Membership", "Báo cáo", "Quản lý Line"],
            keys: ["golf_view", "golf_manage", "golf_checkout", "golf_membership", "golf_report", "golf_line_manage"]
        }
    }
};