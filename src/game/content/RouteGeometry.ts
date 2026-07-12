import type {
  CampaignRouteDefinition,
  RouteBranchSectionDefinition,
  RouteSectionDefinition,
  RouteShape,
  Vec2Tuple,
} from './RouteTypes';

export type AnyRouteSection = RouteSectionDefinition | RouteBranchSectionDefinition;

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
  const projection =
    (point[0] - containing.center[0]) * forward[0] +
    (point[1] - containing.center[1]) * forward[1];
  const ratio = Math.max(0, Math.min(1, projection / (support * 2) + 0.5));
  return profile.start + (profile.end - profile.start) * ratio;
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
