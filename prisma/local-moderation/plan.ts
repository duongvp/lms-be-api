export const moderationTables = ['chat_l1_settings', 'chat_l1_lexicon', 'chat_jev_policy_versions',
  'chat_jev_bindings', 'chat_jev_student_states', 'chat_jev_audit_events'] as const;

/** Never allow this local bootstrap to target a remote database or another local schema. */
export function assertLocalModerationUrl(raw: string | undefined) {
  const url = new URL(raw || '');
  if (url.protocol !== 'mysql:' || url.hostname !== 'localhost' || (url.port || '3306') !== '3306'
    || url.pathname !== '/livestream_local' || decodeURIComponent(url.username) !== 'dev'
    || decodeURIComponent(url.password) !== '123456' || url.hash) {
    throw new Error('LOCAL_MODERATION_TARGET_REJECTED');
  }
  return raw!;
}

/** Extract only the six CREATE TABLE statements. FK definitions apply only to newly created tables. */
export function localModerationPlan(l1Sql: string, jevSql: string, existing: Set<string>) {
  const statements = new Map<string, string>();
  for (const match of (l1Sql + '\n' + jevSql).matchAll(/CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)` \([\s\S]*?;(?=\s|$)/g)) {
    const name = match[1];
    if (!(moderationTables as readonly string[]).includes(name) || statements.has(name)) throw Error('UNEXPECTED_LOCAL_DDL');
    let sql = match[0];
    if (name === 'chat_jev_bindings') sql = sql.replace(/\n\) DEFAULT/, ',\n    CONSTRAINT fk_jev_compact_binding_policy FOREIGN KEY (policy_version_id) REFERENCES chat_jev_policy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT\n) DEFAULT');
    if (name === 'chat_jev_audit_events') sql = sql.replace(/\n\) DEFAULT/, ',\n    INDEX idx_jev_compact_audit_policy(policy_version_id),\n    CONSTRAINT fk_jev_compact_audit_policy FOREIGN KEY (policy_version_id) REFERENCES chat_jev_policy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT\n) DEFAULT');
    statements.set(name, sql);
  }
  if (statements.size !== moderationTables.length) throw Error('INCOMPLETE_LOCAL_DDL');
  return moderationTables.filter(name => !existing.has(name)).map(name => ({ name, sql: statements.get(name)! }));
}
