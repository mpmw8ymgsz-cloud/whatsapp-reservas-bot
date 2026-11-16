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

function readAdminAlertTemplate(value) {
  const env = { ...process.env };
  if (value === undefined) delete env.ADMIN_ALERT_TEMPLATE;
  else env.ADMIN_ALERT_TEMPLATE = value;
  const result = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(require('./src/config').adminAlertTemplate)"],
    { cwd: root, env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('config.adminAlertTemplate', () => {
  it('uses aviso_solicitud_presupuesto when ADMIN_ALERT_TEMPLATE is missing', () => {
    assert.equal(readAdminAlertTemplate(undefined), 'aviso_solicitud_presupuesto');
  });

  it('lets ADMIN_ALERT_TEMPLATE override the default', () => {
    assert.equal(readAdminAlertTemplate('aviso_custom'), 'aviso_custom');
    assert.equal(readAdminAlertTemplate('  aviso_custom  '), 'aviso_custom');
  });
});

function readConfig(expression, overrides = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(process.execPath, ['-e', `process.stdout.write(String(${expression}))`], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('config de avisos por correo', () => {
  const cleared = {
    ALERT_EMAIL: undefined,
    ALERT_EMAIL_FROM: undefined,
    ALERT_EMAIL_FROM_NAME: undefined,
    BREVO_API_KEY: undefined,
  };

  it('usa reservas@donfadrique.com si no hay destinatario ni remitente', () => {
    assert.equal(readConfig("require('./src/config').alertEmail", cleared), 'reservas@donfadrique.com');
    assert.equal(readConfig("require('./src/config').alertEmailFrom", cleared), 'reservas@donfadrique.com');
    assert.equal(readConfig("require('./src/config').alertEmailFromName", cleared), 'Hostería Don Fadrique');
    assert.equal(readConfig("require('./src/config').brevoApiKey", cleared), '');
  });

  it('recorta las variables y deja el valor que se configure', () => {
    assert.equal(
      readConfig("require('./src/config').alertEmail", { ALERT_EMAIL: '  equipo@ejemplo.com  ' }),
      'equipo@ejemplo.com'
    );
    assert.equal(
      readConfig("require('./src/config').alertEmailFrom", { ALERT_EMAIL_FROM: ' avisos@ejemplo.com ' }),
      'avisos@ejemplo.com'
    );
    assert.equal(readConfig("require('./src/config').brevoApiKey", { BREVO_API_KEY: '  xkeysib-test  ' }), 'xkeysib-test');
    assert.equal(readConfig("require('./src/config').alertEmail", { ALERT_EMAIL: '   ' }), 'reservas@donfadrique.com');
  });
});

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
