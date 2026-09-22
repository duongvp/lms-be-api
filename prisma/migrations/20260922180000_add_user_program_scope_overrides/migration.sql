-- Per-user program scope overrides decouple functional roles from data scope.
-- Missing policy means INHERIT from the assigned roles for backward compatibility.
CREATE TABLE IF NOT EXISTS `scope_resources` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `scopeType` VARCHAR(30) NOT NULL,
    `scopeKey` VARCHAR(100) NOT NULL,
    `displayName` VARCHAR(255) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `scope_resources_scopeType_scopeKey_key` (`scopeType`, `scopeKey`),
    INDEX `scope_resources_scopeType_status_idx` (`scopeType`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_program_scope_policies` (
    `userId` INTEGER UNSIGNED NOT NULL,
    `mode` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`userId`),
    INDEX `user_program_scope_policies_mode_idx` (`mode`),
    CONSTRAINT `user_program_scope_policies_userId_fkey`
      FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_program_scopes` (
    `userId` INTEGER UNSIGNED NOT NULL,
    `scopeResourceId` BIGINT UNSIGNED NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`userId`, `scopeResourceId`),
    INDEX `user_program_scopes_scopeResourceId_idx` (`scopeResourceId`),
    CONSTRAINT `user_program_scopes_userId_fkey`
      FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `user_program_scopes_scopeResourceId_fkey`
      FOREIGN KEY (`scopeResourceId`) REFERENCES `scope_resources` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
