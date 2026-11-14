'use strict';
/**
 * SMARTFUZE AQUA - role-based access control.
 * Every API request is checked here on the server; hiding buttons in the browser is only cosmetic.
 * Unknown routes are denied by default.
 */
const ROLES = {
  founder:  { label: 'Founder / Super Admin', labelZh: '创始人 / 超级管理员' },
  admin:    { label: 'Admin / Finance', labelZh: '管理 / 财务' },
  operator: { label: 'Farm Operator', labelZh: '养殖操作员' },
  advisor:  { label: 'Technical Advisor', labelZh: '技术顾问' },
  auditor:  { label: 'External Auditor', labelZh: '外部审计（只读）' },
  investor: { label: 'Investor Viewer', labelZh: '投资人（只读）' }
};

const PERMS = {
  founder: ['*'],
  admin: ['monitor.read', 'ops.write', 'config.write', 'poc.read', 'poc.write', 'poc.review',
          'finance.read', 'finance.write', 'finance.approve',
          'evidence.read', 'evidence.read.all', 'evidence.write', 'evidence.verify', 'audit.read'],
  operator: ['monitor.read', 'ops.write', 'poc.read', 'evidence.read', 'evidence.write'],
  advisor:  ['monitor.read', 'ops.write', 'poc.read', 'poc.review', 'evidence.read', 'evidence.write'],
  auditor:  ['monitor.read', 'poc.read', 'finance.read', 'evidence.read', 'evidence.read.all', 'audit.read'],
  investor: [],           // Investor Center (published reports only) arrives in v2.1.2
  // Anonymous visitor on a LOCAL install (v2.0 behaviour: monitoring stays open on the farm LAN).
  // Business data (POC, finance, evidence, audit, users) always needs a signed-in account.
  local: ['monitor.read', 'ops.write', 'config.write', 'settings.manage']
};

const can = (role, perm) => !!role && !!PERMS[role] && (PERMS[role].includes('*') || PERMS[role].includes(perm));

// [method, path regex, permission]. 'public' = no login; 'auth' = any signed-in user.
const RULES = [
  ['GET',    /^\/auth\/status$/, 'public'],
  ['POST',   /^\/auth\/(login|logout|setup)$/, 'public'],
  ['POST',   /^\/auth\/password$/, 'auth'],
  ['GET',    /^\/me$/, 'auth'],
  ['*',      /^\/users(\/.*)?$/, 'users.manage'],
  ['*',      /^\/devices\/credentials(\/.*)?$/, 'secrets'],
  ['GET',    /^\/backup$/, 'secrets'],
  ['PUT',    /^\/settings$/, 'settings.manage'],
  ['POST',   /^\/notify\/test$/, 'settings.manage'],
  ['GET',    /^\/settings\/full$/, 'config.write'],
  ['GET',    /^\/audit(\/.*)?$/, 'audit.read'],
  // monitoring (v2.0)
  ['GET',    /^\/(info|system\/events|devices|controls|alerts|water|cycles|calibrations|feeding|feeding\/interlock|integrations|integrations\/catalog)$/, 'monitor.read'],
  ['GET',    /^\/ponds(\/[^/]+(\/(readings|export\.csv))?)?$/, 'monitor.read'],
  ['PATCH',  /^\/ponds\/[^/]+$/, 'config.write'],
  ['PUT',    /^\/ponds\/[^/]+\/profile$/, 'config.write'],
  ['*',      /^\/calibrations(\/[^/]+(\/activate)?)?$/, 'config.write'],
  ['POST',   /^\/integrations\/[^/]+\/opened$/, 'ops.write'],
  ['*',      /^\/integrations(\/[^/]+)?$/, 'config.write'],
  ['*',      /^\/feeding\/schedules(\/[^/]+)?$/, 'ops.write'],
  ['POST',   /^\/feeding\/feed$/, 'ops.write'],
  ['PUT',    /^\/alerts\/rules\/[^/]+$/, 'config.write'],
  ['POST',   /^\/alerts\/[^/]+\/ack$/, 'ops.write'],
  ['POST',   /^\/water$/, 'ops.write'],
  ['DELETE', /^\/water\/[^/]+$/, 'config.write'],
  ['PUT',    /^\/water\/limits$/, 'config.write'],
  ['*',      /^\/cycles(\/[^/]+(\/records(\/[^/]+)?)?)?$/, 'ops.write'],
  // POC research
  ['GET',    /^\/poc(\/.*)?$/, 'poc.read'],
  ['POST',   /^\/poc\/[^/]+\/reviews$/, 'poc.review'],
  ['*',      /^\/poc(\/.*)?$/, 'poc.write'],
  // finance
  ['GET',    /^\/finance(\/.*)?$/, 'finance.read'],
  ['POST',   /^\/finance\/expenses\/[^/]+\/(approve|reject)$/, 'finance.approve'],
  ['*',      /^\/finance(\/.*)?$/, 'finance.write'],
  // evidence vault
  ['GET',    /^\/evidence(\/.*)?$/, 'evidence.read'],
  ['POST',   /^\/evidence\/[^/]+\/(verify|archive|restore)$/, 'evidence.verify'],
  ['POST',   /^\/evidence(\/[^/]+\/versions)?$/, 'evidence.write'],
  ['PUT',    /^\/evidence\/[^/]+$/, 'evidence.write']
];

function permFor(method, path) {
  for (const [m, re, perm] of RULES) {
    if ((m === '*' || m === method) && re.test(path)) return perm;
  }
  return 'deny';
}

module.exports = { ROLES, PERMS, can, permFor, RULES };
