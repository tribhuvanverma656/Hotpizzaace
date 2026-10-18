export function normalizeCustomerPhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  const national = compact.replace(/^\+?91(?=[6-9]\d{9}$)/, '');
  if (!/^[6-9]\d{9}$/.test(national))
    throw new Error('Enter a valid 10-digit Indian mobile number.');
  return national;
}

export function verifyDemoCustomerLogin(phone: string, code: string) {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (code.trim() !== '123456') throw new Error('Use the demo code 123456. No SMS is sent.');
  return { phone: normalizedPhone };
}
