-- CreateTable chat_l1_settings
CREATE TABLE IF NOT EXISTS `chat_l1_settings` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `scope_type` VARCHAR(50) NOT NULL DEFAULT 'GLOBAL',
    `scope_key` VARCHAR(50) NOT NULL DEFAULT '*',
    `mode` VARCHAR(20) NOT NULL DEFAULT 'off',
    `revision` INT UNSIGNED NOT NULL DEFAULT 1,
    `updated_by` VARCHAR(100) NULL,
    `updated_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_l1_scope`(`scope_type`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable chat_l1_lexicon
CREATE TABLE IF NOT EXISTS `chat_l1_lexicon` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `list_type` VARCHAR(20) NOT NULL,
    `match_mode` VARCHAR(30) NOT NULL DEFAULT 'BOUNDED',
    `pattern` VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `category` VARCHAR(50) NULL,
    `note` VARCHAR(255) NULL,
    `is_active` TINYINT NOT NULL DEFAULT 1,
    `created_by` VARCHAR(100) NULL,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    INDEX `idx_l1_lexicon_lookup`(`list_type`, `match_mode`, `is_active`),
    INDEX `idx_l1_lexicon_pattern`(`pattern`),
    UNIQUE INDEX `uq_l1_lexicon_entry`(`list_type`, `match_mode`, `pattern`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
