// Placement reservation.
//
// Modelled on Terraria's `StructureMap`, which exists for one reason: a generator
// that places features independently will eventually place two on top of each other,
// and the result is not a happy accident but a ruined room. Every pass that stamps
// something asks `canPlace` first and calls `reserve` after.
//
// The padding argument is the part that matters in practice. Two rooms that merely
// fail to overlap still read as one confused space when they end up two cells apart,
// so features reserve a margin around themselves and the margin is what actually
// produces legible, separated places.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class StructureMap {
  private readonly reserved: Rect[] = [];

  get count(): number {
    return this.reserved.length;
  }

  /** Everything reserved so far, for reporting and tests. */
  get rects(): readonly Rect[] {
    return this.reserved;
  }

  /**
   * Is `area`, grown by `padding` on every side, clear of everything reserved?
   *
   * Note the asymmetry with `reserve`: the *query* is padded, not the stored rect.
   * That way a caller can demand a wide berth for a hall while a small feature
   * placed later only needs its own clearance, rather than every rectangle carrying
   * one global margin.
   */
  canPlace(area: Rect, padding = 0): boolean {
    const left = area.x - padding;
    const top = area.y - padding;
    const right = area.x + area.width + padding;
    const bottom = area.y + area.height + padding;
    for (const rect of this.reserved) {
      if (left < rect.x + rect.width && right > rect.x && top < rect.y + rect.height && bottom > rect.y) {
        return false;
      }
    }
    return true;
  }

  reserve(area: Rect): void {
    this.reserved.push({ ...area });
  }
}
