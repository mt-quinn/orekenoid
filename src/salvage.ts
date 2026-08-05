// The salvage drone's cut.
//
// Separated from the drone that draws it for the same reason the world raster is separated from
// the canvas it ends up on: this is arithmetic, and arithmetic should be testable in Node without
// a DOM. The view class builds a blur filter in its constructor, so it cannot even be
// instantiated outside a browser.

/**
 * Decides which rescued pieces the grinder eats.
 *
 * Not a coin flip per piece. A 50% chance gets the long-run average right and still eats six in a
 * row, which a player reads as the drone being broken rather than as a rate. Counting instead --
 * eat whenever the pieces seen so far entitle it to one more -- makes the share exact *and* the
 * short-run pattern legible: at half it strictly alternates, and it never takes the first piece,
 * so a newly fitted drone always pays out on its debut.
 */
export class Grinder {
  private tax = 0;
  private seen = 0;
  private eaten = 0;

  /**
   * Set the share kept, 0..1. Zero means no drone.
   *
   * Idempotent when the rate has not changed, so it is safe to call every frame -- which is how
   * the caller keeps the grinder in step with the economy. It used to reset unconditionally, which
   * made calling it repeatedly zero the count and eat nothing at all; and calling it only once per
   * claim meant a drone fitted between claims could catch everything while still taxing at the
   * previous rate. Cheap and always-correct beats clever and once.
   */
  configure(tax: number): void {
    const next = Math.max(0, Math.min(1, tax));
    if (next === this.tax) return;
    this.tax = next;
    this.seen = 0;
    this.eaten = 0;
  }

  /** One rescued piece. True means the grinder keeps it. */
  grinds(): boolean {
    if (this.tax <= 0) return false;
    this.seen += 1;
    // The epsilon is load-bearing: accumulating 0.3 a hundred times lands on 29.999999999999996,
    // so without it the hundredth piece of a 30% run is never taken and the share is short by one.
    const owed = Math.floor(this.seen * this.tax + 1e-9);
    if (owed <= this.eaten) return false;
    this.eaten = owed;
    return true;
  }
}
