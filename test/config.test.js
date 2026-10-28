const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const NICO_PHONE = '34661724158';

function readAdminPhone(adminPhone) {
  const env = { ...process.env };
  if (adminPhone === undefined) delete env.ADMIN_PHONE;
  else env.ADMIN_PHONE = adminPhone;

  const result = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(require('./src/config').adminPhone)"],
    { cwd: root, env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('config.adminPhone', () => {
  it('uses Nicolás Sánchez Monge when ADMIN_PHONE is missing', () => {
    assert.equal(readAdminPhone(undefined), NICO_PHONE);
  });

  it('uses Nicolás Sánchez Monge when ADMIN_PHONE is blank', () => {
    assert.equal(readAdminPhone(''), NICO_PHONE);
    assert.equal(readAdminPhone('   '), NICO_PHONE);
  });

  it('lets ADMIN_PHONE override the default', () => {
    assert.equal(readAdminPhone('34600000000'), '34600000000');
    assert.equal(readAdminPhone('  34611111111  '), '34611111111');
  });
});
