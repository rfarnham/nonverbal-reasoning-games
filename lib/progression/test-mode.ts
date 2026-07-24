import {
  findJourneyNode,
  isJourneyNodeUnlocked,
} from "./journey.ts";
import type {
  JourneyPlan,
  PlayerProfile,
} from "./types.ts";

export const JOURNEY_TEST_PROFILE_NAME = "testUser123";

type JourneyAccessProfile = Pick<
  PlayerProfile,
  "name" | "clearedStopIds"
>;

/**
 * Journey test mode is deliberately local and profile-scoped. The exact,
 * case-sensitive display name is the opt-in so normal players cannot enter it
 * through a partial match or an unrelated setting.
 */
export function isJourneyTestProfile(
  profile: Pick<PlayerProfile, "name">,
): boolean {
  return profile.name === JOURNEY_TEST_PROFILE_NAME;
}

/**
 * Test profiles may open any real node in their snapshotted Journey. All
 * canonical node and attempt-integrity checks still run at their usual layers.
 */
export function canPlayerAccessJourneyNode(
  profile: JourneyAccessProfile,
  journey: JourneyPlan,
  stopId: string,
): boolean {
  if (!findJourneyNode(journey, stopId)) return false;
  return (
    isJourneyTestProfile(profile) ||
    isJourneyNodeUnlocked(journey, profile.clearedStopIds, stopId)
  );
}
