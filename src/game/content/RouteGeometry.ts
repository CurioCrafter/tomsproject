import type {
  CampaignRouteDefinition,
  RouteBranchSectionDefinition,
  RouteSectionDefinition,
  RouteShape,
  Vec2Tuple,
} from './RouteTypes';

export type AnyRouteSection = RouteSectionDefinition | RouteBranchSectionDefinition;

export type RouteSurface = Readonly<{
  section: AnyRouteSection;
  elevation: number;
}>;

export function getAllRouteSections(route: CampaignRouteDefinition): readonly AnyRouteSection[] {
  return [...route.sections, ...(route.branchSections ?? [])];
}

export function pointInRouteShape(shape: RouteShape, point: Vec2Tuple, margin = 0): boolean {
  const dx = point[0] - shape.center[0];
  const dz = point[1] - shape.center[1];
  if (shape.kind === 'circle') {
    const radius = Math.max(0, shape.radius + margin);
    return dx * dx + dz * dz <= radius * radius;
  }
  const cosine = Math.cos(shape.rotation);
  const sine = Math.sin(shape.rotation);
  const localX = cosine * dx + sine * dz;
  const localZ = -sine * dx + cosine * dz;
  return (
    Math.abs(localX) <= Math.max(0, shape.halfExtents[0] + margin) &&
    Math.abs(localZ) <= Math.max(0, shape.halfExtents[1] + margin)
  );
}

export function pointInRouteSection(section: AnyRouteSection, point: Vec2Tuple, margin = 0): boolean {
  return section.walkable.some((shape) => pointInRouteShape(shape, point, margin));
}

function forwardSupport(shape: RouteShape, forward: Vec2Tuple): number {
  if (shape.kind === 'circle') return shape.radius;
  const cosine = Math.cos(shape.rotation);
  const sine = Math.sin(shape.rotation);
  const axisX: Vec2Tuple = [cosine, sine];
  const axisZ: Vec2Tuple = [-sine, cosine];
  return (
    Math.abs(forward[0] * axisX[0] + forward[1] * axisX[1]) * shape.halfExtents[0] +
    Math.abs(forward[0] * axisZ[0] + forward[1] * axisZ[1]) * shape.halfExtents[1]
  );
}

export function routeSectionElevationAt(section: AnyRouteSection, point: Vec2Tuple): number {
  const profile = section.elevation;
  if (!profile) return 0;
  if (Math.abs(profile.end - profile.start) < 0.0001) return profile.start;
  const forwardLength = Math.hypot(section.cameraForward[0], section.cameraForward[1]) || 1;
  const forward: Vec2Tuple = [section.cameraForward[0] / forwardLength, section.cameraForward[1] / forwardLength];
  const containing = section.walkable.find((shape) => pointInRouteShape(shape, point)) ?? section.walkable[0];
  if (!containing) return profile.start;
  const support = Math.max(0.001, forwardSupport(containing, forward));
  const landingDepth = section.kind === 'stair'
    ? Math.max(0, Math.min(section.elevation?.landingDepth ?? 0, support - 0.001))
    : 0;
  const transitionSupport = Math.max(0.001, support - landingDepth);
  const projection =
    (point[0] - containing.center[0]) * forward[0] +
    (point[1] - containing.center[1]) * forward[1];
  const ratio = Math.max(0, Math.min(1, projection / (transitionSupport * 2) + 0.5));
  return profile.start + (profile.end - profile.start) * ratio;
}

/**
 * Resolves a stable authored surface from the currently eligible route. A
 * connected stair may take ownership while it still overlaps a flat landing;
 * once on that stair, ownership remains stable until the body leaves it.
 */
export function resolveRouteSurface(
  sections: readonly AnyRouteSection[],
  point: Vec2Tuple,
  referenceElevation: number,
  currentSectionId: string | null = null,
): RouteSurface | null {
  const candidates = sections
    .filter((section) => pointInRouteSection(section, point, 0.08))
    .map((section) => ({ section, elevation: routeSectionElevationAt(section, point) }));
  if (candidates.length === 0) return null;

  const current = currentSectionId
    ? sections.find((section) => section.id === currentSectionId) ?? null
    : null;
  const currentCandidate = current
    ? candidates.find((candidate) => candidate.section.id === current.id) ?? null
    : null;

  if (currentCandidate?.section.kind === 'stair') {
    const profile = currentCandidate.section.elevation;
    const reachedEndLanding = profile && Math.abs(currentCandidate.elevation - profile.end) <= 0.02;
    if (reachedEndLanding) {
      const destination = candidates
        .filter((candidate) => (
          candidate.section.kind !== 'stair'
          && (
            currentCandidate.section.connectsTo.includes(candidate.section.id)
            || candidate.section.connectsTo.includes(currentCandidate.section.id)
          )
          && Math.abs(candidate.elevation - profile.end) <= 0.12
        ))
        .sort((first, second) => (
          Math.hypot(point[0] - first.section.walkable[0].center[0], point[1] - first.section.walkable[0].center[1])
          - Math.hypot(point[0] - second.section.walkable[0].center[0], point[1] - second.section.walkable[0].center[1])
        ))[0];
      if (destination) return destination;
    }
    return currentCandidate;
  }

  if (current) {
    const enteringStair = candidates
      .filter((candidate) => (
        candidate.section.kind === 'stair'
        && (current.connectsTo.includes(candidate.section.id) || candidate.section.connectsTo.includes(current.id))
        && Math.abs(candidate.elevation - referenceElevation) <= 0.3
        && Math.abs(candidate.elevation - (candidate.section.elevation?.start ?? candidate.elevation)) <= 0.12
      ))
      .sort((first, second) => (
        Math.abs(first.elevation - referenceElevation) - Math.abs(second.elevation - referenceElevation)
      ))[0];
    if (enteringStair) return enteringStair;
    if (currentCandidate) return currentCandidate;

    const connected = candidates
      .filter((candidate) => (
        current.connectsTo.includes(candidate.section.id) || candidate.section.connectsTo.includes(current.id)
      ));
    if (connected.length > 0) {
      return connected.reduce((closest, candidate) => (
        Math.abs(candidate.elevation - referenceElevation) < Math.abs(closest.elevation - referenceElevation)
          ? candidate
          : closest
      ));
    }
  }

  return candidates.reduce((closest, candidate) => (
    Math.abs(candidate.elevation - referenceElevation) < Math.abs(closest.elevation - referenceElevation)
      ? candidate
      : closest
  ));
}

export function routeElevationAt(route: CampaignRouteDefinition, point: Vec2Tuple): number {
  const sections = getAllRouteSections(route).filter((section) => pointInRouteSection(section, point, 0.08));
  if (sections.length === 0) return 0;
  // At overlaps prefer the section whose surface is highest, preventing the
  // player from dipping beneath an upper stair or balcony connection.
  return Math.max(...sections.map((section) => routeSectionElevationAt(section, point)));
}

/**
 * Resolves stacked walkable surfaces without snapping a moving body onto the
 * highest nearby stair or balcony. The caller supplies its current height, so
 * the surface it is already following wins until it actually leaves it.
 */
export function routeElevationAtClosest(
  route: CampaignRouteDefinition,
  point: Vec2Tuple,
  referenceElevation: number,
): number {
  const sections = getAllRouteSections(route).filter((section) => pointInRouteSection(section, point, 0.08));
  if (sections.length === 0) return 0;
  return sections
    .map((section) => routeSectionElevationAt(section, point))
    .reduce((closest, elevation) => (
      Math.abs(elevation - referenceElevation) < Math.abs(closest - referenceElevation) ? elevation : closest
    ));
}
