// Barcode numbers (UPC-A, EAN-13, EAN-8, GTIN-14) with check-digit validation.

export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  // 8 digits starting with 0 or 1 are read as UPC-E (the US short code) and filed under the UPC-A they
  // stand for, so both print forms of one product share a key. EAN-8s with those prefixes are in-store
  // codes, rarely on retail packaging.
  if (digits.length === 8 && /^[01]/.test(digits)) {
    const upcA = expandUpcE(digits);
    if (validCheckDigit(upcA)) return upcA.padStart(14, "0");
  }
  if (!validCheckDigit(digits)) return null;
  return digits.padStart(14, "0"); // one canonical key per product
}

// UPC-E (number system, six digits, check digit) → the 12-digit UPC-A it compresses.
export function expandUpcE(upcE: string): string {
  const [ns, d1, d2, d3, d4, d5, d6, check] = upcE;
  const body =
    d6 <= "2" ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
    : d6 === "3" ? `${d1}${d2}${d3}00000${d4}${d5}`
    : d6 === "4" ? `${d1}${d2}${d3}${d4}00000${d5}`
    : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return ns + body + check;
}

export function validCheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  // Weights alternate 3,1,3,1... starting from the digit next to the check digit.
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export function withCheckDigit(body: string): string {
  for (let d = 0; d <= 9; d++) if (validCheckDigit(body + d)) return body + d;
  throw new Error("unreachable");
}
