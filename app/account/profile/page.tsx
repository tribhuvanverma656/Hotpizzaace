import { CustomerGoogleAccount } from '@/components/customer-google-account';
import '@/components/customer-login.css';

export const metadata = { title: 'My account' };

export default function CustomerProfilePage() {
  return <CustomerGoogleAccount />;
}
