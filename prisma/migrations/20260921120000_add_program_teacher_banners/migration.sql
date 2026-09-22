CREATE TABLE `program_teacher_banners` (
  `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
  `program_code` VARCHAR(50) NOT NULL,
  `teacher_profile_id` INTEGER UNSIGNED NOT NULL,
  `banner_url` VARCHAR(500) NOT NULL,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_by` VARCHAR(100) NULL,
  `updated_by` VARCHAR(100) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `uq_program_teacher_banner` (`program_code`, `teacher_profile_id`),
  INDEX `idx_program_teacher_banner_teacher` (`teacher_profile_id`),
  INDEX `idx_program_teacher_banner_status` (`status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_program_teacher_banner_teacher`
    FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES
  ('program_teacher_banner.view', 'Xem banner chương trình - giáo viên', 'Cho phép xem cấu hình banner', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('program_teacher_banner.create', 'Thêm banner chương trình - giáo viên', 'Cho phép thêm cấu hình banner', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('program_teacher_banner.update', 'Sửa banner chương trình - giáo viên', 'Cho phép sửa cấu hình banner', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('program_teacher_banner.delete', 'Xóa banner chương trình - giáo viên', 'Cho phép xóa cấu hình banner', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role_row.id, permission_row.id
     , CURRENT_TIMESTAMP(3)
FROM `roles` role_row
JOIN `permissions` permission_row ON permission_row.code LIKE 'program_teacher_banner.%'
WHERE role_row.code = 'admin';
