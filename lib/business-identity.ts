/** Owner-supplied public business information; this is not a licence-validity check. */
export const publicBusinessIdentity = {
  name: 'HOT PIZZA ACE',
  address: 'ME346, Near Ram Janki Mandir, Barra 2, Kanpur, Uttar Pradesh 208027',
  gstin: '09ANCPV1491R1Z3',
} as const;

/** Customer grievance details confirmed by the restaurant for public display. */
export const publicGrievanceContact = {
  role: 'Customer grievance contact',
  name: 'Ashish Verma',
  email: 'tradersverma01@gmail.com',
  phone: '+91 70815 55055',
} as const;

/** Food-business registrations are outlet-specific. Never infer one for a new branch. */
const branchRegistrations = [
  { branchId: 'barra', branchName: 'Barra', fssaiNumber: '12721045000614' },
] as const;

export function getPublicBranchRegistration(branchId: string) {
  return branchRegistrations.find((registration) => registration.branchId === branchId);
}
