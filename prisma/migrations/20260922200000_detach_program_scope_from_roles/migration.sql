-- Materialize every existing administrator's effective role scope at user level.
-- After this migration, authorization no longer reads role program scopes.
INSERT INTO `scope_resources`
  (`scopeType`, `scopeKey`, `displayName`, `status`, `createdAt`, `updatedAt`)
SELECT
  'PROGRAM', role_scope.`subjectCode`, MAX(lesson.`subject_name`),
  'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `role_program_scopes` role_scope
LEFT JOIN `lessons` lesson
  ON lesson.`subject_code` = role_scope.`subjectCode` AND lesson.`status` <> 0
GROUP BY role_scope.`subjectCode`
ON DUPLICATE KEY UPDATE
  `displayName` = COALESCE(VALUES(`displayName`), `displayName`),
  `status` = 'ACTIVE',
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `user_program_scopes`
  (`userId`, `scopeResourceId`, `createdAt`)
SELECT DISTINCT
  restricted_user.`userId`, resource.`id`, CURRENT_TIMESTAMP(3)
FROM (
  SELECT user_role.`userId`, role_scope.`subjectCode`
  FROM `user_roles` user_role
  JOIN `roles` role_row
    ON role_row.`id` = user_role.`roleId` AND role_row.`isActive` = TRUE
  LEFT JOIN `role_program_scope_policies` role_policy
    ON role_policy.`roleId` = role_row.`id`
  LEFT JOIN `role_program_scopes` role_scope
    ON role_scope.`roleId` = role_row.`id`
  LEFT JOIN `user_program_scope_policies` user_policy
    ON user_policy.`userId` = user_role.`userId`
  WHERE user_policy.`userId` IS NULL
  GROUP BY user_role.`userId`, role_scope.`subjectCode`
  HAVING MAX(CASE
    WHEN role_row.`code` = 'admin'
      OR role_policy.`mode` IS NULL
      OR role_policy.`mode` = 'ALL'
    THEN 1 ELSE 0 END) = 0
    AND MAX(CASE WHEN role_policy.`mode` = 'RESTRICTED' THEN 1 ELSE 0 END) = 1
) restricted_user
JOIN `scope_resources` resource
  ON resource.`scopeType` = 'PROGRAM'
  AND resource.`scopeKey` = restricted_user.`subjectCode`;

INSERT INTO `user_program_scope_policies`
  (`userId`, `mode`, `createdAt`, `updatedAt`)
SELECT
    user_role.`userId`,
    CASE
      WHEN MAX(CASE
        WHEN role_row.`code` = 'admin'
          OR role_policy.`mode` IS NULL
          OR role_policy.`mode` = 'ALL'
        THEN 1 ELSE 0 END) = 1 THEN 'ALL'
      WHEN MAX(CASE WHEN role_policy.`mode` = 'RESTRICTED' THEN 1 ELSE 0 END) = 1
        THEN 'RESTRICTED'
      ELSE 'DENY'
    END,
    CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `user_roles` user_role
JOIN `roles` role_row
  ON role_row.`id` = user_role.`roleId` AND role_row.`isActive` = TRUE
LEFT JOIN `role_program_scope_policies` role_policy
  ON role_policy.`roleId` = role_row.`id`
LEFT JOIN `user_program_scope_policies` user_policy
  ON user_policy.`userId` = user_role.`userId`
WHERE user_policy.`userId` IS NULL
GROUP BY user_role.`userId`;
