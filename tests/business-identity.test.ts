import assert from 'node:assert/strict';
import test from 'node:test';
import { getPublicBranchRegistration, publicBusinessIdentity } from '../lib/business-identity';

test('public registrations retain GSTIN and FSSAI number formats', () => {
  assert.match(publicBusinessIdentity.gstin, /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/);
  const barra = getPublicBranchRegistration('barra');
  assert.ok(barra);
  assert.match(barra.fssaiNumber, /^\d{14}$/);
});

test('an unknown or future branch never inherits the Barra food-business registration', () => {
  for (const branchId of ['', 'another-branch', 'Barra', 'barra-east'])
    assert.equal(getPublicBranchRegistration(branchId), undefined);
});
