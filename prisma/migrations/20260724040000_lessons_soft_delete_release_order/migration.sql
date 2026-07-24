UPDATE `lessons`
SET `learn_number` = -CAST(`id` AS SIGNED)
WHERE `status` = 0
  AND `learn_number` > 0;
