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

function readConfigField(field, envName, value) {
  const env = { ...process.env };
  if (value === undefined) delete env[envName];
  else env[envName] = value;
  const result = spawnSync(
    process.execPath,
    ['-e', `process.stdout.write(String(require('./src/config').${field} ?? ''))`],
    { cwd: root, env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('correo de avisos', () => {
  it('usa reservas@donfadrique.com si ADMIN_ALERT_EMAIL no está', () => {
    assert.equal(readConfigField('adminAlertEmail', 'ADMIN_ALERT_EMAIL', undefined), 'reservas@donfadrique.com');
    assert.equal(readConfigField('adminAlertEmail', 'ADMIN_ALERT_EMAIL', '   '), 'reservas@donfadrique.com');
  });

  it('deja cambiar el destinatario', () => {
    assert.equal(
      readConfigField('adminAlertEmail', 'ADMIN_ALERT_EMAIL', '  equipo@donfadrique.com  '),
      'equipo@donfadrique.com'
    );
  });

  it('no tiene API key hasta que se configura Resend', () => {
    assert.equal(readConfigField('resendApiKey', 'RESEND_API_KEY', undefined), '');
    assert.equal(readConfigField('resendApiKey', 'RESEND_API_KEY', '   '), '');
    assert.equal(readConfigField('resendApiKey', 'RESEND_API_KEY', 're_test'), 're_test');
  });

  it('el remitente por defecto es avisos@ en el dominio del hotel', () => {
    assert.equal(
      readConfigField('alertFromEmail', 'ALERT_FROM_EMAIL', undefined),
      'Hostería Don Fadrique <avisos@donfadrique.com>'
    );
    assert.equal(
      readConfigField('alertFromEmail', 'ALERT_FROM_EMAIL', 'Reservas <reservas@donfadrique.com>'),
      'Reservas <reservas@donfadrique.com>'
    );
  });
});
