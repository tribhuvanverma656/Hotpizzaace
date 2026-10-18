// @ts-ignore
import PaytmChecksum from 'paytmchecksum';

export async function generatePaytmTxnToken(orderId: string, amount: string, customerId: string) {
  const paytmParams: Record<string, any> = {};

  paytmParams.body = {
    requestType: "Payment",
    mid: process.env.NEXT_PUBLIC_PAYTM_MID,
    websiteName: process.env.NEXT_PUBLIC_PAYTM_WEBSITE || "WEBSTAGING",
    orderId: orderId,
    callbackUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/paytm/callback`,
    txnAmount: {
      value: amount,
      currency: "INR",
    },
    userInfo: {
      custId: customerId,
    },
  };

  const checksum = await PaytmChecksum.generateSignature(
    JSON.stringify(paytmParams.body),
    process.env.PAYTM_MERCHANT_KEY || ''
  );

  paytmParams.head = { signature: checksum };

  const response = await fetch(
    `https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction?mid=${process.env.NEXT_PUBLIC_PAYTM_MID}&orderId=${orderId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paytmParams),
    }
  );

  return response.json();
}
