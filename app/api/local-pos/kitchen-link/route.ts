import { networkInterfaces } from 'node:os';
import { localPosJson, logLocalPosFailure, requireLocalPosUser } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return false;

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export async function GET(request: Request) {
  try {
    await requireLocalPosUser(['super_user', 'pos_manager']);
    const port = new URL(request.url).port || '3000';
    const links = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => address.family === 'IPv4' && !address.internal)
        .filter((address) => isPrivateIPv4(address.address))
        .map((address) => ({
          interface: name,
          url: `http://${address.address}:${port}/local-pos/kitchen`,
        })),
    );

    return localPosJson({ links });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
