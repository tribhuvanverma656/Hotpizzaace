'use client';

import type { LocalRole } from '@/lib/local-pos/database';
import styles from './role-tabs.module.css';

export const roleTabLabels: Record<LocalRole, string> = {
  kitchen: 'Kitchen',
  super_user: 'Super User',
  pos_manager: 'POS Manager',
};

const roles: LocalRole[] = ['kitchen', 'super_user', 'pos_manager'];

export function LocalPosRoleTabs({
  currentRole,
  onSelect,
  disabled = false,
}: {
  currentRole: LocalRole;
  onSelect: (role: LocalRole) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={styles.tabs}
      role="group"
      aria-label="Choose account role"
      title="Switching roles signs out and requires that role's credentials."
    >
      {roles.map((role) => (
        <button
          key={role}
          type="button"
          aria-pressed={currentRole === role}
          className={currentRole === role ? styles.active : ''}
          disabled={disabled}
          onClick={() => onSelect(role)}
        >
          {roleTabLabels[role]}
        </button>
      ))}
    </div>
  );
}
