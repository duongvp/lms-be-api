-- Final role-level program scope model.
-- Program keys are stored directly as lessons.subject_code.
-- No action-specific, user-specific, or generic scope-resource tables are created.
CREATE TABLE `role_program_scope_policies` (
    `roleId` BIGINT UNSIGNED NOT NULL,
    `mode` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`roleId`),
    INDEX `role_program_scope_policies_mode_idx` (`mode`),
    CONSTRAINT `role_program_scope_policies_roleId_fkey`
      FOREIGN KEY (`roleId`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `role_program_scopes` (
    `roleId` BIGINT UNSIGNED NOT NULL,
    `subjectCode` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`roleId`, `subjectCode`),
    INDEX `role_program_scopes_subjectCode_idx` (`subjectCode`),
    CONSTRAINT `role_program_scopes_roleId_fkey`
      FOREIGN KEY (`roleId`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
