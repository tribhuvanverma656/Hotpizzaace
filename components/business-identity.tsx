import {
  getPublicBranchRegistration,
  publicBusinessIdentity,
  publicGrievanceContact,
} from '@/lib/business-identity';
import styles from './business-identity.module.css';

export function BusinessRegistrations({ branchId }: { branchId: string }) {
  const registration = getPublicBranchRegistration(branchId);
  return (
    <dl className={styles.registrations}>
      <div>
        <dt>GSTIN</dt>
        <dd>{publicBusinessIdentity.gstin}</dd>
      </div>
      {registration && (
        <div>
          <dt>FSSAI · {registration.branchName} outlet</dt>
          <dd>{registration.fssaiNumber}</dd>
        </div>
      )}
    </dl>
  );
}

/** The operator address and an explicitly named outlet registration are public disclosures. */
export function BusinessIdentity({
  branchId,
  appearance = 'default',
}: {
  branchId: string;
  appearance?: 'default' | 'footer';
}) {
  return (
    <div className={`${styles.identity} ${appearance === 'footer' ? styles.footer : ''}`}>
      <div className={styles.operator}>
        <strong>{publicBusinessIdentity.name}</strong>
        <address>
          <span>Business address</span>
          {publicBusinessIdentity.address}
        </address>
      </div>
      <BusinessRegistrations branchId={branchId} />
    </div>
  );
}

export function GrievanceContact() {
  const telephone = publicGrievanceContact.phone.replace(/[^+\d]/g, '');
  return (
    <div className={styles.grievance}>
      <strong className={styles.contactRole}>{publicGrievanceContact.role}</strong>
      <address>
        <span>{publicGrievanceContact.name}</span>
        <a href={`mailto:${publicGrievanceContact.email}`}>{publicGrievanceContact.email}</a>
        <a href={`tel:${telephone}`}>{publicGrievanceContact.phone}</a>
      </address>
    </div>
  );
}
