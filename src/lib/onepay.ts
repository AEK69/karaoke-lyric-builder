// OnePay (Lao) dynamic QR generator with CRC16-CCITT (init 0xFFFF, poly 0x1021)
export const ONEPAY_STATIC_QR =
  "00020101021115312738041800520446mch19B73F61B9E038570016A00526628466257701082771041802030020314mch19B73F61B9E5204569153034185802LA5916AKAPHON XAYYABED6002VT62120208586625406304C735";

export const ONEPAY_QR_IMAGE_BASE =
  "https://api.qrserver.com/v1/create-qr-code/?size=320x320&ecc=H&data=";

function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function generateOnePayDynamicQR(amount: number): {
  qrCodeUrl: string;
  link: string;
  raw: string;
  amount: number;
} {
  const amountStr = amount.toFixed(2);
  const EMVamount = "54" + String(amountStr.length).padStart(2, "0") + amountStr;
  let base = ONEPAY_STATIC_QR;
  const idx = base.indexOf("6304");
  if (idx !== -1) base = base.slice(0, idx);
  // Insert amount before 5802 (country) — recompute by stripping any existing 54xx and inserting
  // Strategy: remove existing 54xx tag from base, then append EMVamount + "6304" + CRC
  base = base.replace(/54\d{2}[0-9.]+(?=5802)/, "");
  const qrNoCrc = base + EMVamount + "6304";
  const crc = crc16ccitt(qrNoCrc);
  const qrFull = qrNoCrc + crc;
  return {
    qrCodeUrl: ONEPAY_QR_IMAGE_BASE + encodeURIComponent(qrFull),
    link: `onepay://qr/${qrFull}`,
    raw: qrFull,
    amount,
  };
}
