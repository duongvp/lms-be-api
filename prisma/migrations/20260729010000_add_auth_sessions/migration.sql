CREATE TABLE `auth_sessions` (
    `id` VARCHAR(64) NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `refresh_token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `revoked_at` DATETIME(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_auth_sessions_user_revoked`(`user_id`, `revoked_at`),
    INDEX `idx_auth_sessions_expires`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
