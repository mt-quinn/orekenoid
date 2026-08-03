export function calculateClaimDamage(remainingLiableBricks: number, soakCapacity: number): number {
  return Math.max(0, Math.floor(remainingLiableBricks) - Math.max(0, Math.floor(soakCapacity)));
}
